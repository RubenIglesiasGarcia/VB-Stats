"""Pure tracking / contact proposal algorithms, independent of YOLO and OpenCV.

All spatial values are normalized to [0, 1] for consistent thresholds.
A candidate is NOT a confirmed action and its score is NOT a calibrated probability.
"""
from __future__ import annotations
from dataclasses import dataclass
from collections import deque
import math

@dataclass(frozen=True)
class Box:
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)

    @property
    def width(self) -> float:
        return max(0, self.x2 - self.x1)

    @property
    def height(self) -> float:
        return max(0, self.y2 - self.y1)

    def iou(self, other: 'Box') -> float:
        inter = max(0, min(self.x2, other.x2) - max(self.x1, other.x1)) * max(0, min(self.y2, other.y2) - max(self.y1, other.y1))
        union = self.width*self.height + other.width*other.height - inter
        return inter / union if union > 0 else 0

@dataclass(frozen=True)
class Detection:
    label: str  # 'person' / 'ball'
    box: Box
    score: float
    jersey_rgb: tuple[int,int,int] | None = None

@dataclass
class PersonTrack:
    id: int
    box: Box
    last_seen: float
    color: tuple[int,int,int] | None = None
    team_hint: str | None = None
    frames: int = 1


def _color_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    # Perceptual weighting reduces confusion between red / blue / neutral shirts.
    return math.sqrt(sum(w*((a-b)/255)**2 for a,b,w in zip(left,right,(0.30,0.59,0.11))))


def guess_team(color: tuple[int,int,int] | None, team_colors: dict[str, tuple[int,int,int]]) -> str | None:
    if not color: return None
    a = _color_distance(color, team_colors['A'])
    b = _color_distance(color, team_colors['B'])
    if min(a,b) > 0.29 or abs(a-b) < 0.075: return None
    return 'A' if a < b else 'B'

class PersonTracker:
    """Short-term association only. Track ID is NOT an athlete identity."""
    def __init__(self, team_colors: dict[str,tuple[int,int,int]], ttl:float=1.8) -> None:
        self.team_colors=team_colors
        self.ttl=ttl
        self.tracks:dict[int,PersonTrack]={}
        self.sequence=0

    def update(self, persons:list[Detection], second:float) -> list[PersonTrack]:
        self.tracks={tid:t for tid,t in self.tracks.items() if second-t.last_seen <= self.ttl}
        candidate_pairs=[]
        for pidx,det in enumerate(persons):
            for tid,track in self.tracks.items():
                iou=track.box.iou(det.box)
                dx=math.dist(track.box.center,det.box.center)
                if iou>.10 or dx < max(track.box.width,track.box.height)*.60:
                    candidate_pairs.append((iou-dx*.13,pidx,tid))
        used_p:set[int]=set(); used_t:set[int]=set();out=[]
        for _,pidx,tid in sorted(candidate_pairs,reverse=True):
            if pidx in used_p or tid in used_t: continue
            used_p.add(pidx);used_t.add(tid)
            det=persons[pidx];t=self.tracks[tid]
            t.box=det.box;t.last_seen=second;t.frames+=1
            if det.jersey_rgb:
                if t.color: t.color=tuple(round(.8*old+.2*new) for old,new in zip(t.color,det.jersey_rgb))
                else: t.color=det.jersey_rgb
                t.team_hint=guess_team(t.color,self.team_colors)
            out.append(t)
        for pidx,det in enumerate(persons):
            if pidx in used_p:continue
            self.sequence+=1
            t=PersonTrack(id=self.sequence,box=det.box,last_seen=second,color=det.jersey_rgb,
                          team_hint=guess_team(det.jersey_rgb,self.team_colors))
            self.tracks[t.id]=t;out.append(t)
        return out

@dataclass(frozen=True)
class Candidate:
    kind: str # 'contact_candidate' or 'rally_pause_candidate'
    second: float
    score: float
    team_hint: str | None
    track_id: int | None
    note: str
    evidence: dict

    def to_dict(self, sequence: int) -> dict:
        return {'id':f'proposal-{sequence:05d}','kind':self.kind,'second':round(self.second,2),
                'confidence':round(self.score,3),'teamHint':self.team_hint,'trackId':self.track_id,
                'reason':self.note,'evidence':self.evidence,'status':'pending'}


