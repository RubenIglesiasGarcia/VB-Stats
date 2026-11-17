import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,AlertTriangle,ArrowRight,BarChart3,CheckCircle2,Download,FileVideo,Link2,LoaderCircle,PauseCircle,Play,RefreshCw,Scan,ShieldAlert,Users} from 'lucide-react';
import {formatTime,type Team} from './model';
import {hasAutomaticReport} from './reportState';
import {AUTO_ACTIONS,autoCSV,autoPlayerCSV,autoMetrics,autoTracks,autoPlayerTotals,fixAutoEvent,fixAutoRally,fixAutoTrack,
  sanitizeAuto,type AutoAction,type AutoAnalysis} from './automatic';
import './auto.css';

const API=(import.meta.env.VITE_ANALYSIS_API||'http://127.0.0.1:8000').replace(/\/$/,'');
const JOB_KEY='vbstats-automatic-job';
interface Job{phase?:'downloading'|'analysis'|'completed'|'failed'|'cancelled';downloadProgress?:number;jobId:string;status:'queued'|'running'|'completed'|'failed'|'cancelled';progress:number;
  stage?:string;error?:string;processedSegments?:number;totalSegments?:number;autoAnalysis?:AutoAnalysis|null;}
interface Props{file:File|null;youtube:boolean;youtubeId?:string|null;teams:Record<Team,string>;data?:AutoAnalysis;
  onSelectFile:()=>void;onSave:(next:AutoAnalysis)=>void;onSeek:(seconds:number)=>void;}
