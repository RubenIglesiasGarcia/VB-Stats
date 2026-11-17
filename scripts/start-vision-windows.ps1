# VB Stats 0.6.1: iniciar la API antes de instalar los pesos grandes de RAVEL.
# PowerShell 5.1 compatible. Ejecutar por VB-Stats.exe o REPARAR MOTOR IA.cmd.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$host.UI.RawUI.WindowTitle = 'VB Stats - Motor IA (no cerrar)'
Write-Host ''
Write-Host 'VB Stats - iniciando servidor local de inteligencia artificial' -ForegroundColor Cyan

function PythonCommand {
  foreach ($version in @('3.11','3.12','3.13')) {
    try {
      & py "-$version" --version 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { return @{ exe='py'; args=@("-$version") } }
    } catch {}
  }
  if (Get-Command python.exe -ErrorAction SilentlyContinue) {
    try {
      $v = (& python.exe --version 2>&1 | Out-String)
      if ($v -match 'Python 3\.(11|12|13)\.') {return @{exe='python.exe'; args=@()}}
    } catch {}
  }
  throw 'No se encontró Python 3.11, 3.12 o 3.13. Instala Python 3.11 desde python.org y vuelve a abrir VB-Stats.exe.'
}

$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  $candidate = PythonCommand
  Write-Host 'Preparando el entorno Python por primera vez...' -ForegroundColor Cyan
  $cmdArgs = @($candidate.args)
  & $candidate.exe @cmdArgs -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno Python (.venv).' }
}
$basicReady=$false
try {
  & $python -c 'import fastapi,uvicorn,multipart,pydantic' 2>$null
  $basicReady = ($LASTEXITCODE -eq 0)
} catch {}
if (-not $basicReady) {
  Write-Host 'Instalando los componentes del servidor local (solo la primera vez)...' -ForegroundColor Cyan
  & $python -m pip install --disable-pip-version-check -r backend\requirements.txt
  if ($LASTEXITCODE -ne 0) { throw 'La instalación del servidor ha fallado. Revisa tu conexión o el antivirus.' }
}
# La importación de YouTube debe estar disponible desde el primer arranque de la API.
try {
  & $python -c 'import yt_dlp' 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'yt-dlp no instalado' }
} catch {
  Write-Host 'Instalando importador de YouTube (yt-dlp)...' -ForegroundColor Cyan
  & $python -m pip install --disable-pip-version-check -r backend\requirements-youtube.txt
  if ($LASTEXITCODE -ne 0) { Write-Host 'No se pudo instalar yt-dlp. La API seguirá arrancando; prueba REPARAR MOTOR IA.cmd.' -ForegroundColor Yellow }
}
$env:VBSTATS_RAVEL_HOME = Join-Path $root 'external\fast-volleyball-tracking-inference'

# Comprobar si RAVEL está instalado, sin bloquear el inicio del servidor.
$ravelReady=$false
try {
  & $python -c 'from backend.vision.ravel import readiness; ok,_=readiness(); raise SystemExit(0 if ok else 1)' 2>$null
  $ravelReady = ($LASTEXITCODE -eq 0)
} catch {}

if (-not $ravelReady) {
  $setup = Join-Path $root 'scripts\setup-ravel-windows.ps1'
  Write-Host 'RAVEL todavía no está listo. Abriendo su instalación en otra ventana.' -ForegroundColor Yellow
  Write-Host 'Puedes abrir la web mientras RAVEL se instala: el estado se actualizará automáticamente.' -ForegroundColor Yellow
  # Instalar los pesos en un proceso separado: nunca dejar la API desconectada
  # por esperar a la descarga de RAVEL.
  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-File',('"'+$setup+'"')) | Out-Null
} else {
  Write-Host '[OK] RAVEL-VB-013 está instalado.' -ForegroundColor Green
  $ocrReady=$false
  try {
    & $python -c 'import rapidocr' 2>$null
    $ocrReady = ($LASTEXITCODE -eq 0)
  } catch {}
  if (-not $ocrReady) {
    $ocrScript=Join-Path $root 'scripts\setup-jersey-windows.ps1'
    Write-Host 'Preparando reconocimiento de dorsales en segundo plano...' -ForegroundColor Yellow
    Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-File',('"'+$ocrScript+'"')) | Out-Null
  }
}

Write-Host ''
Write-Host 'Iniciando API VB Stats en http://127.0.0.1:8000/health ...' -ForegroundColor Cyan
Write-Host 'Mantén abierta esta ventana durante el análisis.' -ForegroundColor Yellow
& $python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
if ($LASTEXITCODE -ne 0) { throw 'El motor de IA terminó con error. Lee el detalle en esta ventana.' }
