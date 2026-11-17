"""Optional Ultralytics detector. Explicit local model weights required by default.

COCO generic weights only recognize `person` and `sports ball`. A tiny volleyball
may be missed; specialist weights and evaluation are essential for production.
"""
from __future__ import annotations
from pathlib import Path
import os
from .geometry import Box, Detection

class MissingDetector(RuntimeError):
    pass


def available() -> tuple[bool,str]:
    model=os.getenv('VBSTATS_YOLO_MODEL','').strip()
    if not model:return False,'Configura VBSTATS_YOLO_MODEL con la ruta de pesos YOLO locales.'
    if not Path(model).is_file():return False,f'Modelo no encontrado: {Path(model).name}. No se descargan modelos automáticamente.'
    try:
        import ultralytics  # noqa F401
        import cv2  # noqa F401
    except ImportError:
        return False,'Instala las dependencias opcionales de visión: pip install -r backend/requirements-vision.txt'
    return True,'Detector disponible con pesos locales. Debes revisar los contactos propuestos.'


def _rgb_shirt(frame,box:Box) -> tuple[int,int,int]|None:
    """Jersey color heuristic, not recognition of team or player identity."""
    import numpy as np
    h,w=frame.shape[:2]
    x1=int(w*(box.x1+box.width*.24)); x2=int(w*(box.x2-box.width*.24))
    y1=int(h*(box.y1+box.height*.19));y2=int(h*(box.y1+box.height*.40))
    if x2<=x1+3 or y2<=y1+3:return None
    crop=frame[max(0,y1):min(h,y2),max(0,x1):min(w,x2)]
    if crop.size==0:return None
    bgr=np.median(crop.reshape(-1,3),axis=0)
    return tuple(int(c) for c in bgr[::-1])

class YOLODetector:
    def __init__(self,weights:str|None=None,device:str|None=None,detailed:bool=False):
        ok,msg=available()
        if weights is None and not ok:raise MissingDetector(msg)
        from ultralytics import YOLO
        self.model=YOLO(weights or os.environ['VBSTATS_YOLO_MODEL'])
        self.device=device or os.getenv('VBSTATS_YOLO_DEVICE','cpu')
        self.detailed=detailed
        # Standard COCO detection IDs, override for specialist model.
        self.person_id=int(os.getenv('VBSTATS_PERSON_CLASS_ID','0'))
        self.ball_id=int(os.getenv('VBSTATS_BALL_CLASS_ID','32'))

    def detect(self,frame,conf:float=.18) -> list[Detection]:
        h,w=frame.shape[:2]
        predictions=self.model.predict(source=frame,conf=conf,classes=[self.person_id,self.ball_id],
                                       device=self.device,verbose=False,imgsz=960,max_det=45)
        if not predictions:return []
        items=[]
        for box in predictions[0].boxes:
            cls=int(box.cls[0]);confidence=float(box.conf[0]);coords=[float(q) for q in box.xyxy[0].tolist()]
            bounds=Box(max(0,coords[0]/w),max(0,coords[1]/h),min(1,coords[2]/w),min(1,coords[3]/h))
            if bounds.width<=0 or bounds.height<=0:continue
            label='person' if cls==self.person_id else 'ball'
            items.append(Detection(label,bounds,confidence,_rgb_shirt(frame,bounds) if label=='person' else None))
        if self.detailed:
            # Four overlapping crops increase apparent size of tiny volleyballs.
            # Slower but useful for footage shot from a fixed, elevated camera.
            for y0,y1 in ((0,.60),(.40,1)):
                for x0,x1 in ((0,.60),(.40,1)):
                    ix0,ix1=int(w*x0),int(w*x1)
                    iy0,iy1=int(h*y0),int(h*y1)
                    cut=frame[iy0:iy1,ix0:ix1]
                    if cut.shape[0]<32 or cut.shape[1]<32:continue
                    tiles=self.model.predict(source=cut,conf=max(.12,conf*.75),classes=[self.ball_id],
                                             device=self.device,verbose=False,imgsz=960,max_det=12)
                    for detected in tiles[0].boxes:
                        xy=[float(q) for q in detected.xyxy[0].tolist()]
                        score=float(detected.conf[0]);scale_w=ix1-ix0;scale_h=iy1-iy0
                        bounds=Box((ix0+xy[0])/w,(iy0+xy[1])/h,(ix0+xy[2])/w,(iy0+xy[3])/h)
                        if bounds.width<=0 or bounds.height<=0:continue
                        items.append(Detection('ball',bounds,score))
            # Non-maximum suppression across overlapping cropped and whole-image passes.
            distinct=[]
            for d in sorted(items,key=lambda item:item.score,reverse=True):
                if d.label=='ball' and any(old.label=='ball' and
                    (d.box.iou(old.box)>.25 or
                     __import__('math').dist(d.box.center,old.box.center)<.007)
                    for old in distinct):continue
                distinct.append(d)
            items=distinct
        return items
