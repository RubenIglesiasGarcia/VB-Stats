# VB Stats 0.9.2 — analizar directamente YouTube sin descargar el partido

## Objetivo

El visitante **pega una URL pública de YouTube, pulsa Analizar partido y ve observaciones del vídeo**. Ningún visitante instala aplicaciones, descarga el partido, sube MP4, se registra ni introduce claves de IA.

## Qué cambia

Hay dos motores distintos para URLs de YouTube:

1. **Preferido cuando está activado: Gemini API con URL de YouTube**. Google procesa el enlace directamente. Railway no descarga ni almacena los fotogramas, por lo que no depende del acceso de yt-dlp desde las IP bloqueadas de Railway. Se usa el modelo por defecto `gemini-3.6-flash`, a baja resolución para admitir vídeos largos de hasta tres horas según límites documentados.
2. **Alternativa cuando Gemini no está configurado:** yt-dlp + RAVEL. Hemos añadido Node 22 y habilitado yt-dlp-ejs para compatibilidad con desafíos JavaScript, pero YouTube puede seguir rechazando conexiones desde servidores.

## Configuración UNA VEZ del propietario (NO de los visitantes)

- Crea una clave de **Gemini API** en [Google AI Studio](https://aistudio.google.com/apikey). Configura límites y cuotas en el proyecto de Google correspondiente.
- En **Railway → vb-stats-ai-beta → Variables**, añade `GEMINI_API_KEY` como variable secreta del backend.
- `VBSTATS_GEMINI_ENABLE=1` ya está establecido en Railway. No hace falta crear una clave por visitante.
- Actualiza el contenedor Railway a la rama `main` versión 0.9.2 con `railway up`, ya que **GitHub no está conectado como origen automático** de ese servicio.
- Publica la última versión de `main` en Cloudflare Worker para mostrar «YouTube directo · Gemini».
- Mantén el secreto `VBSTATS_RAILWAY_KEY` del Worker configurado como en `docs/ACCESO-PUBLICO.md`.

PowerShell desde la carpeta local del repo:

```powershell
git pull origin main
$railway = Join-Path ((npm.cmd prefix -g).Trim()) "railway.cmd"
& $railway up --project ab3cfa0a-6aea-4705-88f7-17a2808134be --environment production --service vb-stats-ai-beta -m "VB Stats 0.9.2 YouTube directo"
```

**No copies nunca** `GEMINI_API_KEY` en GitHub, `.env.production`, `VITE_*`, el chat, ni el navegador.

## Limitaciones importantes

- Gemini puede analizar **videos públicos** de YouTube. Los vídeos privados u ocultos pueden no ser admitidos.
- El soporte de URL de YouTube está **en preview** y puede cambiar. La documentación indica hasta **8 horas de vídeo al día** en nivel gratuito, pero deben consultarse precios y cuotas del modelo aparte.
- Gemini examina vídeo con **muestreo visual limitado**, no hace inferencia de RAVEL fotograma a fotograma. En voleibol hay varios contactos en menos de un segundo y el modelo puede omitir o confundir jugadas.
- El informe Gemini contiene **momentos candidatos**, no todos los puntos. Los nombres de equipo y los dorsales pueden ser erróneos. **Nunca adjudica ganadores ni genera errores, kills, aces o porcentajes como hechos confirmados**.
- La web distingue el motor `gemini-youtube-preview` del motor `ravel-vb-013`, y los resultados deportivos se calculan solamente de acciones revisadas manualmente.
- La clave del propietario puede conllevar **coste de procesamiento**. Probar primero **un partido**, vigilar el panel de Google AI Studio y definir cuotas. Las peticiones pasan por Cloudflare y su límite de uso, pero eso no equivale a un presupuesto monetario estricto.
- Este enfoque **no garantiza** que el vídeo particular `ul-pA6pLWX8` esté disponible mediante la API de Gemini; es necesaria una prueba real con `GEMINI_API_KEY` configurada.

## Fuentes oficiales

- https://ai.google.dev/gemini-api/docs/video-understanding
- https://ai.google.dev/gemini-api/docs/media-resolution
- https://github.com/yt-dlp/yt-dlp/wiki/EJS

## Verificación

- `/health` del backend debe mostrar `version: 0.9.2`.
- `/capabilities` del Cloudflare Worker debe incluir `"youtube_engine":"gemini"` y `"youtube_import":true`.
- Si falta la clave, `"youtube_engine":"ravel"` (solo si RAVEL y yt-dlp-EJS están listos).
- Iniciar el partido por YouTube desde VB Stats. El avance indicará «Gemini está examinando…» sin descarga.
- El informe resultante llevará `engine: "gemini-youtube-preview"` y mostrará siempre las limitaciones de precisión.

