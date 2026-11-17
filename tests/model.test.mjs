import assert from 'node:assert/strict';
import test from 'node:test';
import {initialMatch,parseYouTubeId,parseTime,formatTime,sanitizeImport,setScore,nextRally,teamStats,progress,exportCSV} from '../src/model.ts';
const e = (id,team,skill,outcome,more={})=>({id,second:15,set:1,rally:1,team,jersey:'13',skill,outcome,...more});
test('URLs de YouTube válidas y dominios externos bloqueados',()=>{
 assert.equal(parseYouTubeId('https://www.youtube.com/live/ul-pA6pLWX8?is=abc'),'ul-pA6pLWX8');
 assert.equal(parseYouTubeId('https://youtu.be/ul-pA6pLWX8?t=40'),'ul-pA6pLWX8');
 assert.equal(parseYouTubeId('https://evil-youtube.com/watch?v=ul-pA6pLWX8'),null);
 assert.equal(parseYouTubeId('https://youtube.com.evil.net/watch?v=ul-pA6pLWX8'),null);
});
test('marca de tiempo',()=>{
 assert.equal(parseTime('1:24:33'),5073);assert.equal(parseTime('03:59'),239);
 assert.equal(parseTime('3:99'),null);assert.equal(parseTime('03:x'),null);
 assert.equal(formatTime(5073),'1:24:33');
});
test('marcador sin duplicados y siguiente punto',()=>{
 const events=[e('1','A','saque','ace'),e('2','A','punto','ganadora'),e('3','B','ataque','ganadora',{rally:2}),e('4','B','punto','ganadora',{rally:2}),e('5','A','punto','ganadora',{rally:2})];
 assert.deepEqual(setScore(events,1),{A:1,B:1,total:2});
 assert.equal(nextRally(events,1),3);
 assert.equal(nextRally([e('1','A','saque','neutra')],1),1);
});
test('resumen de estadísticas sin confundir ganador del rally con acciones ganadoras',()=>{
 const events=[e('1','A','saque','ace'),e('2','A','punto','ganadora'),e('3','A','recepción','perfecta',{rally:2}),e('4','A','recepción','positiva',{rally:3}),e('5','A','ataque','ganadora',{rally:2}),e('6','A','ataque','error',{rally:3})];
 const s=teamStats(events,'A','13');assert.equal(s.positiveRecepPercent,100);assert.equal(s.attackKillPercent,50);assert.equal(s.recordedPoints,1);assert.equal(s.winningActions,2);
 assert.deepEqual(progress(events),{rallies:3,closed:1,actions:5});
});
test('importa versión 1 conservando eventos y normaliza a v2',()=>{
 const v=sanitizeImport({...initialMatch,version:1,events:[e('1','A','punto','ganadora')]});
 assert.equal(v.version,2);assert.equal(v.events.length,1);
});
test('rechaza resultados inválidos y doble ganador',()=>{
 assert.throws(()=>sanitizeImport({...initialMatch,events:[e('1','A','recepción','ace')]}));
 assert.throws(()=>sanitizeImport({...initialMatch,events:[e('1','A','punto','ganadora'),e('2','B','punto','ganadora')]}));
});
test('CSV contiene cabeceras y escapa comillas',()=>{
 const csv=exportCSV([e('1','A','ataque','ganadora',{note:'dijo "sí"'})],initialMatch.teams);
 assert.ok(csv.includes('"dijo ""sí"""'));
});
test('CSV de eventos neutraliza fórmulas potencialmente peligrosas',()=>{
 const csv=exportCSV([e('1','A','ataque','ganadora',{note:'=HYPERLINK("https://example.com")'})],initialMatch.teams);
 assert.ok(csv.includes('"\'=HYPERLINK('));
});
test('importación rechaza IDs de acción duplicados que romperían la edición',()=>{
 const match={...initialMatch,events:[e('duplicate','A','saque','neutra'),e('duplicate','B','recepción','positiva')]};
 assert.throws(()=>sanitizeImport(match),/duplicados/);
});
