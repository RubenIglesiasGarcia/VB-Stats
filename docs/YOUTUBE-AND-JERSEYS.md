# YouTube + dorsales: implementación, evidencia y mejoras próximas

## Flujo automático de un enlace

1. La UI recibe la URL, valida el consentimiento del usuario y propone colores de camiseta y dorsales opcionales.
2. `backend/vision/youtube_import.py` valida que sea un único enlace HTTPS de YouTube/watch, live o youtu.be, extrae un ID de 11 caracteres y reconstruye una URL canónica. Nunca se envía una URL arbitraria a `yt-dlp`.
3. `yt-dlp` consulta duración y estado (emisiones aún en directo o programadas se rechazan), selecciona un único stream de vídeo de hasta 1080p sin necesidad de combinar audio y vídeo. Descarga al equipo local, con control de tamaño y posibilidad de cancelación.
4. La API reutiliza su analizador completo por tramos; RAVEL-VB-013 emite probables contactos y regiones de jugadores. Se recuperan también algunos fotogramas de **todo el seguimiento**, no solo del instante del toque.
5. `RapidOCR` analiza el torso de cada seguimiento, descartando regiones pequeñas o varias lecturas simultáneas. `aggregate_votes` solo atribuye un dorsal cuando tiene **tres o más lecturas nítidas y un mínimo del 75 % de acuerdo**. Los dorsales conocidos permiten restringir los candidatos a los números del equipo.
6. La salida es un borrador editable. Se conservan confianza del modelo y confianza del dorsal. El usuario puede corregir la asignación a un seguimiento completo y exportar los datos.

## Mejoras futuras para identificar dorsales de verdad a nivel profesional

**Fase A: mejorar la evidencia visual.** El dorsal puede ocupar menos de diez píxeles en una cámara fija de pabellón. Hay que priorizar vídeo 1080p, detectar si el jugador está de espaldas y seleccionar fotogramas enfocados donde el número sea legible. Implementar clasificador de legibilidad, detección de hombros/caderas y localización anatómica del torso, en lugar del simple rectángulo actual.

**Fase B: OCR especializado.** La investigación de Koshkina y Elder (CVPR Workshops 2024) utiliza legibilidad + pose + PARSeq para dorsales y agregación a lo largo de la secuencia. Podríamos entrenar PARSeq con recortes de las camisetas y dorsales de voleibol federado. Alternativamente RAVEL publica un módulo experimental de pose+OCR, pero no trae integración lista para nuestro caso. No se debe afirmar que el OCR generalista ya rinde igual.

**Fase C: identidad global.** RAVEL asigna IDs de seguimiento **temporales**; tras bloqueos visuales, sustituciones o cambios de set pueden aparecer distintos IDs para el mismo jugador. Necesitamos reidentificación usando color del equipo, dorsal confirmado, físico/posición y plantillas reales con validación de duplicados. El reconocimiento facial no es necesario.

**Fase D: estadísticas deportivas.** Los contactos y rallies candidatos no bastan para porcentajes de recepción, eficiencia de ataque, aces, errores, bloqueos o puntos. Hace falta un clasificador supervisado de acciones y resultados, seguimiento de la pelota hasta el desenlace, detección de saque y final del rally, control del número de contactos por equipo y validación contra marcador/actas. La interfaz siempre debe diferenciar estimación de dato confirmado.

## Cómo medir la precisión con el partido Getafe–San Fermín

Anotar manualmente una muestra representativa de 50–100 puntos distribuida entre los sets. Comparar sensibilidad de detección de contacto, precisión de actor, número de dorso top-1 por jugador y tasa de abstención (sin dorsal). Después medir recuento de rallies, falsos positivos y errores de estadísticas. Nunca utilizar un porcentaje de confianza del modelo como si fuera precisión real sin evaluación.

## Referencias

- RAVEL-VB-013 — https://github.com/asigatchov/fast-volleyball-tracking-inference
- RapidOCR — https://github.com/RapidAI/RapidOCR
- CVPRW 2024: A General Framework for Jersey Number Recognition in Sports Video — https://openaccess.thecvf.com/content/CVPR2024W/CVsports/papers/Koshkina_A_General_Framework_for_Jersey_Number_Recognition_in_Sports_Video_CVPRW_2024_paper.pdf
- yt-dlp — https://github.com/yt-dlp/yt-dlp
- Condiciones de YouTube — https://www.youtube.com/t/terms
