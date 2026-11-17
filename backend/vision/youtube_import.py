"""Explicit, bounded and local YouTube video import for authorized recordings.

Only watch/video IDs from known YouTube hosts are accepted. Neither redirects
nor arbitrary user-supplied URLs are sent to our video decoder. This module
never touches browser cookies, private credentials or protected content.
"""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import re
from typing import Callable

ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')
HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'}

class ImportCancelled(RuntimeError):
    pass


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
        # A video-only 1080p stream preserves small jersey digits; no ffmpeg merge.
        'format': 'bestvideo[ext=mp4][height<=1080][vcodec^=avc1]/bestvideo[ext=mp4][height<=1080]/best[ext=mp4][height<=1080]/bestvideo[ext=webm][height<=1080]/best[ext=webm][height<=1080]',
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
            raise ValueError('El vídeo no tiene una duración válida o supera el límite de seis horas.')
        estimated = metadata.get('filesize') or metadata.get('filesize_approx') or 0
        if estimated and estimated > max_bytes:
            raise ValueError('El vídeo supera el tamaño máximo de importación.')
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
                'videoId': video_id, 'durationSeconds': float(duration)}
    except ImportCancelled:
        raise
    except DownloadError as exc:
        raise RuntimeError('No se ha podido obtener el vídeo desde YouTube. Puede estar restringido, ser privado o haber cambiado el acceso. Actualiza yt-dlp o utiliza tu archivo original.') from exc
    finally:
        if cancelled and cancelled():
            for candidate in target_dir.glob(f'{video_id}.*'):
                if candidate.is_file():
                    candidate.unlink(missing_ok=True)


def availability() -> tuple[bool, str]:
    try:
        import yt_dlp
        return True, f'yt-dlp {getattr(yt_dlp.version, "__version__", "instalado")}'
    except ImportError:
        return False, 'yt-dlp no instalado; ejecuta REPARAR MOTOR IA.cmd.'
