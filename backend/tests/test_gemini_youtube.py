"""Gemini direct-YouTube previews never turn a language-model guess into a verified stat."""
from backend.vision.gemini_youtube import _json_document, tentative_draft, available

URL='https://www.youtube.com/live/ul-pA6pLWX8?utm_source=chatgpt.com'

def test_gemini_youtube_has_no_user_login_or_cookie_requirement(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.delenv('VBSTATS_GEMINI_ENABLE', raising=False)
    ready,_=available()
    assert not ready

def test_gemini_accepts_youtube_timestamp_candidates_without_confirming_points():
    info=tentative_draft({
        'duration_seconds':5033,
        'moments':[{'second':62,'action':'saque','team':'A','jersey':'13'},
                   {'second':64.8,'action':'ataque','team':'B','jersey':'n/a'},
                   {'second':120,'action':'ace','team':'A','jersey':'2'}],
        'rallies':[{'start_seconds':60,'end_seconds':67}]
    },URL)
    assert info['version']==1
    assert info['durationSeconds']==5033
    assert info['engine']=='gemini-youtube-preview'
    assert len(info['events'])==3
    assert info['events'][0]['rally']==1
    assert all(e['status']=='auto' for e in info['events'])
    assert all(e['jerseyConfidence'] is None for e in info['events'])
    assert info['events'][2]['action']=='toque' # 'ace' is a RESULT, not an action
    assert all(r['winner'] is None for r in info['rallies'])

def test_untrusted_video_model_output_is_clamped_and_sanitized():
    info=tentative_draft({'duration_seconds':999999999,
      'moments':[{'second':-1,'action':'saque'}, {'second':999999,'action':'saque'},
                 {'second':5,'action':'injected-skill','team':'X','jersey':'111'},
                 {'second':10,'action':'defensa','team':None,'jersey':''}],
      'rallies':[{'start_seconds':15,'end_seconds':14}]
    },URL)
    assert info['durationSeconds']==0
    assert len(info['events'])==2
    assert info['events'][0]['jersey']==''
    assert info['events'][0]['team'] is None
    assert info['rallies']==[]

def test_gemini_json_fences():
    info=_json_document('```json\n{"moments":[],"rallies":[]}\n```')
    assert info['moments']==[]
