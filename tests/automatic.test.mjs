import assert from 'node:assert/strict';
import test from 'node:test';
import {autoMetrics,autoTracks,fixAutoTrack,fixAutoEvent,fixAutoRally,sanitizeAuto,autoCSV} from '../src/automatic.ts';

const fixture=()=>({version:1,sourceName:'Getafe.mp4',engine:'ravel-vb-013',durationSeconds:200,processedSeconds:200,segments:1,
  limitations:[],rallies:[{id:'rally-0001',index:1,startSeconds:10,endSeconds:20,winner:null,status:'estimated'}],
  events:[{id:'e1',second:11,trackKey:'0:4',confidence:.9,team:null,teamConfidence:null,action:'toque',actionConfidence:null,jersey:'',status:'auto',rally:1},
          {id:'e2',second:14,trackKey:'0:4',confidence:.8,team:null,teamConfidence:null,action:'saque',actionConfidence:.3,jersey:'',status:'auto',rally:1}]});

test('automatic output provides estimated stats with zero manual actions',()=>{
  const a=fixture();const m=autoMetrics(a);assert.equal(m.contacts,2);assert.equal(m.rallies,1);assert.equal(m.byTeam.unknown,2);
  assert.equal(m.winnersConfirmed,0);assert.equal(m.reviewed,0);
});
test('single correction of track applies to all touches, persists on import',()=>{
  const a=fixAutoTrack(fixture(),'0:4',{team:'A',jersey:'13'});
  assert.equal(a.events.filter(x=>x.jersey==='13').length,2);
  assert.equal(autoTracks(a)[0].touches,2);
  const safe=sanitizeAuto(a);assert.equal(safe.events[0].jersey,'13');
  assert.equal(autoMetrics(safe).byTeam.A,2);
});
test('rejected contact no longer counts, but other contact is kept',()=>{
  const data=fixAutoEvent(fixture(),'e2',{status:'rejected'});
  assert.equal(autoMetrics(data).contacts,1);
  assert.equal(autoMetrics(data).rallies,1);
});
test('winner remains unknown until explicitly selected',()=>{
  assert.equal(autoMetrics(fixture()).winnersConfirmed,0);
  assert.equal(autoMetrics(fixAutoRally(fixture(),'rally-0001','B')).winnersConfirmed,1);
});
test('CSV escapes formula-looking jersey and preserves automatic provenance',()=>{
  let a=fixture();a.events[0].jersey='=CMD';
  assert.match(autoCSV(a),/"'=CMD"/);
  assert.equal(sanitizeAuto(a).events[0].jersey,'');
});

test('multiple tracking IDs of same identified jersey aggregate in player card',async()=>{
  const {autoPlayerTotals}=await import('../src/automatic.ts');
  let a=fixAutoTrack(fixture(),'0:4',{team:'A',jersey:'13'});
  a.events.push({...a.events[0],id:'third',trackKey:'1:92',second:33,status:'auto'});
  const players=autoPlayerTotals(a);
  assert.equal(players.length,1);assert.equal(players[0].jersey,'13');assert.equal(players[0].touches,3);
});
