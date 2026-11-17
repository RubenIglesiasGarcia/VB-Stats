from __future__ import annotations
import pytest
from pydantic import ValidationError
from backend.main import StartJob
from backend.vision.geometry import Box,Detection,BallTracker
from backend.vision.evaluation import evaluate_contacts
from backend.vision.processor import Settings,process_video


def ball(x,y,conf=.8,size=.01):
    return Detection('ball',Box(x,y,x+size,y+size),conf)


def test_ball_temporal_selection_avoids_high_confidence_teleport():
    tracker=BallTracker()
    a=tracker.select([ball(.10,.25,.9)],0)
    b=tracker.select([ball(.14,.25,.6),ball(.95,.95,.98)],.1)
    assert a and b and b.box.center[0]==pytest.approx(.145)
    assert tracker.ambiguous_frames==1


def test_ball_tracker_no_prediction_without_detection():
    tracker=BallTracker()
    assert tracker.select([ball(.2,.2)],0)
    assert tracker.select([],.2) is None
    assert tracker.lost_frames==1
    assert tracker.select([ball(.5,.5)],2)
    assert tracker.reacquisitions==1


def test_ball_oversize_detection_is_rejected():
    tracker=BallTracker()
    assert tracker.select([ball(.3,.3,size=.25)],0) is None


def test_court_region_validation():
    assert StartJob(uploadId='00000000-0000-4000-8000-000000000000',courtRegion=(.2,.2,.85,.85)).courtRegion==(.2,.2,.85,.85)
    for region in [(0,0,.10,1),(.9,0,.1,1),(-.01,0,1,1),(0,0,1,1.01)]:
        with pytest.raises(ValidationError):StartJob(uploadId='00000000-0000-4000-8000-000000000000',courtRegion=region)


def test_roi_filters_people_and_produces_coverage(tmp_path):
    cv2=pytest.importorskip('cv2')
    import numpy as np
    path=tmp_path/'roi.mp4'
    wr=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'mp4v'),10,(256,192))
    assert wr.isOpened()
    for i in range(25):wr.write(np.zeros((192,256,3),dtype=np.uint8))
    wr.release()
    class FakeDetector:
        def detect(self,frame,conf=.18):
            return [Detection('person',Box(.01,.1,.12,.7),.92,(100,100,100)),
                    Detection('person',Box(.45,.15,.60,.65),.89,(20,40,180)),
                    ball(.5,.45)]
    result=process_video(path,FakeDetector(),Settings(0,2,10,.18,(20,40,180),(200,0,0),(.3,.1,.8,.9)))
    stats=result['stats']
    assert stats['framesWithPeople']>0
    assert stats['ignoredPersonsOutsideCourt']==stats['analyzedFrames']
    assert stats['ballCoveragePercent']==100
    assert stats['courtRegion']==[.3,.1,.8,.9]
    assert sum(b['frames'] for b in stats['coverage'])==stats['analyzedFrames']


def test_eval_matches_once_and_counts_duplicates():
    m=evaluate_contacts([1.02,1.08,9.], [1.,3.],.15)
    assert (m.true_positives,m.false_positives,m.false_negatives)==(1,2,1)
    assert m.precision==pytest.approx(1/3)
    assert m.recall==.5
    assert m.f1==pytest.approx(.4)


def test_eval_empty_and_input_validation():
    assert evaluate_contacts([],[]).f1 is None
    assert evaluate_contacts([1.],[]).false_positives==1
    with pytest.raises(ValueError):evaluate_contacts([-1.],[1.])


def test_probe_recognizes_valid_video_and_hides_storage_path(tmp_path,monkeypatch):
    import cv2,numpy as np,backend.main as main
    from fastapi.testclient import TestClient
    path=tmp_path/'actual.mp4'
    wr=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'mp4v'),10,(256,192))
    assert wr.isOpened()
    for _ in range(12):wr.write(np.zeros((192,256,3),dtype=np.uint8))
    wr.release()
    uid='11111111-2222-4444-8888-aaaaaaaaaaaa'
    monkeypatch.setitem(main.uploads,uid,{'path':str(path),'size':path.stat().st_size,'created':__import__('time').time(),'name':'actual.mp4'})
    with TestClient(main.app) as client:
        result=client.get(f'/api/analysis/uploads/{uid}/probe')
        assert result.status_code==200
        assert result.json()['durationSeconds']==pytest.approx(1.2,.01)
        assert 'path' not in str(result.json())


def test_evaluation_prioritises_number_of_matches_over_nearest_pair():
    # Greedy nearest-pair matching would find only one match in this case.
    m=evaluate_contacts([.25,.52],[0,.35],.30)
    assert (m.true_positives,m.false_positives,m.false_negatives)==(2,0,0)
    assert m.f1==1
