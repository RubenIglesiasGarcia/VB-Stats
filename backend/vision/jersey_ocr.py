"""Conservative multi-frame jersey OCR: no guess becomes a verified stat.

Uses bounding boxes for tracked *players*, crops the torso and votes across
independent frames. Designed to prefer unknown over incorrect jersey labels.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
from typing import Any, Callable

_NUMBER = re.compile(r'^\d{1,2}$')


def normalize_number(text: str, allowed: set[str] | None = None) -> str | None:
    compact = text.replace(' ', '').strip()
    if not _NUMBER.fullmatch(compact):
        return None
    number = str(int(compact))
    if allowed is not None and number not in allowed:
        return None
    return number


def aggregate_votes(votes: list[tuple[str, float]], *, min_agreement: int = 3,
                    min_share: float = .75, min_score: float = .62) -> dict | None:
    """Count independent frames, not repeated OCR proposals from one frame."""
    valid = [(n, max(0.0, min(1.0, float(score)))) for n, score in votes
             if _NUMBER.fullmatch(n) and score >= min_score]
    if len(valid) < min_agreement:
        return None
    grouped: dict[str, list[float]] = defaultdict(list)
    for n, score in valid:
        grouped[n].append(score)
    num, scores = max(grouped.items(), key=lambda item:(len(item[1]), sum(item[1])))
    share = len(scores) / len(valid)
    if len(scores) < min_agreement or share < min_share:
        return None
    conf = round(min(.93, .5*share + .5*(sum(scores)/len(scores))), 3)
    return {'jersey': num, 'confidence': conf, 'samples': len(scores), 'totalReadings': len(valid), 'source': 'rapidocr-track-vote'}


def read_candidates(image: Any, reader: Callable[[Any], Any]) -> list[tuple[str, float]]:
    """Adapt RapidOCR v3 output, tolerating older tuple-return adapters in tests."""
    result = reader(image)
    if isinstance(result, tuple):
        result = result[0]
    if result is None:
        return []
    if hasattr(result, 'txts') and hasattr(result, 'scores'):
        pairs = zip(result.txts or [], result.scores or [])
    elif isinstance(result, list):
        pairs = ((entry[1], entry[2]) for entry in result if isinstance(entry,(list,tuple)) and len(entry)>=3)
    else:
        return []
    output = []
    for text, score in pairs:
        if not isinstance(text,str):continue
        try:
            score=float(score)  # includes numpy floating-point scores
        except (ValueError,TypeError):
            continue
        if not 0<=score<=1:continue
        n=normalize_number(text)
        if n is not None:
            output.append((n,score))
    return output


def available() -> tuple[bool,str]:
    try:
        import rapidocr
        return True, 'RapidOCR instalado; identificación conservadora por varios fotogramas.'
    except ImportError:
        return False, 'OCR opcional sin instalar (rapidocr + onnxruntime).'


def identify_track_numbers(video: Path, events: list[dict], *,
                           allowed_a: set[str] | None = None, allowed_b: set[str] | None = None,
                           teams: dict[str,dict] | None = None,
                           max_tracks: int = 450, samples_per_track: int = 8,
                           reader: Callable | None = None,
                           cancelled: Callable[[], bool] | None = None) -> dict[str,dict]:
    """Read numbers from distinct contact frames for each track (bounded CPU work).

    A positive label requires >=3 independent readable frames. When frame crops
    are tiny or ambiguous no jersey number is assigned. No facial recognition.
    """
    try:
        import cv2
    except ImportError:
        return {}
    if reader is None:
        try:
            from rapidocr import RapidOCR
            reader = RapidOCR()
        except (ImportError, RuntimeError):
            return {}
    grouped: dict[str,list[dict]] = defaultdict(list)
    for item in events:
        if item.get('trackKey') and isinstance(item.get('box'), list) and len(item['box'])==4:
            grouped[item['trackKey']].append(item)
    sorted_tracks = sorted(grouped.items(),key=lambda p:(-len(p[1]),p[0]))[:max_tracks]
    # Sample across a track's whole lifetime, not eight adjacent near-identical frames.
    requests=[]
    for key, items in sorted_tracks:
        chron=sorted(items,key=lambda e:e['second'])
        if len(chron)>samples_per_track:
            ids=sorted({round(i*(len(chron)-1)/(samples_per_track-1)) for i in range(samples_per_track)})
            chron=[chron[i] for i in ids]
        requests.extend((key,it) for it in chron)
    requests.sort(key=lambda p:p[1]['second'])
    cap=cv2.VideoCapture(str(video))
    if not cap.isOpened():
        return {}
    recognized:dict[str,list[tuple[str,float]]]=defaultdict(list)
    try:
        for key,item in requests:
            if cancelled and cancelled():return {}
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0,float(item['second']))*1000)
            success,frame=cap.read()
            if not success:continue
            h,w=frame.shape[:2]
            x1,y1,x2,y2=[float(v) for v in item['box']]
            width=x2-x1;height=y2-y1
            # Small uniforms are unreadable in 720p long shots; reject instead of inventing.
            if width<22 or height<52:continue
            left=max(0,int(x1+.12*width));right=min(w,int(x2-.12*width))
            top=max(0,int(y1+.18*height));bottom=min(h,int(y1+.72*height))
            if right-left<16 or bottom-top<25:continue
            crop=frame[top:bottom,left:right]
            if crop.size==0:continue
            # Improve small number contrast without fabricating details.
            up=cv2.resize(crop,None,fx=2,fy=2,interpolation=cv2.INTER_CUBIC)
            candidates=read_candidates(up,reader)
            if len(candidates)!=1:continue  # avoid several players/background text
            number,score=candidates[0]
            team=(teams or {}).get(key,{}).get('team')
            allowed=allowed_a if team=='A' else allowed_b if team=='B' else None
            if allowed is not None and number not in allowed:continue
            recognized[key].append((number,score))
    finally:
        cap.release()
    results={}
    for key,votes in recognized.items():
        verdict=aggregate_votes(votes)
        if verdict is not None:
            results[key]=verdict
    return results
