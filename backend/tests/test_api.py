import io
from pathlib import Path
from fastapi.testclient import TestClient
from backend.main import app


def test_health() -> None:
    with TestClient(app) as client:
        response = client.get('/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok', 'version': '0.9.0'}


def test_capabilities_are_truthful() -> None:
    with TestClient(app) as client:
        body = client.get('/capabilities').json()
    assert body['manual_annotation'] is True
    assert body['auto_point_segmentation'] is False
    assert body['jersey_recognition'] is False
    assert body['touch_classification'] is False
    assert body['human_review_required'] is True
    assert body['pipeline'] in ('model_not_configured','ready')


def test_upload_rejects_fake_video():
    with TestClient(app) as client:
        result=client.post('/api/analysis/uploads',files={'file':('evil.mp4',b'<script>alert(1)</script>','video/mp4')})
        assert result.status_code==415


def test_upload_requires_valid_video_magic_bytes_and_limits(monkeypatch,tmp_path):
    import backend.main as main
    monkeypatch.setattr(main,'UPLOADS',tmp_path)
    with TestClient(app) as client:
        fake_header=b'\x00\x00\x00\x18ftypisom'+b'\x00'*2048
        ok=client.post('/api/analysis/uploads',files={'file':('sample.mp4',fake_header,'video/mp4')})
        assert ok.status_code==201
        uid=ok.json()['uploadId']
        assert (tmp_path/(uid+'.mp4')).exists()
        res=client.post('/api/analysis/jobs',json={'uploadId':uid,'durationSeconds':4000})
        assert res.status_code==422
        assert client.delete(f'/api/analysis/uploads/{uid}').status_code==200
        assert not (tmp_path/(uid+'.mp4')).exists()


def test_analysis_requires_configured_weights():
    from backend.vision.detector import available
    ok,_=available()
    if not ok:
        with TestClient(app) as client:
            res=client.post('/api/analysis/jobs',json={'uploadId':'00000000-0000-4000-8000-000000000000'})
            assert res.status_code==503
