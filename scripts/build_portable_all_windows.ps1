Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RootDir

& (Join-Path $PSScriptRoot "build_portable_vmill_windows.ps1")
& (Join-Path $PSScriptRoot "build_portable_ocr_windows.ps1")

Write-Host ""
Write-Host "All portable Windows bundles were built under:"
Write-Host "  $RootDir\dist_portable"
