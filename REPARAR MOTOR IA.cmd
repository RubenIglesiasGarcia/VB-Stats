@echo off
chcp 65001 >nul
cd /d "%~dp0"
title VB Stats - Reparar motor de IA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\repair-vision-windows.ps1"
if errorlevel 1 (
  echo.
  echo El motor no ha podido iniciarse. Lee el mensaje de error anterior.
  pause
)
