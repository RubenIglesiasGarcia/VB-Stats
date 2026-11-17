# VB Stats v0.5 - local launcher (no GitHub Actions, no cloud credentials)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Instala Node.js 22 o superior: https://nodejs.org' }
if (-not (Get-Command py -ErrorAction SilentlyContinue)) { throw 'Instala Python 3.11 o superior: https://python.org' }
Write-Host 'VB Stats: instalando dependencias del frontend si faltan...' -ForegroundColor Cyan
if (-not (Test-Path 'node_modules')) { npm install; if ($LASTEXITCODE -ne 0) { throw 'npm install falló' } }
$backendScript=(Resolve-Path '.\scripts\start-vision-windows.ps1').Path
Write-Host 'Arrancando el motor de IA en otra ventana. La primera vez descargara pesos y paquetes.' -ForegroundColor Cyan
Start-Process -FilePath 'powershell.exe' -WorkingDirectory (Get-Location).Path -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-File',('"'+$backendScript+'"'))
Write-Host 'Abre http://localhost:5173 en tu navegador y elige tu MP4 local.' -ForegroundColor Green
npm run dev
