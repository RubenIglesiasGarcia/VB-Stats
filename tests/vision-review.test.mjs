import assert from 'node:assert/strict';
import test from 'node:test';
import {initialMatch,sanitizeImport,teamStats} from '../src/model.ts';

test('propuestas de IA jamás suman estadísticas sin acción humana',()=>{
  const initial=structuredClone(initialMatch);
  initial.analysisReview={sourceName:'partido.mp4',analyzedAt:'2026-11-17T09:00:00Z',proposals:[{
    id:'j1-proposal-00001',kind:'contact_candidate',second:12.1,confidence:.65,teamHint:'A',trackId:3,
    reason:'Posible toque',status:'pending'}]};
  const clean=sanitizeImport(initial);
  assert.equal(clean.events.length,0);
  assert.equal(teamStats(clean.events,'A').actions,0);
  assert.equal(clean.analysisReview.proposals.length,1);
  assert.equal(clean.analysisReview.proposals[0].status,'pending');
});

test('propuestas importadas no pueden suplantar eventos ni inyectar estados arbitrarios',()=>{
  const raw=structuredClone(initialMatch);
  raw.analysisReview={sourceName:'test.mp4',analyzedAt:'bad',proposals:[
    {id:'foo',kind:'contact_candidate',second:4,confidence:.4,teamHint:'Z',trackId:2,reason:'a',status:'pending'},
    {id:'foo',kind:'contact_candidate',second:4,confidence:.4,teamHint:'A',trackId:2,reason:'b',status:'accepted'},
    {id:'baz',kind:'contact_candidate',second:7,confidence:1.5,teamHint:'A',trackId:2,reason:'c',status:'pending'},
    {id:'forged',kind:'punto',second:7,confidence:.9,teamHint:'A',trackId:2,reason:'d',status:'accepted'}
  ]};
  const restored=sanitizeImport(raw);
  assert.equal(restored.analysisReview.proposals.length,1);
  assert.equal(restored.analysisReview.proposals[0].teamHint,null);
  assert.equal(restored.events.length,0);
});
