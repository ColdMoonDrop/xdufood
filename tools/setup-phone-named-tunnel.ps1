param(
  [string]$HostName = "",
  [int]$Port = 0,
  [string]$User = "",
  [string]$KeyPath = "",
  [string]$PublicHostname,
  [string]$Token,
  [string]$TokenFile,
  [switch]$NoStart,
  [switch]$NoBoot
)

$ErrorActionPreference = "Stop"

$LocalConfigPath = Join-Path $PSScriptRoot "phone.local.json"
$PhoneConfig = if (Test-Path -LiteralPath $LocalConfigPath) {
  Get-Content -Raw -LiteralPath $LocalConfigPath | ConvertFrom-Json
} else {
  [pscustomobject]@{}
}

$RemoteHome = "/data/data/com.termux/files/home"
$RemoteDataDir = "$RemoteHome/www/xdu-food-oracle/server-data"
$RemoteTokenPath = "$RemoteDataDir/cloudflare-named-tunnel.token"
$RemoteHostnamePath = "$RemoteDataDir/cloudflare-named-tunnel.hostname"
$RemoteStartScript = "$RemoteHome/start-xdu-food-named.sh"
$RemoteBootScript = "$RemoteHome/.termux/boot/start-xdu-food-public"

function Invoke-Native {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$StepName
  )

  Write-Host ""
  Write-Host "==> $StepName" -ForegroundColor Cyan
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$StepName failed with exit code $LASTEXITCODE"
  }
}

function Get-PhoneSetting {
  param([string]$Value, [string]$EnvName, [string]$ConfigName, [string]$DefaultValue = "")
  if ($Value) { return $Value }
  $EnvValue = [Environment]::GetEnvironmentVariable($EnvName)
  if ($EnvValue) { return $EnvValue }
  $ConfigValue = $PhoneConfig.$ConfigName
  if ($ConfigValue) { return [string]$ConfigValue }
  return $DefaultValue
}

function ConvertFrom-SecureStringPlainText {
  param([securestring]$SecureString)
  $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  } finally {
    if ($Bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
    }
  }
}

$HostName = Get-PhoneSetting $HostName "XDU_PHONE_HOST" "hostName" "192.168.3.85"
$User = Get-PhoneSetting $User "XDU_PHONE_USER" "user" "u0_a166"
$KeyPath = Get-PhoneSetting $KeyPath "XDU_PHONE_SSH_KEY" "keyPath"
if ($Port -le 0) {
  $ConfigPort = [int]($PhoneConfig.port ?? 0)
  $Port = if ($env:XDU_PHONE_PORT) { [int]$env:XDU_PHONE_PORT } elseif ($ConfigPort -gt 0) { $ConfigPort } else { 8022 }
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
  throw "SSH key not found: $KeyPath"
}

if (-not $Token -and $TokenFile) {
  if (-not (Test-Path -LiteralPath $TokenFile)) {
    throw "Token file not found: $TokenFile"
  }
  $Token = (Get-Content -Raw -LiteralPath $TokenFile).Trim()
}

if (-not $Token) {
  $SecureToken = Read-Host "Paste Cloudflare Tunnel token (input hidden)" -AsSecureString
  $Token = ConvertFrom-SecureStringPlainText $SecureToken
}

if (-not $Token -or -not $Token.Trim()) {
  throw "Cloudflare Tunnel token is required."
}

if ($PublicHostname -and $PublicHostname -notmatch "^https?://") {
  $PublicHostname = "https://$PublicHostname"
}

$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("xdu-named-tunnel-" + [guid]::NewGuid().ToString("N"))
$Remote = "${User}@${HostName}"
New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
  $TokenPath = Join-Path $TempDir "cloudflare-named-tunnel.token"
  $HostnamePath = Join-Path $TempDir "cloudflare-named-tunnel.hostname"
  $StartScriptPath = Join-Path $TempDir "start-xdu-food-named.sh"
  $BootScriptPath = Join-Path $TempDir "start-xdu-food-public"

  Set-Content -Path $TokenPath -Value $Token.Trim() -Encoding ascii -NoNewline
  Set-Content -Path $HostnamePath -Value (($PublicHostname ?? "").Trim() + "`n") -Encoding ascii

  $StartScript = @'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

APP_DIR="$HOME/www/xdu-food-oracle"
DATA_DIR="$APP_DIR/server-data"
LOG_FILE="$DATA_DIR/cloudflared-named.log"
PID_FILE="$DATA_DIR/cloudflared-named.pid"
URL_FILE="$DATA_DIR/public-url.txt"
TOKEN_FILE="$DATA_DIR/cloudflare-named-tunnel.token"
HOSTNAME_FILE="$DATA_DIR/cloudflare-named-tunnel.hostname"
CLOUDFLARED="$HOME/bin/cloudflared"
DNS_FILE="$DATA_DIR/resolv-cloudflared.conf"

