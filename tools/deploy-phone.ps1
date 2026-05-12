param(
  [string]$HostName = "",
  [int]$Port = 0,
  [string]$User = "",
  [string]$KeyPath = "",
  [string]$AdbPath = "",
  [switch]$UseAdbIp,
  [switch]$SkipBuild,
  [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LocalConfigPath = Join-Path $PSScriptRoot "phone.local.json"
$PhoneConfig = if (Test-Path -LiteralPath $LocalConfigPath) {
  Get-Content -Raw -LiteralPath $LocalConfigPath | ConvertFrom-Json
} else {
  [pscustomobject]@{}
}
$PackagePath = Join-Path $RepoRoot "xdu-food-oracle-runtime.tar.gz"
$RemotePackage = "/data/data/com.termux/files/home/xdu-food-oracle-runtime.tar.gz"
$RemoteApp = "/data/data/com.termux/files/home/www/xdu-food-oracle"
$RemoteRestartScript = "/data/data/com.termux/files/home/start-xdu-food.sh"

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

$HostName = Get-PhoneSetting $HostName "XDU_PHONE_HOST" "hostName" "192.168.3.85"
$User = Get-PhoneSetting $User "XDU_PHONE_USER" "user" "u0_a166"
$KeyPath = Get-PhoneSetting $KeyPath "XDU_PHONE_SSH_KEY" "keyPath"
$AdbPath = Get-PhoneSetting $AdbPath "XDU_PHONE_ADB" "adbPath"
if ($Port -le 0) {
  $ConfigPort = [int]($PhoneConfig.port ?? 0)
  $Port = if ($env:XDU_PHONE_PORT) { [int]$env:XDU_PHONE_PORT } elseif ($ConfigPort -gt 0) { $ConfigPort } else { 8022 }
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
  throw "SSH key not found: $KeyPath"
}

if ($UseAdbIp) {
  if (-not (Test-Path -LiteralPath $AdbPath)) {
    throw "ADB not found: $AdbPath"
  }

  Write-Host ""
  Write-Host "==> Detect phone WLAN IP through ADB" -ForegroundColor Cyan
  $AdbOutput = & $AdbPath shell "ip -4 addr show wlan0"
  if ($LASTEXITCODE -ne 0) {
    throw "ADB IP detection failed with exit code $LASTEXITCODE"
  }

  $IpMatch = [regex]::Match(($AdbOutput -join "`n"), "inet\s+(\d+\.\d+\.\d+\.\d+)/")
  if (-not $IpMatch.Success) {
    throw "Could not find wlan0 IPv4 address from ADB output."
  }

  $HostName = $IpMatch.Groups[1].Value
  Write-Host "Detected phone IP: $HostName"
}

if (-not $SkipBuild) {
  Push-Location $RepoRoot
  try {
    Invoke-Native -FilePath "npm" -ArgumentList @("run", "build") -StepName "Build web app"
  } finally {
    Pop-Location
  }
}

Invoke-Native `
  -FilePath "tar" `
  -ArgumentList @("-czf", $PackagePath, "-C", $RepoRoot, "dist", "server", "package.json", "package-lock.json") `
  -StepName "Package runtime bundle"

$RemoteTarget = "${User}@${HostName}:$RemotePackage"
Invoke-Native `
  -FilePath "scp" `
  -ArgumentList @("-i", $KeyPath, "-P", "$Port", "-o", "StrictHostKeyChecking=accept-new", $PackagePath, $RemoteTarget) `
  -StepName "Upload bundle over LAN SSH"

$RestartLine = if ($NoRestart) { "true # restart skipped by -NoRestart" } else { $RemoteRestartScript }
$RemoteScript = @'
set -e
APP="__REMOTE_APP__"
tar -xzf "__REMOTE_PACKAGE__" -C "$APP"
__RESTART_LINE__
sleep 2
curl -sS http://127.0.0.1:8080/api/health
'@

$RemoteScript = $RemoteScript.Replace("__REMOTE_APP__", $RemoteApp)
$RemoteScript = $RemoteScript.Replace("__REMOTE_PACKAGE__", $RemotePackage)
$RemoteScript = $RemoteScript.Replace("__RESTART_LINE__", $RestartLine)

Invoke-Native `
  -FilePath "ssh" `
  -ArgumentList @("-o", "BatchMode=yes", "-i", $KeyPath, "-p", "$Port", "-o", "StrictHostKeyChecking=accept-new", "${User}@${HostName}", $RemoteScript) `
  -StepName "Extract bundle and check phone service"

Write-Host ""
Write-Host "Phone deployment finished." -ForegroundColor Green
Write-Host "Frontend: http://$HostName`:8080/"
Write-Host "Admin:    http://$HostName`:8080/admin"




