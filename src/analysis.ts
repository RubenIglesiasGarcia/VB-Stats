/** Derived statistics, review queue and exports. No AI-estimated or inferred actions. */
import {formatTime,playersFromEvents,teamStats,type MatchData,type MatchEvent,type Team} from './model.ts';

export interface RallySummary {
  set:number;
  rally:number;
  second:number;
  actions:number;
  events:MatchEvent[];
  winner:Team|null;
  complete:boolean;
  hasUnidentified:boolean;
}
export interface ReviewIssue {
  id:string;
  kind:'warning'|'info';
  title:string;
  description:string;
  set:number;
  rally:number;
  second:number;
}
export function rallySummaries(events:MatchEvent[]):RallySummary[] {
  const grouped=new Map<string,MatchEvent[]>();
  for(const e of events){
    const key=`${e.set}/${e.rally}`;
    const arr=grouped.get(key)||[];arr.push(e);grouped.set(key,arr);
  }
  return [...grouped.entries()].map(([,arr])=>{
    const ordered=[...arr].sort((a,b)=>a.second-b.second);
    const winner=ordered.find(e=>e.skill==='punto')?.team??null;
    return {set:ordered[0].set,rally:ordered[0].rally,second:ordered[0].second,
      actions:ordered.filter(e=>e.skill!=='punto').length,events:ordered,
      winner,complete:winner!==null,hasUnidentified:ordered.some(e=>e.skill!=='punto'&&!e.jersey)};
  }).sort((a,b)=>a.set-b.set||a.rally-b.rally);
}
export function reviewIssues(match:MatchData):ReviewIssue[] {
  const issues:ReviewIssue[]=[];
  const known:Record<Team,Set<string>>={A:new Set(match.rosters.A.map(p=>p.jersey)),B:new Set(match.rosters.B.map(p=>p.jersey))};
  for(const r of rallySummaries(match.events)){
    const base={set:r.set,rally:r.rally,second:r.second};
    if(!r.complete) issues.push({id:`open-${r.set}-${r.rally}`,kind:'warning',title:`Set ${r.set} · Punto ${r.rally} sin cerrar`,description:'Marca qué equipo ganó el rally para incorporarlo al marcador.',...base});
    if(!r.actions) issues.push({id:`empty-${r.set}-${r.rally}`,kind:'info',title:`Set ${r.set} · Punto ${r.rally} sin acciones`,description:'Solo se ha anotado el ganador; faltan las acciones del punto.',...base});
    if(r.hasUnidentified) issues.push({id:`unknown-${r.set}-${r.rally}`,kind:'info',title:`Set ${r.set} · Punto ${r.rally} sin dorsal`,description:'Hay una acción sin jugador identificado. No aparecerá en su ficha.',...base});
    const unknown=[...new Set(r.events.filter(e=>e.jersey&&!known[e.team].has(e.jersey)).map(e=>`${e.team}:#${e.jersey}`))];
    if(unknown.length) issues.push({id:`roster-${r.set}-${r.rally}`,kind:'info',title:'Dorsales sin ficha en plantilla',description:`${unknown.join(', ')}. Puedes añadirlos en Plantillas.`,...base});
  }
  if(match.analysisReview){
    const validIds=new Set<string>();
    for(const e of match.events){
      const matchId=e.note?.match(/\[IA:([^\]]+)\]/)?.[1];
      if(matchId)validIds.add(matchId);
    }
    for(const proposal of match.analysisReview.proposals){
      if(proposal.status==='accepted'&&!validIds.has(proposal.id)){
        issues.push({id:`orphaned-ai-${proposal.id}`,kind:'warning',title:'Propuesta IA validada sin acción',
          description:'La acción asociada fue borrada o editada. Devuelve la propuesta a pendiente para revisarla.',
          set:1,rally:1,second:proposal.second});
      }
    }
  }
  return issues;
}
export function sessionQuality(match:MatchData){
  const rallies=rallySummaries(match.events);
  const complete=rallies.filter(r=>r.complete).length;
  const detailed=rallies.filter(r=>r.actions>0).length;
  const identified=match.events.filter(e=>e.skill!=='punto'&&e.jersey).length;
  const actions=match.events.filter(e=>e.skill!=='punto').length;
  return {rallies:rallies.length,complete,detailed,identified,actions,
    closedRate:rallies.length?Math.round(100*complete/rallies.length):null,
    identificationRate:actions?Math.round(100*identified/actions):null,
    issues:reviewIssues(match)};
}
export function attackEfficiency(events:MatchEvent[],team:Team,jersey?:string,set?:number):number|null {
  const s=teamStats(events,team,jersey,set);
  return s.attacks?Math.round(100*(s.attackKills-s.attackErrors)/s.attacks):null;
}
export function serviceBalance(events:MatchEvent[],team:Team,jersey?:string,set?:number):number|null {
  const s=teamStats(events,team,jersey,set);
  return s.serves?Math.round(100*(s.aces-s.serveErrors)/s.serves):null;
}
export function exportPlayerCSV(match:MatchData,set?:number):string {
  const columns=['set','equipo','dorsal','jugador','posición','saques','aces','errores saque','recepciones','recepciones positivas','recepciones perfectas','errores recepción','recepción positiva %','ataques','ataques ganadores','errores ataque','eficacia ataque %','eficiencia ataque %','bloqueos punto','defensas','colocaciones con error','acciones verificadas'];
  const records:(string|number)[][]=[];
  for(const team of ['A','B'] as Team[]){
    for(const player of playersFromEvents(match,team)){
      const s=teamStats(match.events,team,player.jersey,set);
      records.push([set??'todos',match.teams[team],player.jersey,player.name,player.position,s.serves,s.aces,s.serveErrors,
        s.receptions,s.positiveRecep,s.perfectRecep,s.receptionErrors,s.positiveRecepPercent??'',s.attacks,s.attackKills,s.attackErrors,
        s.attackKillPercent??'',attackEfficiency(match.events,team,player.jersey,set)??'',s.blocks,s.digs,s.settingErrors,s.actions]);
    }
  }
  const quote=(item:string|number)=>{
    const raw=String(item);
    const safe=typeof item==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(raw)?`'${raw}`:raw;
    return `"${safe.replaceAll('\"','\"\"')}"`;
  };
  return [columns,...records].map(row=>row.map(quote).join(';')).join('\r\n');
}
export function rallyPreview(r:RallySummary, teams:MatchData['teams']){
  return `${formatTime(r.second)} · Set ${r.set}, punto ${r.rally} · ${r.complete ? 'Ganador: '+teams[r.winner!] : 'Pendiente'} · ${r.actions} acciones`;
}

/** Export reviewed training labels; predictions are deliberately kept separate from facts. */
export function exportReviewCSV(match:MatchData):string {
  const header=['id','segundos','tipo','estado','señal_no_calibrada','track_temporal','equipo_sugerido',
    'equipo_confirmado','dorsal_confirmado','accion_confirmada','resultado_confirmado','centro_balon','caja_persona','razon'];
  const quote=(value:string|number)=>{
    const raw=String(value);
    const safe=typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(raw)?`'${raw}`:raw;
    return `"${safe.replaceAll('"','""')}"`;
  };
  const rows=(match.analysisReview?.proposals||[]).map(p=>{
    const event=match.events.find(e=>e.note?.includes(`[IA:${p.id}]`));
    return [p.id,p.second,p.kind,p.status,p.confidence,p.trackId??'',p.teamHint??'',
      event?.team??'',event?.jersey??'',event?.skill??'',event?.outcome??'',
      p.evidence?.ballCenter?.join('|')??'',p.evidence?.playerBox?.join('|')??'',p.reason];
  });
  return [header,...rows].map(row=>row.map(quote).join(';')).join('\r\n');
}