mkdir -p "$DATA_DIR"
termux-wake-lock >/dev/null 2>&1 || true

if [ ! -x "$CLOUDFLARED" ]; then
  echo "cloudflared not found at $CLOUDFLARED" >&2
  exit 1
fi

if [ ! -s "$TOKEN_FILE" ]; then
  echo "Named Tunnel token not found at $TOKEN_FILE" >&2
  exit 1
fi

if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" >/dev/null 2>&1; then
    kill "$old_pid" >/dev/null 2>&1 || true
    sleep 1
  fi
fi

pkill -f "$CLOUDFLARED tunnel" >/dev/null 2>&1 || true
pkill -f "cloudflared tunnel" >/dev/null 2>&1 || true
sleep 1

: > "$LOG_FILE"
cat > "$DNS_FILE" <<'DNS'
nameserver 1.1.1.1
nameserver 8.8.8.8
DNS

nohup proot -b "$DNS_FILE:/etc/resolv.conf" env \
  SSL_CERT_FILE="$PREFIX/etc/tls/cert.pem" \
  "$CLOUDFLARED" tunnel \
  --no-autoupdate \
  --protocol http2 \
  run \
  --token-file "$TOKEN_FILE" > "$LOG_FILE" 2>&1 &

echo "$!" > "$PID_FILE"

for _ in $(seq 1 45); do
  if tr -d '\000' < "$LOG_FILE" | grep -q "Registered tunnel connection"; then
    hostname="$(cat "$HOSTNAME_FILE" 2>/dev/null || true)"
    if [ -n "$hostname" ]; then
      echo "$hostname" > "$URL_FILE"
      echo "$hostname"
    else
      echo "Named Tunnel connected. Public hostname is managed in Cloudflare."
    fi
    exit 0
  fi
  sleep 1
done

echo "Named Tunnel did not connect in time. Recent log:" >&2
tr -d '\000' < "$LOG_FILE" | tail -80 >&2
exit 2
'@

  $BootScript = @'
#!/data/data/com.termux/files/usr/bin/bash
if [ -s "$HOME/www/xdu-food-oracle/server-data/cloudflare-named-tunnel.token" ]; then
  "$HOME/start-xdu-food-named.sh" >/dev/null 2>&1 &
else
  "$HOME/start-xdu-food-public.sh" >/dev/null 2>&1 &
fi
'@

  Set-Content -Path $StartScriptPath -Value $StartScript -Encoding utf8
  Set-Content -Path $BootScriptPath -Value $BootScript -Encoding utf8

  Invoke-Native -FilePath "ssh" -ArgumentList @("-i", $KeyPath, "-p", "$Port", "-o", "StrictHostKeyChecking=accept-new", $Remote, "mkdir -p '$RemoteDataDir' '$RemoteHome/.termux/boot'") -StepName "Prepare phone directories"
  Invoke-Native -FilePath "scp" -ArgumentList @("-i", $KeyPath, "-P", "$Port", "-o", "StrictHostKeyChecking=accept-new", $TokenPath, "${Remote}:$RemoteTokenPath") -StepName "Upload tunnel token"
  Invoke-Native -FilePath "scp" -ArgumentList @("-i", $KeyPath, "-P", "$Port", "-o", "StrictHostKeyChecking=accept-new", $HostnamePath, "${Remote}:$RemoteHostnamePath") -StepName "Upload public hostname"
  Invoke-Native -FilePath "scp" -ArgumentList @("-i", $KeyPath, "-P", "$Port", "-o", "StrictHostKeyChecking=accept-new", $StartScriptPath, "${Remote}:$RemoteStartScript") -StepName "Upload named tunnel starter"

  if (-not $NoBoot) {
    Invoke-Native -FilePath "scp" -ArgumentList @("-i", $KeyPath, "-P", "$Port", "-o", "StrictHostKeyChecking=accept-new", $BootScriptPath, "${Remote}:$RemoteBootScript") -StepName "Install Termux:Boot tunnel starter"
  }

  Invoke-Native -FilePath "ssh" -ArgumentList @("-i", $KeyPath, "-p", "$Port", "-o", "StrictHostKeyChecking=accept-new", $Remote, "chmod 600 '$RemoteTokenPath' '$RemoteHostnamePath'; chmod +x '$RemoteStartScript' '$RemoteBootScript' 2>/dev/null || chmod +x '$RemoteStartScript'") -StepName "Secure phone tunnel files"

  if (-not $NoStart) {
    Invoke-Native -FilePath "ssh" -ArgumentList @("-i", $KeyPath, "-p", "$Port", "-o", "StrictHostKeyChecking=accept-new", $Remote, $RemoteStartScript) -StepName "Start named tunnel"
  }

  Write-Host ""
  Write-Host "Named Tunnel setup finished." -ForegroundColor Green
  if ($PublicHostname) {
    Write-Host "Public URL: $PublicHostname"
  }
} finally {
  if (Test-Path -LiteralPath $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force
  }
}


