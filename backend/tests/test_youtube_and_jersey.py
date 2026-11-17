"""Local link ingestion and jersey OCR tests; no network or trained model needed."""
from __future__ import annotations

import sys
import time
import types
from pathlib import Path
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.vision.youtube_import import video_id_from_url, import_video, ImportCancelled
from backend.vision.jersey_ocr import aggregate_votes, normalize_number, read_candidates, identify_track_numbers
from backend.vision.auto_match import make_draft


@pytest.mark.parametrize('url', [
  'https://www.youtube.com/watch?v=ul-pA6pLWX8',
  'https://www.youtube.com/live/ul-pA6pLWX8?is=IsJwXOeEeOTFNTQ_',
  'https://youtu.be/ul-pA6pLWX8',
  'https://m.youtube.com/shorts/ul-pA6pLWX8',
])
def test_accept_known_youtube_links(url):
    assert video_id_from_url(url)=='ul-pA6pLWX8'


@pytest.mark.parametrize('url', [
  'http://www.youtube.com/watch?v=ul-pA6pLWX8',
  'https://youtube.com.evil.org/watch?v=ul-pA6pLWX8',
  'https://www.youtube.com@evil.org/watch?v=ul-pA6pLWX8',
  'https://www.youtube.com:444/watch?v=ul-pA6pLWX8',
  'https://youtube.com/playlist?list=ul-pA6pLWX8',
  'https://localhost/watch?v=ul-pA6pLWX8',
  'https://www.youtube.com/watch?v=ul-pA6pLWX8&v=dQw4w9WgXcQ',
])
def test_reject_untrusted_urls(url):
    with pytest.raises(ValueError):
        video_id_from_url(url)


def test_youtube_preflight_respects_consent_and_six_hour_duration():
    with TestClient(app) as client:
        url='https://www.youtube.com/watch?v=ul-pA6pLWX8'
        assert client.post('/api/analysis/youtube-jobs',json={'url':url,'authorized':False}).status_code==422
        assert client.post('/api/analysis/youtube-jobs',json={'url':'https://127.0.0.1/x','authorized':True}).status_code==422


def test_import_downloads_one_known_video_and_caps_size(tmp_path,monkeypatch):
    seen=[]
    class FakeDL:
        def __init__(self,opts):
            self.opts=opts
        def __enter__(self):return self
        def __exit__(self,*a):pass
        def extract_info(self,url,download):
            seen.append((url,download))
            meta={'id':'ul-pA6pLWX8','duration':5033,'title':'Getafe - San Fermin'}
            if download:
                p=Path(self.opts['outtmpl'].replace('%(ext)s','mp4'))
                p.write_bytes(b'\x00\x00\x00\x18ftypisom'+b'0'*3000)
                for hook in self.opts['progress_hooks']:
                    hook({'status':'downloading','downloaded_bytes':1024,'total_bytes':3072})
            return meta
    fake=types.ModuleType('yt_dlp')
    fake.YoutubeDL=FakeDL
    fake.utils=types.ModuleType('yt_dlp.utils')
    fake.utils.DownloadError=type('DownloadError',(Exception,),{})
    monkeypatch.setitem(sys.modules,'yt_dlp',fake)
    monkeypatch.setitem(sys.modules,'yt_dlp.utils',fake.utils)
    progress=[]
    r=import_video('https://youtu.be/ul-pA6pLWX8',tmp_path,max_bytes=10000,max_duration_seconds=21600,progress=progress.append)
    assert r['path'].is_file() and r['videoId']=='ul-pA6pLWX8'
    assert progress[-1]==1.0
    assert seen and all('ul-pA6pLWX8' in item[0] for item in seen)


def test_ocr_stays_unknown_on_one_frame_or_conflicting_votes():
    assert aggregate_votes([('13',.98)]) is None
    assert aggregate_votes([('13',.99),('13',.95),('14',.99),('14',.98)]) is None
    assert aggregate_votes([('13',.91),('13',.82),('13',.92),('14',.75)])['jersey']=='13'
    assert normalize_number('013') is None
    assert normalize_number('13',{'1','8'}) is None


