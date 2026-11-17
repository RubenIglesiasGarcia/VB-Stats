import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,AlertCircle,ArrowRight,BarChart3,CheckCircle2,ChevronRight,ClipboardCheck,Download,ExternalLink,FileVideo,LockKeyhole,Play,RefreshCw,Search,ShieldCheck,TrendingDown,UploadCloud,Users,Video,Youtube} from 'lucide-react';
import {AUTO_ACTIONS,autoMetrics,autoPlayerTotals,fixAutoEvent,sanitizeAuto,type AutoAction,type AutoAnalysis} from './automatic';
import {computePerformance,hittingEfficiency,percent,performanceCSV,receptionRating,RESULT_CHOICES,reviewEvent,type Reviews,type Skill} from './performance';
import {formatTime} from './model';
import './online.css';
const BASE=(import.meta.env.VITE_ANALYSIS_API||'').replace(/\/$/,'');
const REPORT_KEY='vbstats-online-last-report';const JOB_KEY='vbstats-online-job';
type Job={jobId:string;status:'queued'|'running'|'completed'|'failed'|'cancelled';progress:number;phase?:string;stage?:string;error?:string;processedSegments?:number;totalSegments?:number;autoAnalysis?:AutoAnalysis;downloadProgress?:number;downloadedResolution?:string};
type Caps={engines?:{ravel?:{ready:boolean;note:string}};youtube_import?:boolean;jersey_recognition?:boolean;maxUploadMB?:number;maxAutoDurationSeconds?:number;};
const allSkills=['saque','recepción','ataque','bloqueo','defensa','colocación'] as const;
function loadReport():AutoAnalysis|undefined{try{const s=localStorage.getItem(REPORT_KEY);return s?sanitizeAuto(JSON.parse(s)):undefined;}catch{return undefined;}}
function saveReport(data:AutoAnalysis){try{localStorage.setItem(REPORT_KEY,JSON.stringify(data));}catch{ /* Full-length report may exceed browser quota. Keep session copy. */ }}
function keyFor(data:AutoAnalysis){return `vbstats-reviews-${data.sourceName.slice(0,45)}-${Math.round(data.durationSeconds)}-${data.events.length}`;}
function getReviews(data:AutoAnalysis):Reviews{try{const s=localStorage.getItem(keyFor(data));return s?JSON.parse(s) as Reviews:{};}catch{return {};}}
function download(name:string,contents:string){const url=URL.createObjectURL(new Blob(['\uFEFF',contents],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function value(n:number|null,unit=''){return n===null?'—':`${n}${unit}`}
function Stat({label,note,value:content,tone}:{label:string;note?:string;value:string|number;tone?:string}){return <div className={'os-stat '+(tone??'')}><span>{label}</span><strong>{content}</strong>{note&&<small>{note}</small>}</div>}
export function OnlineStudio(){
 const [connected,setConnected]=useState(false);const [caps,setCaps]=useState<Caps|null>(null);
 const [mode,setMode]=useState<'youtube'|'file'>('youtube');const [url,setUrl]=useState('');const [file,setFile]=useState<File|null>(null);
 const [authorized,setAuthorized]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [jobId,setJobId]=useState(()=>sessionStorage.getItem(JOB_KEY)||'');const [job,setJob]=useState<Job|null>(null);
 const [report,setReport]=useState<AutoAnalysis|undefined>(loadReport);const [reviews,setReviews]=useState<Reviews>(()=>{const r=loadReport();return r?getReviews(r):{}});
 const [teamA,setTeamA]=useState('Mi equipo');const [teamB,setTeamB]=useState('Rival');
 const [tab,setTab]=useState<'team'|'players'|'timeline'>('team');const [filter,setFilter]=useState<'all'|'unreviewed'|'A'|'B'>('unreviewed');
 const [selected,setSelected]=useState<string|null>(null);const [limit,setLimit]=useState(60);const [query,setQuery]=useState('');
 const fileInput=useRef<HTMLInputElement>(null);
 async function api(path:string,init:RequestInit={}){
   const res=await fetch(`${BASE}${path}`,init);
   if(!res.ok){let detail=`Error ${res.status}`;try{const j=await res.json();if(typeof j.detail==='string')detail=j.detail;}catch{}throw Error(detail)}
   return await res.json();
 }
 useEffect(()=>{let active=true;
   const check=async()=>{try{const res=await fetch(`${BASE}/capabilities`);if(!res.ok){let message='La IA está temporalmente no disponible.';try{const data=await res.json();if(typeof data.detail==='string')message=data.detail;}catch{}throw Error(message)}const c=await res.json() as Caps;if(active){setCaps(c);setConnected(true);setError('')}}catch(e){if(active){setConnected(false);setError(e instanceof Error?e.message:'Sin conexión con la IA')}}};
   void check();const timer=window.setInterval(()=>void check(),12000);return()=>{active=false;window.clearInterval(timer)};
 },[]);
 useEffect(()=>{if(!jobId)return;let alive=true;
   const poll=async()=>{try{const res=await fetch(`${BASE}/api/analysis/jobs/${jobId}`);if(!res.ok)throw Error(res.status===404?'Este análisis ya no está disponible en el servidor.':'No se pudo consultar el análisis.');const j=await res.json() as Job;if(!alive)return;setJob(j);
    if(j.status==='completed'){
      if(j.autoAnalysis){const valid=sanitizeAuto(j.autoAnalysis);if(valid){setReport(valid);saveReport(valid);setReviews(getReviews(valid));setTab('team');setError('')}}
      sessionStorage.removeItem(JOB_KEY);setJobId('');
    }else if(j.status==='failed'||j.status==='cancelled'){
      const raw=j.error||'El análisis se interrumpió.';
      setError(raw.includes('No se ha podido obtener el vídeo desde YouTube')?
       'YouTube está impidiendo el acceso automático desde el servidor. El vídeo puede reproducirse en YouTube, pero Railway no puede importar la grabación para analizarla. Si tienes un MP4 autorizado, puedes probarlo en «Subir un vídeo» (la beta limita el tamaño).':
       raw); // Keep the job ID if a chunked analysis can resume.
    }
   }catch(e){if(alive){setError(e instanceof Error?e.message:'Error de conexión')}}};
   void poll();const timer=window.setInterval(()=>void poll(),3500);return()=>{alive=false;window.clearInterval(timer)};
 },[jobId]);
 async function start(){if(!connected||!caps?.engines?.ravel?.ready){setError(caps?.engines?.ravel?.note||'IA no disponible');return;}if(mode==='youtube'&&!authorized){setError('Confirma que tienes permiso para procesar ese vídeo.');return;}
  setBusy(true);setError('');try{let r:{jobId:string};const common={chunkSeconds:60,teamAColor:'#265bac',teamBColor:'#b9373f'};
   if(mode==='youtube'){
    if(!caps.youtube_import)throw Error('El servidor no tiene importación de YouTube disponible.');
    r=await api('/api/analysis/youtube-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...common,url:url.trim(),authorized})});
   }else{if(!file)throw Error('Selecciona un vídeo MP4 o WebM.');if(file.size>(caps.maxUploadMB||384)*1024*1024)throw Error(`Máximo ${(caps.maxUploadMB||384)} MB en esta beta online.`);
    const form=new FormData();form.append('file',file);const up=await api('/api/analysis/uploads',{method:'POST',body:form});r=await api('/api/analysis/auto-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...common,uploadId:up.uploadId})});
   }
   sessionStorage.setItem(JOB_KEY,r.jobId);setJobId(r.jobId);setJob({jobId:r.jobId,status:'queued',progress:0,stage:'Preparando el partido'});
  }catch(e){setError(e instanceof Error?e.message:'No se pudo iniciar')}finally{setBusy(false)}
 }
 async function resume(){if(!jobId)return;setBusy(true);setError('');try{
  await api(`/api/analysis/jobs/${jobId}/resume`,{method:'POST'});
  setJob(j=>j?{...j,status:'queued' as const,error:undefined,stage:'Reanudando desde el último tramo guardado'}:j);
 }catch(e){setError(e instanceof Error?e.message:'No se pudo reanudar el análisis');}finally{setBusy(false)}}
 function updateReport(data:AutoAnalysis){setReport(data);saveReport(data)}
 function updateReview(id:string,review:Reviews[string]|null){const next={...reviews};if(review)next[id]=review;else delete next[id];setReviews(next);if(report)try{localStorage.setItem(keyFor(report),JSON.stringify(next));}catch{}}
 const metrics=useMemo(()=>report?autoMetrics(report):null,[report]);
 const perf=useMemo(()=>report?computePerformance(report,reviews):null,[report,reviews]);
 const players=useMemo(()=>report?autoPlayerTotals(report):[],[report]);
 const shown=useMemo(()=>report?.events.filter(e=>e.status!=='rejected' &&
   (filter!=='unreviewed'||!reviews[e.id])&&(filter!=='A'||e.team==='A')&&(filter!=='B'||e.team==='B')&&
   (!query||[e.jersey,e.trackKey,e.action,formatTime(e.second)].some(v=>v.toLowerCase().includes(query.toLowerCase()))))||[],[report,filter,query,reviews]);
 function lookupTeam(s:'A'|'B'){return s==='A'?teamA:teamB;}
 const youtubeId=/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/)([A-Za-z0-9_-]{11})/.exec(url)?.[1];
 return <div className="os-root"><header className="os-header"><div className="os-container os-header-in"><span className="os-brand-icon">◉</span><strong>VB STATS</strong><span className="os-stage">AI BETA</span><span className="os-grow"/><span className={connected?'os-connection ok':'os-connection'}>{connected?'● IA online disponible':'○ Comprobando IA…'}</span></div></header>
 <main className="os-container">
 <div className="os-warning"><ShieldCheck size={18}/> <span><strong>Beta con IA real:</strong> identifica posibles contactos y dorsales. Los resultados deportivos todavía requieren verificación para evitar estadísticas inventadas. No hace falta registrarse. Durante las pruebas hay límites de uso para proteger el servicio.</span></div>
 {!connected&&<div className="os-info" role="status"><AlertCircle size={16}/> {error||'Comprobando la disponibilidad del motor de IA…'} El resto de la web se puede explorar sin cuenta.</div>}
 <section className="os-hero os-card"><div className="os-tag"><Activity size={14}/> MOTOR RAVEL-VB-013</div><h1>Del partido a las decisiones.</h1><p>Analiza el vídeo completo de forma automática. Consulta contactos, posibles acciones y dorsales; verifica resultados para calcular porcentajes de errores y eficiencia.</p><div className="os-mode"><button className={mode==='youtube'?'selected':''} onClick={()=>setMode('youtube')}><Youtube size={17}/> Enlace de YouTube</button><button className={mode==='file'?'selected':''} onClick={()=>setMode('file')}><FileVideo size={17}/> Subir un vídeo</button></div>
 <div className="os-source">{mode==='youtube'?<><label htmlFor="os-youtube">Enlace del partido</label><input id="os-youtube" type="url" placeholder="https://www.youtube.com/watch?v=..." value={url} onChange={e=>setUrl(e.target.value)}/><label className="os-checkbox"><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/> Tengo autorización para procesar esta grabación.</label></>:<><input type="file" accept="video/mp4,video/quicktime,video/webm" className="os-hidden" ref={fileInput} onChange={e=>setFile(e.target.files?.[0]||null)}/><button className="os-file" onClick={()=>fileInput.current?.click()}><UploadCloud size={20}/>{file?`${file.name} · ${(file.size/1048576).toFixed(1)} MB`:`Seleccionar vídeo (máx. ${caps?.maxUploadMB||384} MB)`}</button></>}
 <div className="os-submit"><span><ShieldCheck size={14}/> Sin cuenta · Máximo {Math.round((caps?.maxAutoDurationSeconds||7200)/60)} min</span><button className="os-primary" disabled={busy||(Boolean(jobId)&&!(['failed','cancelled'].includes(job?.status||'')))||!caps?.engines?.ravel?.ready||(mode==='youtube'&&(!url||!authorized))||(mode==='file'&&!file)} onClick={()=>void start()}>{busy?'Preparando…':'Analizar partido completo'} <ChevronRight size={17}/></button></div></div>
 {connected&&!caps?.engines?.ravel?.ready&&<div className="os-info"><AlertCircle size={16}/>{caps?.engines?.ravel?.note||'El modelo de voleibol no está disponible en el servidor.'}</div>}
 </section>
 {jobId&&job&&<section className="os-progress os-card"><div className="os-progress-head"><div className="os-tag">PROCESAMIENTO EN CURSO</div><h2>{job.stage||'Analizando acciones del partido'}</h2><p>{job.phase==='downloading'?'Descargando grabación permitida…':`Tramos: ${job.processedSegments??0} de ${job.totalSegments??'—'}`}</p></div><div className="os-track"><div style={{width:`${Math.max(1,Math.min(100,job.phase==='downloading'?job.downloadProgress||0:job.progress||0))}%`}}/></div><small>{job.phase==='downloading'?'Descarga':'Inferencia de IA'} · {Math.round(job.phase==='downloading'?job.downloadProgress||0:job.progress||0)}% · Puedes dejar la pestaña abierta durante el análisis. El trabajo podría interrumpirse si se reinicia el servidor.</small>{['failed','cancelled'].includes(job.status)&&(job.processedSegments??0)>0&&<div className="os-submit"><span>Se conservan los tramos terminados mientras el vídeo siga disponible.</span><button className="os-primary" disabled={busy} onClick={()=>void resume()}>Reanudar análisis <ChevronRight size={17}/></button></div>}</section>}
 {error&&<div className="os-error" role="alert"><AlertCircle size={17}/>{error}<button onClick={()=>setError('')}>Cerrar</button></div>}
 {report&&metrics&&perf&&<><section className="os-report-heading"><div><div className="os-tag">INFORME DEL PARTIDO · {report.engine.toUpperCase()}</div><h2>{report.sourceName}</h2><p>Hay datos automáticos provisionales y resultados deportivos comprobados por separado.</p></div><button className="os-secondary" onClick={()=>download('VB-Stats-Estadisticas-Verificadas.csv',performanceCSV(report,reviews))} disabled={perf.verified===0}><Download size={16}/> CSV verificado</button></section>
 <div className="os-stats"><Stat label="Rallies posibles" value={metrics.rallies} note="Detectados, no puntos confirmados"/><Stat label="Contactos detectados" value={metrics.contacts} note="Predicciones de la IA"/><Stat label="Dorsales reconocidos" value={metrics.knownPlayers} note="Requieren comprobación"/><Stat label="Resultados verificados" value={perf.verified} note={`De ${perf.detected} detecciones`}/></div>
 <div className="os-tabs"><button className={tab==='team'?'active':''} onClick={()=>setTab('team')}><BarChart3 size={16}/> Análisis del equipo</button><button className={tab==='players'?'active':''} onClick={()=>setTab('players')}><Users size={16}/> Jugadores</button><button className={tab==='timeline'?'active':''} onClick={()=>setTab('timeline')}><Video size={16}/> Revisar acciones</button></div>
 {tab==='team'&&<><div className="os-teamnames"><input aria-label="Nombre equipo propio" value={teamA} onChange={e=>setTeamA(e.target.value)} maxLength={45}/><span>contra</span><input aria-label="Nombre rival" value={teamB} onChange={e=>setTeamB(e.target.value)} maxLength={45}/></div>
 <div className="os-teamgrid">{(['A','B'] as const).map(t=>{const m=perf.teams[t],s=m.skills;return <article className="os-card os-teamcard" key={t}><div className="os-teamhead"><span className={'os-team-badge '+t}>{t}</span><h3>{lookupTeam(t)}</h3><small>{m.verified} acciones verificadas</small></div>
 {m.verified===0?<div className="os-empty"><AlertCircle size={21}/><p>No hay resultados verificados. La IA ha detectado contactos, pero aún no ha determinado cuáles terminaron en punto o error.</p><button className="os-secondary" onClick={()=>{setTab('timeline');setFilter('unreviewed')}}>Revisar acciones <ArrowRight size={15}/></button></div>:
 <div className="os-skills">
 <div><strong>Saque</strong><span><b>{s.saque.errors}</b> errores / {s.saque.attempts} saques · {s.saque.points} aces</span><small>{value(percent(s.saque.errors,s.saque.attempts),'%')} de error</small></div>
 <div><strong>Recepción</strong><span><b>{s.recepción.errors}</b> errores / {s.recepción.attempts} recepciones</span><small>{value(receptionRating(s.recepción))}/3 de calidad · {s.recepción.quality3} perfectas</small></div>
 <div><strong>Ataque</strong><span><b>{s.ataque.points}</b> puntos / {s.ataque.attempts} ataques · {s.ataque.errors} errores</span><small>Eficiencia {value(hittingEfficiency(s.ataque))}</small></div>
 <div><strong>Bloqueo</strong><span><b>{s.bloqueo.points}</b> puntos / {s.bloqueo.attempts} bloqueos · {s.bloqueo.errors} errores</span><small>Solo acciones verificadas</small></div>
 <div><strong>Defensa</strong><span><b>{s.defensa.good}</b> defensas con continuidad / {s.defensa.attempts} revisadas</span></div>
 </div>}</article>})}</div>
 {perf.verified===0?<div className="os-honesty"><TrendingDown size={18}/><span>Cuando se confirmen suficientes jugadas, aquí aparecerán los puntos débiles y los enlaces a las acciones concretas. Todavía no sería válido afirmar que el equipo falla más en saque o ataque.</span></div>:<div className="os-honesty"><ClipboardCheck size={18}/><span>Estos porcentajes se calculan <strong>solo sobre las acciones verificadas</strong>, no sobre todos los contactos del partido. No son aún estadísticas completas.</span></div>}
 </>}
 {tab==='players'&&<section className="os-card os-tablecard"><h3>Rendimiento por dorsal</h3><p>Contactos sugeridos por IA y rendimiento técnico verificado por separado.</p><div className="os-scroll"><table><thead><tr><th>Equipo</th><th>Dorsal</th><th>Toques IA</th><th>Saques fallados</th><th>Recepciones erróneas</th><th>Ataques punto</th><th>Errores ataque</th><th>Efic. ataque</th><th>Bloqueos punto</th></tr></thead><tbody>{players.map(p=>{const v=perf.players.find(x=>x.team===p.team&&x.jersey===p.jersey);return <tr key={`${p.team}:${p.jersey}`}><td>{lookupTeam(p.team)}</td><td><strong>#{p.jersey}</strong></td><td>{p.touches}</td><td>{v?.skills.saque.errors??'—'}</td><td>{v?.skills.recepción.errors??'—'}</td><td>{v?.skills.ataque.points??'—'}</td><td>{v?.skills.ataque.errors??'—'}</td><td>{v?value(hittingEfficiency(v.skills.ataque)):'—'}</td><td>{v?.skills.bloqueo.points??'—'}</td></tr>})}</tbody></table></div>{!players.length&&<p>La IA no ha conseguido asociar contactos a dorsales. Puedes asignarlos en «Revisar acciones».</p>}<small>Un guion indica que no existen datos verificados suficientes, no que el jugador haya obtenido cero.</small></section>}
 {tab==='timeline'&&<section className="os-card os-tablecard"><div className="os-review-head"><div><h3>Revisión de acciones</h3><p>La IA propone el momento y el tipo de contacto. Tú confirmas el resultado técnico solo cuando estés seguro.</p></div><div className="os-filter"><Search size={16}/><input value={query} placeholder="Dorsal, tiempo, acción…" onChange={e=>{setQuery(e.target.value);setLimit(60)}}/></div></div>
 <div className="os-filterbuttons">{([['unreviewed','Pendientes'],['all','Todas'],['A',teamA],['B',teamB]] as const).map(([id,l])=><button key={id} className={filter===id?'active':''} onClick={()=>{setFilter(id);setLimit(60)}}>{l}</button>)}</div>
 <div className="os-event-list">{shown.slice(0,limit).map(e=>{const r=reviews[e.id];const skill=(r?.action||e.action);return <article key={e.id} className="os-event"><div className="os-event-main"><span className="os-clock">{formatTime(e.second)}</span><strong>{e.jersey?`#${e.jersey}`:'Jugador sin identificar'}</strong><span>{e.team?lookupTeam(e.team):'Equipo desconocido'}</span><span className="os-event-action">{e.action}</span><span className={'os-state '+(r?'verified':'pending')}>{r?'Verificada':'Provisional'}</span><button onClick={()=>setSelected(selected===e.id?null:e.id)}>{selected===e.id?'Cerrar':'Revisar'} <ChevronRight size={14}/></button></div>
 {selected===e.id&&<EventEditor event={e} review={r} teamA={teamA} teamB={teamB} onConfirm={(patch)=>{if(!report)return;const change=fixAutoEvent(report,e.id,{team:patch.team,jersey:patch.jersey,action:patch.action});updateReport(change);const edited=change.events.find(v=>v.id===e.id)!;try{updateReview(e.id,reviewEvent(edited,patch.action,patch.outcome,patch.jersey));setError('')}catch(ex){setError(ex instanceof Error?ex.message:'Resultado inválido')}setSelected(null)}} onClear={()=>{updateReview(e.id,null);setSelected(null)}}/>}</article>})}</div>
 {!shown.length&&<div className="os-empty">No hay acciones para este filtro.</div>}{limit<shown.length&&<button className="os-secondary os-showmore" onClick={()=>setLimit(limit+60)}>Mostrar 60 más ({shown.length-limit} pendientes)</button>}
 </section>}
 <div className="os-report-footer">Las predicciones no equivalen a estadísticas oficiales. Para determinar resultados automáticos fiables habrá que validar un clasificador específico de finales de jugada y un modelo de marcador sobre retransmisiones reales.</div>
 </>}
 {!report&&<section className="os-future"><div><div className="os-tag">CÓMO SE TRABAJA EN VB STATS</div><h2>Una grabación. Las acciones. Un informe claro.</h2><p>No necesitas preparar dorsales ni anotar manualmente todo el partido. La IA busca contactos y trata de identificar jugadores; el informe te permite comprobar los resultados importantes antes de sacar conclusiones.</p></div><div className="os-steps"><div><span>01</span>Vídeo o YouTube</div><div><span>02</span>IA de seguimiento</div><div><span>03</span>Informe por jugador</div></div></section>}
 </main><footer className="os-footer">VB STATS · Acceso abierto · <a href="https://github.com/RubenIglesiasGarcia/VB-Stats" target="_blank" rel="noreferrer">Código en GitHub <ExternalLink size={12}/></a></footer></div>;
}
function EventEditor({event,review,teamA,teamB,onConfirm,onClear}:{event:AutoAnalysis['events'][number];review?:Reviews[string];teamA:string;teamB:string;onConfirm:(patch:{team:'A'|'B';jersey:string;action:Skill;outcome:Reviews[string]['outcome']})=>void;onClear:()=>void}){
 const [team,setTeam]=useState<'A'|'B'|''>(review?.team||event.team||'');
 const [jersey,setJersey]=useState(review?.jersey||event.jersey||'');
 const [skill,setSkill]=useState<Skill>(review?.action!=='toque'&&review?.action?review.action:event.action!=='toque'?event.action:'saque');
 const [outcome,setOutcome]=useState<Reviews[string]['outcome']|''>(review?.outcome||'');
 return <div className="os-event-editor"><div><label>Equipo</label><select value={team} onChange={e=>setTeam(e.target.value as 'A'|'B'|'')}><option value="">Sin identificar</option><option value="A">{teamA}</option><option value="B">{teamB}</option></select></div><div><label>Dorsal (opcional)</label><input value={jersey} inputMode="numeric" maxLength={2} placeholder="?" onChange={e=>setJersey(e.target.value.replace(/\D/g,''))}/></div><div><label>Acción real</label><select value={skill} onChange={e=>{setSkill(e.target.value as Skill);setOutcome('')}}>{allSkills.map(s=><option key={s} value={s}>{s}</option>)}</select></div><div><label>Resultado comprobado</label><select value={outcome} onChange={e=>setOutcome(e.target.value as Reviews[string]['outcome']||'')}><option value="">Seleccionar resultado</option>{RESULT_CHOICES[skill].map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div><div className="os-editor-actions"><button className="os-primary" disabled={!team||!outcome} onClick={()=>onConfirm({team:team as 'A'|'B',jersey,action:skill,outcome:outcome as Reviews[string]['outcome']})}><CheckCircle2 size={16}/> Confirmar</button>{review&&<button className="os-secondary" onClick={onClear}>Desmarcar</button>}</div></div>;
}