type Filter='all'|'uncertain'|'A'|'B';
async function message(response:Response){
  try{const body=await response.json();return typeof body.detail==='string'?body.detail:`Error ${response.status}`;}
  catch{return `Error ${response.status}`;}
}
function download(name:string,content:string,mime:string){
  const url=URL.createObjectURL(new Blob([content],{type:mime}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1500);
}
export function AutoStudio({file,youtube,youtubeId,teams,data,onSelectFile,onSave,onSeek}:Props){
  const [connected,setConnected]=useState<boolean|null>(null);
  const [youtubeReady,setYoutubeReady]=useState(false);
  const [ocrReady,setOcrReady]=useState(false);
  const [sourceMode,setSourceMode]=useState<'youtube'|'file'>(youtube?'youtube':file?'file':'youtube');
  const [youtubeURL,setYoutubeURL]=useState(()=>youtubeId?`https://www.youtube.com/watch?v=${youtubeId}`:'');
  const [authorized,setAuthorized]=useState(false);
  const [reason,setReason]=useState('');
  const [upload,setUpload]=useState<{id:string;file:File}|null>(null);
  const [busy,setBusy]=useState(false);
  const [jobId,setJobId]=useState(()=>sessionStorage.getItem(JOB_KEY)||'');
  const [failedJobId,setFailedJobId]=useState('');
  const [maxUploadMB,setMaxUploadMB]=useState(3072);
  const [job,setJob]=useState<Job|null>(null);
  const [messageText,setMessageText]=useState('');
  const [tab,setTab]=useState<'players'|'actions'|'rallies'>('players');
  const [filter,setFilter]=useState<Filter>('all');
  const [count,setCount]=useState(40);
  const [colorA,setColorA]=useState('#265bac');
  const [colorB,setColorB]=useState('#b9373f');
  const [find,setFind]=useState('');
  const latestSave=useRef(onSave);latestSave.current=onSave;
  const imported=useRef('');
  useEffect(()=>{let active=true;
    const check=async()=>{
      try{const response=await fetch(`${API}/capabilities`);if(!response.ok)throw Error('Servidor desconectado');
        const caps=await response.json();if(active){setConnected(Boolean(caps.engines?.ravel?.ready));setYoutubeReady(Boolean(caps.youtube_import));setOcrReady(Boolean(caps.jersey_recognition));setMaxUploadMB(caps.maxUploadMB||3072);setReason(caps.engines?.ravel?.note||'Motor no configurado');}}
      catch{if(active){setConnected(false);setReason('La API local no responde. Ejecuta REPARAR MOTOR IA.cmd.');}}
    };void check();const timer=window.setInterval(()=>void check(),7000);return()=>{active=false;window.clearInterval(timer)};
  },[]);
  useEffect(()=>{setUpload(null);},[file]);
  useEffect(()=>{if(youtubeId){setYoutubeURL(`https://www.youtube.com/watch?v=${youtubeId}`);setSourceMode('youtube');}},[youtubeId]);
  useEffect(()=>{
    if(!jobId)return;
    sessionStorage.setItem(JOB_KEY,jobId);
    let active=true;
    const poll=async()=>{
      try{const res=await fetch(`${API}/api/analysis/jobs/${jobId}`);if(!res.ok)throw Error(await message(res));
        const next=await res.json() as Job;
        if(!active)return;
        setJob(next);
        if(next.status==='completed'){
          if(next.autoAnalysis&&imported.current!==jobId){
            const clean=sanitizeAuto(next.autoAnalysis);
            if(clean){imported.current=jobId;setFailedJobId('');latestSave.current(clean);setTab('players');setMessageText('Análisis completo guardado. Las acciones propuestas ya aparecen en el informe sin anotarlas a mano.');}
          }
          sessionStorage.removeItem(JOB_KEY);setJobId('');
        }else if(next.status==='failed'||next.status==='cancelled'){
          setFailedJobId(jobId);setMessageText(next.error||'El análisis no se completó.');sessionStorage.removeItem(JOB_KEY);setJobId('');
        }
      }catch(err){if(active){setMessageText(err instanceof Error?err.message:'No se pudo consultar el progreso');setJobId('');sessionStorage.removeItem(JOB_KEY)}}
    };
    void poll();const timer=window.setInterval(()=>void poll(),2200);
    return()=>{active=false;window.clearInterval(timer)};
  },[jobId]);
  const stats=useMemo(()=>data?autoMetrics(data):null,[data]);
  const tracks=useMemo(()=>data?autoTracks(data):[],[data]);
  const playerTotals=useMemo(()=>data?autoPlayerTotals(data):[],[data]);
  const filtered=useMemo(()=>data?.events.filter(e=>{
    if(filter==='uncertain'&&e.team&&e.action!=='toque')return false;
    if((filter==='A'||filter==='B')&&e.team!==filter)return false;
    if(find.trim()&&![formatTime(e.second),String(e.rally||''),e.jersey,e.trackKey,e.action].join(' ').toLowerCase().includes(find.toLowerCase()))return false;
    return true;
  })||[],[data,filter,find]);
  useEffect(()=>setCount(40),[filter,find]);

  async function start(){
    if(!connected){setMessageText(reason);return;}
    if(sourceMode==='youtube'&&!youtubeURL.trim()){setMessageText('Pega el enlace de tu retransmisión de YouTube.');return;}
    if(sourceMode==='youtube'&&!authorized){setMessageText('Confirma que tienes permiso para procesar la grabación.');return;}
    if(sourceMode==='youtube'&&!youtubeReady){setMessageText('La API funciona, pero falta yt-dlp. Ejecuta REPARAR MOTOR IA.cmd.');return;}
    if(sourceMode==='file'&&!file){setMessageText('Selecciona un archivo MP4 o cambia a YouTube.');onSelectFile();return;}
    if(sourceMode==='file'&&file&&file.size>maxUploadMB*1024*1024){setMessageText(`El vídeo excede ${maxUploadMB} MB. Comprímelo o cambia el límite VBSTATS_MAX_UPLOAD_MB.`);return;}
    setBusy(true);setMessageText('');
    try{
      const opts={teamAColor:colorA,teamBColor:colorB,chunkSeconds:600,
        rosterA:[],rosterB:[]};
      let next:{jobId:string};
      if(sourceMode==='youtube'){
        setMessageText('Importando la retransmisión en tu propio ordenador. No necesitas descargarla manualmente.');
        const res=await fetch(`${API}/api/analysis/youtube-jobs`,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...opts,url:youtubeURL.trim(),authorized})});
        if(!res.ok)throw Error(await message(res));
        next=await res.json() as {jobId:string};
      }else{
        if(!file)throw Error('No se ha seleccionado vídeo.');
        let id=upload?.file===file?upload.id:null;
        if(!id){
          setMessageText('Copiando el vídeo al motor local. No cierres esta pestaña.');
          const form=new FormData();form.append('file',file,file.name);
          const res=await fetch(`${API}/api/analysis/uploads`,{method:'POST',body:form});
          if(!res.ok)throw Error(await message(res));
          id=(await res.json()).uploadId as string;setUpload({id,file});
        }
        const probe=await fetch(`${API}/api/analysis/uploads/${id}/probe`);
        if(!probe.ok)throw Error(await message(probe));
        const meta=await probe.json() as {durationSeconds:number};
        if(meta.durationSeconds>21600)throw Error('La duración máxima es de seis horas.');
        const res=await fetch(`${API}/api/analysis/auto-jobs`,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...opts,uploadId:id})});
        if(!res.ok)throw Error(await message(res));
        next=await res.json() as {jobId:string};
      }
      setFailedJobId('');setJobId(next.jobId);
      setJob({jobId:next.jobId,status:'queued',progress:0,
        stage:sourceMode==='youtube'?'Importando desde YouTube':'Preparando vídeo',
        phase:sourceMode==='youtube'?'downloading':'analysis'});
      setMessageText('Todo en marcha: primero se prepara el vídeo y después se analizan sus contactos automáticamente.');
    }catch(err){setMessageText(err instanceof Error?err.message:'No se pudo iniciar el análisis.');}
    finally{setBusy(false);}
  }
  async function resume(){if(!failedJobId)return;try{const res=await fetch(`${API}/api/analysis/jobs/${failedJobId}/resume`,{method:'POST'});if(!res.ok)throw Error(await message(res));setMessageText('Reanudando desde el último tramo completado.');setJobId(failedJobId);setFailedJobId('');}catch(err){setMessageText(err instanceof Error?err.message:'No se pudo reanudar.')}}
  async function cancel(){if(!jobId)return;await fetch(`${API}/api/analysis/jobs/${jobId}`,{method:'DELETE'});setMessageText('Cancelación solicitada.');}
  const active=Boolean(jobId);
  const reportReady=hasAutomaticReport(data);
  return <section className="auto-studio panel" id="automatic" aria-label="Análisis automático del partido">
    <div className="auto-head">
      <div className="auto-head-icon"><Scan size={22}/></div>
      <div className="auto-head-copy"><div className="eyebrow text-lime">AUTO MATCH ANALYSIS</div><h2>Analiza el partido entero.</h2>
        <p>La IA procesa todos los tramos, construye un informe y solo después tú corriges lo necesario.</p></div>
      <span className={`auto-status ${connected?'auto-status-on':'auto-status-off'}`}><span className="status-dot"/>{connected?'RAVEL disponible':connected===null?'Comprobando IA':'IA sin conexión'}</span>
    </div>
    <div className="auto-launch">
      <div className="auto-source-modes" role="group" aria-label="Origen del partido">
        <button className={sourceMode==='youtube'?'active':''} aria-pressed={sourceMode==='youtube'} onClick={()=>setSourceMode('youtube')}><Link2 size={16}/> Enlace de YouTube</button>
        <button className={sourceMode==='file'?'active':''} aria-pressed={sourceMode==='file'} onClick={()=>setSourceMode('file')}><FileVideo size={16}/> Archivo local</button>
      </div>
      {sourceMode==='youtube'?<div className="auto-youtube-source">
        <label htmlFor="auto-youtube-url">Enlace al partido</label>
        <input id="auto-youtube-url" type="url" autoComplete="url" placeholder="https://www.youtube.com/live/…" value={youtubeURL}
          onChange={e=>setYoutubeURL(e.target.value)} disabled={active||busy}/>
        <p>VB Stats prepara una copia temporal en tu ordenador, analiza todo el vídeo y borra los archivos temporales tras 24 h. No tienes que subir nada.</p>
        <label className="auto-permission"><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/>
          Tengo permiso para procesar esta grabación y cumpliré las condiciones de YouTube.</label>
        {!youtubeReady&&<p className="auto-youtube-warning">Falta el importador yt-dlp. Ejecuta REPARAR MOTOR IA.cmd.</p>}
      </div>:<div className="auto-source"><FileVideo size={19}/><div><b>{file?.name||'Sin archivo MP4'}</b><span>{file?`${(file.size/1024/1024).toFixed(1)} MB · vídeo local`:'Elige el vídeo completo de tu ordenador'}</span></div>
        <button className="btn btn-outline" disabled={active||busy} onClick={onSelectFile}>{file?'Cambiar':'Seleccionar vídeo'}</button></div>}
      <div className="auto-identity-status"><Users size={17}/><div><strong>{ocrReady?'Dorsales automáticos activados':'Reconocimiento de dorsales no disponible'}</strong><span>{ocrReady?'No necesitas introducir ningún dorsal. La IA los buscará a lo largo del partido y dejará como desconocidos los que no pueda leer.':'El análisis puede comenzar sin dorsales. Para activar su lectura, usa REPARAR MOTOR IA.cmd e instala el módulo OCR.'}</span></div></div>
      <details className="auto-options"><summary>Ajustes de identificación de equipos <span>Opcional</span></summary>
        <p>Si la IA confunde los equipos, ajusta estos colores según las camisetas. No hace falta tocarlo en cada partido.</p>
        <div className="auto-colors"><label><input type="color" value={colorA} onChange={e=>setColorA(e.target.value)}/> {teams.A}</label><label><input type="color" value={colorB} onChange={e=>setColorB(e.target.value)}/> {teams.B}</label></div>
      </details>
      <button className="btn btn-lime auto-launch-button" disabled={!connected||busy||active||(sourceMode==='file'&&!file)||(sourceMode==='youtube'&&(!youtubeReady||!youtubeURL.trim()||!authorized))} onClick={()=>void start()}>
        {busy||active?<LoaderCircle size={18} className="ai-spin"/>:<Scan size={18}/>}{busy?'Preparando vídeo…':active?'Analizando partido…':'Analizar partido completo'} <ArrowRight size={16}/>
      </button>
    </div>
    {!connected&&connected!==null&&<p className="auto-support"><ShieldAlert size={16}/> {reason}</p>}
    {active&&job&&<div className="auto-running" role="status"><div className="auto-running-head"><span><LoaderCircle size={17} className="ai-spin"/> {job.stage||'Procesando el partido'}</span><strong>{job.phase==='downloading'?(job.downloadProgress||0):(job.progress||0)}%</strong></div>
        <div className="ai-progress-track"><span style={{width:`${Math.max(0,Math.min(100,job.phase==='downloading'?(job.downloadProgress||0):(job.progress||0)))}%`}}/></div>
        <div className="auto-running-foot"><span>{job.phase==='downloading'?'Descargando a tu ordenador (sin subida manual)':'Tramos completados: '+(job.processedSegments||0)+' / '+(job.totalSegments||'—')+' · sin anotaciones tuyas'}</span><button onClick={()=>void cancel()}><PauseCircle size={15}/> Cancelar</button></div></div>}
    {messageText&&<p className="auto-notice" role="status">{messageText}</p>}
    {!active&&!reportReady&&<div className="auto-await-report"><BarChart3 size={18}/><div><strong>{data?'Análisis sin contactos aprovechables':'El informe aparecerá aquí al terminar'}</strong><span>{data?'El vídeo se ha procesado, pero el modelo no ha reconocido suficientes jugadas para ofrecer estadísticas. No se genera un Excel vacío.':'Aún no hay estadísticas para exportar. La IA intentará identificar los dorsales sin pedirte la plantilla.'}</span></div></div>}
    {failedJobId&&!active&&<button className="btn btn-outline auto-resume" onClick={()=>void resume()}><RefreshCw size={15}/> Reanudar análisis sin repetir tramos completados</button>}
    {reportReady&&data&&stats&&<div className="auto-report">
      <div className="auto-report-head"><div><div className="eyebrow text-lime">INFORME GENERADO</div><h3>{data.sourceName}</h3><p>{formatTime(data.processedSeconds)} analizados · {data.segments} tramos · RAVEL-VB-013{data.jerseyRecognition?` · ${data.jerseyRecognition.recognizedTracks} seguimientos con dorsal OCR`:''}</p></div>
        <div className="auto-report-exports">
          {playerTotals.length>0&&<button className="btn btn-lime" onClick={()=>download('vb-stats-jugadores-ia.csv','\uFEFF'+autoPlayerCSV(data),'text/csv;charset=utf-8')}><Download size={15}/> Estadísticas por jugador CSV</button>}
          <details className="auto-export-advanced"><summary><Download size={15}/> Otras exportaciones</summary>
            <div><button className="btn btn-outline" onClick={()=>download('vb-stats-contactos-ia.csv','\uFEFF'+autoCSV(data),'text/csv;charset=utf-8')}>Contactos detectados CSV</button>
            <button className="btn btn-outline" onClick={()=>download('vb-stats-automatico.json',JSON.stringify(data,null,2),'application/json')}>Datos completos JSON</button></div>
          </details>
        </div></div>
      <div className="auto-kpis"><div><strong>{stats.rallies}</strong><small>Rallies estimados</small></div><div><strong>{stats.contacts}</strong><small>Toques detectados</small></div><div><strong>{stats.byTeam.A}</strong><small>Toques {teams.A}</small></div><div><strong>{stats.byTeam.B}</strong><small>Toques {teams.B}</small></div><div><strong>{stats.byTeam.unknown}</strong><small>Equipo dudoso</small></div></div>
      <div className="auto-insight"><ShieldAlert size={18}/><p><b>Datos automáticos provisionales.</b> El modelo detecta contactos, no todos los toques ni sus resultados. Las acciones clasificadas se infieren por la secuencia de contactos. Los dorsales y ganadores de puntos no se inventan. Puedes consultar el informe sin revisar cada jugada.</p></div>
      <div className="auto-subnav" role="tablist" aria-label="Secciones del informe automático">
        <button role="tab" aria-selected={tab==='players'} className={tab==='players'?'active':''} onClick={()=>setTab('players')}><Users size={16}/> Jugadores detectados</button>
        <button role="tab" aria-selected={tab==='actions'} className={tab==='actions'?'active':''} onClick={()=>setTab('actions')}><Activity size={16}/> Acciones ({stats.contacts})</button>
        <button role="tab" aria-selected={tab==='rallies'} className={tab==='rallies'?'active':''} onClick={()=>setTab('rallies')}><BarChart3 size={16}/> Rallies ({stats.rallies})</button></div>
      {tab==='players'&&<div className="auto-table-wrap">{playerTotals.length===0&&<div className="auto-player-empty"><Users size={18}/><div><strong>Dorsales aún sin identificar con confianza</strong><span>La IA ha guardado los seguimientos de jugadores. No necesitas completar la plantilla: puedes consultar las acciones estimadas y corregir solo los seguimientos que te interesen.</span></div></div>}{playerTotals.length>0&&<div className="auto-player-summary"><strong>Estadísticas provisionales por dorsal</strong><div className="auto-player-cards">{playerTotals.map(p=><div key={`${p.team}:${p.jersey}`}><small>{teams[p.team]}</small><strong>#{p.jersey}</strong><span>{p.touches} toques · {p.ralliesInvolved} rallies candidatos</span>
        <span>{p.byAction['ataque']} ataques probables · {p.byAction['recepción']} recepciones probables</span>
        <span>Confianza media detección: {p.averageDetectionConfidence}%</span>
        <button className="auto-link" onClick={()=>{setTab('actions');setFilter(p.team);setFind(p.jersey);}}>Ver acciones <ArrowRight size={13}/></button></div>)}</div></div>}
      <p className="auto-context">La IA agrupa contactos por identificador temporal. El OCR sugiere el dorsal cuando varios fotogramas coinciden. Si falla, corrígelo una vez y se aplica a todo el seguimiento. Un jugador puede tener varios IDs durante el partido.</p>
        <table className="auto-table"><thead><tr><th>ID temporal</th><th>Equipo probable</th><th>Dorsal</th><th>Toques detectados</th><th>Primer contacto</th></tr></thead><tbody>{tracks.slice(0,80).map(t=><tr key={t.key}><td>Seguimiento {t.key}</td><td><select aria-label={`Equipo seguimiento ${t.key}`} value={t.team||''} onChange={e=>onSave(fixAutoTrack(data,t.key,{team:e.target.value===''?null:e.target.value as Team}))}><option value="">Sin determinar</option><option value="A">{teams.A}</option><option value="B">{teams.B}</option></select></td>
        <td><input className="auto-jersey" aria-label={`Dorsal seguimiento ${t.key}`} value={t.jersey} maxLength={3} inputMode="numeric" placeholder="—" onChange={e=>{if(/^\d{0,3}$/.test(e.target.value))onSave(fixAutoTrack(data,t.key,{jersey:e.target.value}))}}/>{t.jerseyConfidence!=null&&<small className="auto-ocr-confidence">IA {Math.round(t.jerseyConfidence*100)}%</small>}</td><td><b>{t.touches}</b></td><td><button className="auto-link" onClick={()=>onSeek(t.firstSecond)}><Play size={13}/>{formatTime(t.firstSecond)}</button></td></tr>)}</tbody></table>{tracks.length>80&&<p className="auto-context">Mostrando 80 de {tracks.length} seguimientos. Descarga el CSV para consultar todo.</p>}</div>}
      {tab==='actions'&&<><div className="auto-filter"><label>Filtrar <select value={filter} onChange={e=>setFilter(e.target.value as Filter)}><option value="all">Todas</option><option value="uncertain">Dudosas</option><option value="A">{teams.A}</option><option value="B">{teams.B}</option></select></label><input value={find} onChange={e=>setFind(e.target.value)} placeholder="Buscar hora, dorsal, acción…" aria-label="Buscar acciones"/></div>
        <div className="auto-table-wrap"><table className="auto-table"><thead><tr><th>Momento</th><th>Rally</th><th>Equipo</th><th>Jugador</th><th>Acción propuesta</th><th>Revisión</th></tr></thead><tbody>{filtered.slice(0,count).map(e=><tr key={e.id} className={e.status==='rejected'?'auto-rejected':''}><td><button className="auto-link" onClick={()=>onSeek(Math.max(0,e.second-1))}><Play size={13}/>{formatTime(e.second)}</button></td><td>{e.rally??'—'}</td><td><select aria-label={`Equipo ${e.id}`} value={e.team??''} onChange={v=>onSave(fixAutoEvent(data,e.id,{team:v.target.value===''?null:v.target.value as Team}))}><option value="">?</option><option value="A">{teams.A}</option><option value="B">{teams.B}</option></select></td><td>{e.jersey?`#${e.jersey}`:`ID ${e.trackKey}`}</td><td><select aria-label={`Acción ${e.id}`} value={e.action} onChange={v=>onSave(fixAutoEvent(data,e.id,{action:v.target.value as AutoAction}))}>{AUTO_ACTIONS.map(a=><option key={a} value={a}>{a==='toque'?'Toque sin clasificar':a}</option>)}</select></td>
        <td><button className="auto-state" onClick={()=>onSave(fixAutoEvent(data,e.id,{status:e.status==='rejected'?'auto':'rejected'}))}>{e.status==='rejected'?<><RefreshCw size={13}/> Restaurar</>:<><ShieldAlert size={13}/> Descartar</>}</button></td></tr>)}</tbody></table></div>{filtered.length>count&&<button className="btn btn-outline auto-more" onClick={()=>setCount(x=>x+60)}>Ver más ({filtered.length-count} restantes)</button>}</>}
      {tab==='rallies'&&<><p className="auto-context">La IA propone los límites de cada jugada. Puedes corregir el equipo ganador si lo conoces, pero no se asume automáticamente.</p><div className="auto-rallies">{data.rallies.slice(0,200).map(r=><div className="auto-rally" key={r.id}><button className="auto-link" onClick={()=>onSeek(Math.max(0,r.startSeconds-1))}><Play size={14}/> Rally {r.index}</button><span>{formatTime(r.startSeconds)} — {formatTime(r.endSeconds)}</span><select aria-label={`Ganador rally ${r.index}`} value={r.winner||''} onChange={e=>onSave(fixAutoRally(data,r.id,e.target.value===''?null:e.target.value as Team))}><option value="">Ganador sin identificar</option><option value="A">{teams.A}</option><option value="B">{teams.B}</option></select></div>)}</div>{data.rallies.length>200&&<p className="auto-context">Mostrando 200 rallies. Exporta el JSON para consultar todo.</p>}</>}
      <div className="auto-foot"><CheckCircle2 size={16}/> Tus correcciones se guardan en la sesión y se exportan. No necesitas recorrer el partido para consultar las estimaciones; revisa solo si quieres perfeccionarlas.</div>
    </div>}
  </section>;
}
