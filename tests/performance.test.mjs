import test from 'node:test';import assert from 'node:assert/strict';
import {computePerformance,hittingEfficiency,percent,receptionRating,reviewEvent,performanceCSV} from '../src/performance.ts';
const base={version:1,sourceName:'Test',events:[
 {id:'e1',team:'A',jersey:'7',action:'saque',status:'auto'},
 {id:'e2',team:'A',jersey:'7',action:'ataque',status:'auto'},
 {id:'e3',team:'A',jersey:'7',action:'ataque',status:'auto'},
 {id:'e4',team:'B',jersey:'10',action:'recepción',status:'auto'},
 {id:'e5',team:'B',jersey:'10',action:'recepción',status:'auto'},
 {id:'e6',team:'B',jersey:'11',action:'bloqueo',status:'rejected'},
 {id:'e7',team:null,jersey:'',action:'toque',status:'auto'},
],rallies:[]};
function R(id,action,outcome,team,jersey){return {action,outcome,team,jersey,reviewedAt:1}}
test('unreviewed suggestions never create official metrics',()=>{const p=computePerformance(base,{});assert.equal(p.verified,0);assert.equal(p.teams.A.skills.saque.attempts,0);});
test('correct serve attack reception + rejected evidence',()=>{const p=computePerformance(base,{e1:R('e1','saque','error','A','7'),e2:R('e2','ataque','kill','A','7'),e3:R('e3','ataque','error','A','7'),e4:R('e4','recepción','3','B','10'),e5:R('e5','recepción','0','B','10'),e6:R('e6','bloqueo','point','B','11')});assert.equal(p.verified,5);assert.equal(p.players.length,2);assert.equal(p.teams.A.skills.saque.errors,1);assert.equal(hittingEfficiency(p.teams.A.skills.ataque),0);assert.equal(receptionRating(p.teams.B.skills.recepción),1.5);assert.equal(percent(p.teams.B.skills.recepción.quality3,2),50);});
test('unknown jersey counts in team totals but not players',()=>{const p=computePerformance(base,{e7:R('e7','saque','ace','B','')});assert.equal(p.teams.B.skills.saque.points,1);assert.equal(p.players.length,0)});
test('reject invalid outcomes and unassigned team',()=>{assert.throws(()=>reviewEvent(base.events[6],'saque','error'));assert.throws(()=>reviewEvent(base.events[0],'ataque','ace'));});
test('CSV only verified values and safe spreadsheet escaped strings',()=>{const s=performanceCSV(base,{e1:R('e1','saque','error','A','7')});assert.match(s,/errores_saque/);assert.match(s,/"TOTAL"/);assert.match(s,/"7"/)});
