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
$ZipPath = Join-Path $RootDir "dist_portable\ocr-windows-portable.zip"

Write-Host "[pack] building OCR portable Windows bundle with $PythonBin"
& $PythonBin -m pip install --upgrade pip pyinstaller
& $PythonBin -m pip install -r "$RootDir\requirements_ocr.txt"

# Some wheels (e.g. chardet/charset-normalizer) expose hashed mypyc module names.
# PyInstaller can miss them unless we add explicit hidden imports.
$sitePackages = Join-Path $VenvOcr "Lib\site-packages"
$mypycModules = @()
if (Test-Path $sitePackages) {
  $mypycModules = Get-ChildItem -Path $sitePackages -File -Filter "*__mypyc*.pyd" |
    ForEach-Object { ($_.BaseName -split '\.')[0] } |
    Sort-Object -Unique
}
if ($mypycModules.Count -gt 0) {
  Write-Host "[pack] detected mypyc modules: $($mypycModules -join ', ')"
}

if (Test-Path $DistBase) {
  Get-ChildItem -Path $DistBase -Force | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force
  }
} else {
  New-Item -ItemType Directory -Path $DistBase | Out-Null
}
if (Test-Path $WorkDir) { Remove-Item $WorkDir -Recurse -Force }
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

$pyiArgs = @(
  "--noconfirm",
  "--clean",
  "--onedir",
  "--name", "ocr_server",
  "--distpath", $DistBase,
  "--workpath", $WorkDir,
  "--specpath", $SpecDir,
  "--collect-all", "fastapi",
  "--collect-all", "starlette",
  "--collect-all", "uvicorn",
  "--collect-all", "paddleocr",
  "--collect-all", "paddlex",
  "--collect-all", "paddle",
  "--collect-all", "cv2",
  "--collect-all", "numpy",
  "--collect-all", "openpyxl",
  "--collect-all", "PIL",
  "--collect-all", "imagesize",
  "--collect-all", "pyclipper",
  "--collect-all", "pypdfium2",
  "--collect-all", "shapely",
  "--recursive-copy-metadata", "paddlex",
  "--recursive-copy-metadata", "paddleocr",
  "--recursive-copy-metadata", "requests",
  "--copy-metadata", "imagesize",
  "--copy-metadata", "pyclipper",
  "--copy-metadata", "pypdfium2",
  "--copy-metadata", "shapely",
  "--hidden-import", "python_multipart"
)
foreach ($mod in $mypycModules) {
  $pyiArgs += @("--hidden-import", $mod)
}
$pyiArgs += "$RootDir\ocr_server.py"

& $PythonBin -m PyInstaller @pyiArgs

$runner = @"
@echo off
setlocal
set "APP_DIR=%~dp0"
if "%PORT%"=="" set "PORT=8081"
set "VMILL_OCR_BASE_DIR=%APP_DIR%ocr_server"
set "PADDLE_HOME=%APP_DIR%ocr_server\.paddlex"
set "PADDLEX_HOME=%APP_DIR%ocr_server\.paddlex"
set "PADDLE_PDX_CACHE_HOME=%APP_DIR%ocr_server\.paddlex"
set "PADDLEOCR_HOME=%APP_DIR%ocr_server\.paddleocr"
set "TEMP=%APP_DIR%ocr_server\temp"
set "TMP=%APP_DIR%ocr_server\temp"
if not exist "%PADDLE_PDX_CACHE_HOME%" mkdir "%PADDLE_PDX_CACHE_HOME%"
if not exist "%PADDLEOCR_HOME%" mkdir "%PADDLEOCR_HOME%"
if not exist "%TEMP%" mkdir "%TEMP%"
echo [ocr-portable] starting on :%PORT%
"%APP_DIR%ocr_server\ocr_server.exe"
"@

$runnerPath = Join-Path $DistBase "run_ocr_portable.cmd"
Set-Content -Path $runnerPath -Value $runner -Encoding ASCII

function Copy-PortableCache {
  param(
    [Parameter(Mandatory = $true)][string]$CacheName
  )

  $target = Join-Path $DistBase "ocr_server\$CacheName"
  $candidates = @(
    (Join-Path $RootDir $CacheName),
    (Join-Path $env:USERPROFILE $CacheName)
  )
  $source = $null
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $source = $candidate
      break
    }
  }
  if (-not $source) {
    Write-Host "[pack] no local $CacheName cache found; first portable startup may require internet."
    return
  }

  New-Item -ItemType Directory -Path $target -Force | Out-Null
  Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
  Write-Host "[pack] copied $CacheName cache from $source"
}

Copy-PortableCache ".paddlex"
Copy-PortableCache ".paddleocr"

$portableReadme = @"
Portable OCR Server Bundle
==========================

Contents
- ocr_server\ocr_server.exe
- ocr_server\.paddlex
- ocr_server\.paddleocr
- run_ocr_portable.cmd

Use on another Windows PC
1. Unzip the whole folder.
2. Keep the folder structure exactly as-is.
3. Run run_ocr_portable.cmd
4. Default port is 8081

Notes
- This is a one-dir portable bundle. Do not move ocr_server.exe out of its folder.
- The Paddle caches are bundled so you can copy this to another PC without re-downloading models.
- If you already have newer .paddlex / .paddleocr folders on another PC, you can overwrite these bundled folders.
- To change the port before launch:
  set PORT=8081
  run_ocr_portable.cmd
"@

$readmePath = Join-Path $DistBase "PORTABLE_README.txt"
Set-Content -Path $readmePath -Value $portableReadme -Encoding ASCII

Compress-Archive -Path (Join-Path $DistBase "*") -DestinationPath $ZipPath -Force

Write-Host ""
Write-Host "Built OCR portable bundle:"
Write-Host "  $DistBase"
Write-Host "Portable zip:"
Write-Host "  $ZipPath"
Write-Host "Run:"
Write-Host "  $runnerPath"
