@echo off
chcp 65001 >nul
cd /d "%~dp0"
title VB Stats - Inicio
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\easy-start-windows.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo iniciar. Revisa el mensaje anterior.
  pause
)