class ContactProposer:
    """Uses observed ball velocity *change* near a tracked person; no label inference.

    Requires observed ball centers in 3 frames, a sizeable direction change, and an
    independently detected human near the middle observation. This intentionally
    favors precision over recall and never decides action type, jersey or winner.
    """
    def __init__(self,min_turn_degrees:float=45,cooldown:float=.9) -> None:
        self.samples:deque[tuple[float,Box,list[PersonTrack],float]]=deque(maxlen=3)
        self.last_candidate=-1e9
        self.min_turn=min_turn_degrees
        self.cooldown=cooldown
        self.last_ball_seen:float|None=None
        self.pause_sent=False

    def observe(self, second:float,ball:Detection|None,persons:list[PersonTrack]) -> list[Candidate]:
        out:list[Candidate]=[]
        if ball is None:
            if self.last_ball_seen is not None and second-self.last_ball_seen>=5.0 and not self.pause_sent:
                out.append(Candidate('rally_pause_candidate',self.last_ball_seen,0.35,None,None,
                                     'El balón dejó de detectarse durante varios segundos; podría haber una pausa.',
                                     {'lastBallSecond':round(self.last_ball_seen,2)}))
                self.pause_sent=True
            if self.last_ball_seen is not None and second-self.last_ball_seen>0.45:
                self.samples.clear()
            return out
        self.last_ball_seen=second
        self.pause_sent=False
        snapshots=[PersonTrack(t.id,t.box,t.last_seen,t.color,t.team_hint,t.frames) for t in persons]
        self.samples.append((second,ball.box,snapshots,ball.score))
        if len(self.samples)<3:return out
        (t1,b1,_,_),(t2,b2,p2,score),(t3,b3,_,_)=self.samples
        if not (.01<t2-t1<=.45 and .01<t3-t2<=.45) or t2-self.last_candidate<self.cooldown:return out
        v1=((b2.center[0]-b1.center[0])/(t2-t1),(b2.center[1]-b1.center[1])/(t2-t1))
        v2=((b3.center[0]-b2.center[0])/(t3-t2),(b3.center[1]-b2.center[1])/(t3-t2))
        n1=math.hypot(*v1);n2=math.hypot(*v2)
        if n1<.035 or n2<.035:return out
        turn=math.degrees(math.acos(max(-1,min(1,(v1[0]*v2[0]+v1[1]*v2[1])/(n1*n2)))))
        if turn<self.min_turn:return out
        nearby=[]
        x,y=b2.center
        for person in p2:
            box=person.box
            pad_x=max(.015,box.width*.30);pad_y=max(.015,box.height*.19)
            if box.x1-pad_x<=x<=box.x2+pad_x and box.y1-pad_y<=y<=box.y2+pad_y:
                distance=math.dist((x,y),box.center)
                nearby.append((distance,person))
        if not nearby:return out
        _,target=min(nearby,key=lambda p:p[0]);self.last_candidate=t2
        score_est=min(.76,round(.20+.0024*turn+.23*min(1,score),3))
        out.append(Candidate('contact_candidate',t2,score_est,target.team_hint,target.id,
                             'Posible contacto: cambio de trayectoria del balón cerca de una persona. Revisar en vídeo.',
                             {'ballCenter':[round(x,4),round(y,4)],'playerBox':[
                                 round(target.box.x1,4),round(target.box.y1,4),round(target.box.x2,4),round(target.box.y2,4)],
                              'angleDegrees':round(turn,1),'ballDetectorScore':round(score,3)}))
        return out

class BallTracker:
    """Select one plausible observed ball among several detector boxes.

    A prediction is used ONLY to rank/gate detections. It is never emitted as an
    observation and cannot itself create a contact or inflate coverage.
    Coordinates are image-normalized, never assumed to be court coordinates.
    """
    def __init__(self, max_gap: float = .65, max_ball_size: float = .095):
        self.max_gap = max_gap
        self.max_ball_size = max_ball_size
        self.previous: tuple[float, tuple[float,float]] | None = None
        self.last: tuple[float, tuple[float,float]] | None = None
        self.lost_frames = 0
        self.ambiguous_frames = 0
        self.discarded_objects = 0
        self.reacquisitions = 0

    def select(self, candidates: list[Detection], second: float) -> Detection | None:
        candidates = [p for p in candidates if p.label == 'ball' and
                      0 < p.box.width <= self.max_ball_size and
                      0 < p.box.height <= self.max_ball_size and
                      0 <= p.box.x1 < p.box.x2 <= 1 and
                      0 <= p.box.y1 < p.box.y2 <= 1]
        self.discarded_objects += len([p for p in candidates if p.score < .10])
        candidates = [p for p in candidates if p.score >= .10]
        if len(candidates) > 1:
            self.ambiguous_frames += 1
        if not candidates:
            self.lost_frames += 1
            return None
        active = self.last is not None and 0 < second - self.last[0] <= self.max_gap
        if active:
            dt = second - self.last[0]
            estimate = self.last[1]
            if self.previous and 0 < self.last[0] - self.previous[0] <= self.max_gap:
                elapsed = self.last[0] - self.previous[0]
                vx = (self.last[1][0] - self.previous[1][0]) / elapsed
                vy = (self.last[1][1] - self.previous[1][1]) / elapsed
                estimate = (self.last[1][0] + vx*dt, self.last[1][1] + vy*dt)
            # Tolerance is deliberately broad for high-speed serves and smashes.
            gate = min(.55, .095 + 1.6*dt)
            nearby = [p for p in candidates if min(math.dist(p.box.center, estimate),
                                                    math.dist(p.box.center, self.last[1])) <= gate]
            if not nearby:
                self.lost_frames += 1
                return None
            chosen = max(nearby, key=lambda p: p.score - .55*min(math.dist(p.box.center, estimate),
                             math.dist(p.box.center, self.last[1]))/gate)
        else:
            if self.last is not None:
                self.reacquisitions += 1
            chosen = max(candidates, key=lambda p: p.score)
            self.previous = None
        self.previous = self.last if active else None
        self.last = (second, chosen.box.center)
        return chosen
