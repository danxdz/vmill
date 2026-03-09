Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RootDir

$VenvOcr = Join-Path $RootDir ".venv_ocr"
$pythonInVenv = Join-Path $VenvOcr "Scripts\python.exe"
$pyLauncher = Get-Command py -ErrorAction SilentlyContinue
if (-not $pyLauncher) {
  throw "[pack] Python launcher 'py' not found. Install Python 3.11 with the launcher enabled."
}

# Detect cross-OS mixed venvs (e.g., created from WSL/Linux), then recreate for Windows.
$needsRecreateVenv = -not (Test-Path $pythonInVenv)
$cfgPath = Join-Path $VenvOcr "pyvenv.cfg"
if ((-not $needsRecreateVenv) -and (Test-Path $cfgPath)) {
  $cfgContent = Get-Content $cfgPath -Raw
  if ($cfgContent -match '(?m)^home\s*=\s*/' -or $cfgContent -match '(?m)^command\s*=\s*/') {
    $needsRecreateVenv = $true
  }
}

if ($needsRecreateVenv) {
  if (Test-Path $VenvOcr) {
    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupPath = "$VenvOcr`_backup_$stamp"
    Rename-Item -Path $VenvOcr -NewName (Split-Path -Leaf $backupPath)
    Write-Host "[pack] moved incompatible .venv_ocr to $backupPath"
  }

  Write-Host "[pack] creating .venv_ocr with Python 3.11"
  & py -3.11 -m venv $VenvOcr
}

if (-not (Test-Path $pythonInVenv)) {
  throw "[pack] .venv_ocr creation failed: $pythonInVenv not found"
}

$PythonBin = $pythonInVenv
$DistBase = Join-Path $RootDir "dist_portable\ocr-windows"
$WorkDir = Join-Path $RootDir "build\pyinstaller-ocr-win"
$SpecDir = Join-Path $RootDir "build"

Write-Host "[pack] building OCR portable Windows bundle with $PythonBin"
& $PythonBin -m pip install --upgrade pip pyinstaller
& $PythonBin -m pip install -r "$RootDir\requirements_ocr.txt"

if (Test-Path $DistBase) { Remove-Item $DistBase -Recurse -Force }
if (Test-Path $WorkDir) { Remove-Item $WorkDir -Recurse -Force }
New-Item -ItemType Directory -Path $DistBase | Out-Null

& $PythonBin -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name ocr_server `
  --distpath $DistBase `
  --workpath $WorkDir `
  --specpath $SpecDir `
  --collect-all fastapi `
  --collect-all starlette `
  --collect-all uvicorn `
  --collect-all paddleocr `
  --collect-all paddlex `
  --collect-all paddle `
  --collect-all cv2 `
  --collect-all numpy `
  --collect-all openpyxl `
  --collect-all PIL `
  --hidden-import python_multipart `
  "$RootDir\ocr_server.py"

$runner = @"
@echo off
setlocal
set "APP_DIR=%~dp0"
if "%PORT%"=="" set "PORT=8081"
echo [ocr-portable] starting on :%PORT%
"%APP_DIR%ocr_server\ocr_server.exe"
"@

$runnerPath = Join-Path $DistBase "run_ocr_portable.cmd"
Set-Content -Path $runnerPath -Value $runner -Encoding ASCII

Write-Host ""
Write-Host "Built OCR portable bundle:"
Write-Host "  $DistBase"
Write-Host "Run:"
Write-Host "  $runnerPath"
