Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RootDir

$defaultPython = Join-Path $RootDir ".venv\Scripts\python.exe"
$PythonBin = if (Test-Path $defaultPython) { $defaultPython } else { "python" }

$DistBase = Join-Path $RootDir "dist_portable\vmill-windows"
$WorkDir = Join-Path $RootDir "build\pyinstaller-vmill-win"
$SpecDir = Join-Path $RootDir "build"

Write-Host "[pack] building VMill portable Windows bundle with $PythonBin"
& $PythonBin -m pip install --upgrade pip pyinstaller

if (Test-Path $DistBase) { Remove-Item $DistBase -Recurse -Force }
if (Test-Path $WorkDir) { Remove-Item $WorkDir -Recurse -Force }
New-Item -ItemType Directory -Path $DistBase | Out-Null

& $PythonBin -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name vmill_server `
  --distpath $DistBase `
  --workpath $WorkDir `
  --specpath $SpecDir `
  --add-data "$RootDir\public;public" `
  --add-data "$RootDir\docs;docs" `
  "$RootDir\vmill_server.py"

$runner = @"
@echo off
setlocal
set "APP_DIR=%~dp0"
if "%PORT%"=="" set "PORT=8080"
if "%VMILL_DB_PATH%"=="" set "VMILL_DB_PATH=%APP_DIR%vmill.db"
echo [vmill-portable] starting on :%PORT% with DB %VMILL_DB_PATH%
"%APP_DIR%vmill_server\vmill_server.exe"
"@

$runnerPath = Join-Path $DistBase "run_vmill_portable.cmd"
Set-Content -Path $runnerPath -Value $runner -Encoding ASCII

Write-Host ""
Write-Host "Built VMill portable bundle:"
Write-Host "  $DistBase"
Write-Host "Run:"
Write-Host "  $runnerPath"
