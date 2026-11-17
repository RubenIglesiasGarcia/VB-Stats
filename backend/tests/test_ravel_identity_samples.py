import json
from backend.vision.ravel import convert_predictions


def test_player_ocr_samples_are_taken_from_track_not_just_contact(tmp_path):
    path=tmp_path/'predictions.jsonl'
    with path.open('w') as f:
        for frame in range(120):
            extra={'action':'Touch','action_score':.88} if frame==3 else {}
            player=[13,.93,100,120,180,310,0,extra]
            record={'type':'frame','frame_index':frame,'players':[player],
                    'ball':[.8,20,20,30,30]}
            f.write(json.dumps(record)+'\n')
    result=convert_predictions(path,fps=10,start_seconds=600,length_seconds=12)
    samples=result['stats']['jerseySamples']
    assert len(samples)>=3
    assert all(s['trackId']==13 for s in samples)
    assert any(s['second']>605 for s in samples)
    assert len(result['proposals'])==1
