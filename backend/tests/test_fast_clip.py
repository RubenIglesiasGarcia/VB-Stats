"""Synthetic FFmpeg clip test: no network/model/GPU required."""
import shutil
import subprocess
import pytest
from backend.vision.fast_clip import _metadata, extract_with_ffmpeg


@pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'),
                    reason='FFmpeg required for media processing')
def test_extract_two_second_segment_with_bounded_resolution(tmp_path, monkeypatch):
    source=tmp_path/'source.mp4'
    target=tmp_path/'clip.mp4'
    subprocess.run([
        'ffmpeg','-y','-loglevel','error','-f','lavfi','-i',
        'testsrc2=size=640x360:rate=30','-t','4',
        '-c:v','libx264','-threads','1',str(source)
    ],check=True)
    monkeypatch.setenv('VBSTATS_RAVEL_INPUT_FPS','15')
    monkeypatch.setenv('VBSTATS_RAVEL_MAX_WIDTH','480')
    updates=[]
    fps,seconds=extract_with_ffmpeg(source,target,1,2,lambda:False,
                                    lambda value,_:updates.append(value))
    width,height,_,_=_metadata(target)
    assert (width,height)==(480,270)
    assert fps==15
    assert 1.8<=seconds<=2.2
    assert updates[-1]==.12
    assert target.stat().st_size < source.stat().st_size


def test_extract_cancellation_without_media(tmp_path):
    with pytest.raises(InterruptedError):
        extract_with_ffmpeg(tmp_path/'notneeded.mp4',tmp_path/'clip.mp4',0,1,lambda:True,None)
