"""Tests for hour-plus YouTube imports without a network request."""
import pytest
from backend.vision.long_match import compact_video_format, estimate_bytes, download_budget
from backend.main import StartYouTubeJob, StartAutoJob, MAX_AUTO_SECONDS

@pytest.fixture
def youtube_formats():
    return {'formats': [
        {'format_id': '1080', 'ext':'mp4','vcodec':'avc1', 'height':1080,'filesize':1_400_000_000},
        {'format_id': '480', 'ext':'mp4','vcodec':'avc1', 'height':480, 'tbr':1100},
        {'format_id': '360', 'ext':'mp4','vcodec':'avc1', 'height':360, 'tbr':460},
        {'format_id': '240', 'ext':'mp4','vcodec':'avc1', 'height':240, 'tbr':200},
    ]}

def test_youtube_match_accepts_hour_plus_clip_and_minute_chunks():
    opts=StartYouTubeJob(url='https://www.youtube.com/live/ul-pA6pLWX8',authorized=True)
    assert opts.chunkSeconds==60
    assert MAX_AUTO_SECONDS>=5033
    assert StartAutoJob(uploadId='00000000-0000-4000-8000-000000000000').chunkSeconds==60

def test_hour_plus_match_fits_at_360p(youtube_formats):
    selected,height,_=compact_video_format(youtube_formats,5033,350*1024*1024)
    assert (selected,height)==('360',360)

def test_downshifts_two_hour_match_to_240p(youtube_formats):
    selected,height,_=compact_video_format(youtube_formats,7200,300*1024*1024)
    assert (selected,height)==('240',240)

def test_does_not_choose_full_hd_for_long_matches(youtube_formats):
    selected,height,_=compact_video_format(youtube_formats,5033,1_500_000_000)
    assert height<=480 and selected!='1080'

def test_unknown_sizes_force_conservative_resolution():
    info={'formats':[
        {'format_id':'unknown-720','ext':'mp4','vcodec':'avc1','height':720},
        {'format_id':'unknown-360','ext':'mp4','vcodec':'avc1','height':360},
    ]}
    assert compact_video_format(info,7000,350_000_000)[0]=='unknown-360'

def test_audio_only_and_drm_are_not_selected():
    info={'formats':[
        {'format_id':'audio','ext':'mp4','vcodec':'none','height':240,'filesize':1000},
        {'format_id':'drm','ext':'mp4','vcodec':'avc1','height':480,'filesize':1000,'has_drm':True},
    ]}
    assert 'height<=240' in compact_video_format(info,7000,350_000_000)[0]

def test_download_budget_preserves_free_space():
    mib=1024*1024
    assert download_budget(450*mib,420*mib,0,500*mib)==356*mib
    assert download_budget(450*mib,420*mib,280*mib,220*mib)==76*mib

def test_rate_based_estimate_is_bytes():
    assert estimate_bytes({'tbr':800},7200)==720_000_000
