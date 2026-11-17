# Cambios

## Web Preview 0.9 · 17/11/2026

- Demo web para Cloudflare Pages construida desde GitHub, sin GitHub Actions.
- Demostración de estadísticas de ejemplo claramente etiquetadas como ficticias, con filtros y corrección de dorsal/acción y CSV de muestra.
- Frontend real 0.8.1 se mantiene para Windows y desarrollo local; la demo no expone el backend Python.
- Documentación de despliegue Git-integrado y controles básicos de cabeceras HTTP.
- Se omiten los ejecutables, los modelos IA y los vídeos del repositorio.

## 0.8.1

Véase el historial anterior en la documentación original del paquete Windows.

## 0.9.0 - Base para IA online y estadisticas de entrenador

- Modulo `performance.ts`: formulas verificadas de saque, recepcion 0-3, ataque, bloqueo y defensa por equipo y dorsal.
- Interfaz `OnlineStudio`: acceso beta por clave, enlace YouTube y archivo, progreso, informe, filtros y revision rapida.
- Backend protegido en modo publico con clave en cabecera y limitaciones de procesamiento, sin alterar el arranque local.
- Dockerfile con RAVEL-VB-013 y OCR, preparado para Railway, y guardado de checkpoints de analisis por tramos.
- Tests del calculo y autenticacion. Las predicciones sin resultado revisado siguen siendo provisionales.