def test_ocr_adapter_reads_digit_only_candidates():
    class FakeResult:
        txts=['13','Getafe','7'];scores=[.9,.98,.82]
    assert read_candidates(None,lambda _:FakeResult())==[('13',.9),('7',.82)]


def test_ocr_track_vote_requires_three_clear_samples(monkeypatch):
    import numpy as np
    import cv2
    class FakeCap:
        def isOpened(self):return True
        def set(self,*args):return True
        def read(self):return True,np.zeros((480,720,3),dtype=np.uint8)
        def release(self):pass
    monkeypatch.setattr(cv2,'VideoCapture',lambda _:FakeCap())
    events=[{'trackKey':'0:13','second':n,'box':[100,100,170,260]} for n in range(5)]
    r=identify_track_numbers(Path('fake.mp4'),events,reader=lambda _:types.SimpleNamespace(txts=['13'],scores=[.93]))
    assert r['0:13']['jersey']=='13' and r['0:13']['samples']==5
    assert identify_track_numbers(Path('fake.mp4'),events[:2],reader=lambda _:types.SimpleNamespace(txts=['13'],scores=[.93]))=={}
    assert identify_track_numbers(Path('fake.mp4'),events,allowed_a={'8'},teams={'0:13':{'team':'A'}},reader=lambda _:types.SimpleNamespace(txts=['13'],scores=[.93]))=={}


def test_report_keeps_ocr_provenance_and_no_invented_winner():
    part={'stats':{'endSeconds':180,'rallyCandidates':[{'startSeconds':12,'endSeconds':19}]},
          'proposals':[{'kind':'contact_candidate','second':13.5,'confidence':.91,'trackId':13,'evidence':{'playerBoxPixels':[50,60,70,130]}}]}
    draft=make_draft([part],source_name='Getafe',duration=180,
                     team_votes={'0:13':{'team':'A','confidence':.7}},
                     jersey_votes={'0:13':{'jersey':'13','confidence':.87,'samples':4}})
    assert draft['events'][0]['jersey']=='13'
    assert draft['events'][0]['jerseyConfidence']==.87
    assert draft['events'][0]['jerseyEvidenceFrames']==4
    assert draft['rallies'][0]['winner'] is None


def test_auto_youtube_job_downloads_then_uses_same_match_analyzer(monkeypatch,tmp_path):
    import backend.main as main
    monkeypatch.setattr(main,'UPLOADS',tmp_path/'uploads')
    monkeypatch.setattr(main,'INCOMING',tmp_path/'incoming')
    seen=[]
    def fake_import(url,folder,**kwargs):
        folder.mkdir(parents=True)
        v=folder/'ul-pA6pLWX8.mp4';v.write_bytes(b'\x00\x00\x00\x18ftypisom'+b'0'*2048)
        kwargs['progress'](.75)
        return {'path':v,'name':'Getafe - San Fermin','videoId':'ul-pA6pLWX8','durationSeconds':5033}
    def fake_analyze(jid,uid,opts):
        seen.append((uid,opts.rosterA,main.jobs[jid]['phase']))
        main.jobs[jid]['status']='completed'
    monkeypatch.setattr(main,'import_video',fake_import)
    monkeypatch.setattr(main,'_run_auto_job',fake_analyze)
    jid=str(uuid4());uid=str(uuid4())
    opts=main.StartYouTubeJob(url='https://www.youtube.com/watch?v=ul-pA6pLWX8',authorized=True,rosterA=[13])
    with main.lock:
        main.jobs[jid]={'uploadId':uid,'status':'queued','created':time.time()}
        main.stop_flags[jid]=Event()
    try:
        main._run_youtube_auto_job(jid,uid,opts)
        assert main.jobs[jid]['status']=='completed'
        assert seen==[(uid,[13],'analysis')]
        assert Path(main.uploads[uid]['path']).exists()
    finally:
        with main.lock:
            main.jobs.pop(jid,None);main.uploads.pop(uid,None);main.stop_flags.pop(jid,None)
