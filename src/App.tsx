import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, Clock3, CloudOff, Command, CornerDownLeft, Download,
  FileJson, FileSpreadsheet, FileUp, Flag, Info, Keyboard, Layers3, Link2,
  ListFilter, Maximize2, Minus, MoreHorizontal, Pause, Pencil, Play, Plus, RotateCcw,
  Save, Search, Settings2, ShieldCheck, SkipBack, SkipForward, Sparkles, Target,
  Trash2, Undo2, UploadCloud, Users, Video, Volleyball, X
} from 'lucide-react';
import {
  exportCSV,formatTime,initialMatch,nextRally,OUTCOME_LABELS,parseTime,parseYouTubeId,
  playersFromEvents,POSITIONS,progress,sanitizeImport,scoreboard,SKILLS,SKILL_OPTIONS,
  teamStats,type DetectionSuggestion,type MatchData,type MatchEvent,type Outcome,type Position,type Skill,type Team
} from './model';
import {attackEfficiency,exportPlayerCSV,exportReviewCSV,rallySummaries,reviewIssues,sessionQuality} from './analysis';
import {YouTubeStage,type YouTubePlayerHandle} from './youtube';
import {DetectionPanel} from './DetectionPanel';
import {AutoStudio} from './AutoStudio';
import {hasAutomaticReport,hasManualReport} from './reportState';

