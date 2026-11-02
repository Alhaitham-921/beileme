@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\start-kokoro.ps1
if errorlevel 1 goto done
call npm.cmd run start:all
:done
pause
