import test from 'node:test';
import assert from 'node:assert/strict';
import {hasAutomaticReport,hasManualReport} from '../src/reportState.ts';

test('sin informe ni acciones las descargas permanecen ocultas',()=>{
  assert.equal(hasAutomaticReport(undefined),false);
  assert.equal(hasManualReport([]),false);
  assert.equal(hasAutomaticReport({events:[],rallies:[]}),false);
});
test('solo informes con contactos o rallies permiten exportar estadísticas IA',()=>{
  assert.equal(hasAutomaticReport({events:[{id:'1'}],rallies:[]}),true);
  assert.equal(hasAutomaticReport({events:[],rallies:[{id:'r1'}]}),true);
});
test('las exportaciones manuales solo se habilitan con acciones registradas',()=>{
  assert.equal(hasManualReport(undefined),false);
  assert.equal(hasManualReport([{id:'1'}]),true);
});

test('el CSV individual contiene estadísticas solo de dorsales reconocidos, nunca puntos inventados',async()=>{
  const {autoPlayerCSV}=await import('../src/automatic.ts');
  const data={version:1,sourceName:'partido',engine:'ravel-vb-013',durationSeconds:100,processedSeconds:100,segments:1,limitations:[],rallies:[],events:[
    {id:'a',second:2,trackKey:'1',confidence:.8,team:'A',teamConfidence:.7,action:'ataque',actionConfidence:.5,jersey:'13',status:'auto',rally:1},
    {id:'b',second:5,trackKey:'2',confidence:.9,team:'B',teamConfidence:.7,action:'recepción',actionConfidence:.5,jersey:'',status:'auto',rally:1}
  ]};
  const csv=autoPlayerCSV(data);
  assert.match(csv,/"A";"13";"1"/);
  assert.doesNotMatch(csv,/ganador|ace|eficiencia/);
  assert.equal(csv.split('\r\n').length,2);
});
