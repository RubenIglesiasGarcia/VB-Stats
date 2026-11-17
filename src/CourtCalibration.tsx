import type {PointerEvent} from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Crosshair, Maximize2, RotateCcw} from 'lucide-react';

export type CourtRegion=[number,number,number,number];
export const WHOLE_FRAME:CourtRegion=[0,0,1,1];
const limit=(v:number)=>Math.max(0,Math.min(1,v));

/** Optional spatial ROI. The preview is generated entirely inside the browser.
 * Selection removes likely spectators and scoreboards from candidate detection.
 * It does not understand court geometry or player identity.
 */
export function CourtCalibration({file,second,region,onChange}:{file:File|null;second:number;region:CourtRegion;onChange:(region:CourtRegion)=>void}){
  const [open,setOpen]=useState(false);
  const [src,setSrc]=useState<string|null>(null);
  const [picture,setPicture]=useState<string|null>(null);
  const [aspect,setAspect]=useState('16 / 9');
  const [failure,setFailure]=useState('');
  const [drag,setDrag]=useState<{x:number;y:number;endX:number;endY:number}|null>(null);
  const videoRef=useRef<HTMLVideoElement|null>(null);
  useEffect(()=>{
    if(!file){setSrc(null);setPicture(null);return}
    const url=URL.createObjectURL(file);
    setSrc(url);setPicture(null);setFailure('');
    return ()=>URL.revokeObjectURL(url);
  },[file]);
  const capture=useCallback(()=>{
    const video=videoRef.current;
    if(!video||!video.videoWidth||!video.videoHeight)return;
    try{
      setAspect(`${video.videoWidth} / ${video.videoHeight}`);
      const canvas=document.createElement('canvas');
      canvas.width=Math.min(960,video.videoWidth);
      canvas.height=Math.round(canvas.width*video.videoHeight/video.videoWidth);
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas no disponible');
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      setPicture(canvas.toDataURL('image/jpeg',.84));setFailure('');
    }catch{setFailure('No se pudo crear una vista previa. Puedes analizar el encuadre completo.');}
  },[]);
  const aim=()=>{
    const video=videoRef.current;if(!video||!Number.isFinite(video.duration))return;
    const target=Math.max(0,Math.min(video.duration-.15,Number.isFinite(second)?second:0));
    if(Math.abs(video.currentTime-target)<.05)capture();
    else video.currentTime=target;
  };
  function normalized(event:PointerEvent<HTMLDivElement>){
    const bounds=event.currentTarget.getBoundingClientRect();
    return {x:limit((event.clientX-bounds.left)/bounds.width),y:limit((event.clientY-bounds.top)/bounds.height)};
  }
  function commit(event:PointerEvent<HTMLDivElement>){
    if(!drag)return;
    const end=normalized(event);
    const a=Math.min(drag.x,end.x),b=Math.max(drag.x,end.x);
    const c=Math.min(drag.y,end.y),d=Math.max(drag.y,end.y);
    if(b-a>=.15 && d-c>=.15)onChange([a,c,b,d]);
    setDrag(null);
  }
  const r=drag?[Math.min(drag.x,drag.endX),Math.min(drag.y,drag.endY),Math.max(drag.x,drag.endX),Math.max(drag.y,drag.endY)]:region;
  return <div className="court-calibration">
    <button type="button" className="court-calibration-trigger" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Crosshair size={16}/><span><strong>Delimitar la zona de juego</strong><small>{region.every((n,i)=>n===WHOLE_FRAME[i])?'Fotograma completo':'Zona de pista personalizada · evita gradas y público'}</small></span><span>{open?'Ocultar':'Ajustar'}</span></button>
    {open&&<div className="court-calibration-content">
      <p>Dibuja un rectángulo que incluya toda la trayectoria del balón y los jugadores, pero excluya la mayor parte del público. Si recortas demasiado, perderás contactos.</p>
      {src&&<video aria-hidden="true" ref={videoRef} src={src} muted playsInline preload="auto" className="court-calibration-hidden" onLoadedMetadata={aim} onLoadedData={capture} onSeeked={capture} onError={()=>setFailure('No se puede previsualizar este archivo en tu navegador.')}/>}
      {picture?<div role="img" aria-label="Fotograma del vídeo y zona seleccionable" className="court-calibration-preview" style={{backgroundImage:`url(${picture})`,aspectRatio:aspect}} onPointerDown={e=>{if(e.button!==0)return;const p=normalized(e);e.currentTarget.setPointerCapture(e.pointerId);setDrag({x:p.x,y:p.y,endX:p.x,endY:p.y})}} onPointerMove={e=>{if(drag){const p=normalized(e);setDrag({...drag,endX:p.x,endY:p.y})}}} onPointerUp={commit} onPointerCancel={()=>setDrag(null)}>
        <div className="court-calibration-selected" style={{left:`${r[0]*100}%`,top:`${r[1]*100}%`,width:`${(r[2]-r[0])*100}%`,height:`${(r[3]-r[1])*100}%`}} />
        <span className="court-calibration-hint">Arrastra para delimitar</span>
      </div>:<div className="court-calibration-placeholder">{file?'Preparando fotograma…':'Selecciona primero un vídeo local'}</div>}
      {failure&&<p role="status">{failure}</p>}
      <div className="court-calibration-actions">
        <button type="button" onClick={aim} disabled={!file}><Maximize2 size={14}/> Capturar instante {Math.floor(second)} s</button>
        <button type="button" onClick={()=>onChange([.10,.10,.90,.90])}>Centro 80 %</button>
        <button type="button" onClick={()=>onChange(WHOLE_FRAME)}><RotateCcw size={14}/> Fotograma completo</button>
      </div>
      <small>Zona usada solo para filtrar detecciones; puedes modificarla antes de cada análisis.</small>
    </div>}
  </div>;
}
