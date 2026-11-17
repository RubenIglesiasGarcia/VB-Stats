# Run from the project root after installing Node and the Python virtual environment.
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host 'Pruebas de eventos y estadisticas...' -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw 'Pruebas JS fallidas' }
Write-Host 'Pruebas API y vision...' -ForegroundColor Cyan
if (Test-Path '.venv\Scripts\python.exe') { $python='.\.venv\Scripts\python.exe' } else { $python='python' }
& $python -m pip install --quiet pytest
& $python -m pytest -q backend/tests
if ($LASTEXITCODE -ne 0) { throw 'Pruebas Python fallidas' }
Write-Host 'Build del frontend...' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build fallido' }
Write-Host 'Todo correcto.' -ForegroundColor Green
