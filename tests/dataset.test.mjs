import assert from 'node:assert/strict';
import test from 'node:test';
import {initialMatch} from '../src/model.ts';
import {exportReviewCSV,reviewIssues} from '../src/analysis.ts';

test('exporta anotaciones revisadas y nunca presenta la predicción como hecho',()=>{
  const m=structuredClone(initialMatch);
  m.analysisReview={sourceName:'video.mp4',analyzedAt:'2026-11-17',proposals:[
    {id:'j1-proposal-1',kind:'contact_candidate',second:24,confidence:.51,teamHint:'A',trackId:2,
      reason:'balón cercano',status:'accepted',evidence:{ballCenter:[.3,.4],playerBox:[.1,.2,.4,.6]}},
    {id:'j1-proposal-2',kind:'contact_candidate',second:26,confidence:.48,teamHint:null,trackId:null,
      reason:'dudoso',status:'rejected'}]};
  m.events=[{id:'ev1',second:24,set:1,rally:1,team:'A',jersey:'13',skill:'recepción',outcome:'positiva',
    note:'Confirmado en vídeo [IA:j1-proposal-1]'}];
  const csv=exportReviewCSV(m);
  assert.match(csv,/j1-proposal-1/);
  assert.match(csv,/"13";"recepción";"positiva"/);
  assert.match(csv,/"rejected"/);
  assert.equal(reviewIssues(m).filter(i=>i.id.startsWith('orphaned-ai')).length,0);
  m.events=[];
  assert.equal(reviewIssues(m).filter(i=>i.id.startsWith('orphaned-ai')).length,1);
});
