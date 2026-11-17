from __future__ import annotations
import pytest
from backend.vision.geometry import Box, Detection, PersonTracker, ContactProposer,guess_team
from backend.vision.processor import Settings, process_video


def test_iou_and_team_guess_are_bounded():
    assert Box(0,0,.5,.5).iou(Box(.25,.25,.75,.75))==pytest.approx(1/7)
    palette={'A':(24,73,188),'B':(212,45,61)}
    assert guess_team((21,71,181),palette)=='A'
    assert guess_team((222,44,52),palette)=='B'
    assert guess_team((140,130,135),palette) is None


def test_tracks_are_short_lived_and_never_equivalent_to_dorsals():
    tracker=PersonTracker({'A':(20,60,170),'B':(194,40,40)},ttl=1)
    p=lambda x: Detection('person',Box(x,.2,x+.2,.8),.9,(23,64,175))
    first=tracker.update([p(.2)],0)[0]
    second=tracker.update([p(.21)],.1)[0]
    assert second.id==first.id and second.frames==2 and second.team_hint=='A'
    third=tracker.update([p(.21)],2)[0]
    assert third.id!=first.id


def test_nearby_direction_change_proposes_contact_but_not_skill_or_jersey():
    tracker=PersonTracker({'A':(40,90,160),'B':(200,40,45)})
    player=tracker.update([Detection('person',Box(.4,.3,.6,.8),.99,(41,88,160))],0)
    analyzer=ContactProposer(min_turn_degrees=45)
    def ball(x,y):return Detection('ball',Box(x-.005,y-.005,x+.005,y+.005),.9)
    assert analyzer.observe(0,ball(.28,.41),player)==[]
    assert analyzer.observe(.1,ball(.48,.45),player)==[]
    results=analyzer.observe(.2,ball(.33,.48),player)
    assert len(results)==1
    candidate=results[0]
    assert candidate.kind=='contact_candidate' and candidate.team_hint=='A' and candidate.track_id==1
    assert candidate.score<=.76 and candidate.evidence['angleDegrees']>45
    assert not hasattr(candidate,'jersey') and not hasattr(candidate,'skill')
    assert analyzer.observe(.3,ball(.26,.47),player)==[] # cooldown
    lost=analyzer.observe(6,None,[])
    assert len(lost)==1 and lost[0].kind=='rally_pause_candidate'
    assert analyzer.observe(6.4,None,[])==[] # one pause only


def test_motion_far_from_players_yields_no_contact():
    analyzer=ContactProposer()
    person=[PersonTracker({'A':(20,40,70),'B':(200,0,0)}).update(
        [Detection('person',Box(.75,.7,.9,.95),.9)],0)[0]]
    ball=lambda x:Detection('ball',Box(x,.2,x+.01,.21),.9)
    for t,x in [(0,.1),(.1,.4),(.2,.2)]:
        assert analyzer.observe(t,ball(x),person)==[]


def test_processor_observes_real_frame_stream_with_stub_model(tmp_path):
    cv2=pytest.importorskip('cv2')
    import numpy as np
    video=tmp_path/'synthetic.mp4'
    writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*'mp4v'),10,(320,240))
    assert writer.isOpened()
    for i in range(25):writer.write(np.zeros((240,320,3),dtype=np.uint8))
    writer.release()
    class FakeModel:
        calls=0
        def detect(self,frame,conf=.18):
            self.calls+=1
            poses={1:(.28,.41),2:(.48,.45),3:(.33,.48)}
            x,y=poses.get(self.calls,(.7,.6))
            return [Detection('person',Box(.4,.3,.6,.8),.95,(40,90,160)),
                    Detection('ball',Box(x-.005,y-.005,x+.005,y+.005),.92)]
    model=FakeModel()
    progress=[]
    result=process_video(video,model,Settings(0,2.4,10,.18,(40,90,160),(200,40,45)),
                         progress=lambda ratio,frames:progress.append(ratio))
    assert not result['cancelled']
    assert result['stats']['analyzedFrames']>=22
    assert result['stats']['framesWithBall']>20
    assert result['stats']['contactCandidates']>=1
    assert len(result['proposals'])>=1
    assert progress[-1]==1
    assert process_video(video,model,Settings(),cancelled=lambda:True)['cancelled']
