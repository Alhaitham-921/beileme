$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$apk=Join-Path $PSScriptRoot 'output/android/beileme-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw 'APK not found. Run npm run android:build first.' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/android.ps1 -Action Install
if ($LASTEXITCODE -ne 0) { Read-Host 'Connect phone, allow USB debugging, then retry. Press Enter to close' }