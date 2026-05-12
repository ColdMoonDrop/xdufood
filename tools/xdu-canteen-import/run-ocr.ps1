$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
$SystemPython = Get-Command python -ErrorAction SilentlyContinue
$Importer = Join-Path $ScriptDir "xdu_canteen_importer.py"

if (Test-Path $VenvPython) {
  & $VenvPython $Importer @args
} elseif ($SystemPython) {
  & $SystemPython.Source $Importer @args
} else {
  throw "No Python runtime found. Run npm run data:xdu:setup first."
}
