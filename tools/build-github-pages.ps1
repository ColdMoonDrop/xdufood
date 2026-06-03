param(
  [string]$ApiBase,
  [string]$Base = "/"
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ApiBase = if ($ApiBase) { $ApiBase } elseif ($env:VITE_API_BASE) { $env:VITE_API_BASE } elseif ($env:XDUFOOD_API_BASE) { $env:XDUFOOD_API_BASE } else { "" }

if (-not $ApiBase) {
  throw "Missing API base. Pass -ApiBase or set VITE_API_BASE/XDUFOOD_API_BASE before running this script."
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
