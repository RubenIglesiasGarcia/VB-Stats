"""Local video-analysis API. Only user-authorized canonical YouTube videos or uploaded files.
The server must remain bound to loopback, not the public internet."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Event, Lock, Thread
from uuid import uuid4
import os
import secrets
import shutil
import time
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from backend.vision.detector import YOLODetector, available
from backend.vision.processor import Settings, process_video
from backend.vision.ravel import readiness as ravel_readiness, process_ravel_video
from backend.vision.auto_match import make_draft, jersey_team_votes, preview_stats
from backend.vision.youtube_import import video_id_from_url, import_video, ImportCancelled, availability as youtube_availability
from backend.vision.jersey_ocr import identify_track_numbers, available as ocr_availability
from backend.vision.long_match import download_budget
from backend.vision.gemini_youtube import available as gemini_youtube_available, analyze as analyze_gemini_youtube

VERSION='0.9.2'
PUBLIC_MODE=os.getenv('VBSTATS_PUBLIC_MODE','0')=='1'
ACCESS_TOKEN=os.getenv('VBSTATS_ACCESS_TOKEN','')
if PUBLIC_MODE and len(ACCESS_TOKEN)<24:
    raise RuntimeError('El servidor publico exige VBSTATS_ACCESS_TOKEN de al menos 24 caracteres.')
DATA_DIR=Path(os.getenv('VBSTATS_DATA_DIR',str(Path.home()/'.vb-stats-analysis'))).resolve()
UPLOADS=DATA_DIR/'uploads'
INCOMING=DATA_DIR/'incoming'
MAX_UPLOAD=int(os.getenv('VBSTATS_MAX_UPLOAD_MB','384' if PUBLIC_MODE else '3072'))*1024*1024
MAX_DURATION=900
MAX_QUEUED=1 if PUBLIC_MODE else 2
MAX_STORED=2 if PUBLIC_MODE else 5
MAX_TOTAL_DISK=int(os.getenv('VBSTATS_MAX_TOTAL_DISK_MB','430' if PUBLIC_MODE else '12288'))*1024*1024
MAX_AUTO_SECONDS=int(os.getenv('VBSTATS_MAX_VIDEO_SECONDS','10800' if PUBLIC_MODE else str(6*3600)))
TTL=24*3600
pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix='vb-stats-vision')
lock=Lock()
uploads:dict[str,dict]={}
jobs:dict[str,dict]={}
stop_flags:dict[str,Event]={}


# Small single-worker beta checkpoint store. Mount VBSTATS_DATA_DIR to a Railway
# volume to survive restarts. Completed events, OCR samples and chunk cursor are
# persisted; active processes are NOT resumed until the user requests it.
STATE_DIR=DATA_DIR/'job-state'

def snapshot_job(jid:str)->None:
    with lock:
        job=jobs.get(jid)
        if not job:return
        snap={'job':dict(job),'upload':uploads.get(job['uploadId'])}
    try:
        STATE_DIR.mkdir(parents=True,exist_ok=True)
        target=STATE_DIR/(jid+'.json')
        temporary=STATE_DIR/(jid+'.'+uuid4().hex+'.tmp')
        temporary.write_text(__import__('json').dumps(snap,default=str,ensure_ascii=False),encoding='utf-8')
        temporary.replace(target)
    except OSError:
        # An in-memory job can still finish when storage is temporarily unavailable.
        pass

def restore_jobs()->None:
    if not STATE_DIR.exists():return
    for path in STATE_DIR.glob('*.json'):
        try:
            if time.time()-path.stat().st_mtime>TTL:
                path.unlink(missing_ok=True);continue
            snap=__import__('json').loads(path.read_text(encoding='utf-8'))
            item=snap['job'];jid=item['jobId'];uid=item['uploadId']
            if jid!=path.stem or not isinstance(uid,str) or not isinstance(jid,str):continue
            if item.get('status') in ('running','queued'):
                item['status']='failed';item['error']='Servidor reiniciado. Puedes reanudar desde el último tramo guardado si el vídeo está disponible.'
            up=snap.get('upload')
            if up and isinstance(up.get('path'),str):
                recorded=Path(up['path']).resolve()
                if recorded.parent==UPLOADS.resolve() and recorded.is_file():uploads[uid]=up
            if uid not in uploads and item.get('status')!='completed':
                item['status']='failed';item['error']='El archivo temporal no está disponible para reanudar.'
            jobs[jid]=item;stop_flags[jid]=Event()
        except (OSError,ValueError,KeyError,TypeError):continue

app=FastAPI(title='VB Stats Video Analysis',version=VERSION,
    docs_url=None if PUBLIC_MODE else '/docs',openapi_url=None if PUBLIC_MODE else '/openapi.json')
origins=[s.strip() for s in os.getenv('VBSTATS_ALLOWED_ORIGINS','http://localhost:5173,http://127.0.0.1:5173').split(',') if s.strip()]
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=False,
                   allow_methods=['GET','POST','DELETE'],allow_headers=['Content-Type','X-VB-Stats-Key'])


@app.middleware('http')
async def beta_access(request, call_next):
    # Cloudflare is public but processing is a private beta. Never bundle this token
    # in Vite or in client source. The user enters it for the current browser session.
    if PUBLIC_MODE and request.url.path not in ('/health',) and request.method!='OPTIONS':
        supplied=request.headers.get('X-VB-Stats-Key','')
        if not secrets.compare_digest(supplied,ACCESS_TOKEN):
            from starlette.responses import JSONResponse
            return JSONResponse(status_code=401,content={'detail':'Acceso privado. Introduce tu clave de VB Stats.'})
    return await call_next(request)


def prune() -> None:
    """Delete expired temp video files; no original video persists indefinitely."""
    now=time.time()
    if UPLOADS.is_dir():
        for p in UPLOADS.iterdir():
            if not p.is_file() or p.suffix not in ('.mp4','.mov','.webm'):continue
            try:
                if now-p.stat().st_mtime>TTL:p.unlink(missing_ok=True)
            except OSError:pass
    if INCOMING.is_dir():
        for d in INCOMING.iterdir():
            try:
                if d.is_dir() and now-d.stat().st_mtime>TTL:shutil.rmtree(d,ignore_errors=True)
            except OSError:pass
    with lock:
        for key,item in list(uploads.items()):
            if now-item['created']>TTL and not any(j['uploadId']==key and j['status'] in ('queued','running') for j in jobs.values()):
                Path(item['path']).unlink(missing_ok=True)
                del uploads[key]
        for key,item in list(jobs.items()):
            if now-item['created']>TTL and item['status'] not in ('queued','running'):
                jobs.pop(key,None);stop_flags.pop(key,None)


@asynccontextmanager
async def lifespan(_):
    restore_jobs()
    stop=Event()
    def janitor():
        while not stop.is_set():
            try:prune()
            except Exception:pass
            stop.wait(3600)
    t=Thread(target=janitor,daemon=True,name='vb-stats-data-cleanup')
    t.start()
    try:yield
    finally:
        stop.set()
        t.join(timeout=1)

app.router.lifespan_context=lifespan


def sniff_ext(prefix:bytes,filename:str) -> str|None:
    # Do not trust file extension or Content-Type alone.
    name=filename.lower()
    if len(prefix)>=12 and prefix[4:8]==b'ftyp' and name.endswith(('.mp4','.mov','.m4v')):
        return '.mov' if name.endswith('.mov') else '.mp4'
    if prefix.startswith(b'\x1a\x45\xdf\xa3') and name.endswith('.webm'):
        return '.webm'
    return None


class StartJob(BaseModel):
    uploadId: str=Field(pattern=r'^[0-9a-f-]{36}$')
    startSeconds:float=Field(default=0,ge=0,le=24*3600)
    durationSeconds:float=Field(default=120,ge=5,le=MAX_DURATION)
    sampleFps:float=Field(default=6,ge=2,le=12)
    minConfidence:float=Field(default=.18,ge=.10,le=.80)
    teamAColor:str=Field(default='#265bac',pattern=r'^#[0-9a-fA-F]{6}$')
    teamBColor:str=Field(default='#b9373f',pattern=r'^#[0-9a-fA-F]{6}$')
    engine:Literal['ravel','yolo']='ravel'
    detailMode:Literal['balanced','detailed']='balanced'
    courtRegion:tuple[float,float,float,float]=(0.,0.,1.,1.)

    @model_validator(mode='after')
    def valid_region(self):
        x1,y1,x2,y2=self.courtRegion
        if not all(0 <= value <= 1 for value in self.courtRegion) or x2-x1 < .15 or y2-y1 < .15:
            raise ValueError('La región de juego debe estar entre 0 y 1, con al menos 15% de anchura y altura.')
        return self


class StartAutoJob(BaseModel):
    uploadId: str=Field(pattern=r'^[0-9a-f-]{36}$')
    chunkSeconds: int=Field(default=60,ge=30,le=MAX_DURATION)
    teamAColor: str=Field(default='#265bac',pattern=r'^#[0-9a-fA-F]{6}$')
    teamBColor: str=Field(default='#b9373f',pattern=r'^#[0-9a-fA-F]{6}$')
    rosterA: list[int]=Field(default_factory=list,max_length=40)
    rosterB: list[int]=Field(default_factory=list,max_length=40)

    @model_validator(mode='after')
    def validate_rosters(self):
        for values in (self.rosterA,self.rosterB):
            if len(set(values))!=len(values) or any(x<0 or x>99 for x in values):
                raise ValueError('Los dorsales deben estar entre 0 y 99, sin repetidos.')
        return self


class StartYouTubeJob(BaseModel):
    url: str=Field(min_length=24,max_length=800)
    authorized: bool
    chunkSeconds: int=Field(default=60,ge=30,le=MAX_DURATION)
    teamAColor: str=Field(default='#265bac',pattern=r'^#[0-9a-fA-F]{6}$')
    teamBColor: str=Field(default='#b9373f',pattern=r'^#[0-9a-fA-F]{6}$')
    rosterA: list[int]=Field(default_factory=list,max_length=40)
    rosterB: list[int]=Field(default_factory=list,max_length=40)

    @model_validator(mode='after')
    def check(self):
        video_id_from_url(self.url)
        StartAutoJob(uploadId=str(uuid4()),chunkSeconds=self.chunkSeconds,
                     teamAColor=self.teamAColor,teamBColor=self.teamBColor,
                     rosterA=self.rosterA,rosterB=self.rosterB)
        if not self.authorized:
            raise ValueError('Confirma que tienes permiso para procesar esta grabación.')
        return self



def parse_rgb(value:str) -> tuple[int,int,int]:
    return tuple(int(value[i:i+2],16) for i in (1,3,5))


@app.get('/health')
def health():
    return {'status':'ok','version':VERSION}


@app.get('/capabilities')
def capabilities():
    yolo_ready,yolo_reason=available()
    ravel_ready,ravel_reason=ravel_readiness()
    youtube_ready,youtube_reason=youtube_availability()
    gemini_ready,gemini_reason=gemini_youtube_available()
    ocr_ready,ocr_reason=ocr_availability()
    return {'manual_annotation':True,'youtube_embed':True,'export_json_csv':True,
        'auto_point_segmentation':False,'whole_match_draft':ravel_ready,'player_tracking':ravel_ready or yolo_ready,
        'ball_tracking':ravel_ready or yolo_ready,'jersey_recognition':ocr_ready,
        'youtube_import':gemini_ready or (youtube_ready and ravel_ready),
        'youtube_engine':'gemini' if gemini_ready else 'ravel' if youtube_ready and ravel_ready else 'unavailable',
        'gemini_youtube_note':gemini_reason,'youtube_import_note':gemini_reason if gemini_ready else youtube_reason,
        'jersey_ocr_note':ocr_reason,
        'touch_classification':ravel_ready,'contact_suggestions':ravel_ready or yolo_ready,
        'court_region_calibration':True,'ball_temporal_filtering':True,'coverage_timeline':True,
        'human_review_required':True,'pipeline':'ready' if (ravel_ready or yolo_ready) else 'model_not_configured',
        'model_note':ravel_reason if ravel_ready or not yolo_ready else yolo_reason,
        'engines':{
          'ravel':{'ready':ravel_ready,'name':'RAVEL-VB-013 · modelo de voleibol','note':ravel_reason,
                   'detects':['jugadores','balón','posibles toques','rallies candidatos']},
          'yolo':{'ready':yolo_ready,'name':'YOLO genérico · legado','note':yolo_reason,
                  'detects':['personas','balón COCO','cambios de trayectoria']}
        },
        'maxUploadMB':MAX_UPLOAD//(1024*1024),'maxSegmentSeconds':MAX_DURATION,'maxAutoDurationSeconds':MAX_AUTO_SECONDS,'onlineBeta':PUBLIC_MODE,
        'supported_inputs':['mp4','mov','webm','youtube_https_url'],
        'notes':'RAVEL detecta contactos; RapidOCR propone dorsales solo con >=3 lecturas consistentes. Puntos y resultados no certificados.'}


@app.post('/api/analysis/uploads',status_code=201)
async def upload_video(file:UploadFile=File(...)):
    prune()
    filename=(file.filename or 'video')[:160]
    first=await file.read(4096)
    ext=sniff_ext(first,filename)
    if not ext:raise HTTPException(415,'Archivo no admitido: usa MP4/MOV o WebM real.')
    with lock:
        if sum(1 for j in jobs.values() if j['status'] in ('queued','running'))>MAX_QUEUED:
            raise HTTPException(429,'La cola está llena. Espera a que finalice otro análisis.')
    UPLOADS.mkdir(parents=True,exist_ok=True)
    with lock:
        if len(uploads)>=MAX_STORED or sum(item['size'] for item in uploads.values())>MAX_TOTAL_DISK-64*1024*1024:
            raise HTTPException(507,'Almacenamiento temporal lleno. Borra vídeos anteriores o espera a su caducidad.')
    uid=str(uuid4());path=UPLOADS/(uid+ext)
    size=0
    try:
        with path.open('wb') as out:
            out.write(first);size+=len(first)
            while True:
                chunk=await file.read(1024*1024)
                if not chunk:break
                size+=len(chunk)
                if size>MAX_UPLOAD:
                    raise HTTPException(413,f'Vídeo demasiado grande: máximo {MAX_UPLOAD//(1024*1024)} MB.')
                out.write(chunk)
        if size<1024:raise HTTPException(422,'Archivo vacío o incompleto.')
        with lock:uploads[uid]={'path':str(path),'size':size,'created':time.time(),'name':filename}
        return {'uploadId':uid,'filename':filename,'bytes':size,'expiresInHours':24,
                'privacy':'El archivo permanece en la instalación del servidor hasta su eliminación automática.'}
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


def _run_job(jid:str,uid:str,opts:StartJob) -> None:
    def mutate(**kwargs):
        with lock:
            if jid in jobs:jobs[jid].update(kwargs)
    with lock:
        job=jobs.get(jid)
        if not job:return
        if stop_flags[jid].is_set():
            job.update(status='cancelled',progress=0);return
        job.update(status='running')
        path=Path(uploads[uid]['path']) if uid in uploads else None
    if not path or not path.is_file():
        mutate(status='failed',error='El archivo de vídeo ya no está disponible.');return
    try:
        if opts.engine=='ravel':
            result=process_ravel_video(path,start_seconds=opts.startSeconds,duration_seconds=opts.durationSeconds,
                         progress=lambda pct,frames:mutate(progress=round(pct*100),frames=frames),
                         cancelled=stop_flags[jid].is_set)
        else:
            detector=YOLODetector(detailed=opts.detailMode=='detailed')
            settings=Settings(opts.startSeconds,opts.durationSeconds,opts.sampleFps,opts.minConfidence,
                              parse_rgb(opts.teamAColor),parse_rgb(opts.teamBColor),opts.courtRegion)
            result=process_video(path,detector,settings,
                                 progress=lambda pct,frames:mutate(progress=round(pct*100),frames=frames),
                                 cancelled=stop_flags[jid].is_set)
        if result['cancelled']:
            mutate(status='cancelled',proposals=[],progress=0)
        else:
            mutate(status='completed',progress=100,proposals=result['proposals'],stats=result['stats'])
    except Exception as exc:
        mutate(status='failed',error=f'{type(exc).__name__}: {str(exc)[:450]}')


@app.post('/api/analysis/jobs',status_code=202)
def start_analysis(opts:StartJob):
    prune()
    ready,reason=ravel_readiness() if opts.engine=='ravel' else available()
    if not ready:raise HTTPException(503,reason)
    with lock:
        if opts.uploadId not in uploads:raise HTTPException(404,'Vídeo no encontrado o caducado. Vuelve a cargarlo.')
        running=sum(1 for j in jobs.values() if j['status'] in ('queued','running'))
        if running>=MAX_QUEUED:raise HTTPException(429,'La cola de análisis está llena. Ya hay un análisis en curso.')
        uid=str(uuid4())
        jobs[uid]={'jobId':uid,'uploadId':opts.uploadId,'status':'queued','progress':0,'frames':0,
                   'created':time.time(),'proposals':[],'stats':None,'error':None,'engine':opts.engine}
        stop_flags[uid]=Event()
    pool.submit(_run_job,uid,opts.uploadId,opts)
    return {'jobId':uid,'status':'queued','message':'Analizando con '+opts.engine+'. Las propuestas requieren revisión.'}


def _run_youtube_auto_job(jid: str, uid: str, options: StartYouTubeJob) -> None:
    """Import media locally, then pass it to the same full-match analyzer."""
    folder=INCOMING/uid
    def mutate(**items):
        with lock:
            if jid in jobs:jobs[jid].update(items)
    try:
        mutate(status='running',phase='downloading',stage='Seleccionando una versión de vídeo que quepa en el servidor')
        DATA_DIR.mkdir(parents=True,exist_ok=True)
        free_bytes=shutil.disk_usage(DATA_DIR).free
        with lock:
            used_bytes=sum(int(u.get('size',0)) for u in uploads.values())
        budget=download_budget(MAX_UPLOAD,MAX_TOTAL_DISK,used_bytes,free_bytes)
        if budget<50*1024*1024:
            raise RuntimeError('No queda espacio suficiente para importar un partido largo. Borra vídeos anteriores o amplía el almacenamiento.')
        data=import_video(options.url,folder,max_bytes=budget,max_duration_seconds=MAX_AUTO_SECONDS,
                          cancelled=stop_flags[jid].is_set,
                          progress=lambda fraction:mutate(downloadProgress=round(fraction*100,1)))
        if stop_flags[jid].is_set():raise ImportCancelled('Importación cancelada.')
        UPLOADS.mkdir(parents=True,exist_ok=True)
        suffix=data['path'].suffix
        dest=UPLOADS/(uid+suffix)
        data['path'].replace(dest)
        with lock:
            uploads[uid]={'path':str(dest),'size':dest.stat().st_size,'created':time.time(),
                          'name':data['name'],'source':'youtube','youtubeId':data['videoId']}
        quality=f"{data['formatHeight']}p" if data.get('formatHeight') else 'calidad compacta'
        mutate(phase='analysis',progress=0,downloadProgress=100,
               downloadedResolution=quality,stage=f'Vídeo obtenido ({quality}); analizando el partido por tramos')
        opts=StartAutoJob(uploadId=uid,chunkSeconds=options.chunkSeconds,
                          teamAColor=options.teamAColor,teamBColor=options.teamBColor,
                          rosterA=options.rosterA,rosterB=options.rosterB)
        mutate(_options=opts.model_dump())
        snapshot_job(jid)
        _run_auto_job(jid,uid,opts)
    except ImportCancelled:
        mutate(status='cancelled',error='Importación cancelada.',phase='cancelled')
    except Exception as exc:
        if stop_flags[jid].is_set():
            mutate(status='cancelled',error='Importación cancelada.',phase='cancelled')
            return
        mutate(status='failed',phase='failed',error=f'{type(exc).__name__}: {str(exc)[:400]}')
    finally:
        shutil.rmtree(folder,ignore_errors=True)


def _run_gemini_youtube_job(jid: str, url: str) -> None:
    """Direct YouTube observation with no Railway media download."""
    def mutate(**items):
        with lock:
            if jid in jobs: jobs[jid].update(items)
        if 'status' in items:
            snapshot_job(jid)
    try:
        mutate(status='running', phase='analysis', progress=5,
               stage='Gemini está examinando el vídeo público de YouTube (sin descargarlo)')
        draft=analyze_gemini_youtube(url,max_seconds=MAX_AUTO_SECONDS)
        if stop_flags[jid].is_set():
            mutate(status='cancelled',phase='cancelled',error='Análisis cancelado.')
            return
        mutate(status='completed',phase='completed',progress=100,
               stage='Observaciones provisionales de Gemini disponibles',
               processedSegments=1,totalSegments=1,autoAnalysis=draft,
               stats={'engine':'gemini-youtube-preview','rallyCandidateCount':len(draft['rallies']),
                      'contactCandidates':len(draft['events']),'durationSeconds':draft['durationSeconds']})
    except Exception as exc:
        mutate(status='failed',phase='failed',error=f'{type(exc).__name__}: {str(exc)[:400]}')


@app.post('/api/analysis/youtube-jobs',status_code=202)
def start_youtube_analysis(opts:StartYouTubeJob):
    prune()
    gemini_ready,_=gemini_youtube_available()
    if not gemini_ready:
        ready,reason=youtube_availability()
        if not ready:raise HTTPException(503,reason)
        ready,reason=ravel_readiness()
        if not ready:raise HTTPException(503,reason)
    with lock:
        running=sum(1 for j in jobs.values() if j['status'] in ('queued','running'))
        if running>=MAX_QUEUED:raise HTTPException(429,'La cola de análisis está llena.')
        if not gemini_ready and (len(uploads)>=MAX_STORED or sum(i['size'] for i in uploads.values())>MAX_TOTAL_DISK-64*1024*1024):
            raise HTTPException(507,'Almacenamiento temporal lleno.')
        jid=str(uuid4());uid=str(uuid4())
        jobs[jid]={'jobId':jid,'uploadId':uid,'status':'queued',
                   'phase':'analysis' if gemini_ready else 'downloading',
                   'progress':0,'downloadProgress':0,'created':time.time(),
                   'engine':'gemini-youtube-preview' if gemini_ready else 'ravel',
                   'error':None,'proposals':[],'autoAnalysis':None,'processedSegments':0,
                   'totalSegments':0,
                   'stage':'Preparando análisis directo de YouTube' if gemini_ready else 'Preparando descarga autorizada',
                   '_chunks':[],'_raw_events':[],'_ocr_samples':[],'_options':None}
        stop_flags[jid]=Event()
    snapshot_job(jid)
    if gemini_ready:
        pool.submit(_run_gemini_youtube_job,jid,opts.url)
    else:
        pool.submit(_run_youtube_auto_job,jid,uid,opts)
    return {'jobId':jid,'status':'queued','message':'Análisis del enlace público iniciado.'}


@app.post('/api/analysis/jobs/{job_id}/resume',status_code=202)
def resume_auto_job(job_id:str):
    with lock:
        job=jobs.get(job_id)
        if not job:raise HTTPException(404,'No existe el trabajo de análisis.')
        if '_chunks' not in job:raise HTTPException(409,'No es un análisis completo reanudable.')
        if job['status'] not in ('failed','cancelled'):
            raise HTTPException(409,'Solo se pueden reanudar análisis fallidos o cancelados.')
        if job['uploadId'] not in uploads or not Path(uploads[job['uploadId']]['path']).is_file():
            raise HTTPException(404,'El vídeo temporal ya no está disponible.')
        if any(j['status'] in ('queued','running') for j in jobs.values()):
            raise HTTPException(429,'Otro análisis está en curso.')
        opts=StartAutoJob.model_validate(job['_options'])
        job.update(status='queued',error=None,stage='Reanudando desde el último tramo completado')
        stop_flags[job_id]=Event()
    pool.submit(_run_auto_job,job_id,job['uploadId'],opts)
    return {'jobId':job_id,'status':'queued','processedSegments':job.get('processedSegments',0)}


@app.get('/api/analysis/jobs/{job_id}')
def get_job(job_id:str):
    prune()
    with lock:
        job=jobs.get(job_id)
        if not job:raise HTTPException(404,'Análisis no encontrado o caducado.')
        return {k:v for k,v in job.items() if k not in ('uploadId','created') and not k.startswith('_')}


@app.delete('/api/analysis/jobs/{job_id}')
def stop_job(job_id:str):
    with lock:
        if job_id not in jobs:raise HTTPException(404,'Análisis no encontrado.')
        if jobs[job_id]['status'] not in ('queued','running'):
            return {'status':jobs[job_id]['status']}
        stop_flags[job_id].set()
    return {'status':'cancelling'}


@app.get('/api/analysis/uploads/{upload_id}/probe')
def probe_upload(upload_id:str):
    """Read metadata only. Never expose the server's real storage path."""
    with lock:
        item=uploads.get(upload_id)
        if not item:raise HTTPException(404,'Archivo no encontrado o caducado.')
        path=item['path']
    try:
        import cv2
        cap=cv2.VideoCapture(str(path))
        try:
            if not cap.isOpened():raise HTTPException(422,'El vídeo no se puede decodificar.')
            fps=float(cap.get(cv2.CAP_PROP_FPS))
            count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH));height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            if not 1<=fps<=240 or count<=0:raise HTTPException(422,'Metadatos inválidos del vídeo.')
            return {'durationSeconds':round(count/fps,2),'fps':round(fps,2),
                    'width':width,'height':height,'analysisRequiresReview':True}
        finally:cap.release()
    except ImportError:raise HTTPException(503,'Instala OpenCV para consultar metadatos del vídeo.')


