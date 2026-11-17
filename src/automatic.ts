import type {Team} from './model';
export type AutoAction='toque'|'saque'|'recepción'|'colocación'|'ataque'|'bloqueo'|'defensa';
export type AutoStatus='auto'|'corrected'|'rejected';
export interface AutoEvent {
  id:string;second:number;trackKey:string;confidence:number;
  team:Team|null;teamConfidence:number|null;
  action:AutoAction;actionConfidence:number|null;
  jersey:string;jerseyConfidence?:number|null;jerseyEvidenceFrames?:number;status:AutoStatus;rally:number|null;
}
export interface AutoRally {
  id:string;index:number;startSeconds:number;endSeconds:number;
  winner:Team|null;status:'estimated'|'corrected';
}
export interface AutoAnalysis {
  version:1;sourceName:string;engine:string;durationSeconds:number;processedSeconds:number;
  segments:number;events:AutoEvent[];rallies:AutoRally[];limitations:string[];
  jerseyRecognition?:{recognizedTracks:number;eligibleTracks:number;method:string};
}
export const AUTO_ACTIONS:AutoAction[]=['toque','saque','recepción','colocación','ataque','bloqueo','defensa'];
export function autoMetrics(data:AutoAnalysis){
  const events=data.events.filter(e=>e.status!=='rejected');
  const count=(team:Team|null)=>events.filter(e=>e.team===team).length;
  const byAction=Object.fromEntries(AUTO_ACTIONS.map(k=>[k,events.filter(e=>e.action===k).length])) as Record<AutoAction,number>;
  const reviewed=events.filter(e=>e.status==='corrected').length;
  const unidentified=events.filter(e=>!e.jersey).length;
  return {contacts:events.length,rallies:data.rallies.length,byTeam:{A:count('A'),B:count('B'),unknown:count(null)},
    byAction,reviewed,unidentified,knownPlayers:new Set(events.filter(e=>e.jersey).map(e=>`${e.team}:${e.jersey}`)).size,
    winnersConfirmed:data.rallies.filter(r=>r.winner!==null).length};
}
export interface AutoTrackSummary {key:string;team:Team|null;jersey:string;touches:number;firstSecond:number;confidence:number;jerseyConfidence:number|null;}
export function autoTracks(data:AutoAnalysis):AutoTrackSummary[]{
  const map=new Map<string,AutoTrackSummary>();
  for(const e of data.events){
    if(e.status==='rejected'||!e.trackKey)continue;
    const current=map.get(e.trackKey);
    if(!current)map.set(e.trackKey,{key:e.trackKey,team:e.team,jersey:e.jersey,touches:1,firstSecond:e.second,confidence:e.confidence,jerseyConfidence:e.jerseyConfidence??null});
    else {current.touches++;current.confidence=Math.max(current.confidence,e.confidence);if(e.jersey){current.jersey=e.jersey;current.jerseyConfidence=e.jerseyConfidence??null;}if(e.team)current.team=e.team;}
  }
  return [...map.values()].sort((a,b)=>b.touches-a.touches||a.firstSecond-b.firstSecond);
}
export function autoPlayerTotals(data:AutoAnalysis){
  const players=new Map<string,{team:Team;jersey:string;touches:number;byAction:Record<AutoAction,number>;
    rallies:Set<number>;firstSecond:number;lastSecond:number;confidenceSum:number}>();
  for(const event of data.events){
    if(event.status==='rejected'||!event.team||!event.jersey)continue;
    const key=`${event.team}:${event.jersey}`;
    let entry=players.get(key);
    if(!entry){entry={team:event.team,jersey:event.jersey,touches:0,byAction:Object.fromEntries(AUTO_ACTIONS.map(x=>[x,0])) as Record<AutoAction,number>,rallies:new Set(),firstSecond:event.second,lastSecond:event.second,confidenceSum:0};players.set(key,entry);}
    entry.touches++;entry.byAction[event.action]++;entry.confidenceSum+=event.confidence;
    if(event.rally!==null)entry.rallies.add(event.rally);
    entry.firstSecond=Math.min(entry.firstSecond,event.second);entry.lastSecond=Math.max(entry.lastSecond,event.second);
  }
  return [...players.values()].map(({rallies,confidenceSum,...e})=>({...e,ralliesInvolved:rallies.size,
    averageDetectionConfidence:Math.round(100*confidenceSum/Math.max(1,e.touches))})).sort((a,b)=>b.touches-a.touches||a.team.localeCompare(b.team)||Number(a.jersey)-Number(b.jersey));
}
export function fixAutoTrack(data:AutoAnalysis,key:string,patch:{team?:Team|null;jersey?:string}):AutoAnalysis{
  return {...data,events:data.events.map(e=>e.trackKey===key?{...e,...patch,jerseyConfidence:patch.jersey!==undefined?null:e.jerseyConfidence,status:'corrected' as AutoStatus}:e)};
}
export function fixAutoEvent(data:AutoAnalysis,id:string,patch:Partial<Pick<AutoEvent,'team'|'jersey'|'action'|'status'>>):AutoAnalysis{
  return {...data,events:data.events.map(e=>e.id===id?{...e,...patch,status:patch.status??'corrected'}:e)};
}
export function fixAutoRally(data:AutoAnalysis,id:string,winner:Team|null):AutoAnalysis{
  return {...data,rallies:data.rallies.map(r=>r.id===id?{...r,winner,status:'corrected' as const}:r)};
}
export function autoCSV(data:AutoAnalysis):string{
  const columns=['segundo','rally_estimado','equipo_estimado','dorsal','id_seguimiento_temporal','accion_estimada','confianza_modelo','confianza_accion_heuristica','confianza_ocr_dorsal','estado'];
  const quote=(value:string|number|null)=>{
    const str=String(value??'');const safe=/^[\s\u0000-\u001f]*[=+@-]/.test(str)?`'${str}`:str;
    return `"${safe.replaceAll('"','""')}"`;
  };
  return [columns,...data.events.map(e=>[e.second,e.rally,e.team??'',e.jersey,e.trackKey,e.action,e.confidence,e.actionConfidence,e.jerseyConfidence??null,e.status])].map(row=>row.map(quote).join(';')).join('\r\n');
}
export function sanitizeAuto(value:unknown):AutoAnalysis|undefined{
  if(!value||typeof value!=='object')return undefined;
  const v=value as Record<string,unknown>;
  if(v.version!==1||!Array.isArray(v.events)||v.events.length>12000||!Array.isArray(v.rallies)||v.rallies.length>2500)return undefined;
  const events:AutoEvent[]=[];const ids=new Set<string>();
  for(const raw of v.events){
    if(!raw||typeof raw!=='object')return undefined;
    const e=raw as Record<string,unknown>;
    if(typeof e.id!=='string'||e.id.length>64||ids.has(e.id)||
      typeof e.second!=='number'||!Number.isFinite(e.second)||e.second<0||e.second>21600||
      typeof e.confidence!=='number'||e.confidence<0||e.confidence>1||
      !AUTO_ACTIONS.includes(e.action as AutoAction)||!['auto','corrected','rejected'].includes(String(e.status)))return undefined;
    ids.add(e.id);
    events.push({id:e.id,second:e.second,trackKey:typeof e.trackKey==='string'?e.trackKey.slice(0,80):'',
      confidence:e.confidence,team:e.team==='A'||e.team==='B'?e.team:null,
      teamConfidence:typeof e.teamConfidence==='number'&&e.teamConfidence>=0&&e.teamConfidence<=1?e.teamConfidence:null,
      action:e.action as AutoAction,actionConfidence:typeof e.actionConfidence==='number'&&e.actionConfidence>=0&&e.actionConfidence<=1?e.actionConfidence:null,
      jersey:typeof e.jersey==='string'&&/^\d{0,3}$/.test(e.jersey)?e.jersey:'',
      jerseyConfidence:typeof e.jerseyConfidence==='number'&&e.jerseyConfidence>=0&&e.jerseyConfidence<=1?e.jerseyConfidence:null,
      jerseyEvidenceFrames:typeof e.jerseyEvidenceFrames==='number'&&e.jerseyEvidenceFrames>=0?e.jerseyEvidenceFrames:0,
      status:e.status as AutoStatus,rally:typeof e.rally==='number'&&Number.isInteger(e.rally)&&e.rally>=1&&e.rally<=2500?e.rally:null});
  }
  const rallies:AutoRally[]=[];
  for(const r0 of v.rallies){
    if(!r0||typeof r0!=='object')return undefined;
    const r=r0 as Record<string,unknown>;
    if(typeof r.id!=='string'||r.id.length>80||typeof r.index!=='number'||!Number.isInteger(r.index)||
       typeof r.startSeconds!=='number'||typeof r.endSeconds!=='number'||!Number.isFinite(r.startSeconds)||!Number.isFinite(r.endSeconds)||
       r.startSeconds<0||r.endSeconds<=r.startSeconds||r.endSeconds>21600)return undefined;
    rallies.push({id:r.id,index:r.index,startSeconds:r.startSeconds,endSeconds:r.endSeconds,
      winner:r.winner==='A'||r.winner==='B'?r.winner:null,status:r.status==='corrected'?'corrected':'estimated'});
  }
  return {version:1,sourceName:typeof v.sourceName==='string'?v.sourceName.slice(0,160):'Partido',
    engine:'ravel-vb-013',durationSeconds:typeof v.durationSeconds==='number'&&Number.isFinite(v.durationSeconds)?v.durationSeconds:0,
    processedSeconds:typeof v.processedSeconds==='number'&&Number.isFinite(v.processedSeconds)?v.processedSeconds:0,
    segments:typeof v.segments==='number'?v.segments:0,events,rallies,
    jerseyRecognition: v.jerseyRecognition&&typeof v.jerseyRecognition==='object' ? (()=>{
      const j=v.jerseyRecognition as Record<string,unknown>;
      return {recognizedTracks:Number(j.recognizedTracks)||0,eligibleTracks:Number(j.eligibleTracks)||0,
        method:typeof j.method==='string'?j.method.slice(0,120):'OCR'};})() : undefined,
    limitations:Array.isArray(v.limitations)?v.limitations.filter((x):x is string=>typeof x==='string').slice(0,8).map(x=>x.slice(0,240)):[]};
}

/** Exportación útil por jugador, basada solo en los contactos asignados a dorsal.
 * No incluye puntos/aces o porcentajes que el modelo aún no puede certificar.
 */
export function autoPlayerCSV(data:AutoAnalysis):string{
  const players=autoPlayerTotals(data);
  const columns=['equipo','dorsal','toques_detectados','rallies_estimados','saques_probables',
    'recepciones_probables','colocaciones_probables','ataques_probables',
    'bloqueos_probables','defensas_probables','toques_sin_clasificar','confianza_media_deteccion_pct'];
  const quote=(value:string|number)=>{
    const raw=String(value);
    const escaped=/^[\s\u0000-\u001f]*[=+@-]/.test(raw)?`'${raw}`:raw;
    return `"${escaped.replaceAll('"','""')}"`;
  };
  const rows=players.map(p=>[p.team,p.jersey,p.touches,p.ralliesInvolved,
    p.byAction.saque,p.byAction.recepción,p.byAction.colocación,p.byAction.ataque,
    p.byAction.bloqueo,p.byAction.defensa,p.byAction.toque,p.averageDetectionConfidence]);
  return [columns,...rows].map(row=>row.map(quote).join(';')).join('\r\n');
}
