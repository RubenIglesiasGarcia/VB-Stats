"""Explicit, bounded and local YouTube video import for authorized recordings.

Only watch/video IDs from known YouTube hosts are accepted. Neither redirects
nor arbitrary user-supplied URLs are sent to our video decoder. This module
never touches browser cookies, private credentials or protected content.
"""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import re
import shutil
import subprocess
from importlib.util import find_spec
from typing import Callable
from backend.vision.long_match import compact_video_format

ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')
HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'}

class ImportCancelled(RuntimeError):
    pass


def describe_download_failure(error: Exception) -> str:
    """Describe common YouTube refusal without exposing session details to visitors."""
    message = str(error).casefold()
    if "not a bot" in message or "confirm you're not a bot" in message:
        return (
            "YouTube ha bloqueado el acceso automático desde el servidor de VB Stats "
            "y solicita verificar que no es un bot. No es un error del modelo RAVEL "
            "ni significa que el partido sea privado. Esta grabación no puede "
            "obtenerse actualmente desde Railway. Si dispones del archivo original "
            "del partido, usa «Subir un vídeo»; no introduzcas contraseñas ni cookies "
            "de YouTube en esta aplicación."
        )
    if "private video" in message or "private" in message and "video" in message:
        return "El vídeo no es accesible públicamente desde el servidor. Utiliza una grabación que tengas autorización para procesar."
    return (
        "YouTube no ha permitido importar esta grabación desde el servidor. "
        "Puede ser un problema de acceso o de disponibilidad del formato. "
        "Si tienes el archivo original autorizado, utiliza «Subir un vídeo»."
    )


def video_id_from_url(url: str) -> str:
    if not isinstance(url, str) or len(url) > 800:
        raise ValueError('Pega un enlace de YouTube válido.')
    try:
        parsed = urlsplit(url.strip())
        host = (parsed.hostname or '').lower()
        if parsed.scheme != 'https' or host not in HOSTS or parsed.username or parsed.password or parsed.port:
            raise ValueError('Solo se admiten enlaces HTTPS de YouTube.')
        path = parsed.path.strip('/').split('/')
        if host.endswith('youtu.be'):
            candidate = path[0] if len(path) == 1 else ''
        elif path == ['watch']:
            q = parse_qs(parsed.query, max_num_fields=20)
            candidate = (q.get('v') or [''])[0] if len(q.get('v') or []) == 1 else ''
        elif len(path) == 2 and path[0] in ('live', 'shorts', 'embed'):
            candidate = path[1]
        else:
            candidate = ''
        if not ID_RE.fullmatch(candidate):
            raise ValueError('No se ha encontrado un ID de vídeo de YouTube válido.')
        return candidate
    except (ValueError, TypeError):
        raise ValueError('Introduce un enlace HTTPS de YouTube válido (watch, live o youtu.be).') from None


