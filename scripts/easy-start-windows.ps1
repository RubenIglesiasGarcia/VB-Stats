# VB Stats: doble clic en VB-Stats.exe (o INICIAR VB STATS.cmd)
# Todo se ejecuta localmente. No envia videos a terceros.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$host.UI.RawUI.WindowTitle='VB Stats - inicio sencillo'
Write-Host ''
Write-Host '=============================================' -ForegroundColor Cyan
Write-Host '     VB STATS - INICIO CON UN CLIC' -ForegroundColor Cyan
Write-Host '=============================================' -ForegroundColor Cyan
Write-Host 'Carpeta: ' (Get-Location).Path
Write-Host 'La primera ejecucion requiere internet y puede descargar paquetes grandes.' -ForegroundColor DarkYellow
Write-Host ''
function Refresh-Path {
  $system=[Environment]::GetEnvironmentVariable('Path','Machine')
  $user=[Environment]::GetEnvironmentVariable('Path','User')
  $env:Path="$system;$user"
}
function Check-Node {
  $node=Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  try {$ver=(& node.exe --version | Select-Object -First 1);$major=[int]((($ver -replace '^v','').Split('.'))[0]);return ($major -ge 20)} catch {return $false}
}
function Check-Python {
  foreach($v in @('3.11','3.12','3.13')) {
    try { & py "-$v" --version 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { return $true } } catch {}
  }
  if (Get-Command python.exe -ErrorAction SilentlyContinue) {
    try { $out=(& python.exe --version 2>&1 | Out-String); return ($out -match 'Python 3\.(11|12|13)\.') } catch {}
  }
  return $false
}
function Install-App([string]$id,[string]$url,[string]$label) {
  Write-Host "No encuentro $label en tu equipo." -ForegroundColor Yellow
  $winget=Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "Puedo intentar instalar $label con winget. No se instalara sin tu permiso." -ForegroundColor Cyan
    $answer=Read-Host 'Quieres instalarlo ahora? [S/n]'
    if ($answer -eq '' -or $answer.ToLowerInvariant() -eq 's' -or $answer.ToLowerInvariant() -eq 'si') {
      & winget install --exact --id $id --accept-package-agreements --accept-source-agreements
      if ($LASTEXITCODE -ne 0) {Write-Host "Winget no pudo instalar $label (codigo $LASTEXITCODE)." -ForegroundColor Yellow}
      Refresh-Path
    }
  }
  else { Write-Host 'Winget no esta disponible en este Windows.' -ForegroundColor Yellow }
  return $url
}
function Check-Port([int]$port) {
  $client=New-Object Net.Sockets.TcpClient
  try {
    $result=$client.BeginConnect('127.0.0.1',$port,$null,$null)
    $ok=$result.AsyncWaitHandle.WaitOne(700)
    if ($ok) { $client.EndConnect($result);return $true }
    return $false
  } catch {return $false} finally {$client.Close()}
}
function Is-OurWeb {
  try {
    $r=Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 3
    return ($r.Content -like '*VB Stats*')
  } catch {return $false}
}
function Is-OurApi {
  try {
    $r=Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2
    return ($r.status -eq 'ok' -and $r.version -like '0.8.*')
  } catch { return $false }
}

if (-not (Check-Node)) {
  $url=Install-App 'OpenJS.NodeJS.LTS' 'https://nodejs.org/en/download' 'Node.js'
  if (-not (Check-Node)) {
    Write-Host 'Falta Node.js 20+. Instala desde: ' $url -ForegroundColor Red
    Start-Process $url
    throw 'Tras instalar Node.js, vuelve a abrir VB-Stats.exe (puede ser necesario reiniciar Windows).'
  }
}
Write-Host '[OK] Node.js detectado' -ForegroundColor Green
$pythonReady=Check-Python
if (-not $pythonReady) {
  $url=Install-App 'Python.Python.3.11' 'https://www.python.org/downloads/windows/' 'Python 3.11'
  $pythonReady=Check-Python
  if (-not $pythonReady) {
    Write-Host 'Python no instalado: la interfaz funcionara, pero la deteccion de IA no.' -ForegroundColor Yellow
    Start-Process $url
  }
}
if ($pythonReady) {Write-Host '[OK] Python detectado' -ForegroundColor Green}
if (-not (Test-Path '.\node_modules\.bin\vite.cmd')) {
  Write-Host ''
  Write-Host 'Preparando interfaz React... (solo la primera vez)' -ForegroundColor Cyan
  & npm.cmd install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) {throw 'Error instalando React. Comprueba la conexion a Internet o permisos de escritura.'}
}
else {Write-Host '[OK] Interfaz ya preparada' -ForegroundColor Green}
$webScript=(Resolve-Path '.\scripts\run-web-windows.ps1').Path
$visionScript=(Resolve-Path '.\scripts\start-vision-windows.ps1').Path
if (-not (Check-Port 5173)) {
  Write-Host 'Abriendo servidor web local...' -ForegroundColor Cyan
  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-File',('"'+$webScript+'"'))
} elseif (-not (Is-OurWeb)) {throw 'El puerto 5173 ya esta ocupado por otra aplicacion. Cierra esa aplicacion y vuelve a ejecutar VB Stats.'}
if ($pythonReady) {
  if (-not (Check-Port 8000)) {
    Write-Host 'Arrancando analisis IA en una segunda ventana...' -ForegroundColor Cyan
    Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-File',('"'+$visionScript+'"'))
  } elseif (Is-OurApi) {
    Write-Host '[OK] La API de VB Stats ya estaba iniciada.' -ForegroundColor Green
  } else {
    Write-Host 'AVISO: el puerto 8000 está ocupado por otro programa; la detección no se conectará.' -ForegroundColor Red
  }
}
Write-Host 'Esperando a que la interfaz este lista...' -ForegroundColor Cyan
$ready=$false
for ($i=0;$i -lt 80;$i++) {
  if (Is-OurWeb) {$ready=$true;break}
  Start-Sleep -Milliseconds 500
}
if ($ready) {
  Start-Process 'http://127.0.0.1:5173'
  Write-Host ''
  Write-Host '[OK] VB Stats abierto en tu navegador.' -ForegroundColor Green
  Write-Host 'Para volver a entrar: http://127.0.0.1:5173' -ForegroundColor Green
  Write-Host 'No cierres las ventanas del servidor web y motor IA mientras lo uses.' -ForegroundColor Yellow
  if ($pythonReady) {
    if (Is-OurApi) {Write-Host '[OK] API local conectada.' -ForegroundColor Green}
    else {Write-Host 'La API sigue arrancando. Comprueba la ventana VB Stats - Motor IA o ejecuta REPARAR MOTOR IA.cmd si da error.' -ForegroundColor Yellow}
    Write-Host 'La instalación del modelo RAVEL puede seguir en otra ventana; la interfaz mostrará su estado.' -ForegroundColor Yellow
  } else {Write-Host 'Sin Python: la interfaz funciona, pero NO se registrarán contactos automáticos.' -ForegroundColor Red}
} else {
  throw 'El frontend no ha arrancado. Revisa los mensajes de la ventana VB Stats - interfaz web.'
}
