"""Frame sampler and candidate proposal engine; supports injected detector for tests."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable
from .geometry import BallTracker,ContactProposer,Detection,PersonTracker

@dataclass(frozen=True)
class Settings:
    start_seconds:float=0
    duration_seconds:float=120
    sample_fps:float=6
    min_confidence:float=.18
    team_a_rgb:tuple[int,int,int]=(38,91,172)
    team_b_rgb:tuple[int,int,int]=(185,55,63)
    court_region:tuple[float,float,float,float]=(0.,0.,1.,1.)


def process_video(file:Path,detector,settings:Settings,
                  progress:Callable[[float,int],None]|None=None,
                  cancelled:Callable[[],bool]|None=None) -> dict:
    import cv2
    cap=cv2.VideoCapture(str(file))
    if not cap.isOpened():raise ValueError('No se pudo abrir el vídeo. Usa MP4 H.264 o WebM válido.')
    try:
        fps=float(cap.get(cv2.CAP_PROP_FPS))
        count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if not 1<=fps<=240 or count<=0:raise ValueError('FPS o duración no reconocidos; reexporta el vídeo.')
        duration=count/fps
        if settings.start_seconds>=duration:raise ValueError('El inicio elegido está fuera del vídeo.')
        end=min(settings.start_seconds+settings.duration_seconds,duration)
        step=max(1,round(fps/settings.sample_fps))
        start_frame=int(settings.start_seconds*fps)
        final_frame=min(count,int(end*fps))
        cap.set(cv2.CAP_PROP_POS_FRAMES,start_frame)
        tracker=PersonTracker({'A':settings.team_a_rgb,'B':settings.team_b_rgb})
        contacts=ContactProposer()
        ball_tracker=BallTracker()
        roi=settings.court_region
        def on_court(box):
            x,y=box.center
            return roi[0] <= x <= roi[2] and roi[1] <= y <= roi[3]
        frame=start_frame;analyzed=0;total_frames=max(1,(final_frame-start_frame+step-1)//step)
        proposals=[];observed_players=0;observed_ball=0;raw_ball_frames=0;ignored_people=0;coverage=[];bucket=None
        while frame<final_frame:
            if cancelled and cancelled():
                return {'cancelled':True,'proposals':[], 'stats':{'analyzedFrames':analyzed}}
            ok,image=cap.read()
            if not ok:break
            second=frame/fps
            objects=detector.detect(image,conf=settings.min_confidence)
            raw_people=[o for o in objects if o.label=='person']
            on_court_people=[o for o in raw_people if on_court(o.box)]
            ignored_people += len(raw_people)-len(on_court_people)
            persons=tracker.update(on_court_people,second)
            balls=[o for o in objects if o.label=='ball' and on_court(o.box)]
            if balls:raw_ball_frames+=1
            ball=ball_tracker.select(balls,second)
            if persons:observed_players+=1
            if ball:observed_ball+=1
            bucket_id=int((second-settings.start_seconds)//15)
            if bucket is None or bucket_id!=bucket_id_previous:
                bucket={'startSeconds':round(settings.start_seconds+bucket_id*15,2),
                        'endSeconds':round(min(end,settings.start_seconds+(bucket_id+1)*15),2),
                        'frames':0,'ballFrames':0,'personFrames':0,'contactCandidates':0}
                coverage.append(bucket)
                bucket_id_previous=bucket_id
            bucket['frames']+=1
            if ball:bucket['ballFrames']+=1
            if persons:bucket['personFrames']+=1
            for c in contacts.observe(second,ball,persons):
                if len(proposals)<2500:proposals.append(c.to_dict(len(proposals)+1))
                if c.kind=='contact_candidate':bucket['contactCandidates']+=1
            analyzed+=1
            if progress and (analyzed%12==0 or frame+step>=final_frame):progress(min(1,analyzed/total_frames),analyzed)
            # OpenCV .grab decodes/advances without returning all skipped frames to Python.
            for _ in range(step-1):
                if not cap.grab():break
            frame+=step
        if progress:progress(1,analyzed)
        return {'cancelled':False,'proposals':proposals,'stats':{
            'analyzedFrames':analyzed,'videoDuration':round(duration,2),
            'startSeconds':round(settings.start_seconds,2),'endSeconds':round(end,2),
            'framesWithPeople':observed_players,'framesWithBall':observed_ball,
            'trackedPersons':tracker.sequence,'rawBallFrames':raw_ball_frames,
            'unmatchedBallFrames':ball_tracker.lost_frames,'ambiguousBallFrames':ball_tracker.ambiguous_frames,
            'ballReacquisitions':ball_tracker.reacquisitions,'ignoredPersonsOutsideCourt':ignored_people,
            'ballCoveragePercent':round(100*observed_ball/max(1,analyzed),1),
            'personCoveragePercent':round(100*observed_players/max(1,analyzed),1),
            'courtRegion':list(roi),'coverage':coverage,'contactCandidates':sum(p['kind']=='contact_candidate' for p in proposals),
            'pauseCandidates':sum(p['kind']=='rally_pause_candidate' for p in proposals),
            'sampleFpsEffective':round(fps/step,2),
            'notes':['Los IDs son seguimientos cortos, no dorsales.',
                     'La puntuación geométrica no es una probabilidad calibrada.',
                     'El seguimiento del balón filtra detecciones dudosas; no reconstruye toques perdidos.',
                     'No se identifican automáticamente acciones técnicas ni ganadores.']}}
    finally:
        cap.release()
