# Cloudflare Pages — despliegue desde GitHub (sin GitHub Actions)

**Repositorio:** https://github.com/RubenIglesiasGarcia/VB-Stats

## Configuración inicial

1. Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git.
2. Autoriza la aplicación de Cloudflare para el repositorio `RubenIglesiasGarcia/VB-Stats` (solo ese repo si quieres permisos mínimos).
3. Selecciona la rama `main`.
4. Configura:
   - **Framework preset:** Vite (o None, con los mismos comandos).
   - **Root directory:** `/` (raíz del repositorio).
   - **Build command:** `npm run build`.
   - **Build output directory:** `dist`.
   - **Node.js:** 22 recomendado (`NODE_VERSION=22` si tu proyecto lo precisa).
5. Pulsa Save and Deploy. Cloudflare Pages construirá el frontend automáticamente en cada push a `main`, **sin GitHub Actions**.

## Qué está publicado

El build de producción usa `.env.production` y `VITE_WEB_PREVIEW=1`: es una **demo interactiva de UX con datos ficticios**, expresamente etiquetada. Permite explorar y corregir datos de ejemplo y descargar un CSV de muestra. No solicita vídeos, no descarga YouTube y no ejecuta RAVEL, OpenVINO, FastAPI, ni ningún procesamiento real.

**No expongas** el backend local `backend/main.py` en Internet. Escucha solo en `127.0.0.1`, no tiene autenticación por usuario ni controles multiusuario ni persistencia robusta. Antes de ofrecer análisis público hacen falta: trabajos asíncronos, almacenamiento de vídeo/reportes, autenticación, cuotas, limpieza, privacidad, permisos de reproducción, defensa frente a abuso y financiación del cómputo.

## Trabajar en local

Con `npm run dev` se carga `.env.example` si la copias a `.env` (o, si no, se usan los valores de desarrollo); `VITE_WEB_PREVIEW` no está activado, y la app completa se inicia contra el backend local. La configuración de Cloudflare **no afecta al motor local**.

## Solución de problemas

- Si Cloudflare publica una pantalla en blanco, revisa en Deployments los logs del build; un `npm run build` fallido no genera `dist`.
- Si intenta comunicarse con `127.0.0.1`, comprueba que `.env.production` forma parte del repositorio y que no se ha configurado `VITE_WEB_PREVIEW=0` como variable de Cloudflare, que tiene precedencia.
- Si la conexión de GitHub no lista el repositorio, revisa los permisos de la app de Cloudflare en GitHub: Settings → Applications → Installed GitHub Apps.
- Los modelos (`*.onnx`, `*.bin`, `*.pt`) y vídeos no se suben a GitHub. No son necesarios para esta demo.
