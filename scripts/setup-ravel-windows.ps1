# Instala los pesos y scripts originales RAVEL-VB-013 (MIT). No utiliza GitHub Actions.
# Ejecutar desde la carpeta del proyecto con la venv ya creada.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$python=Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {throw 'No existe .venv. Inicia primero VB-Stats.exe.'}
$folder=Join-Path $root 'external\fast-volleyball-tracking-inference'
$model=Join-Path $folder 'ov\RAVEL-VB-013-9f.xml'
$modelBin=Join-Path $folder 'ov\RAVEL-VB-013-9f.bin'
$modelJson=Join-Path $folder 'ov\RAVEL-VB-013-9f.json'
$entry=Join-Path $folder 'src\inference_player_ball_openvino.py'
if (!(Test-Path $model) -or !(Test-Path $modelBin) -or !(Test-Path $modelJson) -or !(Test-Path $entry)) {
  $url='https://github.com/asigatchov/fast-volleyball-tracking-inference/archive/refs/tags/v0.2.0.zip'
  $tmp=Join-Path ([IO.Path]::GetTempPath()) ( 'vbstats-ravel-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    $zip=Join-Path $tmp 'ravel-source.zip'
    Write-Host 'Descargando RAVEL-VB v0.2.0 del repositorio oficial (MIT)...' -ForegroundColor Cyan
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 600
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $extracted=Get-ChildItem $tmp -Directory | Where-Object {$_.Name -like 'fast-volleyball-tracking-inference-*'} | Select-Object -First 1
    if (-not $extracted) {throw 'Archivo externo incompleto.'}
    foreach($name in @('ov\RAVEL-VB-013-9f.xml','ov\RAVEL-VB-013-9f.bin','ov\RAVEL-VB-013-9f.json','src\inference_player_ball_openvino.py')) {
      if (-not (Test-Path -LiteralPath (Join-Path $extracted.FullName $name))) {throw "Falta un fichero del modelo: $name"}
    }
    $parent=Split-Path $folder -Parent
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    if (Test-Path $folder) {Remove-Item $folder -Recurse -Force}
    Move-Item -LiteralPath $extracted.FullName -Destination $folder
  } finally {Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue}
}
Write-Host 'Instalando motor OpenVINO y dependencias de RAVEL en la venv...' -ForegroundColor Cyan
& $python -m pip install --disable-pip-version-check -r backend\requirements-ravel.txt
if($LASTEXITCODE -ne 0){throw 'No se pudieron instalar las dependencias de RAVEL.'}
Write-Host 'Preparando OCR de dorsales (puede tardar la primera vez)...' -ForegroundColor Cyan
& $python -m pip install --disable-pip-version-check -r backend\requirements-jersey.txt
if ($LASTEXITCODE -ne 0) {Write-Host 'El OCR no se pudo instalar, RAVEL seguirá operativo sin reconocimiento de dorsales.' -ForegroundColor Yellow}
$env:VBSTATS_RAVEL_HOME=$folder
& $python -c 'from backend.vision.ravel import readiness; ok,msg=readiness(); print(msg); raise SystemExit(0 if ok else 1)'
if($LASTEXITCODE -ne 0){throw 'RAVEL no supera la comprobacion de disponibilidad. Comprueba la instalacion.'}
Write-Host 'RAVEL-VB-013 listo para la primera prueba.' -ForegroundColor Green
