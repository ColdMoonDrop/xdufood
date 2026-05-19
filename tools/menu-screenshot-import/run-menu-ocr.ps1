$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$OcrVenvPython = Join-Path $RepoRoot "tools\xdu-canteen-import\.venv\Scripts\python.exe"
$SystemPython = Get-Command python -ErrorAction SilentlyContinue
$Importer = Join-Path $ScriptDir "import_menu_screenshots.py"

if (Test-Path $OcrVenvPython) {
  & $OcrVenvPython $Importer @args
} elseif ($SystemPython) {
  Write-Warning "Using system Python. If PaddleOCR is missing, run npm run data:xdu:setup first."
  & $SystemPython.Source $Importer @args
} else {
  throw "No Python runtime found. Run npm run data:xdu:setup first."
}
