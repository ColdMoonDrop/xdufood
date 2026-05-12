param(
  [string]$ApiBase,
  [string]$Base = "/",
  [string]$HostName = "",
  [int]$Port = 0,
  [string]$User = "",
  [string]$KeyPath = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LocalConfigPath = Join-Path $PSScriptRoot "phone.local.json"
$PhoneConfig = if (Test-Path -LiteralPath $LocalConfigPath) {
  Get-Content -Raw -LiteralPath $LocalConfigPath | ConvertFrom-Json
} else {
  [pscustomobject]@{}
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
if ($Port -le 0) {
  $ConfigPort = [int]($PhoneConfig.port ?? 0)
  $Port = if ($env:XDU_PHONE_PORT) { [int]$env:XDU_PHONE_PORT } elseif ($ConfigPort -gt 0) { $ConfigPort } else { 8022 }
}

if (-not $ApiBase) {
  if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "SSH key not found: $KeyPath. Pass -ApiBase or configure tools/phone.local.json."
  }
  $Remote = "${User}@${HostName}"
  $RemoteCommand = "cat /data/data/com.termux/files/home/www/xdu-food-oracle/server-data/public-url.txt"
  $ApiBase = (& ssh -i $KeyPath -p $Port -o BatchMode=yes -o StrictHostKeyChecking=accept-new $Remote $RemoteCommand).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to read phone public URL through SSH."
  }
}

$ApiBase = $ApiBase.TrimEnd("/")
if ($ApiBase -notmatch "^https://") {
  throw "GitHub Pages must call an HTTPS API base. Got: $ApiBase"
}

if (-not $Base.StartsWith("/")) {
  $Base = "/$Base"
}
if (-not $Base.EndsWith("/")) {
  $Base = "$Base/"
}

Push-Location $RepoRoot
try {
  $env:VITE_API_BASE = $ApiBase
  $env:VITE_PUBLIC_BASE = $Base
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed with exit code $LASTEXITCODE"
  }

  Copy-Item -LiteralPath (Join-Path $RepoRoot "dist/index.html") -Destination (Join-Path $RepoRoot "dist/404.html") -Force
  New-Item -ItemType File -Path (Join-Path $RepoRoot "dist/.nojekyll") -Force | Out-Null
  Set-Content -Path (Join-Path $RepoRoot "dist/github-pages-build.json") -Encoding utf8 -Value (@{
    apiBase = $ApiBase
    base = $Base
    builtAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Depth 3)
} finally {
  Remove-Item Env:\VITE_API_BASE -ErrorAction SilentlyContinue
  Remove-Item Env:\VITE_PUBLIC_BASE -ErrorAction SilentlyContinue
  Pop-Location
}

Write-Host ""
Write-Host "GitHub Pages build complete." -ForegroundColor Green
Write-Host "API base: $ApiBase"
Write-Host "Page base: $Base"
Write-Host "Output:   $RepoRoot\dist"