const STORAGE='vb-stats-v2';
type Source = {kind:'none'} | {kind:'file', url:string, name:string} | {kind:'youtube',id:string};
type View = 'timeline' | 'compare' | 'players' | 'review';
const MAX_IMPORT_BYTES=8*1024*1024;
const stamp=(file:string,text:string,mime='application/json')=>{
  const url=URL.createObjectURL(new Blob([text],{type:`${mime};charset=utf-8`}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=file;document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const safeInitial=():MatchData=>{
  try {
    const raw=localStorage.getItem(STORAGE)||localStorage.getItem('vb-stats-v1');
    return raw?sanitizeImport(JSON.parse(raw)):initialMatch;
  }catch{return initialMatch;}
};
const initials=(s:string)=>s.trim().split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('')||'VB';
const statCaption=(value:number|null)=>value===null?'—':`${value}%`;
const formatSkill=(skill:Skill)=>skill[0].toUpperCase()+skill.slice(1);
const SHORTCUTS=[['Espacio','Reproducir / pausar'],['J / L','Retroceder / avanzar 5 s'],['1–6','Seleccionar acción'],['A / B','Cerrar punto para un equipo'],['Ctrl + Z','Deshacer última anotación']];

function AppIcon(){return <div className="app-emblem"><Volleyball size={24} strokeWidth={1.8}/><span className="emblem-trace"/></div>}
function Pill({children,variant='neutral'}:{children:ReactNode;variant?:'neutral'|'green'|'amber'|'red'}){
  return <span className={`pill pill-${variant}`}>{children}</span>;
}
function TeamShield({team,label,size='normal'}:{team:Team;label:string;size?:'normal'|'large'}){
  return <div className={`team-shield shield-${team} ${size==='large'?'team-shield-lg':''}`} aria-hidden="true">{initials(label)}</div>;
}
function StatTile({value,label,muted=false}:{value:string|number;label:string;muted?:boolean}){
  return <div className="stat-tile"><span className={`stat-value ${muted?'stat-value-muted':''}`}>{value}</span><span className="stat-label">{label}</span></div>;
}
function VideoEmpty({onSelect,onYouTube}:{onSelect:()=>void;onYouTube:()=>void}){
  return <div className="video-empty">
    <div className="court-art" aria-hidden="true">
      <div className="court-line line-left"/><div className="court-line line-right"/><div className="court-mid"/>
      <div className="court-circle c1"/><div className="court-circle c2"/><div className="court-circle c3"/>
      <div className="court-ball"><Volleyball size={28}/></div>
    </div>
    <div className="empty-media-content"><div className="eyebrow text-lime">PREPARADO PARA ANALIZAR</div>
      <h3>Tu vídeo. Cada detalle.</h3><p>Pega un enlace de YouTube o añade un MP4. La IA analizará el partido y propondrá las acciones automáticamente.</p>
      <div className="video-empty-actions"><button className="btn btn-lime" onClick={onSelect}><FileUp size={16}/> Importar vídeo</button><button className="btn btn-ghost-on-dark" onClick={onYouTube}><Link2 size={16}/> Pegar YouTube</button></div>
    </div>
  </div>;
}

export function App(){
  const [match,setMatch]=useState<MatchData>(safeInitial);
  const [source,setSource]=useState<Source>(()=>{const id=safeInitial().youtubeId;return id?{kind:'youtube',id}:{kind:'none'};});
  const [view,setView]=useState<View>('timeline');
  const [showGuide,setShowGuide]=useState(false);
  const [showManual,setShowManual]=useState(false);
  const [searchText,setSearchText]=useState('');
  const [visibleEvents,setVisibleEvents]=useState(80);
  const [insightSet,setInsightSet]=useState<number|'all'>('all');
  const [setNum,setSetNum]=useState(1);
  const [rally,setRally]=useState(()=>nextRally(safeInitial().events,1));
  const [team,setTeam]=useState<Team>('A');
  const [jersey,setJersey]=useState('');
  const [skill,setSkill]=useState<Skill>('recepción');
  const [outcome,setOutcome]=useState<Outcome>('perfecta');
  const [note,setNote]=useState('');
  const [editingId,setEditingId]=useState<string|null>(null);
  const [lastRemoved,setLastRemoved]=useState<{event:MatchEvent;index:number}|null>(null);
  const [selectedPlayer,setSelectedPlayer]=useState({team:'A' as Team,jersey:''});
  const [currentSec,setCurrentSec]=useState(0);
  const [manualTiming,setManualTiming]=useState(()=>!safeInitial().youtubeId);
  const [manualTime,setManualTime]=useState('00:00');
  const [videoError,setVideoError]=useState('');
  const [youtubeText,setYoutubeText]=useState('');
  const [showUrlModal,setShowUrlModal]=useState(false);
  const [showHelp,setShowHelp]=useState(false);
  const [showSettings,setShowSettings]=useState(false);
  const [feedback,setFeedback]=useState<{message:string;kind:'success'|'error'|'info'}|null>(null);
  const [filterTeam,setFilterTeam]=useState<'all'|Team>('all');
  const [filterSkill,setFilterSkill]=useState<'all'|Skill>('all');
  const [filterSet,setFilterSet]=useState<number|'all'>('all');
  const [rosterTeam,setRosterTeam]=useState<Team>('A');
  const [playerNumber,setPlayerNumber]=useState('');
  const [playerName,setPlayerName]=useState('');
  const [playerPosition,setPlayerPosition]=useState<Position>('Sin definir');
  const [storageError,setStorageError]=useState(false);
  const [analysisFile,setAnalysisFile]=useState<File|null>(null);
  const localRef=useRef<HTMLVideoElement>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  const importRef=useRef<HTMLInputElement>(null);
  const youtubeRef=useRef<YouTubePlayerHandle|null>(null);
  const urlRef=useRef<string|null>(null);
  const currentSecondRef=useRef(0);
  const toastTimer=useRef<number|undefined>(undefined);

  useEffect(()=>{
    try{localStorage.setItem(STORAGE,JSON.stringify(match));setStorageError(false)}catch{setStorageError(true)}
  },[match]);
  useEffect(()=>()=>{if(urlRef.current)URL.revokeObjectURL(urlRef.current);if(toastTimer.current)clearTimeout(toastTimer.current)},[]);
  function notify(message:string,kind:'success'|'error'|'info'='success') {
    setFeedback({message,kind});if(toastTimer.current)clearTimeout(toastTimer.current);
    toastTimer.current=window.setTimeout(()=>setFeedback(null),4200);
  }
  const onCurrentTime=(seconds:number)=>{
    if(!Number.isFinite(seconds))return;
    currentSecondRef.current=seconds;
    setCurrentSec(prev=>Math.floor(prev)===Math.floor(seconds)?prev:seconds);
  };
  const update=(updater:(v:MatchData)=>MatchData)=>setMatch(prev=>updater(prev));
  const listedEvents=useMemo(()=>[...match.events].sort((a,b)=>a.second-b.second),[match.events]);
  const statsA=useMemo(()=>teamStats(match.events,'A',undefined,insightSet==='all'?undefined:insightSet),[match.events,insightSet]);
  const statsB=useMemo(()=>teamStats(match.events,'B',undefined,insightSet==='all'?undefined:insightSet),[match.events,insightSet]);
  const playerStats=useMemo(()=>teamStats(match.events,selectedPlayer.team,selectedPlayer.jersey||'__none__',insightSet==='all'?undefined:insightSet),[match.events,selectedPlayer,insightSet]);
  const playerEfficiency=useMemo(()=>attackEfficiency(match.events,selectedPlayer.team,selectedPlayer.jersey||'__none__',insightSet==='all'?undefined:insightSet),[match.events,selectedPlayer,insightSet]);
  const quality=useMemo(()=>sessionQuality(match),[match]);
  const reviews=useMemo(()=>reviewIssues(match),[match]);
  const rallies=useMemo(()=>rallySummaries(match.events),[match.events]);
  const currentRally=useMemo(()=>rallies.find(r=>r.set===setNum&&r.rally===rally),[rallies,setNum,rally]);
  const scoreboardData=useMemo(()=>scoreboard(match.events),[match.events]);
  const setStats=useMemo(()=>scoreboardData.find(s=>s.set===setNum)||{set:setNum,A:0,B:0,total:0},[scoreboardData,setNum]);
  const total=useMemo(()=>progress(match.events),[match.events]);
  const allPlayers=useMemo(()=>({A:playersFromEvents(match,'A'),B:playersFromEvents(match,'B')}),[match]);
  const filteredEvents=useMemo(()=>listedEvents.filter(e=>(filterTeam==='all'||e.team===filterTeam)&&
    (filterSkill==='all'||e.skill===filterSkill)&&(filterSet==='all'||e.set===filterSet)&&
    (!searchText.trim()||[match.teams[e.team],e.jersey,e.note||'',e.skill,String(e.rally)].join(' ').toLocaleLowerCase('es').includes(searchText.trim().toLocaleLowerCase('es')))).reverse(),[listedEvents,filterTeam,filterSkill,filterSet,searchText,match.teams]);
  const recordedSets=Array.from(new Set([setNum,...match.events.map(e=>e.set)])).sort((a,b)=>a-b);
  useEffect(()=>{setVisibleEvents(80)},[filterTeam,filterSkill,filterSet,searchText]);

  function setVideoSource(next:Source) {
    if(urlRef.current){URL.revokeObjectURL(urlRef.current);urlRef.current=null;}
    if(next.kind==='file')urlRef.current=next.url;
    setSource(next);setVideoError('');onCurrentTime(0);setManualTiming(next.kind==='none');
  }
  function handleVideoFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(!file.type.startsWith('video/')&&!/\.(mp4|m4v|webm|mov|ogg)$/i.test(file.name)){
      notify('Elige un vídeo MP4, MOV o WebM compatible.','error');return;
    }
    const url=URL.createObjectURL(file);
    setAnalysisFile(file);
    setVideoSource({kind:'file',url,name:file.name});
    update(m=>({...m,youtubeId:null,analysisReview:undefined,autoAnalysis:undefined}));notify(`Vídeo cargado: ${file.name}`);
  }
  function handleYouTube(event:FormEvent){
    event.preventDefault();const id=parseYouTubeId(youtubeText);
    if(!id){notify('Introduce un enlace válido de YouTube.','error');return;}
    setAnalysisFile(null);setVideoSource({kind:'youtube',id});update(m=>({...m,youtubeId:id,analysisReview:undefined,autoAnalysis:undefined}));
    setShowUrlModal(false);setYoutubeText('');notify('Vídeo de YouTube vinculado.');
  }
  function seek(second:number){
    const next=Math.max(0,second);
    if(source.kind==='file'&&localRef.current)localRef.current.currentTime=next;
    if(source.kind==='youtube')youtubeRef.current?.seekTo(next,true);
    onCurrentTime(next);setManualTime(formatTime(next));
  }
  function move(seconds:number){seek(currentSecondRef.current+seconds)}
  function togglePlay(){
    if(source.kind==='file'&&localRef.current){if(localRef.current.paused)localRef.current.play().catch(()=>notify('No se pudo reproducir el vídeo.','error'));else localRef.current.pause()}
    if(source.kind==='youtube'&&youtubeRef.current){
      try{if(youtubeRef.current.getPlayerState()===1)youtubeRef.current.pauseVideo();else youtubeRef.current.playVideo();}catch{notify('El reproductor aún no está listo.','info')}
    }
  }
  function getSecond(){
    if(!manualTiming&&source.kind!=='none')return Math.max(0,Number(currentSecondRef.current.toFixed(2)));
    return parseTime(manualTime);
  }
  function addOrSaveAction(){
    const second=getSecond();if(second===null){notify('Introduce un tiempo válido: mm:ss o hh:mm:ss.','error');return;}
    if(!Number.isInteger(setNum)||!Number.isInteger(rally)||setNum<1||rally<1){notify('El set y el número de punto deben ser válidos.','error');return;}
    if(jersey.trim()&&!/^\d{1,3}$/.test(jersey.trim())){notify('El dorsal debe ser numérico (1 a 3 cifras).','error');return;}
    if(!editingId&&match.events.some(v=>v.skill==='punto'&&v.set===setNum&&v.rally===rally)){
      notify('Este rally ya está cerrado. Selecciona el siguiente o edita una acción anterior.','error');return;
    }
    const e:MatchEvent={id:editingId||crypto.randomUUID(),second,set:setNum,rally,team,jersey:jersey.trim(),skill,outcome,note:note.trim()};
    if(e.skill==='punto'&&match.events.some(v=>v.id!==editingId&&v.skill==='punto'&&v.set===e.set&&v.rally===e.rally)){
      notify('Ese punto ya tiene ganador. Corrígelo desde la cronología.','error');return;
    }
    update(m=>({...m,events:editingId?m.events.map(v=>v.id===editingId?e:v):[...m.events,e]}));
    notify(editingId?'Anotación actualizada.':'Acción registrada.');
    setEditingId(null);setNote('');
    if(skill==='punto'&&!editingId)setRally(r=>r+1);
  }
  function awardPoint(winner:Team){
    if(match.events.some(e=>e.set===setNum&&e.rally===rally&&e.skill==='punto')){
      notify('Este rally ya está cerrado. Corrige el ganador en la cronología.','error');return;
    }
    const second=getSecond();if(second===null){notify('Corrige primero el tiempo manual.','error');return;}
    const e:MatchEvent={id:crypto.randomUUID(),second,set:setNum,rally,team:winner,jersey:'',skill:'punto',outcome:'ganadora',note:''};
    update(m=>({...m,events:[...m.events,e]}));setRally(r=>r+1);notify(`Punto ${rally}: ${match.teams[winner]}`);
  }
  function changeWinner(e:MatchEvent){
    const newTeam:Team=e.team==='A'?'B':'A';
    update(m=>({...m,events:m.events.map(x=>x.id===e.id?{...x,team:newTeam}:x)}));
    notify(`Ganador corregido: ${match.teams[newTeam]}`);
  }
  const revertProposals=(m:MatchData,deleted:MatchEvent[])=>{
    const ids=deleted.map(e=>e.note?.match(/\[IA:([^\]]+)\]/)?.[1]).filter((x):x is string=>!!x);
    return !m.analysisReview||!ids.length?m.analysisReview:{...m.analysisReview,
      proposals:m.analysisReview.proposals.map(p=>ids.includes(p.id)?{...p,status:'pending' as const}:p)};
  };
  function removeEvent(id:string){
    const index=match.events.findIndex(e=>e.id===id);
    if(index<0)return;
    setLastRemoved({event:match.events[index],index});
    update(m=>({...m,events:m.events.filter(e=>e.id!==id),analysisReview:revertProposals(m,[match.events[index]])}));
    notify('Acción eliminada.','info');
  }
  function restoreRemoved(){
    if(!lastRemoved)return;
    const {event,index}=lastRemoved;
    update(m=>({...m,events:m.events.some(e=>e.id===event.id)?m.events:[...m.events.slice(0,index),event,...m.events.slice(index)],
      analysisReview:m.analysisReview?{...m.analysisReview,proposals:m.analysisReview.proposals.map(p=>
        event.note?.includes(`[IA:${p.id}]`)?{...p,status:'accepted' as const}:p)}:undefined}));
    setLastRemoved(null);notify('Acción restaurada.');
  }
  function undoLast(){
    if(!match.events.length)return;
    const latest=match.events[match.events.length-1];
    update(m=>({...m,events:m.events.slice(0,-1),analysisReview:revertProposals(m,[latest])}));
    if(latest.skill==='punto'&&latest.set===setNum)setRally(latest.rally);
    notify('Última acción deshecha.','info');
  }
  function startEdit(e:MatchEvent){
    setEditingId(e.id);setSetNum(e.set);setRally(e.rally);setTeam(e.team);setJersey(e.jersey);
    setSkill(e.skill);setOutcome(e.outcome);setNote(e.note||'');setManualTiming(true);setManualTime(formatTime(e.second));
    document.getElementById('annotation')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function cancelEdit(){setEditingId(null);setNote('');setManualTiming(source.kind==='none');setSkill('recepción');setOutcome('perfecta')}
  function selectSet(n:number){setSetNum(n);setRally(nextRally(match.events,n));setEditingId(null)}
  function selectTeam(t:Team){setTeam(t);setJersey(allPlayers[t][0]?.jersey||'')}
  function selectSkill(s:Skill){setSkill(s);setOutcome(SKILL_OPTIONS[s][0])}
  function addPlayer(e:FormEvent){
    e.preventDefault();const number=playerNumber.trim();
    if(!/^\d{1,3}$/.test(number)){notify('Introduce un dorsal de 1 a 3 cifras.','error');return;}
    const has=match.rosters[rosterTeam].some(p=>p.jersey===number);
    if(has){notify('Ese dorsal ya está en la plantilla.','error');return;}
    update(m=>({...m,rosters:{...m.rosters,[rosterTeam]:[...m.rosters[rosterTeam],{jersey:number,name:playerName.trim().slice(0,80),position:playerPosition}]}}));
    setPlayerName('');setPlayerNumber('');setPlayerPosition('Sin definir');notify('Jugador añadido a la plantilla.');
  }
  function removePlayer(t:Team,n:string){
    update(m=>({...m,rosters:{...m.rosters,[t]:m.rosters[t].filter(p=>p.jersey!==n)}}));
    notify('Jugador quitado de la plantilla; sus acciones registradas se conservan.','info');
  }
  function updatePlayer(t:Team,n:string,changes:Partial<{name:string;position:Position}>){
    update(m=>({...m,rosters:{...m.rosters,[t]:m.rosters[t].map(p=>p.jersey===n?{...p,...changes}:p)}}));
  }
  function exportJSON(){if(!hasSessionData){notify('Aún no hay un análisis o anotaciones para guardar.','info');return;}stamp('vb-stats-sesion.json',JSON.stringify(match,null,2));notify('Sesión JSON descargada.');}
  function exportExcel(){if(!manualReportReady){notify('Aún no hay acciones manuales que exportar.','info');return;}stamp('vb-stats-acciones.csv','\uFEFF'+exportCSV(match.events,match.teams),'text/csv');notify('Acciones CSV descargadas.');}
  function exportPlayers(){if(!manualReportReady){notify('Aún no hay acciones manuales que exportar.','info');return;}stamp('vb-stats-jugadores.csv','\uFEFF'+exportPlayerCSV(match,insightSet==='all'?undefined:insightSet),'text/csv');notify('Informe por jugador exportado.');}
  function exportReviewed(){stamp('vb-stats-dataset-revisado.csv','\uFEFF'+exportReviewCSV(match),'text/csv');notify('Dataset de propuestas revisadas descargado.');}
  function reviewRally(set:number,rallyNumber:number,second:number){
    setSetNum(set);setRally(rallyNumber);setEditingId(null);setView('timeline');seek(second);
    document.getElementById('annotation')?.scrollIntoView({behavior:'smooth',block:'start'});
    notify(`Revisando set ${set}, rally ${rallyNumber}.`,'info');
  }
  async function importJSON(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(file.size>MAX_IMPORT_BYTES){notify('El archivo JSON supera el tamaño permitido (8 MB).','error');return;}
    try {
      const next=sanitizeImport(JSON.parse(await file.text()));
      setMatch(next);setAnalysisFile(null);setVideoSource(next.youtubeId?{kind:'youtube',id:next.youtubeId}:{kind:'none'});
      setSetNum(1);setRally(nextRally(next.events,1));setEditingId(null);setSelectedPlayer({team:'A',jersey:next.rosters.A[0]?.jersey||''});setShowGuide(next.events.length===0);notify('Sesión restaurada correctamente.');
    }catch(e){notify(e instanceof Error?e.message:'No se pudo importar el archivo.','error')}
  }
  function importCandidates(proposals:DetectionSuggestion[],sourceName:string){
    update(m=>({...m,analysisReview:{sourceName,analyzedAt:new Date().toISOString(),proposals:[
      ...(m.analysisReview?.sourceName===sourceName?m.analysisReview.proposals:[]),...proposals
    ].slice(-2500)}}));
  }
  function decideCandidate(id:string,status:'accepted'|'rejected'|'pending'){
    update(m=>({...m,analysisReview:m.analysisReview?{...m.analysisReview,
      proposals:m.analysisReview.proposals.map(p=>p.id===id?{...p,status}:p)}:undefined}));
  }
  function confirmCandidate(suggestion:DetectionSuggestion,detectedTeam:Team,detectedJersey:string,detectedSkill:Skill,detectedOutcome:Outcome):boolean{
    if(match.events.some(e=>e.skill==='punto'&&e.set===setNum&&e.rally===rally)){
      notify('El rally actual ya está cerrado. Selecciona un punto abierto antes de confirmar.','error');return false;
    }
    if(suggestion.status!=='pending'||suggestion.kind!=='contact_candidate')return false;
    if(match.events.some(e=>e.note?.includes(`[IA:${suggestion.id}]`))){
      notify('Esta propuesta ya se había incorporado a las acciones.','error');return false;
    }
    const next:MatchEvent={id:crypto.randomUUID(),second:suggestion.second,set:setNum,rally,team:detectedTeam,
      jersey:detectedJersey,skill:detectedSkill,outcome:detectedOutcome,
      note:`Confirmado en vídeo [IA:${suggestion.id}] · ${suggestion.reason}`.slice(0,350)};
    update(m=>({...m,events:[...m.events,next]}));
    notify(`Propuesta confirmada: ${detectedSkill} · set ${setNum}, punto ${rally}`);
    return true;
  }
  function resetEvents(){
    if(!window.confirm('¿Eliminar todas las anotaciones de este partido? Descarga un JSON antes si quieres conservarlas.'))return;
    update(m=>({...m,events:[],analysisReview:m.analysisReview?{...m.analysisReview,proposals:m.analysisReview.proposals.map(p=>({...p,status:'pending' as const}))}:undefined}));setRally(1);setSetNum(1);notify('Anotaciones borradas.','info');
  }
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement|null;
      if(target?.closest('input,select,textarea,button,[contenteditable=true]')||showHelp||showUrlModal||showSettings)return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undoLast();return;}
      if(e.ctrlKey||e.metaKey||e.altKey)return;
      const k=e.key.toLowerCase();
      if(k===' '){e.preventDefault();togglePlay()}
      else if(k==='j'){e.preventDefault();move(-5)}
      else if(k==='k'){e.preventDefault();togglePlay()}
      else if(k==='l'){e.preventDefault();move(5)}
      else if(k==='a'){e.preventDefault();awardPoint('A')}
      else if(k==='b'){e.preventDefault();awardPoint('B')}
      else if('123456'.includes(k)&&k.length===1){selectSkill(SKILLS[Number(k)-1]);}
      else if(k==='?'){setShowHelp(true)}
    };
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  });

  const actionName=(e:MatchEvent)=>e.skill==='punto'?'Punto para '+match.teams[e.team]:`${formatSkill(e.skill)} · ${OUTCOME_LABELS[e.outcome]}`;
  const teamMetrics:[string,keyof ReturnType<typeof teamStats>][]=[
    ['Aces','aces'],['Errores de saque','serveErrors'],['Recepciones','receptions'],['Recepción positiva','positiveRecep'],
    ['Recepción perfecta','perfectRecep'],['Errores de recepción','receptionErrors'],['Ataques','attacks'],
    ['Ataques ganadores','attackKills'],['Errores de ataque','attackErrors'],['Bloqueos punto','blocks'],['Defensas','digs']
  ];
  const videoLoaded=source.kind!=='none';
  const automaticReportReady=hasAutomaticReport(match.autoAnalysis);
  const manualReportReady=hasManualReport(match.events);
  const hasSessionData=automaticReportReady||manualReportReady;
  const hasReviewedPoints=match.events.some(event=>event.skill==='punto');
  const guidedSteps=[
    {label:'Seleccionar partido',detail:videoLoaded?'Vídeo vinculado':'Pega YouTube o selecciona un MP4',done:videoLoaded,action:()=>document.getElementById('automatic')?.scrollIntoView({behavior:'smooth'})},
    {label:'Analizar automáticamente',detail:automaticReportReady?'Informe disponible': 'La IA detectará contactos y dorsales sin introducir la plantilla',done:automaticReportReady,action:()=>document.getElementById('automatic')?.scrollIntoView({behavior:'smooth'})},
    {label:'Consultar y corregir',detail:automaticReportReady?'Explora el informe y revisa solo lo dudoso':'Se habilita cuando termine el análisis',done:automaticReportReady,action:()=>document.getElementById('automatic')?.scrollIntoView({behavior:'smooth'})}
  ];

  return <div className="app">
    <header className="topbar" id="home">
      <div className="topbar-inner">
        <a href="#home" className="identity" aria-label="VB Stats, inicio"><AppIcon/><div className="brand-lockup"><span className="brand-name">VB<span>STATS</span><span className="brand-period">.</span></span><span className="brand-caption">VOLLEYBALL INTELLIGENCE</span></div></a>
        <nav className="top-nav" aria-label="Navegación principal">
          <a className="nav-link nav-active" href="#studio"><Activity size={16}/> Estudio</a>
          <a className="nav-link" href="#automatic"><BarChart3 size={16}/> Estadísticas</a>
          <a className="nav-link" href="#automatic"><Users size={16}/> Jugadores</a>
        </nav>
        <div className="header-actions">
          <Pill variant="green"><span className="status-dot"/> IA + corrección opcional</Pill>
          <button className="icon-button" title="Atajos de teclado" aria-label="Atajos de teclado" onClick={()=>setShowHelp(true)}><Keyboard size={19}/></button>
          {hasSessionData&&<button className="btn btn-outline header-export" onClick={()=>document.getElementById(automaticReportReady?'automatic':'insights')?.scrollIntoView({behavior:'smooth'})}><BarChart3 size={16}/> Ver resultados</button>}
        </div>
      </div>
    </header>

    <main className="main-shell">
      <section className="hero-section" aria-label="Introducción">
        <div className="hero-copy"><div className="hero-eyebrow"><span className="mini-bar"/> SCOUTING STUDIO <span className="hero-eyebrow-muted">/ VERSIÓN 0.8.1</span></div>
          <h1>El partido, <em>bajo control.</em></h1>
          <p>Deja que la IA analice el partido completo. Consulta los contactos detectados y corrige solo lo que necesites.</p>
        </div>
        <div className="hero-beside"><button className="btn btn-outline" onClick={()=>setShowSettings(true)}><Settings2 size={16}/> Configurar partido</button><button className="btn btn-lime" onClick={()=>document.getElementById('automatic')?.scrollIntoView({behavior:'smooth'})}><Scan size={17}/> Analizar partido</button></div>
      </section>

      <section className={`onboarding ${showGuide?'onboarding-open':''}`} aria-label="Guía de preparación del partido">
        <div className="onboarding-head"><div className="onboarding-title"><span className="onboarding-symbol"><Sparkles size={17}/></span><div><strong>Tu espacio de análisis</strong><span>{hasSessionData ? 'Tienes un informe disponible' : 'Analiza sin registrar dorsales a mano'}</span></div></div>
          <button className="btn btn-text" onClick={()=>setShowGuide(v=>!v)} aria-expanded={showGuide}>{showGuide?'Ocultar guía':'Mostrar guía'} <ChevronDown size={15}/></button>
        </div>
        {showGuide&&<div className="onboarding-steps">{guidedSteps.map((step,i)=><button key={step.label} onClick={step.action} className={`onboarding-step ${step.done?'step-complete':''}`}>
          <span className="step-index">{step.done?<Check size={17}/>:String(i+1).padStart(2,'0')}</span><span><strong>{step.label}</strong><small>{step.detail}</small></span><ChevronRight size={17}/>
        </button>)}</div>}
      </section>

      <div className="matchbar" aria-label="Marcador de anotaciones">
        <div className="matchbar-team"><TeamShield team="A" label={match.teams.A}/><div className="matchbar-team-info"><small>EQUIPO AZUL · A</small><strong title={match.teams.A}>{match.teams.A}</strong></div></div>
        <div className="matchbar-score"><div className="score-numbers"><span>{hasReviewedPoints?setStats.A:'—'}</span><span className="score-divider">:</span><span>{hasReviewedPoints?setStats.B:'—'}</span></div><div className="score-subtitle">{hasReviewedPoints?'PUNTOS CONFIRMADOS · SET '+setNum:'MARCADOR SIN VERIFICAR'}</div></div>
        <div className="matchbar-team matchbar-team-right"><div className="matchbar-team-info"><small>EQUIPO ROJO · B</small><strong title={match.teams.B}>{match.teams.B}</strong></div><TeamShield team="B" label={match.teams.B}/></div>
        <div className="matchbar-footer"><div className="set-chips">{scoreboardData.map(s=><button key={s.set} className={`set-chip ${s.set===setNum?'set-chip-active':''}`} onClick={()=>selectSet(s.set)}>Set {s.set} <b>{s.A}–{s.B}</b></button>)}{!scoreboardData.some(s=>s.set===setNum)&&<span className="set-chip set-chip-active">Set {setNum}</span>}</div><div className="matchbar-fine"><Info size={13}/> El marcador no se calcula con contactos estimados</div></div>
      </div>

      <AutoStudio file={analysisFile} youtube={source.kind==='youtube'} youtubeId={source.kind==='youtube'?source.id:null} teams={match.teams}
        data={match.autoAnalysis} onSelectFile={()=>fileRef.current?.click()}
        onSeek={seek} onSave={data=>update(m=>({...m,autoAnalysis:data}))}/>
      <section className={`studio-grid ${!showManual?'auto-workflow':''}`} id="studio">
        <div className="studio-main">
          <section className="panel video-panel" aria-label="Vídeo del partido">
            <div className="panel-head"><div className="panel-title"><span className="head-icon"><Video size={17}/></span><div><h2>Reproductor del partido</h2><p>{source.kind==='file'?source.name:source.kind==='youtube'?'Vídeo enlazado de YouTube':'Añade una fuente para empezar a analizar'}</p></div></div><div className="video-label"><span className="status-dot"/> {videoLoaded?'VÍDEO VINCULADO':'SIN VÍDEO'}</div></div>
            <div className="video-stage">
              {source.kind==='file'?<video key={source.url} ref={localRef} src={source.url} controls playsInline preload="metadata" onTimeUpdate={e=>onCurrentTime(e.currentTarget.currentTime)} onError={()=>setVideoError('No se pudo reproducir el archivo en este navegador. Prueba MP4 H.264 o WebM.')}/>:null}
              {source.kind==='youtube'?<YouTubeStage key={source.id} id={source.id} playerRef={youtubeRef} onTime={onCurrentTime} onError={setVideoError}/>:null}
              {source.kind==='none'?<VideoEmpty onSelect={()=>fileRef.current?.click()} onYouTube={()=>document.getElementById('automatic')?.scrollIntoView({behavior:'smooth'})}/>:null}
            </div>
            {videoError&&<div className="inline-warning" role="alert"><Info size={16}/>{videoError}</div>}
            <div className="transport"><div className="transport-left"><button className="transport-button" onClick={()=>move(-5)} disabled={!videoLoaded} aria-label="Retroceder 5 segundos"><SkipBack size={17}/><span>5s</span></button><button className="play-button" onClick={togglePlay} disabled={!videoLoaded} aria-label="Reproducir o pausar"><Play size={19} fill="currentColor"/></button><button className="transport-button" onClick={()=>move(5)} disabled={!videoLoaded} aria-label="Avanzar 5 segundos"><span>5s</span><SkipForward size={17}/></button><span className="video-time">{formatTime(currentSec)}</span></div><div className="transport-right"><span className="transport-hint"><Keyboard size={15}/> J · K · L</span><button className="control-link" onClick={()=>setShowUrlModal(true)}><Link2 size={16}/> YouTube</button><button className="control-link" onClick={()=>fileRef.current?.click()}><FileUp size={16}/> Archivo</button></div></div>
            <input ref={fileRef} type="file" accept="video/*,.mp4,.webm,.mov" className="sr-only" onChange={handleVideoFile} aria-label="Elegir archivo de vídeo"/>
            <div className="video-note"><ShieldCheck size={15}/><span>El vídeo se reproduce localmente; solo se copia a la API cuando pulsas Analizar partido completo. Los datos del análisis se guardan en este navegador.</span></div>
            <button className="btn btn-outline manual-toggle" onClick={()=>setShowManual(v=>!v)}><Settings2 size={15}/>{showManual?'Ocultar herramientas de anotación':'Abrir anotación manual (opcional)'}</button>
          </section>

          {showManual&&<DetectionPanel file={analysisFile} hasYouTube={source.kind==='youtube'} review={match.analysisReview}
            currentSecond={currentSec} selectedSet={setNum} selectedRally={rally} match={match}
            onSelectVideo={()=>fileRef.current?.click()} onSeek={seek} onImport={importCandidates}
            onDecision={decideCandidate} onConfirm={confirmCandidate} onExport={exportReviewed}/>}

          {(showManual||Boolean(match.events.length))&&<section className="panel activity-panel" id="workspace">
            <div className="panel-head activity-heading"><div className="panel-title"><span className="head-icon"><Layers3 size={17}/></span><div><h2>Centro de análisis</h2><p>Acciones verificadas, jugadores y estadísticas</p></div></div><span className="count-tag">{total.actions} acciones</span></div>
            <div className="tab-list" role="tablist" aria-label="Vistas del análisis">
              <button role="tab" aria-selected={view==='timeline'} className={`tab ${view==='timeline'?'tab-active':''}`} onClick={()=>setView('timeline')}><Clock3 size={16}/> Cronología <span>{match.events.length}</span></button>
              <button role="tab" aria-selected={view==='compare'} className={`tab ${view==='compare'?'tab-active':''}`} onClick={()=>setView('compare')}><BarChart3 size={16}/> Comparativa</button>
              <button role="tab" aria-selected={view==='players'} className={`tab ${view==='players'?'tab-active':''}`} onClick={()=>setView('players')}><Users size={16}/> Plantillas</button>
              <button role="tab" aria-selected={view==='review'} className={`tab ${view==='review'?'tab-active':''}`} onClick={()=>setView('review')}><ShieldCheck size={16}/> Revisión {reviews.length>0&&<span>{reviews.length}</span>}</button>
            </div>

            {view==='timeline'&&<div className="tab-content">
              <div className="rally-navigation" aria-label="Navegación por puntos"><div className="rally-navigation-heading"><strong>Ir a un punto</strong><span>{rallies.length} rallies anotados</span></div><div className="rally-pills">
                {rallies.slice(-14).reverse().map(r=><button key={`${r.set}:${r.rally}`} onClick={()=>reviewRally(r.set,r.rally,r.second)} className={`rally-pill ${r.complete?'rally-complete':''} ${r.set===setNum&&r.rally===rally?'rally-current':''}`} title={`${r.actions} acciones · ${r.complete?'Cerrado':'Pendiente'}`}><span>S{r.set}</span><strong>{r.rally}</strong><span className={`rally-indicator ${r.complete?'done':''}`}/></button>)}
                {!rallies.length&&<span className="empty-rally-hint">Los puntos aparecerán aquí en cuanto empieces a registrar.</span>}
              </div></div>
              <div className="timeline-tools"><span className="timeline-title">Historial de eventos <small>({filteredEvents.length})</small></span><div className="filter-group">
                <select value={filterSet} aria-label="Filtrar por set" onChange={e=>setFilterSet(e.target.value==='all'?'all':Number(e.target.value))}><option value="all">Todos los sets</option>{recordedSets.map(n=><option value={n} key={n}>Set {n}</option>)}</select>
                <select value={filterTeam} aria-label="Filtrar por equipo" onChange={e=>setFilterTeam(e.target.value as 'all'|Team)}><option value="all">Ambos equipos</option><option value="A">Equipo A</option><option value="B">Equipo B</option></select>
                <select value={filterSkill} aria-label="Filtrar por acción" onChange={e=>setFilterSkill(e.target.value as 'all'|Skill)}><option value="all">Todas las acciones</option>{[...SKILLS,'punto' as Skill].map(s=><option value={s} key={s}>{formatSkill(s)}</option>)}</select>
              </div></div>
              <label className="timeline-search"><Search size={16}/><input type="search" value={searchText} onChange={e=>setSearchText(e.target.value)} placeholder="Buscar dorsal, acción o nota..." aria-label="Buscar en la cronología"/>{searchText&&<button title="Borrar búsqueda" aria-label="Borrar búsqueda" onClick={()=>setSearchText('')}><X size={14}/></button>}</label>
              {filteredEvents.length===0?<div className="empty-state"><div className="empty-ring"><Clock3 size={24}/></div><h3>{match.events.length?'No hay acciones con estos filtros':'Tu cronología empieza aquí'}</h3><p>{match.events.length?'Prueba a cambiar el equipo, el set o el tipo de acción.':'Reproduce una jugada y regístrala. Cada acción aparecerá aquí, con su momento exacto para volver a verla.'}</p></div>:
                <div className="events-list">{filteredEvents.slice(0,visibleEvents).map(e=><div className="event-item" key={e.id}>
                  <button className="event-time" onClick={()=>seek(e.second)} title="Ir a este instante" aria-label={`Ir al minuto ${formatTime(e.second)}`}><Play size={12} fill="currentColor"/> {formatTime(e.second)}</button>
                  <div className={`event-team-indicator event-indicator-${e.team}`}/>
                  <div className="event-detail"><strong>{actionName(e)}</strong><span>Set {e.set} · Punto {e.rally} · {e.jersey?`#${e.jersey} · `:''}{match.teams[e.team]}{e.note?` · ${e.note}`:''}</span></div>
                  <div className="event-actions">{e.skill==='punto'&&<button title="Cambiar equipo ganador" aria-label="Cambiar equipo ganador" onClick={()=>changeWinner(e)}><ArrowLeft size={15}/><ArrowRight size={15}/></button>}
                    <button title="Editar acción" aria-label="Editar acción" onClick={()=>startEdit(e)}><Pencil size={15}/></button><button title="Eliminar acción" aria-label="Eliminar acción" onClick={()=>removeEvent(e.id)}><Trash2 size={15}/></button></div>
                </div>)}</div>}
              {filteredEvents.length>visibleEvents&&<div className="load-more"><button className="btn btn-outline" onClick={()=>setVisibleEvents(v=>v+80)}>Mostrar 80 acciones más <ChevronDown size={16}/></button><small>{visibleEvents} de {filteredEvents.length} acciones mostradas</small></div>}
              <div className="timeline-footer"><span><CheckCircle2 size={14}/> {total.closed} puntos cerrados en {total.rallies} rallies registrados</span><button className="text-button" onClick={undoLast} disabled={!match.events.length}><Undo2 size={15}/> Deshacer última</button></div>
            </div>}

            {view==='compare'&&<div className="tab-content compare-content"><div className="filter-banner"><p className="subtle-caption">Solo acciones registradas. Los puntos deben cerrarse manualmente.</p><label>Periodo <select value={insightSet} onChange={e=>setInsightSet(e.target.value==='all'?'all':Number(e.target.value))}><option value="all">Partido completo</option>{recordedSets.map(n=><option key={n} value={n}>Set {n}</option>)}</select></label></div>
              <div className="compare-heading"><span><span className="tiny-team-color tiny-A"/>{match.teams.A}</span><span><span className="tiny-team-color tiny-B"/>{match.teams.B}</span></div>
              {teamMetrics.map(([label,key])=>{const a=statsA[key] as number;const b=statsB[key] as number;const max=Math.max(a,b,1);return <div className="compare-row" key={key}>
                <span className="compare-count">{a}</span><div className="comparison-bars"><span className="comparison-label">{label}</span><div className="comparison-track"><span className="bar-a" style={{width:`${(a/max)*48}%`}}/><span className="bar-b" style={{width:`${(b/max)*48}%`}}/></div></div><span className="compare-count">{b}</span>
              </div>})}
              <p className="subtle-caption">La recepción positiva incluye recepción perfecta. No se extrapolan acciones no anotadas.</p>
            </div>}

            {view==='players'&&<div className="tab-content roster-content">
              <div className="roster-header"><div><h3>Plantilla y dorsales</h3><p>Asocia un dorsal a cada nombre. Los datos se mantienen aunque edites la plantilla.</p></div><div className="team-switch compact"><button className={rosterTeam==='A'?'selected':''} onClick={()=>setRosterTeam('A')}>Azul</button><button className={rosterTeam==='B'?'selected':''} onClick={()=>setRosterTeam('B')}>Rojo</button></div></div>
              <div className="roster-list">{match.rosters[rosterTeam].length===0&&<p className="empty-roster">Todavía no hay jugadores en esta plantilla. Añade dorsales abajo.</p>}
                {match.rosters[rosterTeam].map(p=><div className="roster-item" key={`${rosterTeam}-${p.jersey}`}><div className={`jersey-avatar avatar-${rosterTeam}`}>{p.jersey}</div>
                  <input aria-label={`Nombre del dorsal ${p.jersey}`} value={p.name} placeholder="Nombre del jugador" onChange={e=>updatePlayer(rosterTeam,p.jersey,{name:e.target.value})}/>
                  <select aria-label={`Posición del dorsal ${p.jersey}`} value={p.position} onChange={e=>updatePlayer(rosterTeam,p.jersey,{position:e.target.value as Position})}>{POSITIONS.map(pos=><option key={pos}>{pos}</option>)}</select>
                  <button className="icon-button small" aria-label={`Eliminar dorsal ${p.jersey} de la plantilla`} onClick={()=>removePlayer(rosterTeam,p.jersey)}><X size={16}/></button>
                </div>)}
              </div>
              <form className="roster-add" onSubmit={addPlayer}><label>Dorsal<input value={playerNumber} onChange={e=>setPlayerNumber(e.target.value)} placeholder="Nº" maxLength={3}/></label><label>Jugador<input value={playerName} onChange={e=>setPlayerName(e.target.value)} placeholder="Nombre (opcional)"/></label><label>Posición<select value={playerPosition} onChange={e=>setPlayerPosition(e.target.value as Position)}>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select></label><button className="btn btn-dark" type="submit"><Plus size={16}/> Añadir</button></form>
            </div>}

            {view==='review'&&<div className="tab-content review-content">
              <div className="review-overview">
                <div><strong>{quality.complete}<small> / {quality.rallies}</small></strong><span>rallies cerrados</span></div>
                <div><strong>{quality.actions?`${quality.identificationRate}%`:'—'}</strong><span>acciones con dorsal</span></div>
                <div><strong>{reviews.length}</strong><span>observaciones</span></div>
              </div>
              <p className="review-explainer"><ShieldCheck size={17}/> Este control revisa las anotaciones. No estima jugadas ni certifica que el partido esté completo.</p>
              {reviews.length===0?<div className="empty-state"><div className="empty-ring"><CheckCircle2 size={23}/></div><h3>{quality.actions?'Sin incidencias detectadas':'Preparado para revisar'}</h3><p>{quality.actions?'No se han detectado incoherencias en las acciones introducidas.':'Registra tu primer rally y aparecerán avisos para facilitar la revisión.'}</p></div>:<div className="review-list">
                {reviews.slice(0,60).map(issue=><div key={issue.id} className={`review-item review-${issue.kind}`}><div className="review-dot"><Info size={18}/></div><div><strong>{issue.title}</strong><p>{issue.description}</p></div><button className="btn btn-outline" onClick={()=>reviewRally(issue.set,issue.rally,issue.second)}>Revisar <ArrowRight size={14}/></button></div>)}
                {reviews.length>60&&<p className="subtle-caption">Mostrando las primeras 60 incidencias. Completa algunos rallies para reducir la lista.</p>}
              </div>}
            </div>}
          </section>}
        </div>

        {showManual&&<aside className="studio-side" id="annotation">
          <section className="panel tag-panel">
            <div className="tag-panel-top"><div><div className="eyebrow text-lime">ANOTACIÓN DE JUGADAS</div><h2>{editingId?'Editar acción':'Registrar acción'}</h2><p>{editingId?'Corrige la jugada sin perder su historial':'Registro rápido, diseñado para revisar punto a punto'}</p></div><span className="head-icon accent"><Target size={19}/></span></div>
            <div className="steps-box"><div className="field"><label htmlFor="set-select">Set</label><div className="select-wrap"><select id="set-select" value={setNum} onChange={e=>selectSet(Number(e.target.value))}>{Array.from({length:Math.max(5,...recordedSets,1)},(_,i)=><option key={i+1} value={i+1}>Set {i+1}</option>)}</select><ChevronDown size={15}/></div></div>
              <div className="field"><label htmlFor="rally-input">Punto nº</label><div className="rally-counter"><button aria-label="Punto anterior" onClick={()=>setRally(n=>Math.max(1,n-1))}><Minus size={15}/></button><input id="rally-input" type="number" min="1" value={rally} onChange={e=>setRally(Math.max(1,Math.floor(Number(e.target.value)||1)))}/><button aria-label="Punto siguiente" onClick={()=>setRally(n=>n+1)}><Plus size={15}/></button></div></div></div>
            <div className={`rally-state ${currentRally?.complete?'rally-state-closed':''}`}><span className={`rally-state-icon ${currentRally?.complete?'closed':''}`}>{currentRally?.complete?<CheckCircle2 size={17}/>:<Activity size={17}/>}</span><div><strong>{currentRally?.complete?'Rally cerrado':'Rally en curso'}</strong><small>{currentRally?.actions||0} acciones · {currentRally?.complete?'Punto asignado':'Pendiente de ganador'}</small></div>{currentRally?.complete&&<button className="btn btn-outline" onClick={()=>setRally(nextRally(match.events,setNum))}>Siguiente <ArrowRight size={14}/></button>}</div>
            <div className="field-block"><div className="field-heading">01 <span>Equipo que realiza la acción</span></div><div className="team-switch"><button aria-pressed={team==='A'} className={team==='A'?'selected':''} onClick={()=>selectTeam('A')}><span className="team-mini mini-A"/> Azul</button><button aria-pressed={team==='B'} className={team==='B'?'selected':''} onClick={()=>selectTeam('B')}><span className="team-mini mini-B"/> Rojo</button></div></div>
            <div className="field-block"><div className="field-heading">02 <span>Jugador</span></div><div className="player-field"><span>#</span><input value={jersey} onChange={e=>setJersey(e.target.value)} maxLength={3} inputMode="numeric" placeholder="Dorsal" list="jersey-options" aria-label="Dorsal"/><datalist id="jersey-options">{allPlayers[team].map(p=><option key={p.jersey} value={p.jersey}>{p.name||`#${p.jersey}`}</option>)}</datalist><span className="selected-player-name">{allPlayers[team].find(p=>p.jersey===jersey)?.name||'Jugador sin identificar'}</span></div>
              {allPlayers[team].length>0&&<div className="roster-quick" aria-label="Seleccionar dorsal rápido">{allPlayers[team].slice(0,18).map(p=><button key={p.jersey} title={p.name||`Dorsal ${p.jersey}`} aria-pressed={jersey===p.jersey} className={jersey===p.jersey?'chosen':''} onClick={()=>setJersey(p.jersey)}>#{p.jersey}</button>)}</div>}</div>
            <div className="field-block"><div className="field-heading">03 <span>Tipo de acción</span></div><div className="action-grid">{SKILLS.map((s,i)=><button key={s} className={`action-choice ${skill===s?'active':''}`} onClick={()=>selectSkill(s)} aria-pressed={skill===s}><span>{formatSkill(s)}</span><small>{i+1}</small></button>)}</div></div>
            <div className="field-block"><div className="field-heading">04 <span>Resultado de la acción</span></div><div className="outcome-chips">{SKILL_OPTIONS[skill].map(o=><button key={o} className={`outcome-chip ${outcome===o?'active':''} ${o==='error'?'error-chip':''}`} aria-pressed={outcome===o} onClick={()=>setOutcome(o)}>{o==='error'?<X size={13}/>:o==='ganadora'||o==='ace'||o==='perfecta'?<Check size={13}/>:null}{OUTCOME_LABELS[o]}</button>)}</div></div>
            <div className="form-bottom"><div className="field"><label htmlFor="note">Nota <span>(opcional)</span></label><input id="note" placeholder="Ej. ataque por zona 4" value={note} onChange={e=>setNote(e.target.value)} maxLength={350}/></div>
              <div className="time-input-row"><label><input type="checkbox" checked={manualTiming} onChange={e=>{setManualTiming(e.target.checked);if(e.target.checked)setManualTime(formatTime(currentSecondRef.current));}}/> Usar tiempo manual</label>{manualTiming?<input className="manual-time" aria-label="Marca de tiempo manual" value={manualTime} onChange={e=>setManualTime(e.target.value)} placeholder="mm:ss"/>:<span className="clock-badge"><Clock3 size={14}/>{formatTime(currentSec)}</span>}</div>
              <button className="btn btn-lime btn-save" disabled={!editingId&&Boolean(currentRally?.complete)} onClick={addOrSaveAction}><Plus size={19}/>{editingId?'Guardar cambios':'Guardar acción'}<CornerDownLeft size={16}/></button>
              {editingId&&<button className="btn btn-text full" onClick={cancelEdit}>Cancelar edición</button>}
            </div>
          </section>
          <section className="panel point-panel"><div className="point-title"><span className="head-icon orange"><Flag size={17}/></span><div><h3>Cerrar punto</h3><p>Marca quién gana el rally y pasa al siguiente</p></div></div><div className="point-buttons"><button disabled={Boolean(currentRally?.complete)} onClick={()=>awardPoint('A')}><span className="team-mini mini-A"/> Punto azul <span className="hotkey">A</span></button><button disabled={Boolean(currentRally?.complete)} onClick={()=>awardPoint('B')}><span className="team-mini mini-B"/> Punto rojo <span className="hotkey">B</span></button></div><div className="point-footnote"><Info size={14}/> El resultado no se infiere de las acciones: confirma el ganador al acabar cada punto.</div></section>
          <section className="ai-status"><div className="ai-icon"><Sparkles size={19}/></div><div><strong>Modo manual · opcional</strong><p>La sección Análisis automático genera el borrador de todo el partido. Usa este panel solo para anotaciones técnicas precisas.</p></div><Pill>BETA</Pill></section>
        </aside>}
      </section>

      {(showManual||Boolean(match.events.length))&&<section className="insights-section" id="insights"><div className="section-top"><div><div className="eyebrow text-lime">PERFORMANCE INSIGHTS</div><h2>Los números detrás del juego.</h2><p>Estadísticas calculadas exclusivamente a partir de tus anotaciones.</p></div><div className="insights-actions"><label>Periodo <select value={insightSet} onChange={e=>setInsightSet(e.target.value==='all'?'all':Number(e.target.value))}><option value="all">Todo el partido</option>{recordedSets.map(n=><option key={n} value={n}>Set {n}</option>)}</select></label>{manualReportReady&&<button className="btn btn-outline" onClick={exportPlayers}><FileSpreadsheet size={16}/> Informe jugadores</button>}</div></div>
        <div className="metrics-overview"><div className="featured-stat"><div className="featured-top"><span>ACTIVIDAD REGISTRADA</span><Activity size={20}/></div><strong>{total.actions}</strong><p>acciones etiquetadas</p><div className="featured-bottom"><span><CheckCircle2 size={15}/> {total.closed} puntos cerrados</span><span>{total.rallies} rallies con datos</span></div></div>
          <div className="quick-metrics"><StatTile value={statsA.aces+statsB.aces} label="Aces registrados"/><StatTile value={statsA.attackKills+statsB.attackKills} label="Ataques ganadores"/><StatTile value={statsA.blocks+statsB.blocks} label="Bloqueos punto"/><StatTile value={statsA.digs+statsB.digs} label="Defensas"/></div>
        </div>
        <div className="player-focus panel"><div className="player-focus-head"><div><div className="eyebrow text-lime">PLAYER SPOTLIGHT</div><h3>Rendimiento individual</h3><p>Selecciona cualquier dorsal para seguir su actuación.</p></div><div className="player-focus-filters"><div className="team-switch compact"><button className={selectedPlayer.team==='A'?'selected':''} onClick={()=>setSelectedPlayer(p=>({...p,team:'A',jersey:allPlayers.A[0]?.jersey||''}))}>Azul</button><button className={selectedPlayer.team==='B'?'selected':''} onClick={()=>setSelectedPlayer(p=>({...p,team:'B',jersey:allPlayers.B[0]?.jersey||''}))}>Rojo</button></div><select aria-label="Dorsal a analizar" value={selectedPlayer.jersey} onChange={e=>setSelectedPlayer(p=>({...p,jersey:e.target.value}))}><option value="">Elige dorsal</option>{allPlayers[selectedPlayer.team].map(p=><option key={p.jersey} value={p.jersey}>#{p.jersey}{p.name?` · ${p.name}`:''}</option>)}</select></div></div>
          <div className="focus-body"><div className="focus-person"><div className={`focus-jersey focus-${selectedPlayer.team}`}>{selectedPlayer.jersey||'—'}</div><div><span>JUGADOR SELECCIONADO</span><h4>{allPlayers[selectedPlayer.team].find(p=>p.jersey===selectedPlayer.jersey)?.name||`Dorsal ${selectedPlayer.jersey||'sin elegir'}`}</h4><p>{match.teams[selectedPlayer.team]}</p></div></div><div className="focus-stats">
            <StatTile value={playerStats.receptions} label="Recepciones"/><StatTile value={statCaption(playerStats.positiveRecepPercent)} label="Recepción positiva"/><StatTile value={`${playerStats.attackKills}/${playerStats.attacks}`} label="Ataques ganadores"/><StatTile value={statCaption(playerStats.attackKillPercent)} label="Eficacia de ataque"/>              <StatTile value={playerStats.aces} label="Aces"/><StatTile value={playerStats.blocks} label="Bloqueos punto"/><StatTile value={statCaption(playerEfficiency)} label="Eficiencia de ataque"/><StatTile value={playerStats.receptionErrors} label="Errores de recepción"/>
          </div></div><div className="focus-footer"><Info size={14}/> Las cifras no representan todo el partido hasta que se hayan registrado todas las acciones. Los porcentajes usan solo intentos anotados.</div>
        </div>
      </section>}

      <section className="data-footer panel"><div className="data-title"><span className="head-icon"><Save size={18}/></span><div><h3>{hasSessionData?'Tu informe, listo para guardar.':'Tus datos, cuando haya algo que guardar.'}</h3><p>{hasSessionData?'Los resultados se guardan en este navegador. Descarga una copia si quieres conservarlos fuera del equipo.':'Los informes y descargas aparecerán al finalizar el análisis. No se exportarán hojas vacías.'}</p></div></div><div className="data-buttons">
        {automaticReportReady&&<button className="btn btn-outline" onClick={()=>document.getElementById('automatic')?.scrollIntoView({behavior:'smooth'})}><BarChart3 size={16}/> Ver y descargar informe IA</button>}
        {hasSessionData&&<button className="btn btn-outline" onClick={exportJSON}><FileJson size={16}/> Guardar sesión completa</button>}
        {manualReportReady&&<button className="btn btn-outline" onClick={exportExcel}><FileSpreadsheet size={16}/> Acciones anotadas CSV</button>}
        {manualReportReady&&<button className="btn btn-outline" onClick={exportPlayers}><Users size={16}/> Jugadores anotados CSV</button>}
        <button className="btn btn-outline" onClick={()=>importRef.current?.click()}><UploadCloud size={16}/> Importar sesión anterior</button>
        {manualReportReady&&<button className="btn btn-danger-subtle" onClick={resetEvents}><RotateCcw size={16}/> Borrar anotaciones manuales</button>}
        <input ref={importRef} type="file" className="sr-only" accept=".json,application/json" aria-label="Importar sesión JSON" onChange={importJSON}/>
      </div></section>
      <footer className="footer"><div className="footer-mark"><Volleyball size={16}/> VB STATS <span>© 2026</span></div><span>Analiza con criterio. Decide con datos.</span><span>{storageError?'Advertencia: navegador sin espacio de guardado':'Sesión guardada en este navegador'} <CloudOff size={14}/></span></footer>
    </main>

    {feedback&&<div role="status" className={`toast toast-${feedback.kind}`}><span>{feedback.kind==='success'?<CheckCircle2 size={17}/>:<Info size={17}/>}</span>{feedback.message}{feedback.message==='Acción eliminada.'&&lastRemoved&&<button className="toast-undo" onClick={restoreRemoved}>Deshacer</button>}<button aria-label="Cerrar aviso" onClick={()=>setFeedback(null)}><X size={15}/></button></div>}
    {showUrlModal&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowUrlModal(false)}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="youtube-title"><div className="modal-top"><div className="head-icon accent"><Link2 size={20}/></div><button className="icon-button" aria-label="Cerrar" onClick={()=>setShowUrlModal(false)}><X size={19}/></button></div><h2 id="youtube-title">Vincular vídeo de YouTube</h2><p>Pega el enlace de la retransmisión. El reproductor intentará abrirlo aquí para que puedas anotar con marcas de tiempo.</p><form onSubmit={handleYouTube}><input autoFocus value={youtubeText} onChange={e=>setYoutubeText(e.target.value)} placeholder="https://www.youtube.com/live/..." aria-label="URL del vídeo"/><button className="btn btn-lime full" type="submit"><Link2 size={16}/> Vincular vídeo</button></form><div className="modal-help"><Info size={16}/> Algunos canales bloquean la reproducción integrada. En ese caso, utiliza el archivo original del vídeo.</div></div></div>}
    {showSettings&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowSettings(false)}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="modal-top"><div className="head-icon accent"><Settings2 size={20}/></div><button className="icon-button" aria-label="Cerrar" onClick={()=>setShowSettings(false)}><X size={19}/></button></div><h2 id="settings-title">Configurar partido</h2><p>Puedes modificar el título y los nombres de los equipos sin perder tus anotaciones.</p><div className="settings-fields"><label>Título del partido<input maxLength={140} value={match.title} onChange={e=>update(m=>({...m,title:e.target.value}))}/></label><label>Equipo azul · A<input maxLength={80} value={match.teams.A} onChange={e=>update(m=>({...m,teams:{...m.teams,A:e.target.value}}))}/></label><label>Equipo rojo · B<input maxLength={80} value={match.teams.B} onChange={e=>update(m=>({...m,teams:{...m.teams,B:e.target.value}}))}/></label></div><button className="btn btn-lime full" onClick={()=>{setShowSettings(false);notify('Configuración actualizada.')}}><Check size={16}/> Listo</button></div></div>}
    {showHelp&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowHelp(false)}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="shortcut-title"><div className="modal-top"><div className="head-icon accent"><Keyboard size={20}/></div><button className="icon-button" aria-label="Cerrar" onClick={()=>setShowHelp(false)}><X size={19}/></button></div><h2 id="shortcut-title">Atajos para anotar más rápido</h2><p>Funcionan cuando el foco no está dentro de un campo de texto.</p><div className="shortcuts-list">{SHORTCUTS.map(([key,action])=><div key={key}><kbd>{key}</kbd><span>{action}</span></div>)}</div><button className="btn btn-dark full" onClick={()=>setShowHelp(false)}>Entendido</button></div></div>}
  </div>;
}
