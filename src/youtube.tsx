import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

export interface YouTubePlayerHandle {
  getCurrentTime(): number;
  seekTo(second:number, allowSeekAhead:boolean):void;
  playVideo():void;
  pauseVideo():void;
  getPlayerState():number;
}
interface YTNamespace {
  Player: new(element:HTMLElement,opts:{videoId:string;playerVars:Record<string,number|string>;events:{onReady:()=>void;onError:(e:{data:number})=>void}}) => YouTubePlayerHandle & {destroy():void};
}
declare global { interface Window { YT?:YTNamespace; onYouTubeIframeAPIReady?:()=>void } }
let apiPromise:Promise<void>|undefined;
function loadYouTubeApi():Promise<void> {
  if(window.YT?.Player) return Promise.resolve();
  if(apiPromise)return apiPromise;
  apiPromise=new Promise<void>((resolve,reject)=>{
    const old=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=()=>{ old?.(); resolve(); };
    const script=document.createElement('script');
    script.src='https://www.youtube.com/iframe_api';script.async=true;
    script.onerror=()=>{apiPromise=undefined;reject(new Error('No se pudo cargar el reproductor de YouTube.'));};
    document.head.appendChild(script);
  });
  return apiPromise;
}
export function YouTubeStage({id,playerRef,onTime,onError}:{id:string;playerRef:MutableRefObject<YouTubePlayerHandle|null>;onTime:(n:number)=>void;onError:(message:string)=>void}) {
  const el=useRef<HTMLDivElement>(null);
  const timeCallback=useRef(onTime);
  const errorCallback=useRef(onError);
  useEffect(()=>{timeCallback.current=onTime;errorCallback.current=onError;},[onTime,onError]);
  useEffect(()=>{
    let canceled=false;
    let player:(YouTubePlayerHandle & {destroy():void})|undefined;
    let ticker:number|undefined;
    loadYouTubeApi().then(()=>{
      if(canceled||!el.current||!window.YT)return;
      player=new window.YT.Player(el.current,{
        videoId:id,
        playerVars:{enablejsapi:1,playsinline:1,rel:0,origin:window.location.origin},
        events:{
          onReady:()=>{if(!canceled&&player){playerRef.current=player;timeCallback.current(player.getCurrentTime());}},
          onError:e=>errorCallback.current(`YouTube no puede reproducir este vídeo aquí (código ${e.data}). Prueba con un archivo local.`)
        }
      });
      ticker=window.setInterval(()=>{
        if(!canceled&&playerRef.current){
          try{const s=playerRef.current.getCurrentTime();if(Number.isFinite(s))timeCallback.current(s);}catch{/* player not ready */}
        }
      },250);
    }).catch(e=>errorCallback.current(e instanceof Error?e.message:'Error al cargar YouTube'));
    return ()=>{
      canceled=true;
      if(ticker!==undefined)clearInterval(ticker);
      playerRef.current=null;
      try{player?.destroy()}catch{/* unload */}
    };
  },[id,playerRef]);
  return <div className="youtube-frame" ref={el} aria-label="Reproductor de YouTube"/>;
}
