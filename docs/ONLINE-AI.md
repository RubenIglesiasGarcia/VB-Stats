# VB Stats 0.9 — beta online con analítica para entrenadores

## Arquitectura

- **Frontend:** Cloudflare Pages, conectado a `RubenIglesiasGarcia/VB-Stats`, rama `main`, comando `npm run build`, salida `dist`.
- **Backend:** un servicio Python/FastAPI de Railway construido desde **el mismo GitHub**, con `Dockerfile` en la raíz. Incluye RAVEL-VB-013 y sus pesos del release original. Arranque con un solo worker.
- **Acceso:** clave privada `VBSTATS_ACCESS_TOKEN` solo en el servidor, enviada por el usuario al iniciar sesión desde el navegador; nunca en `VITE_*` ni GitHub. Es una beta de uso individual, NO autenticación multiusuario.
- **Privacidad:** clips de vídeos autorizados. Los vídeos residen temporalmente en el servidor. Montar un volumen en `/app/analysis-data` para que sobrevivan a reinicios. Se borran por antigüedad (24 h). Los resultados y tramos se guardan en checkpoint; las correcciones del entrenador en su navegador.

## Limitaciones y seguridad

- **Esto NO sustituye automáticamente las estadísticas de Balltime.** RAVEL-VB-013 detecta posibles toques y seguimientos; los resultados ace/error/kill/recepción 0–3/eficiencia se calculan únicamente a partir de resultados revisados explícitamente.
- Las clases de técnica inferidas por el orden de contactos son débiles. Nunca convertir en estadística oficial sin evidencia adicional.
- Los vídeos de YouTube dependen de disponibilidad, restricciones y autorización; un enlace puede no descargarse. No eludir DRM, iniciar sesiones ajenas ni usar cookies privadas.
- En la beta online: 1 trabajo activo, máximo 200 MB por subida, 60 minutos de grabación en la cuenta actual de Railway y límite de almacenamiento temporal. Enlace YouTube importado directamente en el servidor, sin subir archivos manualmente.
- No usar directamente como producto público de varios clubes. Se requiere login por usuario, aislamiento de almacenamiento, control de cuotas, consentimiento y registro de acceso, almacenamiento gestionado y clasificación independiente de resultados antes de abrirlo.
- Railway cobra CPU, RAM, disco y tráfico. **Configurar un límite de gasto en Railway**, no usarlo para grandes cargas sin estimación. Un CPU puede tardar muchas horas en completar un partido.
- Ante reinicios del servidor, los trabajos a medias quedan interrumpidos y pueden reanudarse desde el último tramo guardado cuando existe volumen persistente y el vídeo sigue disponible.

## Variables para Railway

- `VBSTATS_ACCESS_TOKEN`: una cadena secreta aleatoria de al menos 24 caracteres, nunca pública.
- `VBSTATS_ALLOWED_ORIGINS`: URL de la aplicación Cloudflare Pages, por ejemplo `https://vb-stats.pages.dev`, sin `/` final.
- `VBSTATS_PUBLIC_MODE=1`
- `VBSTATS_DATA_DIR=/app/analysis-data`
- `VBSTATS_MAX_UPLOAD_MB=200`
- `VBSTATS_MAX_VIDEO_SECONDS=3600`
- `PORT`: Railway lo establece automáticamente.

## Variables para Cloudflare Pages

- `VITE_ONLINE_STUDIO=1`
- `VITE_WEB_PREVIEW=0`
- `VITE_ANALYSIS_API=https://<api>.up.railway.app` (URL real de Railway, sin barra final).

**Nunca** poner `VBSTATS_ACCESS_TOKEN` en una variable `VITE_` ni en los archivos del repositorio.

## Informe técnico

La pantalla tiene tres pestañas: equipos, jugadores y revisión de acciones. Las cifras de contacto/rally/OCR son estimaciones, marcadas como tales. Los resultados técnicos `ace`, `error de saque`, `recepción 0–3`, `kill`, `error de ataque`, `bloqueo punto` y otros se introducen al verificar una acción. Las métricas se recalculan automáticamente por equipo/dorsal; las exportaciones CSV contienen **solo resultados revisados**. Si no hay suficientes, se muestra guion, no 0 falsamente.

### Fórmulas

- **Error de saque %:** errores de saque / saques verificados × 100.
- **Ace %:** aces / saques verificados × 100.
- **Recepción perfecta %:** recepciones con 3 / recepciones verificadas × 100.
- **Calidad de recepción:** suma de calidades 0–3 / recepciones verificadas.
- **Eficiencia de ataque:** (kills − errores) / intentos de ataque verificados.
- **Bloqueos punto:** número de acciones verificadas como bloqueo punto.

**Atención al denominador:** estas métricas cubren solamente acciones verificadas, no todo el partido, mientras no contemos con clasificación de resultados fiable y completa.

## Próximas tareas técnicas para estadísticas automáticas reales

1. Dataset con vídeos de partidos de usuarios autorizados, anotaciones de `actor`, `action`, `outcome`, `team`, `jersey`, `rally` y `scoreboard`, con partidos enteros separados en train/test sin filtración entre vídeos.
2. Entrenar y evaluar un modelo temporal de **tipo de acción** con clases diferenciadas saque/recepción/colocación/ataque/bloqueo/defensa (RAVEL detecta principalmente Touch/no Touch).
3. Clasificación de **resultado** (ace, error de saque, kill, error de ataque, balón continúa) con contexto de la secuencia y posibles actualizaciones del marcador. Verificar que detecta también puntos ausentes, no solo conocidos.
4. Identidad persistente del jugador por OCR multi-fotograma + apariencia y rotaciones, y umbrales de abstención. Validación de cambios de set/cámara/plantilla.
5. Comparar conteos de errores con un acta anotada por entrenador por partido y por jugador: precisión, recall, F1, error absoluto por categoría y cobertura de dorsales.
6. Añadir registro seguro multiusuario, trabajos persistentes durables con almacenamiento objeto, contadores de costes y concurrencia controlada antes de abrirlo a público.

## Estado de despliegue Railway a 17/11/2026

Proyecto `vb-stats-preview`, servicio `vb-stats-ai-beta`, rama objetivo `main`. Servicio creado y variables de acceso ya configuradas. **NO desplegado**: el conector de Railway devuelve `User does not have access to the repo` al conectar `RubenIglesiasGarcia/VB-Stats`. Para desbloquear, entrar en Railway → proyecto `vb-stats-preview` → servicio `vb-stats-ai-beta` → Settings → Source → Connect Repo y autorizar a **Railway GitHub App** para el repositorio `RubenIglesiasGarcia/VB-Stats` en GitHub. Tras ello, enlazar `main`, desplegar y comprobar `/health` y `/capabilities` con clave. En Cloudflare configurar `VITE_ONLINE_STUDIO=1`, `VITE_WEB_PREVIEW=0` y `VITE_ANALYSIS_API=https://<dominio>` únicamente **después** de verificar la inferencia. Nunca publicar la clave en código público. El plan Railway disponible limita a **1 GB RAM y 500 MB de volumen**, insuficientes para garantizar vídeos largos; si los modelos se quedan sin memoria, subir capacidad o rediseñar trabajador de procesamiento por partes. La creación del volumen puede implicar costes incluso con el servicio sin desplegar.