def _video_metadata(path:Path) -> dict:
    import cv2
    cap=cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():raise ValueError('El vídeo no se puede decodificar.')
        fps=float(cap.get(cv2.CAP_PROP_FPS))
        count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if not 1<=fps<=240 or count<=0:raise ValueError('FPS o duración inválidos.')
        return {'durationSeconds':count/fps,'fps':fps}
    finally:cap.release()


def _run_auto_job(jid:str,uid:str,opts:StartAutoJob) -> None:
    def mutate(**items):
        with lock:
            if jid in jobs: jobs[jid].update(items)
        if any(k in items for k in ('_chunks','status')):
            snapshot_job(jid)
    with lock:
        job=jobs.get(jid)
        if not job:return
        job['status']='running'
        job['phase']='analysis'
        uploaded=uploads.get(uid)
        video=Path(uploaded['path']) if uploaded else None
        file_name=uploaded['name'] if uploaded else 'Partido'
    if not video or not video.is_file():
        mutate(status='failed',error='No se encuentra el archivo de vídeo.')
        return
    try:
        duration=_video_metadata(video)['durationSeconds']
        if duration>MAX_AUTO_SECONDS:
            raise ValueError(f'El vídeo supera el máximo de {MAX_AUTO_SECONDS//60} minutos de esta instalación.')
        with lock:
            old_chunks=jobs.get(jid,{}).get('_chunks',[])
            old_events=jobs.get(jid,{}).get('_raw_events',[])
            old_ocr=jobs.get(jid,{}).get('_ocr_samples',[])
        segments=list(old_chunks);raw_events=list(old_events);ocr_samples=list(old_ocr)
        total_chunks=max(1,__import__('math').ceil(duration/opts.chunkSeconds))
        for index in range(len(segments),total_chunks):
            if stop_flags[jid].is_set():
                mutate(status='cancelled',error='Análisis detenido. No se generó un informe completo.')
                return
            offset=index*opts.chunkSeconds
            length=min(opts.chunkSeconds,duration-offset)
            mutate(stage=f'Tramo {index+1} de {total_chunks}',processedSegments=index,totalSegments=total_chunks)
            def progress(pct:float,_frames:int,idx=index):
                mutate(progress=round(100*(idx+max(0,min(1,pct)))/total_chunks,1))
            result=process_ravel_video(video,start_seconds=offset,duration_seconds=length,
                                       progress=progress,cancelled=stop_flags[jid].is_set)
            if result['cancelled'] or stop_flags[jid].is_set():
                mutate(status='cancelled',error='Análisis cancelado, sin puntos adjudicados.')
                return
            # Retain only evidence needed for automatic draft. No raw frames in RAM.
            segments.append({'stats':{'rallyCandidates':result['stats'].get('rallyCandidates',[]),
                                      'endSeconds':result['stats'].get('endSeconds',offset+length)},
                             'proposals':result['proposals']})
            for i,p in enumerate(result['proposals']):
                if p.get('kind')!='contact_candidate':continue
                raw_events.append({'trackKey':f'{index}:{p.get("trackId")}',
                                  'second':p['second'], 'box':p.get('evidence',{}).get('playerBoxPixels'),
                                  'confidence':p.get('confidence',0)})
            for sample in result['stats'].get('jerseySamples',[]):
                if not isinstance(sample.get('trackId'),int):continue
                ocr_samples.append({'trackKey':f'{index}:{sample["trackId"]}',
                                    'second':sample['second'],'box':sample['box'],
                                    'confidence':sample.get('confidence',0)})
            mutate(processedSegments=index+1,progress=round(100*(index+1)/total_chunks,1),
                   _chunks=list(segments),_raw_events=list(raw_events),_ocr_samples=list(ocr_samples))
        mutate(stage='Asignando equipos y preparando informe')
        colors=(parse_rgb(opts.teamAColor),parse_rgb(opts.teamBColor))
        mutate(stage='Analizando colores de camiseta y posibles dorsales')
        votes=jersey_team_votes(video,ocr_samples or raw_events,colors)
        mutate(stage='Reconociendo dorsales por OCR (puede tardar)',progress=99)
        # OCR is optional. Unknown and low-agreement numbers remain unassigned.
        numbers=identify_track_numbers(video,ocr_samples or raw_events,teams=votes,
                    cancelled=stop_flags[jid].is_set,
                    allowed_a={str(n) for n in opts.rosterA} if opts.rosterA else None,
                    allowed_b={str(n) for n in opts.rosterB} if opts.rosterB else None)
        if stop_flags[jid].is_set():
            mutate(status='cancelled',error='Análisis cancelado durante el reconocimiento OCR.')
            return
        draft=make_draft(segments,source_name=file_name,duration=duration,team_votes=votes,jersey_votes=numbers)
        draft['jerseyRecognition']={'recognizedTracks':len(numbers),'eligibleTracks':len({e['trackKey'] for e in raw_events if e.get('trackKey')}),
                                    'method':'OCR multi-fotograma con umbral conservador'}
        draft['summary']=preview_stats(draft)
        mutate(status='completed',phase='completed',progress=100,stage='Informe automático terminado',autoAnalysis=draft,
               stats={'engine':'ravel-vb-013','rallyCandidateCount':len(draft['rallies']),
                      'contactCandidates':len(draft['events']),'durationSeconds':duration})
    except Exception as exc:
        mutate(status='failed',error=f'{type(exc).__name__}: {str(exc)[:480]}')


