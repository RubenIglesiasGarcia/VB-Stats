import {sanitizeAuto,type AutoAnalysis} from './automatic.ts';
export type Team = 'A' | 'B';
export type Skill = 'saque' | 'recepción' | 'colocación' | 'ataque' | 'bloqueo' | 'defensa' | 'punto';
export type Outcome = 'neutra' | 'positiva' | 'perfecta' | 'negativa' | 'error' | 'ace' | 'ganadora';
export type Position = 'Colocador' | 'Opuesto' | 'Receptor' | 'Central' | 'Líbero' | 'Sin definir';
export interface RosterPlayer { jersey: string; name: string; position: Position }
export interface MatchEvent {
  id: string;
  second: number;
  set: number;
  rally: number;
  team: Team;
  jersey: string;
  skill: Skill;
  outcome: Outcome;
  note?: string;
}
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';
/** Candidate evidence from a computer vision model. NEVER a confirmed match action. */
export interface DetectionSuggestion {
  id: string;
  kind: 'contact_candidate' | 'rally_pause_candidate';
  second: number;
  confidence: number; // heuristic score, not calibrated likelihood
  teamHint: Team | null;
  trackId: number | null; // transient track ID, NOT a jersey
  reason: string;
  evidence?: {ballCenter?:number[];playerBox?:number[];angleDegrees?:number;ballDetectorScore?:number;lastBallSecond?:number};
  status: SuggestionStatus;
}
export interface AnalysisReview {
  sourceName: string;
  analyzedAt: string;
  proposals: DetectionSuggestion[];
}
export interface MatchData {
  version: 2;
  title: string;
  teams: Record<Team, string>;
  rosters: Record<Team, RosterPlayer[]>;
  youtubeId: string | null;
  events: MatchEvent[];
  analysisReview?: AnalysisReview;
  autoAnalysis?: AutoAnalysis;
}
export const SKILLS: Exclude<Skill,'punto'>[] = ['saque','recepción','colocación','ataque','bloqueo','defensa'];
export const SKILL_OPTIONS: Record<Skill, Outcome[]> = {
  saque: ['neutra','ace','error'],
  recepción: ['perfecta','positiva','negativa','error'],
  colocación: ['positiva','neutra','error'],
  ataque: ['ganadora','positiva','neutra','error'],
  bloqueo: ['ganadora','positiva','neutra','error'],
  defensa: ['positiva','neutra','error'],
  punto: ['ganadora']
};
export const OUTCOME_LABELS: Record<Outcome,string> = {
  neutra:'Continuidad', positiva:'Positiva (+)', perfecta:'Perfecta (#)', negativa:'Negativa (-)',
  error:'Error (=)', ace:'Ace', ganadora:'Ganadora (#)'
};
export const POSITIONS: Position[] = ['Colocador','Opuesto','Receptor','Central','Líbero','Sin definir'];
export const initialMatch: MatchData = {
  version:2, title:'CV Getafe Verde vs ADC San Fermín',
  teams:{ A:'CV Getafe Verde', B:'ADC San Fermín' },
  rosters:{ A:[], B:[] },
  youtubeId:null, events:[]
};
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (parts.length > 1 && (nums.at(-1)! >= 60 || (parts.length === 3 && nums[1] >= 60))) return null;
  return parts.length === 3 ? nums[0]*3600 + nums[1]*60 + nums[2] : parts.length === 2 ? nums[0]*60 + nums[1] : nums[0];
}
export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const domain = hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
    let id = '';
    if (hostname === 'youtu.be' || hostname === 'www.youtu.be') id = url.pathname.split('/')[1] || '';
    else if (domain) {
      if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
      else if (/^\/(live|shorts|embed)\//.test(url.pathname)) id = url.pathname.split('/')[2] || '';
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
export function sanitizeImport(value: unknown): MatchData {
  if (!value || typeof value !== 'object') throw new Error('Formato de archivo no válido.');
  const v = value as Record<string,unknown>;
  if (![1,2].includes(Number(v.version)) || typeof v.title !== 'string' || !v.teams || typeof v.teams !== 'object' || !Array.isArray(v.events)) {
    throw new Error('Este archivo no parece una sesión compatible de VB Stats.');
  }
  const t = v.teams as Record<string,unknown>;
  if (typeof t.A !== 'string' || typeof t.B !== 'string') throw new Error('Los equipos del archivo no son válidos.');
  const events: MatchEvent[] = v.events.map((raw:unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Hay eventos inválidos.');
    const e = raw as Record<string,unknown>;
    if (typeof e.id !== 'string' || !e.id || typeof e.second !== 'number' || !Number.isFinite(e.second) || e.second < 0 ||
      typeof e.set !== 'number' || !Number.isInteger(e.set) || e.set<1 || e.set>100 || typeof e.rally !== 'number' || !Number.isInteger(e.rally) || e.rally<1 ||
      (e.rally as number)>1000 || !['A','B'].includes(String(e.team)) || typeof e.jersey !== 'string' ||
      !Object.keys(SKILL_OPTIONS).includes(String(e.skill)) || !SKILL_OPTIONS[e.skill as Skill].includes(e.outcome as Outcome)) {
      throw new Error('El archivo contiene acciones o resultados no válidos.');
    }
    return {id:e.id,second:e.second as number,set:e.set as number,rally:e.rally as number,
      team:e.team as Team,jersey:(e.jersey as string).slice(0,8),skill:e.skill as Skill,outcome:e.outcome as Outcome,
      note:typeof e.note==='string'?e.note.slice(0,350):''};
  });
  const eventIds = new Set<string>();
  for(const event of events){
    if(eventIds.has(event.id))throw new Error('El archivo incluye IDs de acciones duplicados.');
    eventIds.add(event.id);
  }
  const scoreKeys = new Set<string>();
  for(const e of events) if(e.skill==='punto'&&e.outcome==='ganadora') {
    const k=`${e.set}:${e.rally}`;
    if(scoreKeys.has(k)) throw new Error(`El punto ${e.rally} del set ${e.set} tiene varios ganadores.`);
    scoreKeys.add(k);
  }
  const parseRoster=(team:Team):RosterPlayer[] => {
    const source = v.rosters && typeof v.rosters==='object' ? (v.rosters as Record<string,unknown>)[team] : [];
    if(!Array.isArray(source)) return [];
    const used=new Set<string>();
    return source.filter((p):p is Record<string,unknown>=>!!p&&typeof p==='object'&&typeof p.jersey==='string'&&/^\d{1,3}$/.test(p.jersey)).map(p=>({
      jersey:String(p.jersey),name:typeof p.name==='string'?p.name.slice(0,80):'',
      position:POSITIONS.includes(p.position as Position)?p.position as Position:'Sin definir'
    })).filter(p=>{if(used.has(p.jersey))return false;used.add(p.jersey);return true;});
  };
  let analysisReview:AnalysisReview|undefined;
  if(v.analysisReview && typeof v.analysisReview==='object'){
    const ar=v.analysisReview as Record<string,unknown>;
    if(typeof ar.sourceName==='string' && Array.isArray(ar.proposals)){
      const unique=new Set<string>();
      const proposals:DetectionSuggestion[]=[];
      for(const item of ar.proposals.slice(0,2500)){
        if(!item || typeof item!=='object')continue;
        const c=item as Record<string,unknown>;
        if(typeof c.id!=='string'||c.id.length>100||unique.has(c.id) ||
          !['contact_candidate','rally_pause_candidate'].includes(String(c.kind)) ||
          typeof c.second!=='number'||!Number.isFinite(c.second)||c.second<0||c.second>86400 ||
          typeof c.confidence!=='number'||!Number.isFinite(c.confidence)||c.confidence<0||c.confidence>1 ||
          !['pending','accepted','rejected'].includes(String(c.status)))continue;
        unique.add(c.id);
        const hint = c.teamHint==='A'||c.teamHint==='B'?c.teamHint:null;
        const evidence=c.evidence&&typeof c.evidence==='object'?c.evidence as DetectionSuggestion['evidence']:undefined;
        proposals.push({id:c.id,kind:c.kind as DetectionSuggestion['kind'],second:c.second,confidence:c.confidence,
          teamHint:hint,trackId:typeof c.trackId==='number'&&Number.isInteger(c.trackId)?c.trackId:null,
          reason:typeof c.reason==='string'?c.reason.slice(0,240):'Revisar en vídeo',
          status:c.status as SuggestionStatus,evidence});
      }
      analysisReview={sourceName:ar.sourceName.slice(0,160),analyzedAt:typeof ar.analyzedAt==='string'?ar.analyzedAt.slice(0,40):'',proposals};
    }
  }
  return {version:2,title:v.title.slice(0,140),teams:{A:t.A.slice(0,80),B:t.B.slice(0,80)},
    rosters:{A:parseRoster('A'),B:parseRoster('B')},youtubeId:typeof v.youtubeId==='string'&&parseYouTubeId(v.youtubeId)?v.youtubeId:null,events,analysisReview,autoAnalysis:sanitizeAuto(v.autoAnalysis)};
}
export function setScore(events:MatchEvent[],set:number){
  const winners=new Map<number,Team>();
  for(const e of events) if(e.set===set&&e.skill==='punto'&&e.outcome==='ganadora'&&!winners.has(e.rally)) winners.set(e.rally,e.team);
  const values=[...winners.values()];
  return {A:values.filter(x=>x==='A').length,B:values.filter(x=>x==='B').length,total:values.length};
}
export function scoreboard(events:MatchEvent[]) {
  const sets = Array.from(new Set(events.map(e=>e.set))).sort((a,b)=>a-b);
  return (sets.length?sets:[1]).map(n=>({set:n,...setScore(events,n)}));
}
export function nextRally(events:MatchEvent[],set:number){
  const winners=events.filter(e=>e.set===set&&e.skill==='punto');
  const max=Math.max(0,...events.filter(e=>e.set===set).map(e=>e.rally));
  if(!max)return 1;
  return winners.some(e=>e.rally===max)?max+1:max;
}
export function teamStats(events:MatchEvent[],team:Team,jersey?:string,set?:number){
  const filtered=events.filter(e=>e.team===team&&(!jersey||e.jersey===jersey)&&(!set||e.set===set));
  const count=(skill:Skill,outcome?:Outcome)=>filtered.filter(e=>e.skill===skill&&(!outcome||e.outcome===outcome)).length;
  const receptions=count('recepción'),attacks=count('ataque');
  const positiveRecep=count('recepción','positiva')+count('recepción','perfecta');
  const attackKills=count('ataque','ganadora');
  return {
    actions:filtered.filter(e=>e.skill!=='punto').length, serves:count('saque'),aces:count('saque','ace'),serveErrors:count('saque','error'),
    receptions,positiveRecep,perfectRecep:count('recepción','perfecta'),receptionErrors:count('recepción','error'),
    positiveRecepPercent:receptions?Math.round(100*positiveRecep/receptions):null,
    perfectRecepPercent:receptions?Math.round(100*count('recepción','perfecta')/receptions):null,
    attacks,attackKills,attackErrors:count('ataque','error'),attackKillPercent:attacks?Math.round(100*attackKills/attacks):null,
    blocks:count('bloqueo','ganadora'),digs:count('defensa'),settingErrors:count('colocación','error'),
    recordedPoints:count('punto','ganadora'),
    winningActions:count('saque','ace')+attackKills+count('bloqueo','ganadora')
  };
}
export function playersFromEvents(match:MatchData,team:Team){
  const all=new Map<string,RosterPlayer>();
  match.rosters[team].forEach(p=>all.set(p.jersey,p));
  match.events.filter(e=>e.team===team&&e.jersey).forEach(e=>{
    if(!all.has(e.jersey)) all.set(e.jersey,{jersey:e.jersey,name:'',position:'Sin definir'});
  });
  return [...all.values()].sort((a,b)=>Number(a.jersey)-Number(b.jersey));
}
export function exportCSV(events:MatchEvent[],teams:Record<Team,string>){
  const q=(value:string|number)=>{
    const raw=String(value);
    // Excel can execute formulas even in quoted CSV cells. Escape untrusted strings.
    const safe=typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(raw)?`'${raw}`:raw;
    return `"${safe.replaceAll('\"','\"\"')}"`;
  };
  return [['segundos','set','punto','equipo','dorsal','accion','resultado','nota'],...events.map(e=>[
    e.second,e.set,e.rally,teams[e.team],e.jersey,e.skill,e.outcome,e.note||''
  ])].map(row=>row.map(q).join(';')).join('\r\n');
}
export function progress(events:MatchEvent[]){
  const rallies=new Set(events.map(e=>`${e.set}:${e.rally}`));
  const closed=new Set(events.filter(e=>e.skill==='punto'&&e.outcome==='ganadora').map(e=>`${e.set}:${e.rally}`));
  return {rallies:rallies.size,closed:closed.size,actions:events.filter(e=>e.skill!=='punto').length};
}
