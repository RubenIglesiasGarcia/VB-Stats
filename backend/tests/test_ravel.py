"""Contract tests for the published RAVEL-VB prediction format, no model downloads."""
from __future__ import annotations
import gzip
import json
from pathlib import Path
from backend.vision.ravel import convert_predictions, readiness, _touch_events, _rally_windows, iter_prediction_frames
from backend.main import StartJob, capabilities


def frame(i: int, touch: float | None = None, track: int = 13, ball: bool = True) -> dict:
    p = [track, .94, 30., 40., 80., 160., 0]
    if touch is not None:
        p += [{'action': 'Touch', 'action_score': touch}]
    return {'type':'frame','frame_index':i,'players':[p],**({'ball':[.9,45.,60.,55.,70.]} if ball else {})}


def test_reader_jsonl_and_gzip(tmp_path:Path):
    path=tmp_path/'output.jsonl'
    path.write_text('\n'.join([json.dumps({'type':'header','fps':30}),json.dumps(frame(0)),json.dumps(frame(1)),'not-json'])+'\n')
    assert [p['frame_index'] for p in iter_prediction_frames(path)]==[0,1]
    zipped=tmp_path/'output.jsonl.gz'
    with gzip.open(zipped,'wt') as f:f.write(path.read_text())
    assert [p['frame_index'] for p in iter_prediction_frames(zipped)]==[0,1]


def test_touches_are_peaks_not_one_per_frame(tmp_path:Path):
    series=[frame(i) for i in range(75)]
    for i in range(10,18):series[i]=frame(i,.52+(i-10)*.05)
    for i in range(43,48):series[i]=frame(i,.64)
    result=_touch_events(series,30,120)
    assert len(result)==2
    assert result[0]['second']>120
    assert result[0]['confidence']>.6
    assert result[0]['trackId']==13
    assert all(p['kind']=='contact_candidate' and p['teamHint'] is None for p in result)


def test_interpolated_player_not_a_touch():
    sequence=[frame(0,touch=.96)]
    sequence[0]['players'][0][6]=1
    assert _touch_events(sequence,30,0)==[]


def test_rally_candidates_do_not_declare_winners():
    sequence=[frame(i,ball=(0<=i<=95 or 175<=i<=255)) for i in range(260)]
    windows=_rally_windows(sequence,30,10)
    assert len(windows)==2
    assert windows[0]['startSeconds']==10
    assert 'winner' not in windows[0]


def test_manifest_conversion(tmp_path:Path):
    path=tmp_path/'predictions.jsonl'
    lines=[json.dumps({'type':'header','fps':30})]
    for i in range(130):lines.append(json.dumps(frame(i,.86 if i in (55,56,57,58) else None)))
    path.write_text('\n'.join(lines)+'\n')
    result=convert_predictions(path,fps=30,start_seconds=25,length_seconds=130/30)
    assert result['stats']['engine']=='ravel-vb-013'
    assert result['stats']['rallyCandidateCount']==1
    assert len(result['proposals'])==1
    assert result['stats']['contactCandidates']==1
    assert result['proposals'][0]['second']>25
    assert result['stats']['ballCoveragePercent']==100.0


def test_capabilities_do_not_claim_official_points():
    caps=capabilities()
    assert caps['auto_point_segmentation'] is False
    assert caps['jersey_recognition'] is False
    assert caps['engines']['ravel']['name'].startswith('RAVEL-VB')


def test_request_rejects_wrong_engine():
    assert StartJob(uploadId='12345678-1234-1234-1234-123456789012').engine=='ravel'
    try:
        StartJob(uploadId='12345678-1234-1234-1234-123456789012',engine='anything')
    except ValueError: pass
    else: assert False,'unknown engine should be rejected'


def test_setup_missing_explains_how_to_enable(tmp_path:Path):
    ok,message=readiness(tmp_path)
    assert not ok
    assert 'setup-ravel' in message


def test_pipeline_runs_external_command_and_converts(monkeypatch, tmp_path:Path):
    from backend.vision import ravel
    root=tmp_path/'upstream'
    (root/'src').mkdir(parents=True)
    (root/'ov').mkdir()
    (root/'src'/'inference_player_ball_openvino.py').write_text('# mock subprocess entry')
    for suffix in ('.xml','.bin','.json'):
        (root/'ov'/('RAVEL-VB-013-9f'+suffix)).write_text('mock')
    monkeypatch.setattr(ravel, 'readiness', lambda *_a,**_k: (True,'ready'))
    monkeypatch.setattr(ravel, '_extract_interval', lambda source,target,start,length,stop,progress: (30.,2.5))
    commands=[]
    class FakeProcess:
        returncode=0
        def __init__(self,command,**kw):
            commands.append(command)
            result=Path(command[command.index('--output')+1])
            records=[{'type':'header'},*[frame(i, .9 if i in (21,22,23) else None) for i in range(75)]]
            with gzip.open(str(result)+'.gz','wt') as f:
                for record in records:f.write(json.dumps(record)+'\n')
        def poll(self):return 0
        def wait(self,**kw):return 0
        def kill(self):raise AssertionError('no need to kill')
    monkeypatch.setattr(ravel.subprocess, 'Popen', FakeProcess)
    original=tmp_path/'input.mp4';original.write_bytes(b'fake original: not decoded in this integration test')
    result=ravel.process_ravel_video(original,start_seconds=80,duration_seconds=3,root=root)
    assert '--model' in commands[0]
    assert commands[0][commands[0].index('--model')+1].endswith('RAVEL-VB-013-9f.xml')
    assert result['stats']['contactCandidates']==1
    assert 80<result['proposals'][0]['second']<82
    assert result['stats']['rallyCandidateCount']==1
    assert 'winner' not in result['stats']['rallyCandidates'][0]
