$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$VenvDir = Join-Path $ScriptDir ".venv"
$Requirements = Join-Path $ScriptDir "requirements.txt"
$BundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

function Resolve-Python {
  if ($env:XDU_OCR_PYTHON -and (Test-Path $env:XDU_OCR_PYTHON)) {
    return $env:XDU_OCR_PYTHON
  }
  if (Test-Path $BundledPython) {
    return $BundledPython
  }
  $py312 = Get-Command py -ErrorAction SilentlyContinue
  if ($py312) {
    return "py -3.12"
  }
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return $python.Source
  }
  throw "No Python runtime found. Set XDU_OCR_PYTHON to a Python 3.10-3.12 executable."
}

$Python = Resolve-Python
Write-Host "Using Python: $Python"

if (!(Test-Path $VenvDir)) {
  if ($Python -like "py *") {
    Invoke-Expression "$Python -m venv `"$VenvDir`""
  } else {
    & $Python -m venv $VenvDir
  }
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -r $Requirements

Write-Host "OCR environment ready: $VenvPython"
Write-Host "Next: npm run data:xdu:fetch; npm run data:xdu:ocr; npm run data:xdu:generate"
