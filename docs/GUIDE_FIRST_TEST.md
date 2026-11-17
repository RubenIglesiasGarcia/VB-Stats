# Primera prueba real de VB Stats — Getafe Verde / San Fermín

Prueba controlada, no evaluación oficial de rendimiento. **Necesitas el MP4 original**; un enlace de YouTube solo permite reproducirlo dentro de la interfaz. Los vídeos no se añaden al repositorio.

## Windows — iniciar con un comando

Instala [Node.js 22+](https://nodejs.org/) y [Python 3.11+](https://www.python.org/downloads/), incluyendo Python Launcher (`py`). Extrae el ZIP del proyecto, abre PowerShell en la carpeta con `package.json` y ejecuta:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-all-windows.ps1
```

La primera vez instala npm, dependencias de visión (pueden ser grandes) y pesos YOLO. Se abren el frontend en la terminal actual y una segunda ventana con el backend local. Visita **http://localhost:5173**. Debe verse «Detector preparado» al abrir el Laboratorio de detección. Solo se envían archivos a la **API local** cuando pulsas Analizar.

## Probar el primer fragmento

1. En **Nuevo vídeo**, selecciona el MP4. Si quieres, añade el enlace de YouTube para reproducirlo, pero el motor necesita el MP4 local.
2. En Laboratorio, pulsa **Delimitar zona de juego**, captura un fotograma del segmento y arrastra para rodear cancha + trayectoria del balón. Excluye público, mesa y banquillos cuando puedas, pero deja margen.
3. Selecciona **1 minuto** para el primer experimento y modo **Equilibrado** (mejor para CPU). Define los colores aproximados de las camisetas de ambos equipos.
4. Pulsa **Analizar fragmento**. Tras el procesado, revisa **Cobertura visual estimada** y la banda de tramos de 15 segundos: rojo = pocos fotogramas con balón; verde = muchos. **No representa precisión ni recall**.
5. Selecciona un candidato, vuelve unos segundos atrás y **confirma equipo, dorsal y acción** solo si se ve claramente. Lo que se descarta no altera estadísticas.
6. Ve a **Estadísticas** para comparar equipos o a **Jugadores** para filtrar el dorsal 13. Usa **Exportar** para guardar sesión y CSV.
7. Si el primer minuto funciona, elige **5 / 10 / 15 minutos**, o **Siguiente tramo** hasta cubrir un partido completo. No proceses de golpe 84 minutos con CPU; empieza corto.

## Interpretación de los resultados

- Si `Fotogramas con balón` es muy bajo, usa **Balón pequeño (modo detallado)**, más lento. También puedes ajustar la región de pista.
- Si hay muchos falsos contactos, no los aceptes: revisa marcas de tiempo y exporta el dataset de decisiones. Un `trackId` no es un dorsal.
- Si las estadísticas aparecen vacías, es **correcto** hasta que se confirmen acciones manualmente.
- El informe del dorsal 13 será incompleto si hay jugadas no detectadas o no anotadas.
- Los resultados se guardan en el navegador: **exporta JSON periódicamente**. No borres los datos del navegador hasta guardarlo.

## Medir la calidad científica

Etiqueta contactos de un tramo **sin ver primero las propuestas de la IA**. Guárdalos en un CSV `second` (tiempo en segundos, uno por fila), por ejemplo:

```csv
second
8.24
9.12
10.67
```

Exporta el JSON de sesión desde VB Stats y ejecuta (con backend y sus dependencias instalados):

```powershell
python scripts\evaluate-contacts.py --session .\vb-stats-sesion.json --truth .\contactos-reales.csv --tolerance 0.35
```

Obtendrás verdaderos positivos, falsos positivos, falsos negativos, precisión, sensibilidad (recall) y F1 con una tolerancia de ±0,35s. **Una serie de fotogramas con balón detectado no equivale a una acción detectada**. Compara con la verdad anotada antes de entrenar modelos especializados.

## Problemas conocidos

La detección actual usa YOLO COCO, no un detector específico de balones de voleibol y dorsales. Los saltos, bloqueos, oclusiones y primeros planos pueden perder toques. La geometría de la pista, rotaciones, resultado del rally, tipo de acción y quién lleva cada dorsal **no se infieren automáticamente**. La revisión es obligatoria.

La API es local, sin autenticación; no la publiques directamente en internet. Los archivos subidos se mantienen temporalmente hasta 24h o hasta que los elimines.
