**Nuevo en 0.9:** base de IA online privada y estadísticas técnicas por entrenador. Lee [docs/ONLINE-AI.md](docs/ONLINE-AI.md) para los pasos de despliegue y sus limitaciones. En Cloudflare se mantiene la demo hasta validar el backend.

# VB Stats 0.8.1 — análisis automático desde YouTube y OCR de dorsales

VB Stats es una herramienta local para analizar vídeo de voleibol. Ahora puedes pegar una URL de YouTube **sin descargar ni subir manualmente otro archivo**. El backend utiliza `yt-dlp` para obtener una copia temporal **en tu ordenador**, ejecuta RAVEL-VB-013 para proponer contactos y rallies, y utiliza OCR para sugerir números de camiseta cuando hay suficientes fotogramas legibles. Todo el proceso puede tardar; el estado se muestra por fases.

**Límite técnico:** las estadísticas son **provisionales y basadas en los contactos detectados**; todavía no pueden considerarse una estadística DataVolley validada, ni adjudicar automáticamente ganadores de puntos, errores, aces o tasas de recepción perfectas. Las acciones específicas de voleibol son inferencias a partir de la secuencia de toques. La IA puede omitir muchos contactos y no debe inventar dorsales.

## Cómo abrirlo en Windows (sin comandos)

1. Cierra por completo las versiones anteriores de VB Stats y sus ventanas «Motor IA» e «Interfaz web».
2. Descomprime **todo el ZIP** en una carpeta nueva y abre `VB-Stats.exe` (alternativa: `INICIAR VB STATS.cmd`).
3. La primera ejecución necesita Internet para preparar Node, Python, `yt-dlp`, RAVEL y opcionalmente RapidOCR. Las descargas pueden ser grandes. No cierres las ventanas del motor.
4. En «Analiza el partido entero» selecciona **Enlace de YouTube**, pega la URL y confirma que tienes permiso para procesar la grabación.
5. Pulsa **Analizar partido completo** una sola vez. No hace falta indicar dorsales. El ajuste de colores está disponible dentro de opciones avanzadas si hace falta.
6. La aplicación importará temporalmente el vídeo, recorrerá sus tramos, detectará posibles contactos y extraerá sus estadísticas estimadas. Puedes consultar las fichas por dorsal, hacer clic en «Ver acciones» o corregir un seguimiento.

Ejemplo: `https://www.youtube.com/live/ul-pA6pLWX8?is=IsJwXOeEeOTFNTQ_`.

Si YouTube impide el acceso a la grabación, **no se intentan eludir restricciones**: pide el MP4 al propietario de la retransmisión y utiliza la pestaña «Archivo local». La compatibilidad de `yt-dlp` con YouTube cambia y puede requerir actualizar dependencias. Para contenidos ajenos, asegúrate de contar con autorización y de respetar las [Condiciones de YouTube](https://www.youtube.com/t/terms).

## Estados de la pantalla

- **Importando desde YouTube:** el backend prepara la copia en el almacenamiento temporal del usuario; no tienes que subir ni enviar el vídeo a un servicio externo.
- **Analizando tramo X de Y:** RAVEL procesa de forma consecutiva todo el partido.
- **Reconociendo dorsales:** RapidOCR compara varios fotogramas por seguimiento. Solo asocia un dorsal con 3+ lecturas coherentes y un umbral conservador. Las identificaciones dudosas quedan vacías.
- **Informe terminado:** muestra contactos, rallies candidatos, equipos inferidos, estadística provisional por dorsal (toques, rallies detectados, tipos de acción tentativos) y exportaciones CSV/JSON.

Los vídeos temporales caducan a las 24 horas. Las estadísticas se guardan en el navegador y pueden exportarse. El análisis puede reanudarse si falla tras procesar varios tramos, mientras el servidor siga activo y la copia temporal no haya caducado.

Si aparece «API sin conexión»: comprueba `http://127.0.0.1:8000/health` (versión `0.8.1`) y ejecuta `REPARAR MOTOR IA.cmd` si es necesario. Asegúrate de haber cerrado cualquier servidor de versiones anteriores. Consulta `docs/YOUTUBE-AND-JERSEYS.md` para el diseño técnico y sus límites.

## Privacidad y seguridad

- El servidor escucha **solo** en `127.0.0.1`, no está preparado para exponerlo en Internet.
- Solo se aceptan URLs HTTPS de dominios concretos de YouTube; no se aceptan hosts arbitrarios ni listas de reproducción.
- Se limita la descarga por tamaño, duración (seis horas) y número de trabajos; no se emplean cookies, contraseñas ni mecanismos para eludir restricciones.
- La copia descargada y las imágenes procesadas permanecen en el equipo del usuario; los ficheros temporales se eliminan automáticamente.
- `yt-dlp` y RapidOCR son dependencias externas opcionales; antes de arrancar se informa de qué falta. La UI funciona sin OCR, pero no atribuye automáticamente números de camiseta.

## Desarrollo

```bash
npm install
npm run dev
python -m pip install -r backend/requirements.txt -r backend/requirements-youtube.txt
python -m pip install -r backend/requirements-ravel.txt -r backend/requirements-jersey.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
python -m pytest -q backend/tests
node --experimental-strip-types --test tests/*.test.mjs
```

RAVEL se instala aparte usando `scripts/setup-ravel-windows.ps1` (pesos originales MIT, no incluidos). En Windows el lanzador automatiza estos pasos cuando faltan.

API: `POST /api/analysis/youtube-jobs` recibe una URL validada, consentimiento y colores/dorsales opcionales. `GET /api/analysis/jobs/{jobId}` consulta progreso e informe. Las cargas MP4 locales siguen siendo compatibles mediante `POST /api/analysis/uploads` y `POST /api/analysis/auto-jobs`.

El núcleo es React/TypeScript + FastAPI + OpenVINO/RAVEL-VB-013 + yt-dlp + RapidOCR/ONNXRuntime. Sin GitHub Actions. No requiere API key de YouTube, pero tampoco ofrece acceso garantizado a cualquier vídeo.

**Validación:** se han realizado pruebas unitarias y de integración simulada, no inferencia sobre un partido completo en este entorno ni build completo de React por indisponibilidad del registro npm. Validar la precisión y la instalación en Windows sigue siendo necesario.


## Cambios UX 0.8.1

Para iniciar un partido ya no tienes que introducir dorsales. La app intenta leerlos con OCR en múltiples fotogramas; cuando no puede, deja el dorsal desconocido. Los colores de camiseta están en opciones avanzadas. La opción de exportar resultados aparece solo con un informe que contenga eventos o rallies, o cuando existan anotaciones manuales. La copia completa JSON de la sesión sigue disponible cuando existe análisis.

## Vista previa web (Cloudflare Pages)

La rama `main` también contiene una **demo web de interfaz** lista para el despliegue Git-integrado de Cloudflare Pages; se activa mediante `VITE_WEB_PREVIEW=1` en `.env.production`. **Todos los datos de la demo son ficticios y no hay procesamiento real de IA online.** La aplicación Windows sigue usando el frontend real + motor local, sin cambios en su funcionamiento.

Para crear el proyecto Pages, utiliza `npm run build`, salida `dist`, rama `main`, carpeta raíz `/`. Todos los detalles y advertencias: [`docs/CLOUDFLARE-PAGES.md`](docs/CLOUDFLARE-PAGES.md). No hace falta configurar GitHub Actions.
