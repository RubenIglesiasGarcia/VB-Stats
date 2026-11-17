# VB Stats 0.9.1 — partidos completos de 80–180 minutos

Caso de prueba previsto: `https://www.youtube.com/live/ul-pA6pLWX8` (grabación autorizada). Se usa un **vídeo de 5033 segundos (~84 min) como dato de test**, no como metadato verificado en directo de YouTube.

## Cambios

- El backend acepta grabaciones hasta **10800 segundos (3 horas)** mediante `VBSTATS_MAX_VIDEO_SECONDS`.
- El frontend inicia un único trabajo y el backend recorre **tramos de 60 segundos** consecutivamente. Cada tramo queda registrado en un checkpoint.
- Si falla o se detiene un trabajo, el frontend conserva su identificador y muestra **Reanudar análisis**; solo funciona si el archivo de origen sigue en el servidor.
- El importador de YouTube inspecciona los formatos disponibles y selecciona automáticamente el más nítido que cabe en el presupuesto de disco: máximo **480p** para vídeos de 60 minutos o más. Si hace falta, baja a 360p o 240p.
- La descarga tiene límite real de bytes, deja **64 MiB** de reserva para ficheros temporales/checkpoints y rechaza archivos que no caben.
- **A menor resolución, peor OCR de dorsales**. RAVEL no convierte automáticamente sus contactos en aces, errores, kill, calidad de recepción o puntos certificados.

## Desplegar backend desde el repositorio

El servicio Railway `vb-stats-ai-beta` sigue desplegado vía CLI porque su conexión con GitHub ha devuelto errores de permisos. Un commit a GitHub **no modifica automáticamente** ese contenedor.

En el ordenador donde está clonado el repositorio:

```powershell
cd "$HOME\Downloads\VB-Stats"
git pull origin main
railway up --project ab3cfa0a-6aea-4705-88f7-17a2808134be --environment production --service vb-stats-ai-beta -m "VB Stats 0.9.1 partidos largos"
```

Si PowerShell bloquea scripts, usar el ejecutable `railway.cmd` **con la ruta completa mostrada por `npm.cmd prefix -g`**.

Variables del servicio Railway (solo configuración privada, nunca en GitHub):

```text
VBSTATS_MAX_VIDEO_SECONDS=10800
VBSTATS_MAX_UPLOAD_MB=400
VBSTATS_MAX_TOTAL_DISK_MB=430
```

El volumen actual está limitado a **500 MB** y la RAM disponible a **1 GB**, de modo que un partido concreto puede fallar por falta de espacio/memoria incluso con estos cambios. Se recomienda comprobar las métricas y la factura antes de hacer un análisis largo. Un vídeo superior a los formatos de baja resolución que caben en el volumen seguirá requiriendo almacenamiento ampliado/externo.

El frontend de Cloudflare es público con acceso sin cuentas y usa un secreto de Worker, pero **el secreto debe estar configurado por el propietario** (`VBSTATS_RAILWAY_KEY`), nunca en el navegador.

## Estado de validación

La lógica de elección de formatos y presupuesto de descarga tiene pruebas unitarias sin acceso a Internet. **No se ha ejecutado un partido real de 84 minutos ni se ha validado inferencia RAVEL completa en un servidor Railway de 1 GB.**

En pruebas iniciales, comenzar con el mismo vídeo si cabe en el volumen; comprobar que el progreso supera 60 minutos, y revisar registros/memoria. Si la precisión empeora debido a los formatos compactos, para un producto final hacen falta almacenamiento mayor, más RAM y, probablemente, workers de procesamiento más rápidos.
