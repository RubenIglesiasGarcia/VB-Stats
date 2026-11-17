# VB Stats — acceso de visitantes sin cuentas ni claves

La web pública muestra directamente el formulario de YouTube o vídeo. **Ningún visitante necesita cuenta, clave ni instalar programas.**

## Configuración única del propietario (no de los visitantes)

1. En **Railway → vb-stats-ai-beta → Variables**, localiza la variable secreta `VBSTATS_ACCESS_TOKEN`. No la publiques.
2. En **Cloudflare → Workers & Pages → vb-stats → Settings → Variables and Secrets → Add**, crea una variable de tipo **Secret** con nombre **`VBSTATS_RAILWAY_KEY`** y pega el mismo valor.
3. Publica la variable con **Deploy**. Comprueba que el último despliegue de `main` incluye `worker/index.js` y `wrangler.jsonc`.
4. Abre la web pública. Debe mostrar **Analizar partido**, sin pedir claves. El navegador habla con `/capabilities` y `/api/analysis/...` del Worker; el Worker añade la clave solo al conectarse con Railway.

**Nunca** copies la clave en GitHub, en `.env.production`, en `VITE_*`, ni en una consulta compartida. El Worker devuelve 503 y **no contacta al backend** si el secreto no está configurado.

## Protecciones iniciales

- Solo se permite un conjunto de rutas API; el proxy no puede acceder a otras URL.
- Cloudflare Rate Limiting: hasta 60 peticiones por minuto por IP, una solicitud de análisis por minuto por IP, dos solicitudes por minuto por ubicación de Cloudflare, y una subida por minuto por IP.
- Las limitaciones de Cloudflare son aproximadas, **por ubicación**, no una cuota global exacta. No garantizan controlar el gasto total.
- La beta pública limita las subidas directas a **25 MB**, aunque la importación permitida desde YouTube usa el servidor de Railway y depende de restricciones de YouTube.
- Railway mantiene **un solo trabajo de análisis activo** y exige el secreto incluso si alguien conoce la dirección pública del servidor.
- En una beta sin cuenta, las correcciones se almacenan en el navegador del visitante. No hay acceso multiusuario protegido ni historial en la nube.

## Importante antes de activarlo

La cuenta de Railway tiene actualmente **1 GB de RAM, 500 MB de almacenamiento** y crédito limitado. El análisis real de un partido largo puede consumir horas y fallar por memoria o espacio.

**Establece límites de gasto/alertas en Railway antes de hacer público el Worker.** Para pruebas abiertas, conviene comenzar con clips cortos y supervisar las métricas y registros de Railway.

RAVEL detecta posibles contactos y seguimientos; **no identifica de forma fiable todos los aces, errores, recepciones o puntos**. Esas estadísticas aparecerán como verificadas solo después de una revisión. No es todavía un clon de Balltime.

## Comprobación

- `https://tu-worker.workers.dev/capabilities` debe devolver información de `engines.ravel.ready`, sin revelar `VBSTATS_RAILWAY_KEY`.
- Si devuelve un JSON con 503, falta el secreto en Cloudflare o está desactivado.
- Si devuelve 502, el motor Railway no está disponible.
- Si devuelve 429, se ha aplicado un límite temporal de peticiones.