def import_video(url: str, target_dir: Path, *, max_bytes: int, max_duration_seconds: int,
                 cancelled: Callable[[], bool] | None = None,
                 progress: Callable[[float], None] | None = None) -> dict:
    """Download just one *public, authorized* video; return its local media path.

    The output is deleted by the caller when its 24-hour cache expires.
    Retries / throttling are delegated to yt-dlp; no authentication bypass.
    """
    video_id = video_id_from_url(url)
    if cancelled and cancelled():
        raise ImportCancelled('Importación cancelada.')
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError
    except ImportError as exc:
        raise RuntimeError('Falta yt-dlp. Ejecuta REPARAR MOTOR IA.cmd para instalar las dependencias de YouTube.') from exc

    canonical = f'https://www.youtube.com/watch?v={video_id}'
    target_dir.mkdir(parents=True, exist_ok=True)
    output_tpl = str(target_dir / (video_id + '.%(ext)s'))

    def on_progress(info: dict) -> None:
        if cancelled and cancelled():
            raise ImportCancelled('Importación cancelada.')
        if info.get('status') != 'downloading':
            return
        size = info.get('downloaded_bytes') or 0
        if size > max_bytes:
            raise ValueError('La descarga supera el límite de tamaño permitido.')
        total = info.get('total_bytes') or info.get('total_bytes_estimate') or 0
        if progress and total:
            progress(min(.99, max(0.0, float(size) / float(total))))

    opts = {
        'noplaylist': True, 'ignoreerrors': False, 'quiet': True, 'no_warnings': True,
        'outtmpl': output_tpl,
        # Temporary selector used to obtain metadata before picking a disk-safe format.
        'format': 'bestvideo[height<=720]/best[height<=720]',
        # yt-dlp does NOT automatically enable Node; version >=22 plus yt-dlp-ejs are required.
        'js_runtimes': {'node': {}},
        'max_filesize': max_bytes,
        'socket_timeout': 25, 'retries': 2, 'fragment_retries': 2,
        'progress_hooks': [on_progress],
        'cachedir': False,
        'writethumbnail': False, 'writesubtitles': False, 'writeautomaticsub': False,
        'extract_flat': False,
    }
    try:
        with YoutubeDL({**opts, 'skip_download': True}) as inspector:
            metadata = inspector.extract_info(canonical, download=False)
        if not isinstance(metadata, dict) or metadata.get('id') != video_id:
            raise ValueError('No se pudo comprobar el vídeo solicitado.')
        if metadata.get('is_live') or metadata.get('live_status') in ('is_live', 'is_upcoming'):
            raise ValueError('Espera a que finalice la emisión en directo.')
        duration = metadata.get('duration')
        if not isinstance(duration, (int, float)) or not 5 <= duration <= max_duration_seconds:
            raise ValueError(f'El vídeo no tiene duración válida o supera el máximo de {max_duration_seconds//60} minutos.')
        selected_format,selected_height,estimated = compact_video_format(metadata,float(duration),max_bytes)
        opts['format']=selected_format
        if cancelled and cancelled():
            raise ImportCancelled('Importación cancelada.')
        with YoutubeDL(opts) as downloader:
            downloader.extract_info(canonical, download=True)
        candidates = [p for ext in ('.mp4', '.webm', '.mov', '.mkv')
                      if (p := target_dir / f'{video_id}{ext}').is_file()]
        if len(candidates) != 1:
            raise RuntimeError('YouTube no devolvió un archivo de vídeo compatible.')
        path = candidates[0]
        if not 1024 <= path.stat().st_size <= max_bytes:
            raise ValueError('El vídeo descargado está vacío o supera el límite.')
        if path.suffix not in ('.mp4', '.webm', '.mov'):
            raise RuntimeError('Formato no compatible para análisis; prueba con otra retransmisión.')
        if progress:
            progress(1.0)
        return {'path': path, 'name': (metadata.get('title') or 'Partido de YouTube')[:160],
                'videoId': video_id, 'durationSeconds': float(duration),
                'formatHeight': selected_height, 'estimatedBytes': estimated}
    except ImportCancelled:
        raise
    except DownloadError as exc:
        raise RuntimeError(describe_download_failure(exc)) from exc
    finally:
        if cancelled and cancelled():
            for candidate in target_dir.glob(f'{video_id}.*'):
                if candidate.is_file():
                    candidate.unlink(missing_ok=True)


def availability() -> tuple[bool, str]:
    try:
        import yt_dlp
    except ImportError:
        return False, 'yt-dlp no instalado.'
    if find_spec('yt_dlp_ejs') is None:
        return False, 'Falta yt-dlp-ejs para procesar los desafíos de YouTube.'
    node = shutil.which('node')
    if not node:
        return False, 'No está instalado Node.js 22 o superior para el motor YouTube.'
    try:
        completed = subprocess.run([node, '--version'], capture_output=True, text=True, timeout=5, check=True)
        major = int(completed.stdout.strip().lstrip('v').split('.')[0])
        if major < 22:
            return False, f'Node.js {major} es demasiado antiguo; hace falta Node.js 22 o superior.'
    except (OSError, ValueError, subprocess.SubprocessError):
        return False, 'No se ha podido verificar la versión de Node.js.'
    return True, f'yt-dlp {getattr(yt_dlp.version, "__version__", "instalado")} · Node.js {major} · EJS disponible'
