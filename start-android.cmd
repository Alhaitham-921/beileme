@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\android.ps1" -Action Install
if errorlevel 1 pause
