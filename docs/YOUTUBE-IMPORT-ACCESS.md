# Diagnóstico: YouTube pide comprobación antibots desde Railway

Caso: https://www.youtube.com/live/ul-pA6pLWX8

## Observación confirmada

En los logs del servicio Railway `vb-stats-ai-beta` (17 de noviembre de 2026, ~16:22 UTC), `yt-dlp` registra repetidamente:

```
ERROR: [youtube] ul-pA6pLWX8: Sign in to confirm you're not a bot.
```

La API responde `202 Accepted` porque el trabajo se encola correctamente, pero la **fase de importación falla antes de descargar el vídeo y antes de ejecutar RAVEL**. No hay evidencia de que el vídeo esté privado, ni de un fallo de memoria o duración en este intento.

La causa probable es el control de acceso antibots de YouTube hacia la sesión/dirección IP del servidor. Una actualización de `yt-dlp` no lo garantiza. No pedir cookies, contraseñas, ni credenciales personales de YouTube a los visitantes. El reproductor embebido de YouTube no entrega directamente los fotogramas a la IA.

## Lo que permite realmente VB Stats hoy

- Se acepta un enlace de YouTube pero **no todos pueden importarse** desde Railway.
- El modelo RAVEL está instalado y disponible cuando se consulta su readiness, pero no se ejecutó en este intento.
- Se puede analizar un **archivo de vídeo original autorizado** mediante la opción `Subir un vídeo`. Actualmente el Worker público limita la subida a **25 MB**, **insuficientes para un partido de hora y media**.
- Para cubrir un partido completo con un archivo original, la siguiente inversión necesaria es **subida directa por partes a almacenamiento objeto (R2/S3) con URLs temporales**, seguida de análisis en un worker con almacenamiento y memoria adecuados. Esto evita claves de IA para los visitantes, pero requiere configurar y costear el almacenamiento.
- La alternativa ideal para un club es acceder al **archivo original de la grabación** (por ejemplo, exportarlo desde el sistema de grabación del equipo o obtenerlo del canal si se es el propietario) y usar una importación de archivos grandes, cuando esté implementada.

## Estado del código

Se ha añadido `describe_download_failure()` para distinguir un rechazo antibots de un vídeo privado, con pruebas unitarias, y un aviso más claro en el frontend. **El contenedor Railway se desplegó manualmente desde CLI; no toma los cambios de GitHub hasta que se ejecute un nuevo despliegue.** Cloudflare debe compilar el último commit para mostrar la corrección visual.

## Acceso y cumplimiento

Los servicios API de YouTube no dan acceso libre a los bytes de todos los vídeos de otros usuarios. No se debe incorporar un sistema de evasión de verificaciones antibots ni almacenar cookies de cuentas personales como solución estándar. La aplicación debe trabajar con grabaciones sobre las que exista derecho de acceso y procesamiento.
