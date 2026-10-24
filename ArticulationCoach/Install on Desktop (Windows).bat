@echo off
echo Installing Articulation Coach shortcut on your Desktop...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-desktop-shortcut.ps1"
pause
