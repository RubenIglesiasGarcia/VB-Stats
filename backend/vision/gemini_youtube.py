"""Direct public-YouTube input through Google's video-understanding API.

No downloading, no cookies, no user-facing API key. This is a provisional
observational report, NOT frame-accurate Balltime-like sports statistics.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

from backend.vision.youtube_import import video_id_from_url

ALLOWED_ACTIONS = {'toque', 'saque', 'recepción', 'colocación', 'ataque', 'bloqueo', 'defensa'}
GEMINI_MODEL = os.getenv('VBSTATS_GEMINI_MODEL', 'gemini-3.6-flash')
MAX_OBSERVATIONS = 120

PROMPT = """
Analiza esta grabación COMPLETA de voleibol de forma conservadora.
Devuelve EXCLUSIVAMENTE JSON válido sin markdown:
{
  "duration_seconds": número de segundos de vídeo si puedes identificarlo, de lo contrario 0,
  "moments": [
    {"second": número absoluto de segundo del vídeo,
     "action": "saque|recepción|colocación|ataque|bloqueo|defensa|toque",
     "team": "A" o "B" o "",
     "jersey": "número de dorsal" o ""}
  ],
  "rallies": [{"start_seconds": número, "end_seconds": número}]
}
Reglas críticas:
- Describe ÚNICAMENTE jugadas claramente visibles que puedas situar en el tiempo.
- Devuelve como máximo 120 momentos útiles y 120 rallies. Un cero es preferible a inventar.
- Los tiempos son SEGUNDOS del vídeo, no del reloj de marcador ni de retransmisión.
- No adivines los dorsales; deja "" si no se ve nítidamente.
- No adivines el equipo, ni puntos, ni aces, ni errores.
- Un rally es estimado: debe estar visiblemente delimitado, sin suponer un ganador.
- Esta observación por IA NO reemplaza un scouting de voleibol acción a acción.
"""

RESPONSE_SCHEMA = {
    'type': 'object',
    'properties': {
        'duration_seconds': {'type': 'number'},
        'moments': {'type': 'array', 'items': {
            'type': 'object', 'properties': {
                'second': {'type': 'number'},
                'action': {'type': 'string'},
                'team': {'type': 'string'},
                'jersey': {'type': 'string'}
            }, 'required': ['second', 'action', 'team', 'jersey']
        }},
        'rallies': {'type': 'array', 'items': {
            'type': 'object', 'properties': {
                'start_seconds': {'type': 'number'},
                'end_seconds': {'type': 'number'}
            }, 'required': ['start_seconds', 'end_seconds']
        }}
    },
    'required': ['duration_seconds', 'moments', 'rallies']
}

def available() -> tuple[bool, str]:
    if os.getenv('VBSTATS_GEMINI_ENABLE') != '1':
        return False, 'La integración directa de YouTube está desactivada.'
    if len(os.getenv('GEMINI_API_KEY', '').strip()) < 20:
        return False, 'Falta GEMINI_API_KEY en Railway (solo configuración del propietario).'
    try:
        from google import genai  # noqa: F401
    except ImportError:
        return False, 'Falta la dependencia google-genai.'
    return True, 'Gemini acepta URL de YouTube directamente; estadísticas provisionales.'

def _json_document(text: str) -> dict:
    s = (text or '').strip()
    if s.startswith('```'):
        s = re.sub(r'^```(?:json)?\s*', '', s, flags=re.I)
        s = re.sub(r'\s*```$', '', s)
    try:
        data = json.loads(s)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValueError('Gemini no devolvió observaciones JSON válidas del vídeo.') from exc
    if not isinstance(data, dict):
        raise ValueError('Gemini devolvió un formato de informe inesperado.')
    return data

def _number(value: Any, max_seconds: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    n = float(value)
    if not 0 <= n <= max_seconds or n != n:
        return None
    return round(n, 2)

def tentative_draft(payload: dict, url: str, max_seconds: float = 10800) -> dict:
    """Whitelist the model output. Never mark outcomes or jerseys verified."""
    identifier = video_id_from_url(url)
    duration = _number(payload.get('duration_seconds'), max_seconds) or 0
    events = []
    items = payload.get('moments', [])
    if not isinstance(items, list):
        items = []
    for raw in items[:MAX_OBSERVATIONS]:
        if not isinstance(raw, dict):
            continue
        second = _number(raw.get('second'), max_seconds)
        if second is None:
            continue
        action = raw.get('action')
        if action not in ALLOWED_ACTIONS:
            action = 'toque'
        team = raw.get('team')
        if team not in ('A', 'B'):
            team = None
        jersey = str(raw.get('jersey') or '').strip()
        if not re.fullmatch(r'\d{1,2}', jersey):
            jersey = ''
        events.append({
            'id': f'gemini-{len(events):04d}', 'second': second, 'trackKey': '',
            'confidence': 0.25, 'team': team, 'teamConfidence': None,
            'action': action, 'actionConfidence': 0.2, 'jersey': jersey,
            'jerseyConfidence': None, 'jerseyEvidenceFrames': 0,
            'status': 'auto', 'rally': None,
        })
    events.sort(key=lambda e: e['second'])
    rallies = []
    windows = payload.get('rallies', [])
    if not isinstance(windows, list):
        windows = []
    for raw in windows[:120]:
        if not isinstance(raw, dict):
            continue
        start = _number(raw.get('start_seconds'), max_seconds)
        end = _number(raw.get('end_seconds'), max_seconds)
        if start is None or end is None or end <= start:
            continue
        idx = len(rallies) + 1
        rallies.append({'id': f'gemini-rally-{idx:03d}', 'index': idx,
                        'startSeconds': start, 'endSeconds': end,
                        'winner': None, 'status': 'estimated'})
    rallies.sort(key=lambda r:r['startSeconds'])
    for idx, r in enumerate(rallies, start=1):
        r['index'] = idx
        r['id'] = f'gemini-rally-{idx:03d}'
    for ev in events:
        for rally in rallies:
            if rally['startSeconds'] <= ev['second'] <= rally['endSeconds']:
                ev['rally'] = rally['index']
                break
    return {
        'version': 1,
        'sourceName': f'YouTube · {identifier}',
        'engine': 'gemini-youtube-preview',
        'durationSeconds': duration,
        'processedSeconds': duration,
        'segments': 1,
        'events': events,
        'rallies': rallies,
        'limitations': [
            'Análisis visual provisional de Gemini: puede perder jugadas rápidas y confundir acciones.',
            'El modelo muestrea vídeo con detalle limitado; NO realiza tracking fotograma a fotograma.',
            'Los tiempos y los dorsales son aproximaciones, no lecturas certificadas.',
            'El número de eventos NO representa todos los contactos ni todos los puntos del partido.',
            'No se calculan aces, errores, kills ni porcentajes sin revisión humana.',
            'Solo es compatible con vídeos públicos accesibles por la API de Gemini.'
        ],
    }

def analyze(url: str, *, max_seconds: float = 10800) -> dict:
    ok, reason = available()
    if not ok:
        raise RuntimeError(reason)
    from google import genai
    identifier = video_id_from_url(url)
    canonical = f'https://www.youtube.com/watch?v={identifier}'
    client = genai.Client(api_key=os.environ['GEMINI_API_KEY'].strip())
    try:
        interaction = client.interactions.create(
            model=GEMINI_MODEL,
            input=[
                {'type': 'text', 'text': PROMPT},
                {'type': 'video', 'uri': canonical, 'resolution': 'low'},
            ],
            response_format={'type': 'text', 'mime_type': 'application/json',
                             'schema': RESPONSE_SCHEMA},
        )
        payload = _json_document(getattr(interaction, 'output_text', '') or '')
        return tentative_draft(payload, canonical, max_seconds)
    except ValueError:
        raise
    except Exception as exc:
        # Never echo API exceptions: they may contain request metadata.
        raise RuntimeError('Gemini no ha podido procesar el enlace público de YouTube. Revisa límites de API, disponibilidad o acceso a la grabación.') from exc
    finally:
        client.close()
