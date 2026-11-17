# VB Stats 0.6 · RAVEL-VB-013 (motor de voleibol)

## Lo que es real y lo que no

Se integra mediante un **adaptador local por subprocess** la inferencia del motor publicado en [asigatchov/fast-volleyball-tracking-inference](https://github.com/asigatchov/fast-volleyball-tracking-inference), versión **v0.2.0**, que incluye los pesos **RAVEL-VB-013-9f.xml/bin/json**. Las licencias del repositorio y pesos publicados son MIT; el código y pesos originales son del autor y se descargan desde su repositorio, **no se redistribuyen dentro del ZIP de VB Stats**.

El modelo detecta personas, balones y un score `Touch` por jugador con un identificador temporal. VB Stats colapsa los frames próximos al pico de probabilidad y muestra una propuesta revisable. La presencia del balón permite proponer intervalos de rally sin atribuir ganador. Se mantienen todos los datos predichos separados de las estadísticas confirmadas.

**NO hace todavía**: OCR de dorsales fiable, clasificacíon automática completa de saque/recepción/colocación/ataque/bloqueo, evaluación 0–3 de recepción, puntos adjudicados automáticamente ni estadísticas completas por jugador. Un `track_id` no equivale a dorsal. Las métricas del repositorio de origen son de su conjunto de prueba y **no validan vídeos de Getafe ni cámaras de la liga madrileña**.

## Windows · un clic

1. Descomprimir el ZIP entero (no ejecutar el EXE dentro del ZIP).
2. Abrir `VB-Stats.exe` o `INICIAR VB STATS.cmd`.
3. La primera vez, `scripts/start-vision-windows.ps1` crea la venv, invoca `setup-ravel-windows.ps1`, descarga **v0.2.0** de GitHub y ejecuta pip para instalar los requisitos OpenVINO. Requiere Internet y espacio libre.
4. Abrir `http://127.0.0.1:5173`, elegir **RAVEL-VB-013**, cargar un MP4 y analizar 1–2 minutos para comenzar. Luego revisar los contactos y saltar a cada rally candidato.

Si RAVEL aparece *No disponible*, comprueba `http://127.0.0.1:8000/capabilities` y vuelve a ejecutar `scripts/setup-ravel-windows.ps1`. No descargues pesos de enlaces desconocidos.

## Integración API

- `GET /capabilities`: presenta `engines.ravel.ready` y `engines.yolo.ready`; no se marca listo un modelo que no existe.
- `POST /api/analysis/jobs` con `{ uploadId, engine: "ravel", startSeconds, durationSeconds }`.
- `GET /api/analysis/jobs/{id}`: estado, progreso y `proposals[]` + `stats.rallyCandidates[]`.
- `/api/analysis/uploads`: el vídeo permanece en el servidor local, se elimina tras 24 h o a petición.

El adaptador recorta la ventana en MP4 temporal, lanza el proceso RAVEL con ruta de modelo local y lee `predictions.jsonl.gz` (o `.jsonl`). Admite cancelación; nunca envía el vídeo a un servidor remoto. **La instalación del modelo sí descarga software y pesos de GitHub.**

## Validación, límites y expectativas

Las pruebas unitarias comprueban la lectura del formato de salida real de RAVEL (esquema documentado), agregación de picos, tiempos y estados. No ejecutan pesos reales. Se requiere una validación con el vídeo Getafe–San Fermín etiquetado manualmente, midiendo precisión, recall y F1 de contactos, atribución y rallies antes de presentar resultados automáticos fiables.

La segmentación por ausencia del balón no equivale a saber cuándo termina un punto; el vídeo puede contener varios contactos perdidos, interrupciones o balones sobre la grada. Los outputs de probabilidad no están calibrados para este dominio. Ninguna propuesta se contabiliza automáticamente.

El código externo y sus modelos no son parte de este repositorio; consulta sus licencias y política de actualización. Para un servicio público habría que añadir autenticación, cuotas y aislamiento de procesos.
