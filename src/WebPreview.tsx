import { useMemo, useState } from 'react';
import { ArrowRight, BarChart3, CheckCircle2, ChevronDown, ClipboardCheck, Download, ExternalLink, FileVideo, Flag, Info, RotateCcw, Search, ShieldCheck, Sparkles, Users, Volleyball } from 'lucide-react';
import './webPreview.css';

type Team = 'A' | 'B';
type Action = 'saque' | 'recepción' | 'colocación' | 'ataque' | 'bloqueo' | 'defensa' | 'sin clasificar';
type Event = { id: number; second: number; rally: number; team: Team | ''; jersey: string; action: Action; confidence: 'Alta' | 'Media' | 'Baja' };
const teams: Record<Team,string> = {A:'Equipo local',B:'Equipo visitante'};
const SAMPLE:Event[] = [
  {id:1,second:73,rally:1,team:'A',jersey:'13',action:'saque',confidence:'Media'},
  {id:2,second:75,rally:1,team:'B',jersey:'7',action:'recepción',confidence:'Media'},
  {id:3,second:77,rally:1,team:'B',jersey:'',action:'colocación',confidence:'Baja'},
  {id:4,second:79,rally:1,team:'B',jersey:'8',action:'ataque',confidence:'Media'},
  {id:5,second:81,rally:1,team:'A',jersey:'13',action:'defensa',confidence:'Alta'},
  {id:6,second:137,rally:2,team:'B',jersey:'7',action:'saque',confidence:'Alta'},
  {id:7,second:139,rally:2,team:'A',jersey:'4',action:'recepción',confidence:'Media'},
  {id:8,second:141,rally:2,team:'A',jersey:'',action:'colocación',confidence:'Baja'},
  {id:9,second:143,rally:2,team:'A',jersey:'13',action:'ataque',confidence:'Media'},
  {id:10,second:202,rally:3,team:'A',jersey:'4',action:'saque',confidence:'Alta'},
  {id:11,second:205,rally:3,team:'B',jersey:'7',action:'recepción',confidence:'Media'},
  {id:12,second:207,rally:3,team:'B',jersey:'8',action:'ataque',confidence:'Media'},
  {id:13,second:209,rally:3,team:'A',jersey:'',action:'bloqueo',confidence:'Baja'},
  {id:14,second:211,rally:3,team:'B',jersey:'7',action:'defensa',confidence:'Media'},
];
const actions:Action[]=['saque','recepción','colocación','ataque','bloqueo','defensa','sin clasificar'];
const mmss=(n:number)=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;
const escapeCsv=(s:unknown)=>`"${String(s??'').replaceAll('"','""')}"`;
function saveDemoCsv(rows:Event[]){
  const lines=[['tiempo','rally','equipo','dorsal','accion','confianza'],...rows.map(e=>[mmss(e.second),e.rally,e.team,e.jersey,e.action,e.confidence])];
  const blob=new Blob(['\uFEFF'+lines.map(r=>r.map(escapeCsv).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='vb-stats-DATOS-FICTICIOS.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
export function WebPreview(){
  const [view,setView]=useState<'welcome'|'report'>('welcome');
  const [tab,setTab]=useState<'actions'|'players'|'quality'>('actions');
  const [events,setEvents]=useState<Event[]>(SAMPLE.map(e=>({...e})));
  const [search,setSearch]=useState('');
  const [edited,setEdited]=useState(false);
  const players=useMemo(()=>{
    const map=new Map<string,{team:Team,jersey:string,contacts:number,rallies:Set<number>}>();
    events.forEach(e=>{if(!e.team||!e.jersey)return;const key=`${e.team}:${e.jersey}`;let p=map.get(key);if(!p){p={team:e.team,jersey:e.jersey,contacts:0,rallies:new Set()};map.set(key,p)}p.contacts++;p.rallies.add(e.rally)});
    return [...map.values()].sort((a,b)=>b.contacts-a.contacts);
  },[events]);
  const countAssigned=events.filter(e=>e.jersey).length;
  const visible=events.filter(e=>`${mmss(e.second)} ${e.rally} ${e.team} ${e.jersey} ${e.action}`.toLowerCase().includes(search.toLowerCase()));
  const modify=(id:number,update:Partial<Event>)=>{setEvents(prev=>prev.map(e=>e.id===id?{...e,...update}:e));setEdited(true)};
  const openReport=()=>{setView('report');setTab('actions');window.scrollTo({top:0,behavior:'smooth'})};
  const reset=()=>{setEvents(SAMPLE.map(e=>({...e})));setEdited(false);setSearch('')};
  return <div className="wp-root">
    <header className="wp-header"><div className="wp-container wp-header-inner"><span className="wp-brand-logo"><Volleyball size={24}/></span><strong className="wp-brand">VB STATS</strong><span className="wp-preview-pill">WEB PREVIEW</span><div className="wp-header-space"/><button className="wp-btn wp-btn-quiet" onClick={openReport}>Ver demo <ArrowRight size={16}/></button></div></header>
    <main className="wp-container">
      <aside className="wp-disclaimer" role="note"><Info size={18}/><div><strong>Vista previa de la aplicación.</strong> Los datos de esta web son <strong>ficticios</strong>. Aquí todavía no se procesan vídeos ni enlaces de YouTube; el análisis real con RAVEL y OCR funciona en la versión local para Windows.</div></aside>
      {view==='welcome'&&<>
        <div className="wp-hero"><div className="wp-hero-copy"><span className="wp-eyebrow"><Sparkles size={15}/> VOLEIBOL · ANÁLISIS ASISTIDO POR IA</span><h1>Tu partido.<br/><em>Los datos, claros.</em></h1><p>Así queremos que funcione VB Stats: pegas el enlace, el motor analiza el partido y tú ves estadísticas, jugadas y jugadores sin anotar cada toque.</p><div className="wp-row"><button className="wp-btn wp-btn-primary" onClick={openReport}>Explorar un informe de ejemplo <ArrowRight size={17}/></button><a href="#wp-flow" className="wp-btn wp-btn-secondary">Cómo funciona</a></div><small>Sin registrarte · Sin enviar grabaciones · Demostración interactiva</small></div><div className="wp-illustration"><div className="wp-illustration-head"><span>PREVISUALIZACIÓN DE PARTIDO</span><span className="wp-live">● DEMO</span></div><div className="wp-court"><div className="wp-court-left"/><div className="wp-court-right"/><div className="wp-net"/>{[20,32,43].map((x,i)=><i key={'a'+i} className="wp-athlete wp-blue" style={{left:`${x}%`,top:`${40+i*11}%`}}/>)}{[64,76,83].map((x,i)=><i key={'b'+i} className="wp-athlete wp-pink" style={{left:`${x}%`,top:`${34+i*15}%`}}/>)}<i className="wp-ball"/></div><div className="wp-illustration-foot"><span><CheckCircle2 size={16}/> Rallies detectados</span><span><ShieldCheck size={16}/> Revisión editable</span></div></div></div>
        <section id="wp-flow" className="wp-section"><span className="wp-eyebrow">SIMPLE DESDE EL PRIMER MOMENTO</span><h2>De la grabación al informe</h2><div className="wp-steps"><article><div className="wp-step-no">01</div><FileVideo size={22}/><h3>Añade el partido</h3><p>En la versión completa, pega YouTube o selecciona un MP4 sin introducir manualmente dorsales.</p></article><article><div className="wp-step-no">02</div><Sparkles size={22}/><h3>La IA lo analiza</h3><p>Detecta posibles contactos, rallies y jugadores. Los resultados dudosos quedan señalados.</p></article><article><div className="wp-step-no">03</div><BarChart3 size={22}/><h3>Consulta y corrige</h3><p>Revisa estadísticas provisionales y corrige únicamente los eventos que lo necesiten.</p></article></div></section>
        <section className="wp-section wp-callout"><div><h2>Prueba el informe sin instalar nada</h2><p>Datos ficticios de un partido de muestra. Podrás filtrar, cambiar dorsales y exportar un CSV identificado como demo.</p></div><button className="wp-btn wp-btn-primary" onClick={openReport}>Abrir informe de ejemplo <ArrowRight size={17}/></button></section>
      </>}
      {view==='report'&&<section className="wp-section wp-report">
        <div className="wp-report-top"><div><span className="wp-eyebrow">INFORME DE EJEMPLO · DATOS FICTICIOS</span><h1>Partido de demostración</h1><p>Todos los registros son inventados para probar la interfaz. Puedes modificarlos; no afectan a ningún partido real.</p></div><button className="wp-btn wp-btn-secondary" onClick={()=>{setView('welcome');window.scrollTo({top:0,behavior:'smooth'})}}>Volver al inicio</button></div>
        <div className="wp-metrics"><article><strong>{new Set(events.map(e=>e.rally)).size}</strong><span>Rallies de ejemplo</span></article><article><strong>{events.length}</strong><span>Contactos de ejemplo</span></article><article><strong>{players.length}</strong><span>Dorsales asignados</span></article><article><strong>{events.length-countAssigned}</strong><span>Toques sin dorsal</span></article></div>
        <div className="wp-tabs" role="tablist" aria-label="Secciones del informe">{([['actions','Acciones'],['players','Jugadores'],['quality','Calidad de los datos']] as const).map(([key,label])=><button role="tab" aria-selected={tab===key} className={tab===key?'wp-tab wp-selected':'wp-tab'} key={key} onClick={()=>setTab(key)}>{label}</button>)}</div>
        {tab==='actions'&&<article className="wp-data-card"><div className="wp-card-head"><div><h2>Contactos detectados</h2><p>Modifica equipo, dorsal o tipo de acción y observa cómo cambia el resumen.</p></div><button className="wp-btn wp-btn-primary" onClick={()=>saveDemoCsv(events)}><Download size={16}/> CSV de demostración</button></div><label className="wp-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar dorsal, minuto o acción" aria-label="Filtrar contactos"/></label><div className="wp-scroll"><table><thead><tr><th>Momento</th><th>Rally</th><th>Equipo</th><th>Dorsal</th><th>Acción (simulada)</th><th>Confianza*</th></tr></thead><tbody>{visible.map(e=><tr key={e.id}><td><span className="wp-time">{mmss(e.second)}</span></td><td>#{e.rally}</td><td><select aria-label={`Equipo en ${mmss(e.second)}`} value={e.team} onChange={v=>modify(e.id,{team:v.target.value as Team})}><option value="">Sin identificar</option><option value="A">Local</option><option value="B">Visitante</option></select></td><td><select aria-label={`Dorsal en ${mmss(e.second)}`} value={e.jersey} onChange={v=>modify(e.id,{jersey:v.target.value})}>{['','4','7','8','13','16'].map(n=><option key={n} value={n}>{n?`#${n}`:'Sin identificar'}</option>)}</select></td><td><select aria-label={`Acción en ${mmss(e.second)}`} value={e.action} onChange={v=>modify(e.id,{action:v.target.value as Action})}>{actions.map(a=><option key={a} value={a}>{a}</option>)}</select></td><td><span className={`wp-confidence wp-${e.confidence.toLowerCase()}`}>{e.confidence}</span></td></tr>)}</tbody></table></div><small>*Confianzas inventadas para representar el flujo de revisión, no son mediciones del modelo real.</small></article>}
        {tab==='players'&&<article className="wp-data-card"><div className="wp-card-head"><div><h2>Jugadores detectados</h2><p>Agrupación provisional de los contactos asignados al mismo dorsal. Los datos se actualizan al corregir una acción.</p></div><Users size={25}/></div><div className="wp-scroll"><table><thead><tr><th>Equipo</th><th>Jugador</th><th>Contactos</th><th>Rallies distintos</th></tr></thead><tbody>{players.map(p=><tr key={`${p.team}:${p.jersey}`}><td>{teams[p.team]}</td><td><span className="wp-number">#{p.jersey}</span></td><td>{p.contacts}</td><td>{p.rallies.size}</td></tr>)}</tbody></table></div></article>}
        {tab==='quality'&&<article className="wp-data-card"><div className="wp-card-head"><div><h2>Calidad de los datos</h2><p>El informe indica qué registros tienen dorsal y cuáles requieren revisión.</p></div><ClipboardCheck size={25}/></div><h3>{Math.round(100*countAssigned/events.length)} % de contactos con dorsal asignado</h3><div className="wp-progress"><div style={{width:`${100*countAssigned/events.length}%`}}/></div><p>{countAssigned} de {events.length} contactos de ejemplo tienen un dorsal. Los resultados de acciones técnicas y el ganador de un punto nunca deben tratarse como verificados sin evidencia suficiente.</p><div className="wp-note"><Flag size={18}/> Estos porcentajes también son ficticios; en la app real la fiabilidad dependerá de la grabación y los modelos.</div></article>}
        <div className="wp-report-actions">{edited&&<span className="wp-edited"><CheckCircle2 size={17}/> Cambios aplicados a los datos de muestra</span>}<button className="wp-btn wp-btn-secondary" onClick={reset}><RotateCcw size={16}/> Restablecer demo</button></div>
      </section>}
    </main><footer className="wp-footer"><div className="wp-container wp-footer-content"><strong>VB STATS</strong><span>Vista previa de UX · Sin procesamiento real de vídeos</span><a href="https://github.com/RubenIglesiasGarcia/VB-Stats" target="_blank" rel="noopener noreferrer">Código en GitHub <ExternalLink size={13}/></a></div></footer>
  </div>;
}
