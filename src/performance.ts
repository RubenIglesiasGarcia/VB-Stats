/** Coach analytics. AI detections are not official results.
 * Only explicitly reviewed outcomes contribute to technical KPIs.
 */
import type {AutoAnalysis,AutoEvent,AutoAction} from './automatic';
export type Outcome='ace'|'error'|'in_play'|'kill'|'continuation'|'point'|'touch'|'0'|'1'|'2'|'3'|'assist'|'good'|'bad';
export interface Review{action:AutoAction;outcome:Outcome;team:'A'|'B';jersey:string;reviewedAt:number;}
export type Reviews=Record<string,Review>;
export type Skill='saque'|'recepción'|'ataque'|'bloqueo'|'defensa'|'colocación';
export const RESULT_CHOICES:Record<Skill,readonly {value:Outcome;label:string}[]>={
 saque:[{value:'in_play',label:'Saque en juego'},{value:'ace',label:'Ace'},{value:'error',label:'Error de saque'}],
 recepción:[{value:'3',label:'Perfecta (3)'},{value:'2',label:'Buena (2)'},{value:'1',label:'Mala (1)'},{value:'0',label:'Error (0)'}],
 ataque:[{value:'kill',label:'Punto de ataque'},{value:'continuation',label:'Continuidad'},{value:'error',label:'Error de ataque'}],
 bloqueo:[{value:'point',label:'Bloqueo punto'},{value:'touch',label:'Toque de bloqueo'},{value:'error',label:'Error de bloqueo'}],
 defensa:[{value:'good',label:'Defensa con continuidad'},{value:'bad',label:'Defensa sin continuidad'}],
 colocación:[{value:'assist',label:'Asistencia a punto'},{value:'good',label:'Colocación en juego'},{value:'error',label:'Error de colocación'}],
};
const isSkill=(a:string):a is Skill=>Object.hasOwn(RESULT_CHOICES,a);
export interface SkillMetrics{attempts:number;errors:number;points:number;good:number;qualitySum:number;quality3:number;quality2:number;quality1:number;quality0:number;continues:number;assists:number;}
const empty=():SkillMetrics=>({attempts:0,errors:0,points:0,good:0,qualitySum:0,quality3:0,quality2:0,quality1:0,quality0:0,continues:0,assists:0});
export interface SegmentMetrics{team:'A'|'B';jersey?:string;skills:Record<Skill,SkillMetrics>;verified:number;}
const create=(team:'A'|'B',jersey?:string):SegmentMetrics=>({team,jersey,verified:0,skills:{saque:empty(),recepción:empty(),ataque:empty(),bloqueo:empty(),defensa:empty(),colocación:empty()}});
export function reviewEvent(event:AutoEvent,skill:Skill,outcome:Outcome,jersey?:string):Review{
  if(!event.team)throw Error('Identifica primero el equipo');
  if(!RESULT_CHOICES[skill].some(c=>c.value===outcome))throw Error('Resultado no válido para la acción');
  const number=jersey??event.jersey;
  if(number&&!/^\d{1,2}$/.test(number))throw Error('Dorsal inválido');
  return {action:skill,outcome,team:event.team,jersey:number,reviewedAt:Date.now()};
}
function record(group:SegmentMetrics,skill:Skill,outcome:Outcome){
  const m=group.skills[skill];m.attempts++;group.verified++;
  if(outcome==='error'||(skill==='recepción'&&outcome==='0'))m.errors++;
  if(outcome==='ace'||outcome==='kill'||outcome==='point')m.points++;
  if(outcome==='good'||outcome==='in_play'||outcome==='touch')m.good++;
  if(outcome==='continuation')m.continues++;
  if(outcome==='assist')m.assists++;
  if(skill==='recepción'&&['0','1','2','3'].includes(outcome)){
    const n=Number(outcome);m.qualitySum+=n;
    if(n===0)m.quality0++;if(n===1)m.quality1++;if(n===2)m.quality2++;if(n===3)m.quality3++;
  }
}
export function computePerformance(data:AutoAnalysis,reviews:Reviews){
  const teams:{A:SegmentMetrics;B:SegmentMetrics}={A:create('A'),B:create('B')};
  const players=new Map<string,SegmentMetrics>();
  let invalid=0;
  for(const e of data.events){
    const r=reviews[e.id];
    if(!r||e.status==='rejected')continue;
    // A reviewed result belongs to this event only, never to another analysis.
    // The explicit review captures the final corrected team and dorsal.
    if(!isSkill(r.action)||!RESULT_CHOICES[r.action].some(x=>x.value===r.outcome)||!['A','B'].includes(r.team)||
       (r.jersey&&!/^\d{1,2}$/.test(r.jersey))){invalid++;continue;}
    record(teams[r.team],r.action,r.outcome);
    if(r.jersey){const key=`${r.team}:${r.jersey}`;if(!players.has(key))players.set(key,create(r.team,r.jersey));record(players.get(key)!,r.action,r.outcome);}
  }
  const verified=teams.A.verified+teams.B.verified;
  return {teams,players:[...players.values()].sort((a,b)=>b.verified-a.verified||a.team.localeCompare(b.team)||Number(a.jersey)-Number(b.jersey)),
    verified,invalid,detected:data.events.filter(e=>e.status!=='rejected').length};
}
export function percent(n:number,d:number):number|null{return d>0?Math.round(n*1000/d)/10:null;}
export function hittingEfficiency(m:SkillMetrics):number|null{
  return m.attempts>0?Math.round((m.points-m.errors)/m.attempts*1000)/1000:null;
}
export function receptionRating(m:SkillMetrics):number|null{return m.attempts>0?Math.round(m.qualitySum/m.attempts*100)/100:null;}
export function performanceCSV(data:AutoAnalysis,reviews:Reviews):string{
  const p=computePerformance(data,reviews);
  const quote=(s:string|number|null)=>'"'+String(s??'').replace(/^[\s\u0000-\u001f]*[=+@-]/,x=>"'"+x).replaceAll('"','""')+'"';
  const rows:(string|number|null)[][]=[['equipo','dorsal','saques','aces','errores_saque','recepciones','recepciones_perfectas','errores_recepcion','ataques','puntos_ataque','errores_ataque','eficiencia_ataque','bloqueos','bloqueos_punto','errores_bloqueo','defensas_buenas','acciones_verificadas']];
  for(const x of [...Object.values(p.teams),...p.players]){
    const a=x.skills.ataque,r=x.skills.recepción,s=x.skills.saque,b=x.skills.bloqueo;
    rows.push([x.team,x.jersey||'TOTAL',s.attempts,s.points,s.errors,r.attempts,r.quality3,r.errors,a.attempts,a.points,a.errors,hittingEfficiency(a),b.attempts,b.points,b.errors,x.skills.defensa.good,x.verified]);
  }
  return rows.map(r=>r.map(quote).join(';')).join('\r\n');
}
