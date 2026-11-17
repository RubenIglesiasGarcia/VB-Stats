$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$env:VITE_ANALYSIS_API='http://127.0.0.1:8000'
Write-Host ''
Write-Host 'VB Stats - interfaz web (esta ventana mantiene la aplicacion abierta)' -ForegroundColor Cyan
Write-Host 'Abrir http://127.0.0.1:5173' -ForegroundColor Green
& npm.cmd run dev -- --host 127.0.0.1
if ($LASTEXITCODE -ne 0) { throw 'No se pudo arrancar Vite. Revisa la instalacion de Node.js.' }
