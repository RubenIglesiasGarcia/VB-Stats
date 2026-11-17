# Instalacion opcional del OCR por seguimiento, sin bloquear el servidor IA.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$python=Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {throw 'VB Stats debe estar iniciado antes de preparar el OCR.'}
Write-Host 'Instalando OCR de dorsales en la venv local...' -ForegroundColor Cyan
& $python -m pip install --disable-pip-version-check -r backend\requirements-jersey.txt
if ($LASTEXITCODE -ne 0) {throw 'Instalacion de OCR fallida.'}
Write-Host 'OCR preparado. Reinicia el motor IA si ya estaba ejecutandose.' -ForegroundColor Green
