"""Measure real RAVEL throughput on an authorized local test recording.

Usage:
  python scripts/benchmark_ravel.py --video path/to/clip.mp4 --seconds 20 --chunks 2

Only processes the requested preview windows; never estimates model accuracy.
"""
from __future__ import annotations
import argparse
import json
import resource
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.vision.ravel import process_ravel_video, readiness


def benchmark(video: Path, seconds: int, chunks: int) -> dict:
    ready, reason = readiness()
    if not ready:
        raise RuntimeError(reason)
    if not video.is_file():
        raise ValueError('El vídeo de prueba no existe.')
    results = []
    for idx in range(chunks):
        start = idx * seconds
        t0 = time.perf_counter()
        data = process_ravel_video(video,start_seconds=start,duration_seconds=seconds)
        elapsed = time.perf_counter()-t0
        if data.get('cancelled'):
            raise RuntimeError('RAVEL canceló el análisis de prueba.')
        stats = data.get('stats') or {}
        results.append({'startSeconds':start,'inputSeconds':seconds,
                        'runtimeSeconds':round(elapsed,2),
                        'proposals':len(data.get('proposals',[])),
                        'analyzedFrames':stats.get('analyzedFrames')})
    total_video = sum(r['inputSeconds'] for r in results)
    total_wall = sum(r['runtimeSeconds'] for r in results)
    speed = total_video/max(1e-9,total_wall)
    return {'model':'ravel-vb-013','chunks':results,
            'videoSeconds':total_video,'wallSeconds':round(total_wall,2),
            'videoSecondsPerRealSecond':round(speed,4),
            'approximate90MinWallHours':round(5400/max(speed,1e-9)/3600,2),
            'peakChildResidentMemoryKB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
            'warning':'Extrapolación indicativa: la velocidad puede cambiar con resolución, contenido, cola y hardware. No mide exactitud deportiva.'}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--video',type=Path,required=True)
    parser.add_argument('--seconds',type=int,default=20,choices=range(5,121),metavar='5..120')
    parser.add_argument('--chunks',type=int,default=2,choices=range(1,5),metavar='1..4')
    args=parser.parse_args()
    print(json.dumps(benchmark(args.video,args.seconds,args.chunks),ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
