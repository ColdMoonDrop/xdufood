param(
  [string]$HostName = "",
  [int]$Port = 0,
  [string]$User = "",
  [string]$KeyPath = "",
  [string]$AdbPath = "",
  [switch]$UseAdbIp,
  [string]$Command
)

$ErrorActionPreference = "Stop"

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

  Write-Host "Detecting phone WLAN IP through ADB..." -ForegroundColor Cyan
  $AdbOutput = & $AdbPath shell "ip -4 addr show wlan0"
  if ($LASTEXITCODE -ne 0) {
    throw "ADB IP detection failed with exit code $LASTEXITCODE"
  }

  $IpMatch = [regex]::Match(($AdbOutput -join "`n"), "inet\s+(\d+\.\d+\.\d+\.\d+)/")
  if (-not $IpMatch.Success) {
    throw "Could not find wlan0 IPv4 address from ADB output."
  }

  $HostName = $IpMatch.Groups[1].Value
  Write-Host "Detected phone IP: $HostName" -ForegroundColor Green
}

$SshArgs = @(
  "-i", $KeyPath,
  "-p", "$Port",
  "-o", "StrictHostKeyChecking=accept-new",
  "${User}@${HostName}"
)

if ($Command) {
  $SshArgs += $Command
}

& ssh @SshArgs
exit $LASTEXITCODE



