"""Resource-bounded FFmpeg clipping for long volleyball recordings.

The default (18fps) intentionally trades temporal recall for CPU throughput.
Use VBSTATS_RAVEL_INPUT_FPS=30 when contact recall matters more than latency.
"""
from __future__ import annotations

from fractions import Fraction
from pathlib import Path
import json
import math
import os
import subprocess
import time
from collections.abc import Callable


def _metadata(path: Path) -> tuple[int, int, float, float]:
    command = ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
               '-show_entries', 'stream=width,height,avg_frame_rate:format=duration',
               '-of', 'json', str(path)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=25, check=True)
    payload = json.loads(result.stdout)
    streams = payload.get('streams') or []
    if not streams:
        raise ValueError('No hay una pista de vídeo válida.')
    video = streams[0]
    width, height = int(video['width']), int(video['height'])
    fps = float(Fraction(video['avg_frame_rate']))
    seconds = float(payload.get('format', {}).get('duration', 0))
    if not (32 <= width <= 8192 and 32 <= height <= 8192 and
            1 <= fps <= 240 and math.isfinite(seconds) and 1 <= seconds <= 24*3600):
        raise ValueError('Dimensiones, FPS o duración de vídeo inválidos.')
    return width, height, fps, seconds


def _progress(path: Path, length: float) -> float:
    try:
        recent = path.read_bytes()[-2048:].decode('utf-8', 'ignore').splitlines()
        values = [int(line.partition('=')[2]) for line in recent
                  if line.startswith(('out_time_us=', 'out_time_ms='))
                  and line.partition('=')[2].isdigit()]
        return min(0.12, 0.12 * max(values, default=0)/1_000_000/max(1, length))
    except OSError:
        return 0.0


def extract_with_ffmpeg(source: Path, target: Path, start_seconds: float,
                        duration_seconds: float, stopped: Callable[[], bool],
                        progress: Callable[[float, int], None] | None) -> tuple[float, float]:
    """Seek once, rescale and encode only the selected time window.

    No whole-video frame loops or large image arrays in the Python process.
    A hard cap bounds temporary segment size; cancellation stops FFmpeg.
    """
    if stopped():
        raise InterruptedError('Análisis cancelado.')
    width, height, source_fps, total = _metadata(source)
    if not (math.isfinite(start_seconds) and math.isfinite(duration_seconds)) or \
       start_seconds < 0 or duration_seconds <= 0 or start_seconds >= total:
        raise ValueError('El fragmento comienza después del final del vídeo o no es válido.')
    requested_fps = max(8, min(30, int(os.getenv('VBSTATS_RAVEL_INPUT_FPS', '18'))))
    max_width = max(320, min(1920, int(os.getenv('VBSTATS_RAVEL_MAX_WIDTH', '960'))))
    fps = min(float(requested_fps), source_fps)
    scale = min(1, max_width/width)
    out_width = max(32, int(width*scale)//2*2)
    out_height = max(32, int(height*scale)//2*2)
    length = min(duration_seconds, total-start_seconds)
    progress_file = target.with_name(target.name+'.progress')
    command = ['ffmpeg', '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
               '-ss', f'{start_seconds:.3f}', '-i', str(source),
               '-t', f'{length:.3f}', '-map', '0:v:0', '-an', '-sn',
               '-vf', f'fps={fps:.5f},scale={out_width}:{out_height}',
               '-c:v', 'libx264', '-preset', 'superfast', '-crf', '29',
               '-threads', '1', '-pix_fmt', 'yuv420p',
               '-progress', str(progress_file), str(target)]
    try:
        with target.with_suffix('.ffmpeg.log').open('w+', encoding='utf-8', errors='replace') as error_log:
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=error_log)
            try:
                while process.poll() is None:
                    if stopped():
                        process.terminate()
                        try:
                            process.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
                        raise InterruptedError('Análisis cancelado.')
                    if progress:
                        progress(_progress(progress_file, length), 0)
                    time.sleep(.25)
                if process.returncode:
                    error_log.flush()
                    error_log.seek(0)
                    raise RuntimeError('Error preparando el tramo: ' + error_log.read()[-450:])
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
        if not target.is_file() or target.stat().st_size < 1024:
            raise RuntimeError('FFmpeg generó un fragmento de vídeo vacío.')
        max_segment = int(os.getenv('VBSTATS_MAX_SEGMENT_MB', '150')) * 1024*1024
        if target.stat().st_size > max_segment:
            raise RuntimeError('El fragmento supera el espacio asignado. Reduce la resolución del vídeo.')
        _, _, actual_fps, actual_length = _metadata(target)
        return actual_fps, actual_length
    finally:
        progress_file.unlink(missing_ok=True)
        if progress:
            progress(.12, 0)
