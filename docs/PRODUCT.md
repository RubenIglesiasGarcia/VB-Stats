# VB Stats · Premium product direction

## Regla de diseño

El usuario debe entender **qué está analizando, qué datos son reales y qué hacer a continuación** sin tener que navegar por varios paneles a la vez. El estudio principal concentra vídeo + entrada de eventos; el análisis avanzado está en vistas secundarias. No se utiliza una cifra estimada como si fuera estadística confirmada.

## Usuario principal

- Entrenador / analista de club: revisar partido, identificar jugadores, analizar tendencias y exportar datos.
- Jugador: consultar acciones filtradas por dorsal y saltar al vídeo original.
- Club sin presupuesto de software profesional: cargar vídeo local, anotar por puntos y llevar informes a Excel sin cuenta obligatoria.

## Flujo 0.3 (implementado)

1. **Entrar:** onboarding ocultable con vídeo, plantilla y primera anotación; ninguna métrica inventada.
2. **Analizar:** vídeo, selección de set y rally, equipo, dorsal, categoría y resultado, con puntos cerrados bloqueados.
3. **Corregir:** mini navegación por rallies, búsqueda de eventos y acceso directo a revisión.
4. **Explorar:** comparativa por equipo/set y ficha de jugador. Diferenciar tasa de punto de ataque vs eficiencia neta.
5. **Revisar y exportar:** alertas de rallies abiertos, acciones sin dorsal, jugadores sin ficha, JSON de respaldo, CSV de acciones y CSV por jugador.

## Semántica de datos

- Cada evento tiene id, instante, set, rally, equipo, dorsal, acción y resultado.
- El marcador **solo** usa los eventos `punto:ganadora` registrados. Nunca asume un resultado por una acción ganadora.
- Los porcentajes son proporciones de **eventos anotados**, no del partido completo salvo que se haya etiquetado todo.
- Sin IA en 0.3. No asignar puntuaciones de confianza ficticias.
- El control de revisión no garantiza que cada jugada haya sido anotada; indica problemas visibles en los datos presentes.

## QA local antes de publicación

- `npm test` (13 tests de dominio)
- `python -m pytest backend/tests -q` (API)
- `npm install && npm run build` en equipo con acceso a npm
- Validación manual Chrome/Safari/Firefox: reproducción local/YouTube, cambio de set, crear/editar/borrar acciones, cierre de rally, importación/restauración, CSV Excel, móvil 375 px y 768 px, navegación con teclado
- No desplegar sobre VB Manager; no usar workflows de GitHub Actions

## Roadmap ordenado por valor

1. **Beta 0.4:** múltiples partidos separados, migraciones de datos y backups, test E2E de reproductor y anotación.
2. **IA assistiva 0.5:** sugerencia de cortes por rally con confianza, nunca autoguardada sin aprobación.
3. **IA 0.6:** detección balón/pista/jugadores, calibración de homografía y seguimiento consistente.
4. **IA 0.7:** reconocimiento de dorsales y atribución de contactos; corrección humana en vídeo, dataset de errores y entrenamiento reproducible.
5. **Profesional:** informes agregados por temporada, roles compartidos, permisos, privacidad, consentimiento, almacenamiento opt-in y procesamiento de GPU con techo de gasto.

> La meta no es una demo espectacular, sino un scouting verificable y suficientemente rápido para usarse cada fin de semana.
