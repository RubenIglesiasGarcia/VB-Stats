import { useEffect, useRef, useState } from 'react';
import { Activity, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Cpu, FileVideo, LoaderCircle, PauseCircle, Play, ScanSearch, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import {CourtCalibration, WHOLE_FRAME, type CourtRegion} from './CourtCalibration';
import { formatTime, playersFromEvents, SKILLS, SKILL_OPTIONS, OUTCOME_LABELS,
  type DetectionSuggestion, type MatchData, type Outcome, type Skill, type Team } from './model';

const API=(import.meta.env.VITE_ANALYSIS_API || 'http://127.0.0.1:8000').replace(/\/$/,'');
type Engine='ravel'|'yolo';
type EngineInfo={ready:boolean;name:string;note:string;detects:string[]};
type Capabilities={contact_suggestions:boolean;model_note:string;maxUploadMB:number;maxSegmentSeconds:number;pipeline:string;engines?:Record<Engine,EngineInfo>};
type QualityWindow={startSeconds:number;endSeconds:number;frames:number;ballFrames:number;personFrames:number;contactCandidates:number};
type JobResponse={jobId:string;status:'queued'|'running'|'cancelled'|'failed'|'completed';progress:number;error?:string|null;
  proposals:DetectionSuggestion[];stats?:{analyzedFrames:number;framesWithBall:number;framesWithPeople:number;contactCandidates:number;pauseCandidates:number;sampleFpsEffective:number;startSeconds:number;endSeconds:number;ballCoveragePercent?:number;personCoveragePercent?:number;ignoredPersonsOutsideCourt?:number;unmatchedBallFrames?:number;ballReacquisitions?:number;coverage?:QualityWindow[];rallyCandidates?:{startSeconds:number;endSeconds:number;status:string}[];rallyCandidateCount?:number;engine?:string}|null};

interface Props {
  file:File|null;
  hasYouTube:boolean;
  review:MatchData['analysisReview'];
  currentSecond:number;
  selectedSet:number;
  selectedRally:number;
  match:MatchData;
  onSeek:(seconds:number)=>void;
  onImport:(suggestions:DetectionSuggestion[],sourceName:string)=>void;
  onDecision:(id:string,status:'accepted'|'rejected'|'pending')=>void;
  onConfirm:(suggestion:DetectionSuggestion, team:Team,jersey:string,skill:Skill,outcome:Outcome)=>boolean;
  onSelectVideo:()=>void;
  onExport:()=>void;
}

const errorMessage=async(response:Response)=>{
  try{const b=await response.json();return typeof b.detail==='string'?b.detail:`Error ${response.status}`}
  catch{return `Error ${response.status}`}
};
const verdict=(value:number)=>value>=.65?'Señal fuerte':value>=.45?'Señal media':'Señal débil';
const timestamp=(s:number)=>formatTime(s);

export function DetectionPanel({file,hasYouTube,review,currentSecond,selectedSet,selectedRally,match,
  onSeek,onImport,onDecision,onConfirm,onSelectVideo,onExport}:Props){
  const [expanded,setExpanded]=useState(false);
  const [cap,setCap]=useState<Capabilities|null>(null);
  const [connectTick,setConnectTick]=useState(0);
  const [apiError,setApiError]=useState('');
  const [busy,setBusy]=useState<'upload'|'start'|null>(null);
  const [job,setJob]=useState<JobResponse|null>(null);
  const [jobId,setJobId]=useState<string|null>(null);
  const [uploaded,setUploaded]=useState<{id:string;name:string}|null>(null);
  const [videoProbe,setVideoProbe]=useState<{durationSeconds:number;fps:number;width:number;height:number}|null>(null);
  const [start,setStart]=useState(0);
  const [seconds,setSeconds]=useState(120);
  const [colorA,setColorA]=useState('#265bac');
  const [colorB,setColorB]=useState('#b9373f');
  const [sampleFps]=useState(6);
  const [courtRegion,setCourtRegion]=useState<CourtRegion>(WHOLE_FRAME);
  const [detailMode,setDetailMode]=useState<'balanced'|'detailed'>('balanced');
  const [engine,setEngine]=useState<Engine>('ravel');
  const [selected,setSelected]=useState<string|null>(null);
  const [showAll,setShowAll]=useState(false);
  const [team,setTeam]=useState<Team|''>('');
  const [jersey,setJersey]=useState('');
  const [skill,setSkill]=useState<Skill|''>('');
  const [outcome,setOutcome]=useState<Outcome|''>('');
  const [notice,setNotice]=useState('');
  const importedJob=useRef<string|null>(null);
  const lastFile=useRef<File|null>(null);
  const candidates=review?.proposals||[];
  const pending=candidates.filter(p=>p.status==='pending');
  const chosen=candidates.find(p=>p.id===selected)||pending[0]||null;
  const pendingContacts=pending.filter(p=>p.kind==='contact_candidate');
  const list=showAll?candidates:pending;
  const configured=Boolean(cap?.engines?.[engine]?.ready ?? cap?.contact_suggestions);
  const engineName=cap?.engines?.[engine]?.name||engine;

  useEffect(()=>{
    if(!expanded)return;
    const c=new AbortController();
    let busy=false;
    const retrieve=async()=>{
      if(busy||c.signal.aborted)return;
      busy=true;
      try{
        const response=await fetch(`${API}/capabilities`,{signal:c.signal});
        if(!response.ok)throw Error('API no disponible');
        setCap(await response.json());setApiError('');
      }
      catch(e){if(!c.signal.aborted){setCap(null);setApiError('El motor de IA no está conectado. Comprueba la ventana del servidor o ejecuta REPARAR MOTOR IA.cmd.')}}
      finally{busy=false;}
    };
    void retrieve();
    // La instalación de RAVEL puede tardar: reflejar el estado nuevo sin recargar la web.
    const interval=window.setInterval(()=>void retrieve(),5000);
    return ()=>{c.abort();window.clearInterval(interval)};
  },[expanded,connectTick]);

  useEffect(()=>{
    if(file!==lastFile.current){lastFile.current=file;setUploaded(null);setVideoProbe(null);setJob(null);setJobId(null);}
  },[file]);

  useEffect(()=>{
    if(!jobId)return;
    let alive=true;
    const poll=async()=>{
      try{const response=await fetch(`${API}/api/analysis/jobs/${jobId}`);
        if(!response.ok)throw Error(await errorMessage(response));
        const result=await response.json() as JobResponse;
        if(!alive)return;
        setJob(result);
        if(result.status==='completed'){
          if(importedJob.current!==jobId){
            importedJob.current=jobId;
            const proposals=(result.proposals||[]).map((p,i)=>({...p,id:`${jobId.slice(0,8)}-${p.id||i}`,status:'pending' as const}));
            onImport(proposals,`${file?.name||'Fragmento analizado'} · ${result.stats?.engine||engine}`);
            setNotice(`Análisis finalizado: ${result.stats?.contactCandidates??0} posibles contactos y ${result.stats?.rallyCandidateCount??0} rallies candidatos. Verifica antes de anotar.`);
            setExpanded(true);
          }
          setJobId(null);
        } else if(result.status==='failed'||result.status==='cancelled'){
          setNotice(result.status==='failed'?(result.error||'El análisis ha fallado.'):'Análisis cancelado.');setJobId(null);
        }
      }catch(e){if(alive){setNotice(e instanceof Error?e.message:'No se pudo consultar el análisis.');setJobId(null)}}
    };
    void poll();const timer=window.setInterval(()=>void poll(),1750);
    return ()=>{alive=false;window.clearInterval(timer)};
  },[jobId,file,onImport]);

  async function submit(){
    if(!file){setNotice('Selecciona un archivo de vídeo local antes de analizar.');return;}
    if(!configured){setNotice(cap?.engines?.[engine]?.note||'Configura el motor de IA seleccionado primero.');return;}
    if(cap && file.size>cap.maxUploadMB*1024*1024){setNotice(`El vídeo supera ${cap.maxUploadMB} MB. Recorta un fragmento local primero.`);return;}
    if(!Number.isFinite(start)||start<0||seconds<5||seconds>900){setNotice('Comprueba el inicio y la duración (5–900 s).');return;}
    try{
      setNotice('');setBusy('upload');
      let fileId=uploaded?.name===file.name?uploaded.id:null;
      if(!fileId){
        const body=new FormData();body.append('file',file,file.name);
        const res=await fetch(`${API}/api/analysis/uploads`,{method:'POST',body});
        if(!res.ok)throw Error(await errorMessage(res));
        const result=await res.json() as {uploadId:string};fileId=result.uploadId;
        setUploaded({id:fileId,name:file.name});
      }
      const probe=await fetch(`${API}/api/analysis/uploads/${fileId}/probe`);
      if(!probe.ok)throw Error(await errorMessage(probe));
      const details=await probe.json() as {durationSeconds:number;fps:number;width:number;height:number};
      setVideoProbe(details);
      if(start>=details.durationSeconds)throw Error('El inicio está fuera del vídeo. Elige un instante anterior.');
      setBusy('start');
      const res=await fetch(`${API}/api/analysis/jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        uploadId:fileId,engine,startSeconds:start,durationSeconds:seconds,sampleFps:detailMode==='detailed'?Math.min(sampleFps,4):sampleFps,teamAColor:colorA,teamBColor:colorB,detailMode,courtRegion
      })});
      if(!res.ok)throw Error(await errorMessage(res));
      const data=await res.json() as {jobId:string};importedJob.current=null;
      setJobId(data.jobId);setJob({jobId:data.jobId,status:'queued',progress:0,proposals:[]});
    }catch(e){setNotice(e instanceof Error?e.message:'No se pudo iniciar el análisis.')}
    finally{setBusy(null)}
  }
  async function cancel(){if(!jobId)return;try{await fetch(`${API}/api/analysis/jobs/${jobId}`,{method:'DELETE'});setNotice('Cancelación solicitada.')}catch{setNotice('No se pudo cancelar el trabajo.')}}
  async function deleteTemporary(){
    if(!uploaded)return;
    if(jobId){setNotice('Cancela primero el análisis en curso.');return;}
    try{
      const response=await fetch(`${API}/api/analysis/uploads/${uploaded.id}`,{method:'DELETE'});
      if(!response.ok)throw Error(await errorMessage(response));
      setUploaded(null);setVideoProbe(null);setNotice('Copia temporal eliminada del servidor.');
    }catch(e){setNotice(e instanceof Error?e.message:'No se pudo eliminar el vídeo temporal.')}
  }

  function focusSuggestion(p:DetectionSuggestion){
    setSelected(p.id);setTeam(p.teamHint||'');setJersey('');setSkill('');setOutcome('');
    onSeek(Math.max(0,p.second-1.2));
  }
  function confirmCandidate(){
    if(!chosen || chosen.kind!=='contact_candidate')return;
    if(!team||!skill||!outcome){setNotice('Confirma expresamente equipo, acción y resultado. El modelo no puede determinarlo aún.');return;}
    const ok=onConfirm(chosen,team,jersey,skill,outcome);
    if(ok){onDecision(chosen.id,'accepted');setSelected(null);setNotice('Contacto confirmado y añadido a las estadísticas.');}
  }

  return <section className={`ai-lab panel ${expanded?'ai-lab-open':''}`} aria-label="Laboratorio de visión artificial" id="ai-laboratory">
    <button type="button" className="ai-lab-header" onClick={()=>setExpanded(s=>!s)} aria-expanded={expanded}>
      <span className="ai-lab-logo"><ScanSearch size={19}/></span>
      <span className="ai-lab-title"><strong>Laboratorio de detección <span className="ai-beta">BETA</span></strong><small>Balón · jugadores · posibles contactos · revisión humana</small></span>
      {pending.length>0&&<span className="ai-lab-count">{pending.length} por revisar</span>}
      <ChevronDown size={19} className="ai-lab-chevron"/>
    </button>
    {expanded&&<div className="ai-lab-body">
      <div className="ai-info"><ShieldCheck size={17}/><span>La IA propone <strong>instantes para revisar</strong>, no resultados oficiales. Los dorsales y los tipos de toque se confirman manualmente. Ninguna propuesta cuenta como estadística hasta que la aceptes.</span></div>
      <div className="ai-lab-columns">
        <div className="ai-setup">
          <div className="ai-section-heading"><span className="ai-step">01</span><strong>Configurar fragmento</strong></div>
          <div className="ai-service"><span className={`ai-service-dot ${configured?'online':'offline'}`}/><div><strong>{configured?'Detector preparado':apiError?'API desconectada':'Detector sin modelo'}</strong><small>{apiError||cap?.model_note||'Comprobando capacidad del servidor...'}</small></div><button className="ai-recheck" onClick={()=>setConnectTick(n=>n+1)} title="Volver a comprobar conexión">Revisar</button></div>
          {(apiError||cap&&!configured)&&<div className="ai-connection-help" role="status"><strong>{apiError?'El servidor local no ha arrancado':'El servidor funciona, pero falta preparar el modelo seleccionado'}</strong><span>{apiError?'Abre REPARAR MOTOR IA.cmd en la carpeta de VB Stats, sin cerrar la ventana que aparezca.':'RAVEL puede seguir descargándose. Revisa la ventana de instalación y vuelve aquí; se actualizará automáticamente.'}</span><a href={`${API}/health`} target="_blank" rel="noreferrer">Comprobar servidor local</a></div>}
          <label className="ai-precision-select">Motor de análisis
            <select value={engine} onChange={e=>setEngine(e.target.value as Engine)} disabled={Boolean(jobId)}>
              <option value="ravel">RAVEL-VB-013 · específico de voleibol</option>
              <option value="yolo">YOLO COCO · detección genérica</option>
            </select>
          </label>
          {cap?.engines&&<p className="ai-engine-note" role="status"><strong>{engineName}</strong> · {cap.engines[engine]?.note}</p>}
          <div className="ai-file-selected"><FileVideo size={17}/><span>{file?file.name:hasYouTube?'YouTube enlazado: para analizarlo necesitas el archivo original':'Sin vídeo seleccionado'}</span><button type="button" onClick={onSelectVideo}>Elegir archivo</button></div>
          <div className="ai-analysis-fields">
            <label>Inicio (segundos)<input type="number" min={0} max={86400} step={1} value={start} onChange={e=>setStart(Number(e.target.value))}/></label>
            <label>Duración<select value={seconds} onChange={e=>setSeconds(Number(e.target.value))}><option value={60}>1 minuto</option><option value={120}>2 minutos</option><option value={300}>5 minutos</option><option value={600}>10 minutos</option><option value={900}>15 minutos</option></select></label>
            <label>Color equipo A<input type="color" title="Color aproximado camiseta equipo A" value={colorA} onChange={e=>setColorA(e.target.value)}/></label>
            <label>Color equipo B<input type="color" title="Color aproximado camiseta equipo B" value={colorB} onChange={e=>setColorB(e.target.value)}/></label>
          </div>
          {videoProbe&&<div className="ai-video-probe">Vídeo validado: <b>{formatTime(videoProbe.durationSeconds)}</b> · {videoProbe.width}×{videoProbe.height} · {videoProbe.fps} FPS</div>}
          {engine==='yolo'&&<label className="ai-precision-select">Modo de detección
            <select value={detailMode} onChange={e=>setDetailMode(e.target.value as 'balanced'|'detailed')}>
              <option value="balanced">Equilibrado · personas y balón</option>
              <option value="detailed">Balón pequeño · recortes extra (más lento)</option>
            </select>
          </label>}
          {engine==='ravel'&&<p className="ai-precision-select">RAVEL analiza los fotogramas con pesos especializados. El recorte de pista es solo para el motor YOLO. Los IDs detectados no son dorsales.</p>}
          {engine==='yolo'&&<CourtCalibration file={file} second={start} region={courtRegion} onChange={setCourtRegion}/>}
          <div className="ai-analysis-actions"><button className="btn btn-outline" disabled={!file} onClick={()=>setStart(Math.max(0,Math.floor(currentSecond)))}><Clock3 size={15}/> Desde vídeo</button>
            <button className="btn btn-lime" disabled={!file||!configured||busy!==null||Boolean(jobId)} onClick={()=>void submit()}>
              {busy||jobId?<LoaderCircle size={15} className="ai-spin"/>:<ScanSearch size={15}/>}{busy==='upload'?'Subiendo vídeo…':busy==='start'?'Iniciando…':jobId?'Procesando…':'Analizar fragmento'}</button></div>
          {job&&<div className="ai-progress" role="status"><div><strong>{job.status==='completed'?'Análisis finalizado':job.status==='failed'?'Análisis fallido':job.status==='cancelled'?'Cancelado':'Procesando fotogramas'}</strong><span>{job.progress||0}%</span></div><div className="ai-progress-track"><span style={{width:`${Math.max(0,Math.min(job.progress||0,100))}%`}}/></div>{jobId&&<button onClick={()=>void cancel()}><PauseCircle size={14}/> Cancelar análisis</button>}</div>}
          {job?.status==='completed'&&job.stats&&<div className="ai-diagnostics" aria-label="Diagnóstico de cobertura visual">
            <div className="ai-diagnostics-head"><strong>Cobertura visual estimada</strong><small>No equivale a precisión de acciones ni a porcentaje de contactos reconocidos.</small></div>
            <div className="ai-diagnostics-metrics"><span><b>{job.stats.ballCoveragePercent??'—'}%</b><small>Fotogramas con balón</small></span><span><b>{job.stats.personCoveragePercent??'—'}%</b><small>Fotogramas con jugadores</small></span><span><b>{job.stats.ignoredPersonsOutsideCourt??0}</b><small>Personas fuera de pista filtradas</small></span></div>
            <div className="ai-coverage-timeline" aria-label="Cobertura del balón por tramos de 15 segundos">
              {(job.stats.coverage||[]).map((w,i)=>{const v=w.frames?Math.round(100*w.ballFrames/w.frames):0;return <span key={`${w.startSeconds}-${i}`} className={v>=60?'good':v>=25?'partial':'low'} title={`${timestamp(w.startSeconds)}–${timestamp(w.endSeconds)}: balón en ${v}% de los fotogramas · ${w.contactCandidates} propuestas de contacto`}/>})}
            </div>
            <p>{(job.stats.ballCoveragePercent??0)<20?'Cobertura de balón baja. Prueba el modo detallado y delimita la pista antes de interpretar resultados.':'Revisa igualmente las jugadas: un balón visible no garantiza que el contacto se haya reconocido.'}</p>
          </div>}
          {job?.status==='completed'&&Boolean(job.stats?.rallyCandidates?.length)&&<div className="ai-diagnostics" aria-label="Rallies sugeridos">
            <div className="ai-diagnostics-head"><strong>{job.stats?.rallyCandidateCount} rallies candidatos</strong><small>Detectados por períodos de balón visible, no por marcador.</small></div>
            <div className="ai-rally-list">{job.stats?.rallyCandidates?.slice(0,32).map((r,i)=><button type="button" key={`${r.startSeconds}-${i}`} onClick={()=>onSeek(Math.max(0,r.startSeconds-1))} className="ai-rally-jump">#{i+1} · {timestamp(r.startSeconds)}–{timestamp(r.endSeconds)} <Play size={13}/></button>)}</div>
          </div>}
          {job?.status==='completed'&&videoProbe&&<div className="ai-next-interval"><span>¿Quieres seguir con el siguiente tramo? Se reutiliza el vídeo ya subido.</span><button type="button" onClick={()=>{setStart(v=>Math.min(Math.max(0,videoProbe.durationSeconds-1),v+seconds));setJob(null);setNotice('Tramo preparado. Pulsa Analizar fragmento para continuar.')}} disabled={start+seconds>=videoProbe.durationSeconds}>Siguiente tramo →</button></div>}
          {uploaded&&<button type="button" className="ai-delete-temp" onClick={()=>void deleteTemporary()} disabled={Boolean(jobId)}>Eliminar copia temporal del servidor</button>}
          <p className="ai-privacy"><CircleHelp size={14}/> Solo cuando pulsas Analizar se sube una copia a tu API. Los vídeos se eliminan de allí tras 24 horas o manualmente. No expongas la API local a internet sin autenticación.</p>
        </div>
        <div className="ai-review-panel">
          <div className="ai-section-heading"><span className="ai-step">02</span><strong>Revisar y validar</strong><span className="ai-counts">{candidates.filter(p=>p.status==='accepted').length} aceptados · {pendingContacts.length} contactos pendientes</span></div>
          {candidates.length===0?<div className="ai-review-empty"><Cpu size={27}/><strong>Las propuestas aparecerán aquí</strong><p>Analiza un fragmento corto y revisa los posibles contactos. Con RAVEL-VB-013 se buscan toques por un modelo especializado; no se adjudican puntos sin revisión.</p></div>:<>
            <div className="ai-review-summary"><span><Sparkles size={15}/> {pending.length} por revisar</span><button type="button" onClick={()=>setShowAll(v=>!v)}>{showAll?'Solo pendientes':'Ver todos'} <ChevronRight size={14}/></button></div>
            <div className="ai-proposal-list" role="list" aria-label="Propuestas de detección">
              {list.slice(0,120).map(p=><button type="button" role="listitem" onClick={()=>focusSuggestion(p)} key={p.id} className={`ai-proposal ${chosen?.id===p.id?'active':''} ${p.status!=='pending'?'dimmed':''}`}>
                <span className="ai-proposal-play"><Play size={13}/></span>
                <span className="ai-proposal-text"><strong>{timestamp(p.second)} · {p.kind==='contact_candidate'?'Posible contacto':'Posible pausa'}</strong><small>{p.trackId?`Persona seguida ${p.trackId}`:'Sin jugador'} · {p.teamHint?`Equipo sugerido ${p.teamHint}`:'Equipo sin determinar'}</small></span>
                <span className="ai-proposal-score" title="Señal geométrica heurística; no probabilidad calibrada">{p.status==='pending'?verdict(p.confidence):p.status==='accepted'?'Validado':'Descartado'}</span>
              </button>)}
              {list.length>120&&<p className="ai-truncated">Mostrando 120 de {list.length} propuestas. Exporta JSON para guardar todas.</p>}
            </div>
            {chosen&&<div className="ai-inspector">
              <div className="ai-inspector-head"><div><strong>{timestamp(chosen.second)} · {chosen.kind==='contact_candidate'?'Revisar contacto':'Revisar pausa'}</strong><small>{chosen.reason}</small></div><button type="button" className="icon-button small" title="Ir al vídeo" onClick={()=>onSeek(Math.max(0,chosen.second-1))}><Play size={15}/></button></div>
              {chosen.status==='pending'&&chosen.kind==='contact_candidate'&&<>
                <div className="ai-review-fields">
                  <label>Equipo<select value={team} onChange={e=>{setTeam(e.target.value as Team|'');setJersey('')}}><option value="">Elegir equipo</option><option value="A">A · {match.teams.A}</option><option value="B">B · {match.teams.B}</option></select></label>
                  <label>Dorsal<select value={jersey} onChange={e=>setJersey(e.target.value)}><option value="">Sin identificar</option>{(team?playersFromEvents(match,team):[]).map(p=><option key={p.jersey} value={p.jersey}>#{p.jersey}{p.name?` · ${p.name}`:''}</option>)}</select></label>
                  <label>Acción<select value={skill} onChange={e=>{const v=e.target.value as Skill|'';setSkill(v);setOutcome('')}}><option value="">Elegir acción</option>{SKILLS.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
                  <label>Resultado<select disabled={!skill} value={outcome} onChange={e=>setOutcome(e.target.value as Outcome|'')}><option value="">Elegir resultado</option>{skill&&SKILL_OPTIONS[skill].map(s=><option key={s} value={s}>{OUTCOME_LABELS[s]}</option>)}</select></label>
                </div><p className="ai-target-rally">Se anotará en <b>set {selectedSet}, rally {selectedRally}</b>. Comprueba el punto activo antes de validar.</p>
                </>}
              <div className="ai-inspector-actions">
                {chosen.status==='pending'&&chosen.kind==='contact_candidate'&&<button className="btn btn-lime" onClick={confirmCandidate}><Check size={16}/> Confirmar acción</button>}
                {chosen.status==='pending'&&<button className="btn btn-outline" onClick={()=>{onDecision(chosen.id,'rejected');setSelected(null)}}><X size={15}/> Descartar</button>}
                {chosen.status!=='pending'&&<button className="btn btn-outline" onClick={()=>onDecision(chosen.id,'pending')}>Volver a revisar</button>}
              </div>
            </div>}
          </>}
        </div>
      </div>
      {notice&&<p className="ai-notice" role="status">{notice}</p>}
      {candidates.length>0&&<div className="ai-dataset-tools"><span>Las decisiones confirmadas sirven como etiquetas verificadas para futuras mejoras del modelo.</span><button className="btn btn-outline" onClick={onExport}><Upload size={14}/> Exportar dataset CSV</button></div>}
      <div className="ai-lab-foot"><Activity size={15}/> RAVEL reconoce solo Touch/no Touch; clasificación detallada y OCR de dorsales: pendiente de datos etiquetados y evaluación. Esta beta no etiqueta esas acciones automáticamente.</div>
    </div>}
  </section>;
}
