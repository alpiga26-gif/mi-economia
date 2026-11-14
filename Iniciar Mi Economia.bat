@echo off
title Mi Economia - servidor local (no cierres esta ventana)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1" -Port 8080
pause
