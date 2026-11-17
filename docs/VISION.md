# Actualización v0.5

- Se añade un filtro temporal del balón que descarta objetos espacialmente inverosímiles entre fotogramas. **No interpola observaciones ni inventa contactos.**
- Calibración visual opcional de la región de juego; elimina gente del público y objetos fuera del rectángulo marcado, pero puede eliminar acciones si el rectángulo es pequeño.
- Informe de cobertura por ventanas de 15 segundos, porcentaje de fotogramas con balón y personas, y pérdidas de tracking. Estos porcentajes **no son precision/recall**.
- Una herramienta de evaluación independiente con tolerancia temporal compara propuestas con etiquetas manuales no inducidas por IA (`scripts/evaluate-contacts.py`).
- Consulta [la guía de prueba](GUIDE_FIRST_TEST.md).

# VB Stats · Motor de visión v0.4

## Qué puede hacer ahora

El análisis de vídeo utiliza un **modelo de objetos real** cuando el operador instala pesos locales compatibles. La API analiza fragmentos de 5–900 segundos (máximo 15 minutos), detecta `person` y `sports ball`, mantiene pistas breves y busca cambios bruscos de dirección del balón cerca de una persona. Genera:

- **Posible contacto**: candidato con tiempo, pista temporal del jugador, equipo sugerido por color (si es claro), score geométrico y evidencia espacial.
- **Posible pausa**: el balón deja de detectarse varios segundos tras haber sido visible; es un indicio, **no** el final de un rally confirmado.
- **Diagnóstico de cobertura**: frames procesados, frames con detecciones de personas/balón y número de candidatos.

Los jugadores no se identifican por dorsal; el `trackId` es solo una pista temporal de pocos segundos. **No se reconocen todavía** ataques, saques, recepciones, colocaciones, bloqueos, rotaciones, puntuaciones ni sets automáticamente. Un modelo COCO genérico puede no detectar bien el balón pequeño de un pabellón; el modo detallado intenta recuperarlo con cuatro crops solapados a mayor escala, a cambio de más computación.

El usuario **reproduce cada instante** y confirma qué jugador realizó qué acción antes de que los datos entren en las estadísticas. Esto evita inventar puntos o atribuir acciones a un dorsal equivocado. Los ejemplos y los datos del partido de Getafe no se han validado con este detector.

## Instalación — Windows

Requisitos: Node.js 22+, Python 3.11–3.13, npm, y CPU o GPU compatible (una GPU es recomendable). Ejecuta desde la raíz:

```powershell
npm install
npm run dev
```

