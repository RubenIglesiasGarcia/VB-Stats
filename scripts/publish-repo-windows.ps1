# En caso de no estar disponible la integración de GitHub para ChatGPT:
# publicación manual a tu repositorio, sin GitHub Actions ni force-push.
$ErrorActionPreference = 'Stop'
$remote = 'https://github.com/RubenIglesiasGarcia/VB-Stats.git'
if (-not (Test-Path 'package.json')) { throw 'Abre PowerShell desde la carpeta del proyecto, donde está package.json.' }
if (-not (Test-Path '.git')) { git init; git branch -M main }
if ((git remote) -contains 'origin') { git remote set-url origin $remote } else { git remote add origin $remote }
# No se sobreescribe un repositorio existente: trae su historia primero.
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar GitHub. Inicia sesión en Git Credential Manager.' }
if (-not (git rev-parse --verify HEAD 2>$null)) {
  git checkout -B main origin/main
} else {
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { throw 'Hay cambios en ambas ramas. Resuelve el conflicto antes de subir.' }
}
git add .
git commit -m 'feat: VB Stats web preview for Cloudflare Pages'
if ($LASTEXITCODE -ne 0) { Write-Host 'Sin cambios para publicar.'; exit 0 }
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'GitHub rechazó el push. Revisa la autenticación.' }
Write-Host 'Publicado en https://github.com/RubenIglesiasGarcia/VB-Stats'
