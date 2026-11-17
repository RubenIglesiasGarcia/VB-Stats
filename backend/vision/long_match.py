"""Bounded media choices for analysis of long, authorized volleyball recordings."""
from __future__ import annotations
from math import isfinite
from typing import Any

def estimate_bytes(fmt: dict[str, Any], duration_seconds: float) -> int | None:
    """Approximate total size of a yt-dlp video stream."""
    for key in ("filesize", "filesize_approx"):
        value = fmt.get(key)
        if isinstance(value, (float, int)) and isfinite(value) and value > 0:
            return int(value)
    kbps = fmt.get("tbr")
    if isinstance(kbps, (float, int)) and isfinite(kbps) and kbps > 0:
        return int(kbps * 1000 * duration_seconds / 8)
    return None

def compact_video_format(info: dict[str, Any], duration_seconds: float, max_bytes: int) -> tuple[str, int | None, int | None]:
    """Pick the clearest supported single video stream that fits the storage budget."""
    options: list[tuple[tuple[int, int, int, int], str, int, int | None]] = []
    formats = info.get("formats")
    if not isinstance(formats, list):
        formats = []
    for fmt in formats:
        if not isinstance(fmt, dict):
            continue
        format_id, ext, codec, height = fmt.get("format_id"), fmt.get("ext"), fmt.get("vcodec"), fmt.get("height")
        if not isinstance(format_id, str) or not format_id or ext not in ("mp4", "webm"):
            continue
        if not isinstance(codec, str) or codec in ("none", "unknown"):
            continue
        if not isinstance(height, (int, float)) or not isfinite(height) or height < 144 or height > 720:
            continue
        if fmt.get("has_drm"):
            continue
        height = int(height)
        if duration_seconds >= 3600 and height > 480:
            continue  # Preserve memory and disk headroom for hour-plus matches.
        estimated = estimate_bytes(fmt, duration_seconds)
        if estimated is not None and estimated > int(max_bytes * 0.85):
            continue
        if estimated is None and height > 360:
            continue
        preferred_height = min(height, 480 if duration_seconds >= 3600 else 720)
        score = (preferred_height, 1 if ext == "mp4" else 0,
                 1 if codec.startswith("avc1") else 0, 1 if estimated is not None else 0)
        options.append((score, format_id, height, estimated))
    if options:
        _, format_id, height, estimated = max(options, key=lambda x: x[0])
        return format_id, height, estimated
    # Fallback is intentionally low resolution. The progress hook still caps bytes.
    return ("bestvideo[ext=mp4][height<=240]/best[ext=mp4][height<=240]/"
            "bestvideo[ext=webm][height<=240]/best[height<=240]", None, None)

def download_budget(max_upload_bytes: int, quota_bytes: int, already_used_bytes: int,
                    filesystem_free_bytes: int, *, reserve_bytes: int = 64 * 1024 * 1024) -> int:
    """Leave free space for metadata/checkpoints when importing long recordings."""
    return max(0, min(max_upload_bytes, quota_bytes - already_used_bytes - reserve_bytes,
                      filesystem_free_bytes - reserve_bytes))
