"""Whole-match *draft* from trained RAVEL Touch/no-Touch detections.

Evidence-first: saves detected contacts and possible rally boundaries, optional team
hints derived from the player's jersey colour, and only tentative skill guesses.
Nothing here claims a point winner, a jersey number or a verified attack result.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Callable
from pathlib import Path
import math
from typing import Any


def _join_rallies(windows: list[dict], gap: float = 2.2) -> list[dict]:
    ordered = sorted(windows, key=lambda w: w['startSeconds'])
    joined: list[dict] = []
    for r in ordered:
        start, end = float(r['startSeconds']), float(r['endSeconds'])
        if start >= end:
            continue
        if joined and start - joined[-1]['endSeconds'] <= gap:
            joined[-1]['endSeconds'] = round(max(end, joined[-1]['endSeconds']), 2)
        else:
            joined.append({'id':f'rally-{len(joined)+1:04d}', 'index':len(joined)+1,
                           'startSeconds':round(start,2),'endSeconds':round(end,2),
                           'winner':None,'status':'estimated'})
    return joined


def jersey_team_votes(video: Path, events: list[dict], colors: tuple[tuple[int,int,int],tuple[int,int,int]],
                      *, sample_limit:int=2200) -> dict[str,dict]:
    """Sample a torso per transient track and compare jersey pixel colours in LAB.

    Only assigns a team when the evidence is substantially different from the other
    shirt and close to one of the provided colours.  Ambiguous uniforms stay null.
    This is a *hint*, not a trained team/jersey recognition model.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        return {}
    grouped: dict[str,list[dict]] = defaultdict(list)
    for event in events:
        if event.get('trackKey') and isinstance(event.get('box'),list) and len(event['box'])==4:
            grouped[event['trackKey']].append(event)
    picks=[]
    for key, items in grouped.items():
        items.sort(key=lambda x: x.get('confidence',0),reverse=True)
        picks.extend((key,x) for x in items[:3])
    picks.sort(key=lambda x:x[1]['second'])
    cap=cv2.VideoCapture(str(video))
    if not cap.isOpened():
        return {}
    color_lab=[]
    for rgb in colors:
        rgb_arr=np.array([[list(reversed(rgb))]],dtype=np.uint8)
        color_lab.append(cv2.cvtColor(rgb_arr,cv2.COLOR_BGR2LAB).astype(np.float32)[0,0])
    responses=defaultdict(list)
    try:
        for key,event in picks[:sample_limit]:
            cap.set(cv2.CAP_PROP_POS_MSEC,float(event['second'])*1000)
            ok, frame=cap.read()
            if not ok:continue
            h,w=frame.shape[:2]
            x1,y1,x2,y2=[float(x) for x in event['box']]
            bw=x2-x1;bh=y2-y1
            if bw<12 or bh<24:continue
            # Players in long shots are small. Use chest region, avoiding head and shorts.
            crop=frame[max(0,int(y1+.21*bh)):min(h,int(y1+.53*bh)),
                       max(0,int(x1+.24*bw)):min(w,int(x1+.76*bw))]
            if crop.size<100:continue
            hsv=cv2.cvtColor(crop,cv2.COLOR_BGR2HSV)
            valid=(hsv[:,:,1]>=38)&(hsv[:,:,2]>=35)&(hsv[:,:,2]<=246)
            if valid.sum()<10:continue
            lab=cv2.cvtColor(crop,cv2.COLOR_BGR2LAB).astype(np.float32)[valid]
            # Trim to the best-matching part of shirt: nearby skin/floor are outliers.
            distances=[]
            for anchor in color_lab:
                d=np.sqrt(((lab-anchor)**2).sum(axis=1))
                distances.append(float(np.percentile(d,30)))
            a,b=distances
            best=min(a,b)
            difference=abs(a-b)
            if best<70 and difference>18:
                guess='A' if a<b else 'B'
                conf=round(min(.84,.4+.006*difference+.001*(70-best)),2)
                responses[key].append((guess,conf))
    finally:
        cap.release()
    output={}
    for key,votes in responses.items():
        weight=Counter()
        for team,conf in votes:weight[team]+=conf
        total=sum(weight.values())
        if total==0:continue
        team,value=weight.most_common(1)[0]
        if value/total>=.72:
            output[key]={'team':team,'confidence':round(min(.84,value/total*.84),2),'samples':len(votes)}
    return output


