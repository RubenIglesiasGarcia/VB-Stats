"""Run local contact evaluation: python scripts/evaluate-contacts.py --session session.json --truth ground-truth.csv"""
import argparse
import csv
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.vision.evaluation import evaluate_contacts


def main():
    parser=argparse.ArgumentParser(description='VB Stats contact evaluation on independently annotated timestamps')
    parser.add_argument('--session',required=True,help='Session JSON exported by VB Stats')
    parser.add_argument('--truth',required=True,help='CSV with a column named second, one row per true contact')
    parser.add_argument('--tolerance',type=float,default=.35)
    args=parser.parse_args()
    data=json.loads(Path(args.session).read_text(encoding='utf-8'))
    predictions=[float(p['second']) for p in data.get('analysisReview',{}).get('proposals',[]) if p.get('kind')=='contact_candidate']
    with Path(args.truth).open(encoding='utf-8-sig',newline='') as stream:
        truth=[float(row['second']) for row in csv.DictReader(stream) if row.get('second')]
    print(json.dumps(evaluate_contacts(predictions,truth,args.tolerance).to_dict(),indent=2,ensure_ascii=False))

if __name__=='__main__':main()
