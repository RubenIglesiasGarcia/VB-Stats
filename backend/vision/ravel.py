"""RAVEL-VB-013 adapter (MIT upstream, model not bundled).

Runs the published *trained* OpenVINO detector in an isolated local subprocess,
then converts its frame-indexed player / ball / touch evidence into VB Stats
review proposals. No predicted touch is entered as an official match statistic.

Upstream: https://github.com/asigatchov/fast-volleyball-tracking-inference
Tag tested against source interface: v0.2.0. Needs the upstream weights and
optional dependencies installed on the user's machine.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from importlib.util import find_spec
from pathlib import Path
import gzip
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from backend.vision.fast_clip import extract_with_ffmpeg

MODEL_FILE = 'RAVEL-VB-013-9f.xml'
UPSTREAM_URL = 'https://github.com/asigatchov/fast-volleyball-tracking-inference'


def source_root() -> Path:
    return Path(os.getenv('VBSTATS_RAVEL_HOME', str(Path(__file__).resolve().parents[2] / 'external' / 'fast-volleyball-tracking-inference'))).expanduser().resolve()


def model_file(root: Path | None = None) -> Path:
    env = os.getenv('VBSTATS_RAVEL_MODEL')
    return Path(env).expanduser().resolve() if env else (root or source_root()) / 'ov' / MODEL_FILE


def readiness(root: Path | None = None, *, verify_packages: bool = True) -> tuple[bool, str]:
    base = root or source_root()
    runner = base / 'src' / 'inference_player_ball_openvino.py'
    model = model_file(base)
    if not runner.is_file():
        return False, 'Falta RAVEL-VB. Ejecuta scripts/setup-ravel-windows.ps1 (se descarga del repositorio original).'
    missing = [suffix for suffix in ('.xml', '.bin', '.json') if not model.with_suffix(suffix).is_file()]
    if missing:
        return False, f'Pesos RAVEL incompletos ({", ".join(missing)}). Reinstala el modelo.'
    if verify_packages and any(find_spec(x) is None for x in ('openvino', 'scipy', 'cv2', 'numpy', 'tqdm')):
        return False, 'Faltan dependencias RAVEL: ejecuta scripts/setup-ravel-windows.ps1.'
    return True, 'RAVEL-VB-013 disponible: detección entrenada de jugadores, balón y probables toques (requiere revisión).'


def iter_prediction_frames(path: Path) -> Iterator[dict]:
    """Stream source JSONL v3, optionally gzipped; never load whole match in RAM."""
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rt', encoding='utf-8') as handle:
        for line in handle:
            try:
                record = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
            if isinstance(record, dict) and record.get('type') == 'frame':
                yield record


def _touch_events(frames: list[dict], fps: float, offset: float, threshold: float = .5) -> list[dict]:
    """Peak-hold/NMS per track; model outputs consecutive Touch frames per contact."""
    peaks: dict[int, list[tuple[float, float, list[float], bool]]] = defaultdict(list)
    for record in frames:
        frame_number = record.get('frame_index')
        if not isinstance(frame_number, int) or frame_number < 0:
            continue
        for player in record.get('players') or []:
            if not isinstance(player, list) or len(player) < 8 or not isinstance(player[0], int):
                continue
            extra = player[7] if isinstance(player[7], dict) else {}
            if player[6] or str(extra.get('action', '')).lower() != 'touch':
                continue
            score = extra.get('action_score', 0)
            if not isinstance(score, (int, float)) or not threshold <= score <= 1:
                continue
            peaks[player[0]].append((frame_number / fps, float(score), player[2:6], False))
    merged = []
    # Merge successive frames of one predicted touch. Keep maximum-probability peak.
    for track_id, observations in peaks.items():
        observations.sort(key=lambda row: row[0])
        group = []
        for item in observations:
            if group and item[0] - group[-1][0] > .42:
                merged.append((track_id, max(group, key=lambda row: row[1])))
                group = []
            group.append(item)
        if group:
            merged.append((track_id, max(group, key=lambda row: row[1])))
    # Near-simultaneous peaks on different players can be one contact; keep one and
    # mark competing candidates. This is not jersey OCR or stable player identity.
    merged.sort(key=lambda x: x[1][0])
    events = []
    for track_id, (local_sec, confidence, box, _) in merged:
        sec = offset + local_sec
        if events and sec - events[-1]['second'] < .17:
            if confidence > events[-1]['confidence']:
                events[-1].update(second=round(sec, 2), confidence=round(confidence, 3), trackId=track_id, evidence={**events[-1]['evidence'], 'playerBoxPixels': box})
            events[-1]['evidence']['nearbyCompetingTracks'] += 1
            continue
        events.append({
            'id': f'proposal-{len(events)+1:05d}',
            'kind': 'contact_candidate',
            'second': round(sec, 2),
            'confidence': round(confidence, 3),
            'teamHint': None,
            'trackId': track_id,
            'reason': 'RAVEL-VB-013: posible toque detectado por un modelo entrenado. Confirma dorsal, acción y resultado.',
            'evidence': {'engine':'ravel-vb-013','localSecond':round(local_sec,3),'playerBoxPixels':box,'nearbyCompetingTracks':0,'scoreType':'model_action_score'},
            'status':'pending'
        })
    return events


def _rally_windows(frames: list[dict], fps: float, offset: float, min_seconds: float = 2.0, gap_seconds: float = 2.0) -> list[dict]:
    """Ball-visibility rally *candidates*; long occlusions cause missing/extra rallies."""
    indexes = sorted({r['frame_index'] for r in frames if isinstance(r.get('frame_index'), int) and isinstance(r.get('ball'), list) and len(r['ball']) >= 5 and r['ball'][0] >= .20})
    if not indexes:
        return []
    start=previous=indexes[0]
    windows=[]
    for idx in indexes[1:]:
        if (idx-previous)/fps > gap_seconds:
            if (previous-start)/fps >= min_seconds:
                windows.append({'startSeconds':round(offset+start/fps,2),'endSeconds':round(offset+previous/fps,2),'confidence':None, 'status':'candidate'})
            start=idx
        previous=idx
    if (previous-start)/fps>=min_seconds:
        windows.append({'startSeconds':round(offset+start/fps,2),'endSeconds':round(offset+previous/fps,2),'confidence':None,'status':'candidate'})
    return windows


def convert_predictions(path: Path, *, fps: float, start_seconds: float, length_seconds: float) -> dict:
    if fps <= 0:
        raise ValueError('FPS inválidos')
    # One 15-minute video is bounded by the backend; prevents unbounded memory.
    frames = list(iter_prediction_frames(path))
    touches = _touch_events(frames, fps, start_seconds)
    rallies = _rally_windows(frames, fps, start_seconds)
    # Identity evidence: sample *player tracks* from across the full clip, not
    # only touch instants. Dorsals are often visible when the player turns away
    # from the camera, between contacts. Bound the sample list for long games.
    contact_tracks={t.get('trackId') for t in touches if isinstance(t.get('trackId'),int)}
    candidate_samples:dict[int,list[dict]]=defaultdict(list)
    last_sample:dict[int,float]={}
    for record in frames:
        index=record.get('frame_index')
        if not isinstance(index,int) or index<0:continue
        sec=index/fps
        for player in record.get('players') or ():
            if not isinstance(player,list) or len(player)<6 or player[0] not in contact_tracks or not isinstance(player[0],int):continue
            track=player[0]
            box=player[2:6]
            if not all(isinstance(n,(int,float)) for n in box):continue
            width=float(box[2])-float(box[0]);height=float(box[3])-float(box[1])
            if width<22 or height<52 or len(candidate_samples[track])>=50:continue
            if sec-last_sample.get(track,-1e4)<2.0:continue
            last_sample[track]=sec
            candidate_samples[track].append({'trackId':track,'second':round(start_seconds+sec,2),
                                              'box':box,'confidence':float(player[1]),'height':height})
    ocr_samples=[]
    for track,items in candidate_samples.items():
        # Pick the best-size, best-score images at least a few seconds apart.
        chosen=[]
        for item in sorted(items,key=lambda x:(-x['height']*x['confidence'],x['second'])):
            if all(abs(item['second']-prior['second'])>=2 for prior in chosen):
                chosen.append(item)
            if len(chosen)>=8:break
        ocr_samples.extend({k:v for k,v in item.items() if k!='height'} for item in chosen)
    coverage_map: dict[int,dict] = {}
    ball_count=people_count=0
    for record in frames:
        idx=record.get('frame_index')
        if not isinstance(idx,int): continue
        sec=idx/fps
        bucket_index=int(sec//15)
        c=coverage_map.setdefault(bucket_index, {'startSeconds':round(start_seconds+bucket_index*15,2),'endSeconds':round(start_seconds+min(length_seconds,(bucket_index+1)*15),2),'frames':0,'ballFrames':0,'personFrames':0,'contactCandidates':0})
        c['frames']+=1
        if record.get('ball'):
            c['ballFrames']+=1
            ball_count+=1
        if record.get('players'):
            c['personFrames']+=1
            people_count+=1
    for t in touches:
        k=int((t['second']-start_seconds)//15)
        if k in coverage_map:coverage_map[k]['contactCandidates']+=1
    return {
        'cancelled':False,
        'proposals':touches[:2500],
        'stats':{
            'engine':'ravel-vb-013','analyzedFrames':len(frames),
            'startSeconds':start_seconds,'endSeconds':round(start_seconds+length_seconds,2),
            'framesWithBall':ball_count,'framesWithPeople':people_count,
            'contactCandidates':len(touches),'pauseCandidates':0,
            'jerseySamples':ocr_samples,
            'rallyCandidates':rallies,
            'rallyCandidateCount':len(rallies),
            'ballCoveragePercent':round(100*ball_count/max(1,len(frames)),1),
            'personCoveragePercent':round(100*people_count/max(1,len(frames)),1),
            'coverage':[coverage_map[k] for k in sorted(coverage_map)],
            'sampleFpsEffective':round(fps,2),
            'ignoredPersonsOutsideCourt':0,
            'notes':[
                'RAVEL-VB-013: la acción entrenada es Touch/no Touch; NO clasifica recepción, ataque ni ganador.',
                'El ID de pista corresponde a un seguimiento temporal, no al dorsal del jugador.',
                'Los rallies son candidatos por presencia del balón y pueden incluir fallos; no son puntos oficiales.',
                'Las predicciones no suman estadísticas hasta su validación.'
            ]
        }
    }


def _extract_interval(source:Path,target:Path,start_seconds:float,duration_seconds:float,
                      stopped:Callable[[],bool],progress:Callable[[float,int],None]|None) -> tuple[float,float]:
    if os.getenv('VBSTATS_FFMPEG_SEGMENTS','1')=='1':
        return extract_with_ffmpeg(source,target,start_seconds,duration_seconds,stopped,progress)
    # Legacy fallback, opt-in for compatibility with installations without FFmpeg.
    import cv2
    cap=cv2.VideoCapture(str(source))
    if not cap.isOpened():raise ValueError('No se pudo abrir el vídeo.')
    writer=None
    try:
        fps=float(cap.get(cv2.CAP_PROP_FPS));frame_count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        w=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH));h=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if fps<=0 or frame_count<=0 or w<=0 or h<=0:
            raise ValueError('Metadatos de vídeo inválidos.')
        total=frame_count/fps
        if start_seconds >= total:raise ValueError('El tramo empieza después del final del vídeo.')
        real_duration=min(duration_seconds,total-start_seconds)
        # Extract only the user-selected window; do not run the upstream engine on
        # the entire 84-minute video for a two-minute trial.
        start_frame=round(start_seconds*fps)
        frames_to_write=max(1,round(real_duration*fps))
        cap.set(cv2.CAP_PROP_POS_FRAMES,start_frame)
        writer=cv2.VideoWriter(str(target),cv2.VideoWriter_fourcc(*'mp4v'),fps,(w,h))
        if not writer.isOpened():raise RuntimeError('OpenCV no pudo crear el fragmento MP4.')
        done=0
        for i in range(frames_to_write):
            if stopped():raise InterruptedError('Cancelado')
            ok,frame=cap.read()
            if not ok:break
            writer.write(frame);done+=1
            if progress and i%max(1,round(fps*3))==0:
                progress(min(.13,.13*done/frames_to_write),done)
        if done==0:raise ValueError('Fragmento de vídeo vacío.')
        return fps,done/fps
    finally:
        cap.release()
        if writer:writer.release()


def _frame_from_stream(path:Path) -> int:
    if not path.is_file():return -1
    try:
        with path.open('rb') as f:
            f.seek(max(0,path.stat().st_size-65536))
            data=f.read().splitlines()
        for line in reversed(data):
            match=re.search(rb'"type"\s*:\s*"frame"\s*,\s*"frame_index"\s*:\s*(\d+)',line)
            if match:return int(match.group(1))
    except OSError:pass
    return -1


def process_ravel_video(file:Path, *, start_seconds:float, duration_seconds:float,
                        progress:Callable[[float,int],None]|None=None,
                        cancelled:Callable[[],bool]|None=None,
                        root:Path|None=None) -> dict:
    base=root or source_root()
    ok,why=readiness(base)
    if not ok:raise RuntimeError(why)
    stopped=cancelled or (lambda:False)
    with tempfile.TemporaryDirectory(prefix='vb-stats-ravel-') as tmp:
        temp=Path(tmp)
        clip=temp/'clip.mp4'
        try:
            fps,clip_duration=_extract_interval(file,clip,start_seconds,duration_seconds,stopped,progress)
        except InterruptedError:
            return {'cancelled':True,'proposals':[],'stats':{}}
        if stopped():return {'cancelled':True,'proposals':[],'stats':{}}
        output=temp/'predictions.jsonl'
        command=[sys.executable,str(base/'src'/'inference_player_ball_openvino.py'),str(clip),
                 '--model',str(model_file(base)),'--output',str(output),
                 '--action-threshold','0.50','--device','CPU','--reader','opencv']
        with (temp/'ravel.log').open('w+',encoding='utf-8',errors='replace') as log:
            proc=subprocess.Popen(command,cwd=str(base),stdout=log,stderr=subprocess.STDOUT)
            try:
                while proc.poll() is None:
                    if stopped():
                        proc.terminate()
                        try:proc.wait(timeout=3)
                        except subprocess.TimeoutExpired:proc.kill();proc.wait()
                        return {'cancelled':True,'proposals':[],'stats':{}}
                    if progress:
                        n=_frame_from_stream(output)
                        if n>=0:progress(min(.95,.13+.82*(n+1)/max(1,round(fps*clip_duration))),n+1)
                    time.sleep(.35)
                if proc.returncode!=0:
                    log.flush();log.seek(0)
                    tail=log.read()[-2000:]
                    raise RuntimeError(f'RAVEL-VB no pudo completar la inferencia ({proc.returncode}): {tail[-700:]}')
            finally:
                if proc.poll() is None:proc.kill();proc.wait()
        completed=output.with_name(output.name+'.gz')
        result_path=completed if completed.is_file() else output
        if not result_path.is_file():raise RuntimeError('El modelo terminó sin generar predicciones JSONL.')
        result=convert_predictions(result_path,fps=fps,start_seconds=start_seconds,length_seconds=clip_duration)
        if progress:progress(1.0,len(result.get('proposals',[])))
        return result