def make_draft(parts:list[dict], *, source_name:str, duration:float,
               team_votes:dict[str,dict]|None=None,
               jersey_votes:dict[str,dict]|None=None) -> dict:
    """Summarize all segments into editable auto-events; never create scored points."""
    team_votes=team_votes or {}
    jersey_votes=jersey_votes or {}
    raw=[]
    windows=[]
    for part_index,part in enumerate(parts):
        windows.extend(part['stats'].get('rallyCandidates',[]))
        for i,p in enumerate(part.get('proposals',[])):
            if p.get('kind')!='contact_candidate':continue
            track=p.get('trackId')
            key=f'{part_index}:{track}' if isinstance(track,int) else ''
            raw.append({'id':f'auto-{part_index:03d}-{i:05d}',
                        'second':round(float(p['second']),2),'trackKey':key,
                        'confidence':round(float(p['confidence']),3),
                        'box':p.get('evidence',{}).get('playerBoxPixels'),
                        'team':team_votes.get(key,{}).get('team'),
                        'teamConfidence':team_votes.get(key,{}).get('confidence'),
                        'action':'toque','actionConfidence':None,
                        'jersey':jersey_votes.get(key,{}).get('jersey',''),
                        'jerseyConfidence':jersey_votes.get(key,{}).get('confidence'),
                        'jerseyEvidenceFrames':jersey_votes.get(key,{}).get('samples',0),
                        'status':'auto','rally':None})
    raw.sort(key=lambda e:e['second'])
    # Duplicate contacts near the edges of chunks are removed, without suppressing
    # two genuinely close contacts from different players inside a rally.
    dedup=[]
    for e in raw:
        if dedup and abs(dedup[-1]['second']-e['second'])<.12 and dedup[-1]['trackKey'].split(':')[0]!=e['trackKey'].split(':')[0]:
            if e['confidence']>dedup[-1]['confidence']:dedup[-1]=e
        else:dedup.append(e)
    rallies=_join_rallies(windows)
    j=0
    buckets=defaultdict(list)
    for e in dedup:
        while j<len(rallies) and rallies[j]['endSeconds'] < e['second']-1.0:j+=1
        if j<len(rallies) and rallies[j]['startSeconds']-1.0 <= e['second'] <= rallies[j]['endSeconds']+1.0:
            e['rally']=rallies[j]['index'];buckets[rallies[j]['index']].append(e)
    for rally, touches in buckets.items():
        if len(touches)<2:continue
        # First contact of rally may be a serve; other skills require coherent
        # team transitions and are merely *tentative*.
        first=touches[0]
        first['action']='saque';first['actionConfidence']=.28
        previous_team=first['team'];streak=0
        for e in touches[1:]:
            team=e['team']
            if not team or not previous_team:
                previous_team=team or previous_team
                continue
            if team!=previous_team:
                streak=1;e['action']='recepción';e['actionConfidence']=.3
            else:
                streak+=1
                if streak==2:e['action']='colocación';e['actionConfidence']=.27
                elif streak==3:e['action']='ataque';e['actionConfidence']=.25
            previous_team=team
    for e in dedup:
        e.pop('box',None)
    return {'version':1,'sourceName':source_name[:160], 'engine':'ravel-vb-013',
            'durationSeconds':round(duration,2),'processedSeconds':round(min(duration,max([p['stats'].get('endSeconds',0) for p in parts],default=0)),2),
            'segments':len(parts),'rallies':rallies,'events':dedup,
            'limitations':[
                'Rallies candidatos por visibilidad del balón; no representan puntos confirmados.',
                'El tipo de acción es una inferencia de orden de contactos y puede estar equivocado.',
                'El equipo se aproxima usando colores de camiseta; los casos dudosos quedan sin identificar.',
                'Los dorsales sugeridos por OCR requieren varias lecturas coherentes; sin evidencia se dejan vacíos.',
                'Los identificadores de seguimiento pueden cambiar tras sustituciones u oclusiones.',
                'Sin marcador fiable: no se adjudican ganadores, aces ni ataques ganadores automáticamente.'
            ]}


def preview_stats(data:dict) -> dict:
    events=[e for e in data.get('events',[]) if e.get('status')!='rejected']
    count=Counter(e.get('team') or 'unknown' for e in events)
    skills=Counter(e.get('action','toque') for e in events)
    return {'ralliesEstimated':len(data.get('rallies',[])),
            'touchesEstimated':len(events),'touchesByTeam':dict(count),'actionsEstimated':dict(skills),
            'unassigned':count.get('unknown',0)}
