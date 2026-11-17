# VB Stats — hoja de ruta para análisis de partidos como Balltime

**Fecha:** 17 de noviembre de 2026. Documento de arquitectura; los hitos de producto son objetivos, no características verificadas.

## Requisito principal

Un entrenador pega una URL pública de YouTube de un partido de 90–180 minutos, inicia el análisis y recibe un informe por equipo/jugador con momentos reproducibles. Sin instalaciones ni claves de IA por visitante. Objetivo de producto: menos de una hora de procesamiento para un partido de 90 minutos **después** de obtener legalmente el vídeo, sujeto a benchmarks.

## Comparación realista

Balltime/Hudl emplea visión entrenada específicamente para voleibol y permite revisión/corrección del resultado. La documentación de Balltime indica aproximadamente **una hora de procesamiento** tras subir la grabación. No publican una API o pipeline que podamos simplemente copiar. Fuente: https://academy.balltime.com/getting-started/faqs y https://support.hudl.com/s/article/volleyball-ai

VB Stats actual:
- **RAVEL-VB-013 OpenVINO/CPU:** jugadores, balón y posibles contactos; no clasifica de forma certificada errores, aces, bloqueos ni recepción 0–3. Un modelo de tracking no es un estadístico completo.
- **Gemini URL YouTube:** observa el vídeo público sin descargarlo en Railway; muestreo por defecto de **1 fotograma por segundo**, insuficiente para registrar cada toque rápido. El informe limita observaciones (120). Debe llamarse **vista preliminar**, nunca scouting completo. Fuente: https://ai.google.dev/gemini-api/docs/video-understanding
- **Infraestructura Railway:** 1 vCPU, 1 GB RAM y 500 MB volumen. En las métricas del 17/11 se alcanzó ~1 GB de RAM, próximo al límite.
- **YouTube:** para la grabación ul-pA6pLWX8 yt-dlp devolvió "Sign in to confirm you're not a bot" desde Railway. La API oficial de YouTube no ofrece descarga general de vídeo ajeno. No hay garantía de que un enlace público arbitrario sea extraíble a resolución/fps suficientes desde nuestro servidor.

## Cambios implementados en código (no necesariamente desplegados)

- `backend/vision/fast_clip.py`: FFmpeg recorta una ventana con un solo proceso y reduce fps/resolución **opcionalmente** para ahorrar CPU, memoria y disco. Predeterminado: 18 fps, ancho máximo 960. Puede perder contactos rápidos: nunca etiquetar esta modalidad como más precisa sin medir recall.
- Variable `VBSTATS_FFMPEG_SEGMENTS=1` (predeterminada) en `backend/vision/ravel.py`. Puede revertirse a la implementación antigua con `0`.
- `backend/main.py` expone `elapsedSeconds`, `etaSeconds`, `processingSpeed` y `lastChunkSeconds` tras cada tramo terminado. El estado de cada tramo distingue preparación e inferencia.
- `src/OnlineStudio.tsx` presenta la velocidad observada y ETA, siempre como estimación.
- `backend/tests/test_fast_clip.py`: prueba sintética de recorte FFmpeg y cancelación. Se probó localmente con un vídeo sintético, no con una grabación de voleibol.
- `scripts/benchmark_ravel.py`: medición del modelo en 1–4 fragmentos reales para estimar tiempos, sin prometer exactitud.

## Arquitectura recomendada para lograr el objetivo

