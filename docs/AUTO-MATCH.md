# VB Stats 0.7 — Análisis de partido completo (borrador automático)

## Lo que hace esta versión

- Seleccionas **un archivo MP4 local** y pulsas **Analizar partido completo** **una sola vez**.
- El backend local procesa el partido por tramos de 10 minutos con **RAVEL-VB-013** y agrega las detecciones al finalizar. No tienes que ir avanzando ni anotando cada punto.
- Estima secuencias de juego (rallies) mediante presencia de balón, contactos `Touch` observados por el modelo, y equipos probables utilizando el color de la camiseta.
- Sugiere un tipo técnico **solo cuando el orden de contactos lo permite** (saque/recepción/colocación/ataque); es una heurística de confianza baja, no un clasificador entrenado de esas cuatro clases.
- El resultado se guarda automáticamente en la sesión. Se puede consultar tal cual y corregir opcionalmente desde *Jugadores detectados*, *Acciones* o *Rallies*.
- Permite **asignar un dorsal una sola vez por seguimiento temporal** para actualizar todos sus contactos y sumar varios seguimientos al mismo dorsal.
- Exporta CSV/JSON de las estimaciones con su procedencia, estado de revisión y marca de tiempo.
- Si el procesamiento de un tramo falla o se cancela, permite **reanudación desde el último tramo completado**, siempre que el servidor local siga vivo y conserve el vídeo temporal.

## Lo que NO hace todavía

- **No** identifica dorsal de forma automática. Un ID de tracking no equivale a una persona identificada en toda la grabación.
- **No** cuenta puntos oficialmente ni detecta aces, errores, remates ganadores, bloqueos punto o porcentajes de recepción precisa. El modelo entrenado disponible distingue `Touch` frente a no `Touch` y es capaz de perder contactos; el tipo técnico inferido puede ser erróneo.
- **No** se ha medido la precisión de RAVEL sobre el vídeo Getafe–San Fermín. Las pruebas automáticas actuales verifican software y formatos con datos simulados, **no su rendimiento real en un pabellón**.
- No descarga YouTube automáticamente: el reproductor de YouTube no proporciona un archivo directamente analizable por la API local. Usa la copia MP4 del partido.
- Si se cierra el servidor Python, el trabajo activo puede perderse, incluso con la pestaña abierta. La reanudación de esta versión conserva tramos **solo mientras vive el proceso local**.
- No está comprobada la compilación del frontend con npm en este entorno de entrega; la instalación debe validarse en Windows.

## Inicio para Windows

1. Cierra por completo los servidores y navegadores de versiones anteriores de VB Stats, especialmente la ventana **Motor IA**.
2. Extrae el ZIP nuevo en una carpeta diferente. Abre `VB-Stats.exe` o `INICIAR VB STATS.cmd`.
3. La primera vez pueden instalarse Node.js, Python, OpenVINO y los pesos RAVEL. Requiere Internet y espacio libre suficiente.
4. Cuando en la tarjeta **Analiza el partido entero** aparezca *RAVEL disponible*, selecciona el MP4 y revisa los dos colores de camiseta.
5. Pulsa **Analizar partido completo**. Mantén abiertos el navegador y el servidor local.
6. Al terminar, consulta **Jugadores detectados**, **Acciones** y **Rallies**. No es obligatorio corregir nada para ver las cifras provisionales.
7. Exporta CSV o JSON. Para guardar el informe junto a toda tu sesión, usa **Exportar JSON** en la parte inferior.

### ¿API desconectada?

Abre `http://127.0.0.1:8000/health`, que debe devolver `"version":"0.7.0"`. Si muestra otra versión, cierra la ventana del motor antiguo e inicia la nueva. Si no responde, ejecuta `REPARAR MOTOR IA.cmd` desde el nuevo ZIP.

### Rendimiento y recursos

Un partido de 84 minutos requiere procesar muchos fotogramas con inferencia local. El análisis puede consumir CPU y disco de forma notable; no hay garantía de una velocidad concreta ni de cobertura perfecta.

La API limita los vídeos a 6 horas, acepta por defecto hasta 3072 MB (configurable mediante `VBSTATS_MAX_UPLOAD_MB`) y utiliza una copia temporal que caduca a las 24 horas. Por defecto solo escucha en `127.0.0.1`. No expongas esta API a Internet sin autenticación, control de acceso y políticas de retención.

## Licencias y atribución

Los pesos de `RAVEL-VB-013` no se distribuyen dentro del ZIP: el instalador los obtiene del repositorio público del autor bajo las condiciones de sus licencias. Revisa la licencia y dependencias antes de comercializar la solución: https://github.com/asigatchov/fast-volleyball-tracking-inference