@app.post('/api/analysis/auto-jobs',status_code=202)
def start_auto_analysis(opts:StartAutoJob):
    prune()
    ready,reason=ravel_readiness()
    if not ready:raise HTTPException(503,reason)
    with lock:
        if opts.uploadId not in uploads:raise HTTPException(404,'Vídeo no encontrado. Cárgalo de nuevo.')
        if sum(1 for j in jobs.values() if j['status'] in ('queued','running'))>=MAX_QUEUED:
            raise HTTPException(429,'Hay otro análisis en curso.')
        jid=str(uuid4())
        jobs[jid]={'jobId':jid,'uploadId':opts.uploadId,'status':'queued','phase':'analysis','progress':0,
                   'created':time.time(),'engine':'ravel','error':None,'proposals':[],
                   'autoAnalysis':None,'processedSegments':0,'totalSegments':0,'stage':'Preparando vídeo',
            '_chunks':[],'_raw_events':[],'_ocr_samples':[],'_options':opts.model_dump()}
        stop_flags[jid]=Event()
    snapshot_job(jid)
    pool.submit(_run_auto_job,jid,opts.uploadId,opts)
    return {'jobId':jid,'status':'queued','message':'Análisis completo iniciado. Solo se generarán estadísticas provisionales, sin ganadores inventados.'}


@app.delete('/api/analysis/uploads/{upload_id}')
def delete_upload(upload_id:str):
    with lock:
        item=uploads.get(upload_id)
        if not item:raise HTTPException(404,'Archivo no encontrado.')
        if any(job['uploadId']==upload_id and job['status'] in ('queued','running') for job in jobs.values()):
            raise HTTPException(409,'Cancela primero el análisis que está usando este vídeo.')
        uploads.pop(upload_id)
    Path(item['path']).unlink(missing_ok=True)
    return {'status':'deleted'}