En otra consola:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-vision-windows.ps1
```

Este último comando crea un entorno virtual, instala OpenCV/Ultralytics y **descarga explícitamente** `yolo11n.pt` la primera vez. Comprueba http://127.0.0.1:8000/capabilities. Para un modelo de voleibol especializado, sustituye el fichero de pesos local y configura IDs de clases según tu dataset.

## Instalación — Linux/macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements-vision.txt
python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"  # Descarga explícita inicial
export VBSTATS_YOLO_MODEL="$PWD/yolo11n.pt"
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

En otra terminal: `npm install && npm run dev`.

## Flujo en la interfaz

1. Vincula el **archivo original local** (MP4/MOV/WebM). YouTube se puede visualizar, pero **no se descarga automáticamente** para inferencia por razones de privacidad, permisos y fiabilidad.
2. Expande **Laboratorio de detección** bajo el reproductor y revisa que la API indique "Detector preparado".
3. Elige intervalo de 1, 2, 5, 10 o 15 minutos; colores aproximados de ambos equipos, y modo equilibrado o detallado.
4. Pulsa **Analizar fragmento**. El fichero se sube **solo en ese momento** a tu API; se puede cancelar el análisis y borrar la copia temporal.
5. Reproduce cada candidato, confirma equipo, dorsal, acción y resultado. El punto ganador se marca por separado y siempre a mano.
6. Exporta JSON (incluye propuestas), CSV de acciones, CSV de jugadores o CSV de etiquetas revisadas.

## Servicios

- `GET /health`, `GET /capabilities`
- `POST /api/analysis/uploads` — subida en chunks, máx. 1000 MB por defecto, validación de cabeceras, sin URL arbitrarias.
- `POST /api/analysis/jobs` — cola limitada, intervalo/colores/precisión/mode.
- `GET /api/analysis/jobs/{id}` — progreso, candidatos y diagnóstico.
- `DELETE /api/analysis/jobs/{id}` — cancelación cooperativa.
- `DELETE /api/analysis/uploads/{id}` — borrar fichero temporal, salvo si se está procesando.

Los ficheros temporales se purgan aproximadamente después de **24 horas** por una tarea interna horaria (si el servidor está encendido), y se pueden eliminar de inmediato desde la interfaz. Los resultados se mantienen en memoria hasta su expiración, y las propuestas se guardan en el JSON/localStorage del navegador.

## Variables de entorno

| Variable | Uso |
|---|---|
| `VBSTATS_YOLO_MODEL` | Ruta a fichero local de pesos `.pt`, requerida para activar la detección |
| `VBSTATS_YOLO_DEVICE` | `cpu`, `0` o `cuda:0` dependiendo de PyTorch |
| `VBSTATS_PERSON_CLASS_ID` | Índice de clase persona (COCO: `0`) |
| `VBSTATS_BALL_CLASS_ID` | Índice de clase sports-ball (COCO: `32`) |
| `VBSTATS_DATA_DIR` | Carpeta temporal bajo la cuenta del operador |
| `VBSTATS_ALLOWED_ORIGINS` | CORS, por defecto solo localhost:5173 |
| `VBSTATS_MAX_UPLOAD_MB` | Límite de subida, por defecto `300` |
| `VITE_ANALYSIS_API` | URL del backend utilizada por React |

## Seguridad y privacidad

- Diseñado para uso **local o dentro de una red privada**. No incluye login, autorización por usuario, control de cuota por cuenta, antivirus ni cifrado de datos en reposo. **No publiques la API abierta a internet**.
- El análisis de vídeos de terceros requiere los permisos correspondientes. No se realiza scraping de YouTube ni se descarga el vídeo remotamente.
- Si se despliega el backend en un servidor remoto, el vídeo se enviará a ese servidor al pulsar Analizar; el aviso de privacidad de la interfaz debe reflejar ese despliegue.
- No se deben añadir vídeos ni pesos de modelos al repositorio.

## Evaluación científica antes de comercializar

1. Etiquetar manualmente **100–200 rallies** de al menos 3 pabellones distintos: momentos reales de contacto, balón, caja del jugador y dorsal validado. Reservar encuentros completos para test independiente.
2. Medir *recall* y precisión del balón, tracking (ID switches), tiempo de contacto a ±0,25s, tasa de falsos candidatos/minuto, y cobertura real por jugador.
3. Evaluar por contexto: tipo de iluminación, distancia, anchura de campo, cámara fija o móvil, camiseta de líbero, bloqueos/oclusiones, cambios de pista y sustituciones.
4. Afinar modelo especializado en pelota de voleibol, segmentación de rallies, poses e identidad por dorsal **con datasets propios y licencias comprobadas**.
5. Solo activar reconocimiento de tipos de toque y puntuaciones cuando alcancen umbrales medidos y exista control de calidad por evidencia.

El `confidence` actual es una **señal heurística no calibrada**, nunca una probabilidad estadística ni garantía de acierto. Un contacto que falte **no significa** que no ocurriera.

## Licencias de modelos

**Ultralytics YOLO** se distribuye bajo **AGPL-3.0** o licencia empresarial, según sus términos. Antes de publicar un SaaS de pago o código cerrado, decide si la distribución completa será compatible con AGPL-3.0 o adquiere una licencia comercial adecuada; consulta la [política de Ultralytics](https://www.ultralytics.com/license). El uso de modelos de terceros debe verificarse individualmente; este proyecto no distribuye pesos propietarios ni copias de vídeos.
