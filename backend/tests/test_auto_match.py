"""Full-match orchestration and honest inferred-statistics contract tests."""
from __future__ import annotations
from concurrent.futures import Future
from pathlib import Path
from threading import Event
import time
from fastapi.testclient import TestClient
from backend.vision.auto_match import make_draft, preview_stats, _join_rallies
from backend.main import app, jobs,uploads,stop_flags,StartAutoJob,_run_auto_job


def part(offset=0,track=13,side=None):
    return {'stats':{'endSeconds':offset+600,'rallyCandidates':[{'startSeconds':offset+14,'endSeconds':offset+24}]},
      'proposals':[{'kind':'contact_candidate','second':offset+15.5,'confidence':.85,'trackId':track,
                    'evidence':{'playerBoxPixels':[20,20,60,120]}},
                   {'kind':'contact_candidate','second':offset+16.8,'confidence':.75,'trackId':track+2,
                    'evidence':{'playerBoxPixels':[30,40,70,145]}}]}


def test_whole_match_draft_autofills_without_human_annotations():
    draft=make_draft([part(0),part(600)],source_name='partido.mp4',duration=1200,team_votes={'0:13':{'team':'A','confidence':.75}})
    assert len(draft['events'])==4
    assert len(draft['rallies'])==2
    assert draft['events'][0]['team']=='A'
    assert draft['events'][0]['action']=='saque'
    assert draft['events'][1]['action']=='toque'
    assert all(e['status']=='auto' for e in draft['events'])
    assert all(r['winner'] is None for r in draft['rallies'])
    assert preview_stats(draft)['touchesEstimated']==4


def test_no_one_score_is_invented_even_if_teams_are_known():
    draft=make_draft([part()],source_name='x',duration=600,
                     team_votes={'0:13':{'team':'A','confidence':.75},'0:15':{'team':'B','confidence':.7}})
    assert draft['events'][1]['action']=='recepción'
    assert draft['events'][1]['actionConfidence']<.5
    assert all(r['winner'] is None for r in draft['rallies'])


def test_fragment_edges_merge_without_double_counting():
    joined=_join_rallies([{'startSeconds':590,'endSeconds':600},
                           {'startSeconds':600.1,'endSeconds':625}])
    assert len(joined)==1
    assert joined[0]['endSeconds']==625


def test_auto_full_job_runs_successive_chunks_without_user_intervention(tmp_path,monkeypatch):
    import backend.main as main
    video=tmp_path/'match.mp4';video.write_bytes(b'dummy')
    monkeypatch.setattr(main,'_video_metadata',lambda p:{'durationSeconds':1300,'fps':30})
    calls=[]
    def mock_run(video,**kwargs):
        calls.append(kwargs['start_seconds'])
        offset=kwargs['start_seconds']
        kwargs['progress'](1,100)
        return {'cancelled':False,'proposals':part(offset)['proposals'],
                'stats':part(offset)['stats']}
    monkeypatch.setattr(main,'process_ravel_video',mock_run)
    monkeypatch.setattr(main,'jersey_team_votes',lambda *a,**kw:{})
    uid='test-upload-7';jid='test-job-7'
    with main.lock:
        main.uploads[uid]={'path':str(video),'name':'match.mp4','created':time.time(),'size':100}
        main.jobs[jid]={'status':'queued','uploadId':uid,'created':time.time()}
        main.stop_flags[jid]=Event()
    try:
        opts=main.StartAutoJob(uploadId='01234567-1234-1234-1234-123456789012',chunkSeconds=600)
        main._run_auto_job(jid,uid,opts)
        job=main.jobs[jid]
        assert job['status']=='completed'
        assert calls==[0,600,1200]
        assert len(job['autoAnalysis']['events'])==6
        assert job['processedSegments']==3
        assert job['autoAnalysis']['rallies'][0]['winner'] is None
    finally:
        with main.lock:
            main.uploads.pop(uid,None);main.jobs.pop(jid,None);main.stop_flags.pop(jid,None)


def test_auto_request_rejects_giant_chunk():
    try: StartAutoJob(uploadId='01234567-1234-1234-1234-123456789012',chunkSeconds=3600)
    except ValueError: pass
    else: assert False
