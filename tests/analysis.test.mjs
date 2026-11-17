import assert from 'node:assert/strict';
import test from 'node:test';
import {initialMatch} from '../src/model.ts';
import {attackEfficiency,exportPlayerCSV,rallySummaries,reviewIssues,sessionQuality,serviceBalance} from '../src/analysis.ts';
const ev=(id,team,jersey,skill,outcome,rally=1,set=1)=>({id,team,jersey,skill,outcome,rally,set,second:rally*30});
const make=(events)=>({...initialMatch,events});
test('agrupa rallies y distingue puntos anotados de acciones',()=>{
  const match=make([ev('1','A','13','saque','ace'),ev('2','A','','punto','ganadora'),ev('3','B','4','defensa','positiva',2)]);
  const r=rallySummaries(match.events);
  assert.equal(r.length,2);assert.equal(r[0].winner,'A');assert.equal(r[0].actions,1);assert.equal(r[1].complete,false);
});
test('detecta puntos abiertos, sin acciones, sin dorsal y fuera de plantilla',()=>{
  const match=make([ev('1','A','13','recepción','positiva'),ev('2','A','','punto','ganadora'),ev('3','B','7','ataque','ganadora',2),ev('4','B','','defensa','positiva',3),ev('5','B','','punto','ganadora',3)]);
  const issues=reviewIssues(match);
  assert.ok(issues.some(x=>x.id==='open-1-2'));
  assert.ok(issues.some(x=>x.id==='roster-1-2'));
  assert.ok(issues.some(x=>x.id==='unknown-1-3'));
  assert.equal(sessionQuality(match).closedRate,67);
});
test('eficiencia neta y balance de saque nunca confunden acciones con rally ganador',()=>{
  const events=[ev('1','A','13','ataque','ganadora'),ev('2','A','13','ataque','error'),ev('3','A','13','ataque','neutra'),ev('4','A','13','saque','ace'),ev('5','A','13','saque','error')];
  assert.equal(attackEfficiency(events,'A','13'),0);assert.equal(serviceBalance(events,'A','13'),0);
  assert.equal(attackEfficiency([], 'A'),null);
});
test('exporta informe de todos los jugadores escapando CSV e incluyendo % calculados',()=>{
  const match=make([ev('1','A','13','ataque','ganadora')]);
  match.rosters={A:[{jersey:'13',name:'Ana "Ace"',position:'Receptor'}],B:[]};
  const csv=exportPlayerCSV(match);
  assert.ok(csv.includes('"Ana ""Ace"""'));assert.ok(csv.includes('"eficiencia ataque %"'));
  assert.ok(csv.includes('"100"'));
});
test('CSV neutraliza fórmulas en nombres y equipos importados',()=>{
 const m=make([ev('1','A','13','ataque','ganadora')]);
 m.rosters={A:[{jersey:'13',name:'=HYPERLINK("https://example.com")',position:'Receptor'}],B:[]};
 const csv=exportPlayerCSV(m);
 assert.ok(csv.includes('"\'=HYPERLINK('));
});
