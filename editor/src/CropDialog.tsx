import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {FULL_CROP} from './core/crop';
import type {PhotoCrop} from './core/types';
import {t} from './i18n';

type Corner='nw'|'ne'|'sw'|'se';
type Drag={id:number;kind:Corner|'move';x:number;y:number;initial:PhotoCrop};
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
function adjusted(start:PhotoCrop,kind:Corner|'move',dx:number,dy:number):PhotoCrop {
 const min=.01;
 if(kind==='move')return {...start,x:clamp(start.x+dx,0,1-start.width),y:clamp(start.y+dy,0,1-start.height)};
 let left=start.x,top=start.y,right=start.x+start.width,bottom=start.y+start.height;
 if(kind.includes('w'))left=clamp(left+dx,0,right-min);else right=clamp(right+dx,left+min,1);
 if(kind.includes('n'))top=clamp(top+dy,0,bottom-min);else bottom=clamp(bottom+dy,top+min,1);
 return {x:left,y:top,width:right-left,height:bottom-top};
}
export default function CropDialog({canvas,initial,onApply,onClose}:{canvas:HTMLCanvasElement;initial?:PhotoCrop;onApply:(crop:PhotoCrop)=>void;onClose:()=>void}){
 const [crop,setCrop]=useState<PhotoCrop>(()=>({...initial??FULL_CROP})),surface=useRef<HTMLDivElement>(null),preview=useRef<HTMLCanvasElement>(null),dialog=useRef<HTMLDivElement>(null),drag=useRef<Drag|null>(null);
 useEffect(()=>{const c=preview.current;if(!c)return;c.width=canvas.width;c.height=canvas.height;c.getContext('2d')?.drawImage(canvas,0,0);const opener=document.activeElement as HTMLElement|null;dialog.current?.focus();return()=>{c.width=1;c.height=1;queueMicrotask(()=>opener?.focus());};},[canvas]);
 const pointerDown=(event:ReactPointerEvent<HTMLDivElement>)=>{
  if(!event.isPrimary||(event.pointerType!=='touch'&&event.button!==0))return;
  const target=event.target as HTMLElement,kind=(target.closest('[data-crop-handle]')?.getAttribute('data-crop-handle') as Corner|null)??'move';
  drag.current={id:event.pointerId,kind,x:event.clientX,y:event.clientY,initial:crop};
  try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Synthetic pointers may not be capturable. */}
  event.preventDefault();
 };
 const pointerMove=(event:ReactPointerEvent<HTMLDivElement>)=>{const active=drag.current,rect=surface.current?.getBoundingClientRect();if(!active||!rect||active.id!==event.pointerId||!rect.width||!rect.height)return;setCrop(adjusted(active.initial,active.kind,(event.clientX-active.x)/rect.width,(event.clientY-active.y)/rect.height));};
 const finish=(event:ReactPointerEvent<HTMLDivElement>,cancel=false)=>{const active=drag.current;if(!active||active.id!==event.pointerId)return;if(cancel)setCrop(active.initial);drag.current=null;try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}catch{/* Already released. */}};
 const handleKey=(event:ReactKeyboardEvent<HTMLButtonElement>,corner:Corner)=>{const step=event.shiftKey?.1:.01;const delta:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};if(!delta[event.key])return;event.preventDefault();const [dx,dy]=delta[event.key];setCrop(current=>adjusted(current,corner,dx,dy));};
 return <div className="modal-shade crop-shade"><div className="export-dialog crop-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="crop-title" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose();return;}if(event.key!=='Tab')return;const entries=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]'));const first=entries[0],last=entries.at(-1);if(!first||!last)return;if(event.shiftKey&&(document.activeElement===first||document.activeElement===event.currentTarget)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}>
  <h2 id="crop-title">{t('Crop photo')}</h2><p>{t('Drag the corners to crop, or drag inside to move the selection.')}</p>
  <div ref={surface} className="crop-surface" style={{width:`min(100%, ${50*canvas.width/canvas.height}dvh)`,aspectRatio:`${canvas.width} / ${canvas.height}`}} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)} onLostPointerCapture={event=>finish(event,true)}>
   <canvas ref={preview} aria-hidden="true"/>
   <div className="crop-selection" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.width*100}%`,height:`${crop.height*100}%`}}>
    {(['nw','ne','sw','se'] as const).map(corner=><button type="button" key={corner} className={`crop-handle crop-${corner}`} data-crop-handle={corner} aria-label={t({nw:'Top left crop handle',ne:'Top right crop handle',sw:'Bottom left crop handle',se:'Bottom right crop handle'}[corner])} onKeyDown={event=>handleKey(event,corner)}/>) }
   </div>
  </div>
  <p>{t('Crop is non-destructive and can be changed or undone.')}</p>
  <div className="crop-actions"><button type="button" className="button secondary" onClick={()=>setCrop({...FULL_CROP})}>{t('Reset crop')}</button><button type="button" className="button secondary" onClick={onClose}>{t('Cancel')}</button><button type="button" className="button primary" onClick={()=>onApply(crop)}>{t('Apply crop')}</button></div>
 </div></div>;
}