1. **Entrada YouTube:** validar URL pública y derechos de análisis. Intentar Gemini directo para un primer informe preliminar. Para estadística fotograma a fotograma hay que poder acceder a una señal de vídeo autorizada de suficiente frecuencia. Si el proveedor bloquea las descargas automáticas, **no inventar** una ruta técnica que eluda las comprobaciones. Mejor experiencia futura: que el propietario del canal autorice una integración/entrega de la grabación una vez; los entrenadores seguirían pegando solo la URL.
2. **Localización de rallies:** una primera pasada ligera estima intervalos activos usando vídeo/audio/marcador; se entrena y evalúa frente a límites de jugada anotados. Nunca saltarse jugadas por una heurística no verificada.
3. **Detección especializada:** para cada rally, tracking del balón y jugadores, corrección de cámara, cambio de pista, clasificación temporal de toque y secuencia saque→recepción→colocación→ataque; registrar incertidumbre e instantes de vídeo.
4. **Identificación de jugador:** dorsal OCR multiframe + reidentificación + rotación + alineación aportada por equipo. Dudas se marcan para revisión, nunca se convierten en un dorsal inventado.
5. **Resultados:** clasificador supervisado de final de jugada, error de saque, punto de ataque, bloqueo y recepción 0–3 sobre clips anotados. No inferir por simple orden de contactos. Separar en UI "detectado", "propuesto" y "verificado".
6. **Infraestructura:** Cloudflare Worker + almacenamiento R2/colas para orquestar; worker de inferencia con GPU mediante Modal o Runpod Serverless según pruebas. El adaptador OpenVINO actual usa `--device CPU`, por lo que **hay que portar o sustituir el modelo para usar GPU**. Modal publica T4 ~$0.59/h, L4 ~$0.80/h, A10 ~$1.10/h de GPU, **más** CPU, memoria, almacenamiento y tráfico. Referencia https://modal.com/pricing. Cloudflare R2 evita cargos por salida, pero cobra almacenaje y operaciones: https://developers.cloudflare.com/r2/pricing/
7. **Persistencia:** conservar checkpoint por tramos, tiempos de cada fase y resultados; permitir revisión y exportación sin necesidad de dejar la pestaña abierta. Presupuesto y límites por trabajo para evitar gastos imprevistos.

## Criterios de aceptación de producto (NO alcanzados aún)

- A) **Prueba técnica:** procesar 3 clips de rally, 1 set y 1 partido de 90+ minutos; sin OOM ni bloqueo, con tiempos y RAM medidos.
- B) **Tiempo objetivo:** como hito, ≤60 min de cómputo por 90 min de vídeo, una vez disponible la fuente autorizada. Comparar con el resultado de `scripts/benchmark_ravel.py`.
- C) **Precisión:** medir por separado precisión/recall de rallies, contactos, equipo, dorsales y acciones. Objetivos de validación propuestos: F1 ≥0.90 para detección de rallies; F1 ≥0.80 para contactos; precisión ≥0.90 para acciones adjudicadas como verificadas (las dudosas quedan para revisión). No confundir objetivos con métricas reales.
- D) **Usabilidad:** enlace, progreso real, ETA, resultados con clips correspondientes; indicar claramente cuándo se ha analizado solo una muestra.
- E) **Fiabilidad y coste:** límites de concurrencia y gasto, cola, reintentos, pausa/reanudación y medidas de calidad en el tiempo.
- F) **YouTube:** distinguir entre vídeo público que Gemini puede examinar, archivo completo autorizado accesible y vídeo no descargable por el servidor. No garantizar todo el scouting desde un vídeo inaccesible a nivel de fotogramas.

## Orden de implementación recomendado

1. Ejecutar y registrar benchmark real sobre 20–60 segundos del partido con el hardware actual.
2. Medir precisión de rally y contacto en 20 jugadas anotadas por entrenador; mantener fps alto si 18fps pierde contactos.
3. Probar una GPU temporal con modelo compatible para contrastar velocidad y coste, **sin dejar una GPU encendida** permanentemente.
4. Validar segmentación y los seis tipos de acciones antes de calcular estadísticas.
5. Conectar grabaciones autorizadas a la entrada de YouTube sin pasos técnicos para el visitante.
6. Validar 90 minutos completos de extremo a extremo antes de anunciar disponibilidad general.

**Limitación actual:** no se ha obtenido ni procesado íntegramente ul-pA6pLWX8; los cambios en GitHub no equivalen a código desplegado en Railway. No ofrecer estimaciones de precisión que no estén respaldadas por pruebas.
