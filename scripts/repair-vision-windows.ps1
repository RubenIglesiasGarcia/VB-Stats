# Comprueba API, y levanta backend si la interfaz arranca sin detección.
$ErrorActionPreference='Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
try {
  $check=Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2
  if ($check.status -eq 'ok' -and $check.version -like '0.8.*') {
    Write-Host '[OK] La API está ejecutándose.' -ForegroundColor Green
    $caps=Invoke-RestMethod -Uri 'http://127.0.0.1:8000/capabilities' -TimeoutSec 3
    if ($caps.engines.ravel.ready) {
      Write-Host '[OK] RAVEL está instalado y disponible.' -ForegroundColor Green
    } else {
      Write-Host ('RAVEL todavía no está listo: ' + $caps.engines.ravel.note) -ForegroundColor Yellow
      if (Test-Path '.venv\Scripts\python.exe') {
        Write-Host 'Intentando instalar RAVEL. La ventana quedará abierta para mostrar errores...' -ForegroundColor Cyan
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\scripts\setup-ravel-windows.ps1'
        if ($LASTEXITCODE -ne 0) { throw 'La instalación del modelo falló. Lee el mensaje anterior.' }
      }
    }
    Write-Host 'Vuelve a VB Stats, abre Laboratorio de IA y pulsa Revisar.' -ForegroundColor Green
    return
  }
} catch {}
Write-Host 'Si tienes una versión anterior usando el puerto 8000, cierra su ventana Motor IA antes de reparar.' -ForegroundColor Yellow
Write-Host 'Motor de IA desconectado. Arrancando servidor local...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\scripts\start-vision-windows.ps1'
if ($LASTEXITCODE -ne 0) { throw 'El servidor no se pudo iniciar; revisa el mensaje anterior.' }
