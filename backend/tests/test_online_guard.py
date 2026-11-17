"""Public-facing auth regression; local development mode remains unchanged."""
import os,subprocess,sys
from fastapi.testclient import TestClient
from backend import main

def test_local_mode_stays_local_unless_opted_in():
    assert main.PUBLIC_MODE is False
    with TestClient(main.app) as client:
        r=client.get('/capabilities')
        assert r.status_code==200

def test_public_mode_refuses_start_without_secret():
    env=dict(os.environ,VBSTATS_PUBLIC_MODE='1',VBSTATS_ACCESS_TOKEN='')
    cmd=[sys.executable,'-c','import backend.main']
    p=subprocess.run(cmd,env=env,capture_output=True,text=True)
    assert p.returncode!=0
    assert 'VBSTATS_ACCESS_TOKEN' in p.stderr

def test_auth_header_and_preflight_in_public_mode():
    original_mode,original_secret=main.PUBLIC_MODE,main.ACCESS_TOKEN
    main.PUBLIC_MODE=True;main.ACCESS_TOKEN='development-test-secret-0123456789'
    try:
        with TestClient(main.app) as client:
            assert client.get('/health').status_code==200
            assert client.get('/capabilities').status_code==401
            assert client.get('/capabilities',headers={'X-VB-Stats-Key':main.ACCESS_TOKEN}).status_code==200
            preflight=client.options('/capabilities',headers={'Origin':'http://localhost:5173','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'x-vb-stats-key'})
            assert preflight.status_code==200
    finally:
        main.PUBLIC_MODE=original_mode;main.ACCESS_TOKEN=original_secret
