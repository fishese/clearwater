import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
import {parseRecipe} from '../core/engine';
import type {StoredPhoto} from '../storage';

export type IOSCaptureKind='photo'|'video';
export type IOSCaptureVariant='source'|'enhanced';
export interface IOSCaptureDescriptor {
 schemaVersion:1;id:string;kind:IOSCaptureKind;name:string;type:string;sourceUrl:string;thumbnailUrl:string;enhancedUrl?:string;
 width:number;height:number;bytes:number;addedAt:number;recipeVersion:1;recipe:Record<string,unknown>;
 visible:boolean;pending:boolean;photosSaved:boolean;duration?:number;fps?:number;codec?:string;
}
export interface IOSCameraSettings {
 strength:number;quality:'auto'|'standard'|'high';minutes:1|3|5;microphoneEnabled:boolean;saveEnhancedPhotos:boolean;
}
export interface IOSCameraPreferences { saveEnhancedPhotos:boolean;microphoneEnabled:boolean }
export interface IOSCameraOpenOptions {
 schemaVersion:1;locale:'en'|'zh-HK'|'ja';strings:Record<string,string>;settings:IOSCameraSettings;
}
interface IOSCameraPlugin {
 open(options:IOSCameraOpenOptions):Promise<void>;
 listCaptures():Promise<{captures:IOSCaptureDescriptor[]}>;
 getCapture(options:{id:string}):Promise<{capture:IOSCaptureDescriptor}>;
 drainCaptures():Promise<{captures:IOSCaptureDescriptor[]}>;
 acknowledgeCapture(options:{id:string}):Promise<void>;
 setCaptureRecipe(options:{id:string;recipe:Record<string,unknown>}):Promise<void>;
 setCaptureVisible(options:{id:string;visible:boolean}):Promise<void>;
 deleteCapture(options:{id:string}):Promise<void>;
 saveCaptureToPhotos(options:{id:string}):Promise<{saved:boolean}>;
 shareCapture(options:{id:string;variant:IOSCaptureVariant}):Promise<{completed:boolean;activityType?:string}>;
 addListener(name:'captureCompleted',listener:(event:{id:string})=>void):Promise<PluginListenerHandle>;
 addListener(name:'captureError',listener:(event:{id?:string;message:string})=>void):Promise<PluginListenerHandle>;
 addListener(name:'recordingState',listener:(event:{state:string})=>void):Promise<PluginListenerHandle>;
}

const camera=registerPlugin<IOSCameraPlugin>('ClearWaterCamera');
export const isIOSCameraAvailable=()=>Capacitor.getPlatform()==='ios'&&Capacitor.isPluginAvailable('ClearWaterCamera');
const preferencesKey='clearwater-ios-camera-preferences';
const preferenceListeners=new Set<()=>void>();
function loadPreferences():IOSCameraPreferences {
 try{const saved=JSON.parse(localStorage.getItem(preferencesKey)??'null');return {saveEnhancedPhotos:saved?.saveEnhancedPhotos===true,microphoneEnabled:saved?.microphoneEnabled===true};}catch{return {saveEnhancedPhotos:false,microphoneEnabled:false};}
}
let preferences=loadPreferences();
export const getIOSCameraPreferences=()=>preferences;
export const subscribeIOSCameraPreferences=(listener:()=>void)=>{preferenceListeners.add(listener);return()=>preferenceListeners.delete(listener);};
export function setIOSSaveEnhancedPhotos(enabled:boolean){preferences={...preferences,saveEnhancedPhotos:enabled};persistPreferences();}
export function setIOSMicrophoneEnabled(enabled:boolean){preferences={...preferences,microphoneEnabled:enabled};persistPreferences();}
function persistPreferences(){try{localStorage.setItem(preferencesKey,JSON.stringify(preferences));}catch{/* The setting still applies for this session. */}preferenceListeners.forEach(listener=>listener());}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===preferencesKey){preferences=loadPreferences();preferenceListeners.forEach(listener=>listener());}});

function requireCamera(){if(!isIOSCameraAvailable())throw new Error('Native camera is unavailable in this iOS build.');}

export async function listIOSCaptures():Promise<IOSCaptureDescriptor[]> {
 requireCamera();
 const result=await camera.listCaptures();
 return Array.isArray(result?.captures)?result.captures.filter(item=>validDescriptor(item)):[];
}

export async function drainIOSCaptures():Promise<IOSCaptureDescriptor[]> {
 requireCamera();
 const result=await camera.drainCaptures();
 return Array.isArray(result?.captures)?result.captures.filter(item=>validDescriptor(item)):[];
}

function validDescriptor(value:IOSCaptureDescriptor):boolean {
 const localFile=(uri:string)=>{try{return new URL(uri).protocol==='file:';}catch{return false;}};
 return !!value&&value.schemaVersion===1&&typeof value.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)&&
  (value.kind==='photo'||value.kind==='video')&&typeof value.name==='string'&&typeof value.sourceUrl==='string'&&typeof value.thumbnailUrl==='string'&&
  localFile(value.sourceUrl)&&localFile(value.thumbnailUrl)&&(!value.enhancedUrl||localFile(value.enhancedUrl))&&
  Number.isFinite(value.bytes)&&value.bytes>0&&value.bytes<=512*1024*1024&&Number.isFinite(value.width)&&Number.isFinite(value.height)&&
  Number.isFinite(value.addedAt)&&value.recipeVersion===1&&!!value.recipe&&typeof value.visible==='boolean'&&typeof value.pending==='boolean';
}

export async function toIOSStoredPhotos(descriptors:readonly IOSCaptureDescriptor[]):Promise<StoredPhoto[]> {
 const results:StoredPhoto[]=[];
 for(const descriptor of descriptors){
  if(!descriptor.visible||!validDescriptor(descriptor))continue;
  const {blob,dataUrl}=await readIOSCaptureThumbnail(descriptor);
  const previewFile=new File([blob],descriptor.name,{type:descriptor.type,lastModified:descriptor.addedAt});
  let recipe;
  try{recipe=parseRecipe(descriptor.recipe);}catch{recipe=undefined;}
  results.push({id:descriptor.id,file:previewFile,previewFile,recipe,thumbnail:dataUrl,addedAt:descriptor.addedAt,
   nativeCapture:{descriptor,loaded:false}});
 }
 return results;
}

export async function acknowledgeIOSCapture(id:string){requireCamera();await camera.acknowledgeCapture({id});}
export async function setIOSCaptureRecipe(id:string,recipe:Record<string,unknown>){requireCamera();await camera.setCaptureRecipe({id,recipe});}
export async function setIOSCaptureVisible(id:string,visible:boolean){requireCamera();await camera.setCaptureVisible({id,visible});}
export async function deleteIOSCapture(id:string){requireCamera();await camera.deleteCapture({id});}
export async function saveIOSCaptureToPhotos(id:string){requireCamera();return camera.saveCaptureToPhotos({id});}
export async function shareIOSCapture(id:string,variant:IOSCaptureVariant='source'){
 requireCamera();return camera.shareCapture({id,variant});
}

export async function openIOSCamera(
 options:IOSCameraOpenOptions,
 callbacks:{onCapture:(id:string)=>void;onError:(message:string)=>void;onRecordingState?:(state:string)=>void}
):Promise<void> {
 requireCamera();
 const listeners:PluginListenerHandle[]=[];
 try {
  listeners.push(await camera.addListener('captureCompleted',event=>{if(typeof event?.id==='string')callbacks.onCapture(event.id);}));
  listeners.push(await camera.addListener('captureError',event=>callbacks.onError(typeof event?.message==='string'?event.message:'Camera capture failed.')));
  if(callbacks.onRecordingState)listeners.push(await camera.addListener('recordingState',event=>callbacks.onRecordingState?.(event.state)));
  await camera.open(options);
 } finally { await Promise.all(listeners.map(listener=>listener.remove().catch(()=>{}))); }
}

export async function readIOSCaptureFile(descriptor:IOSCaptureDescriptor,variant:IOSCaptureVariant='source',signal?:AbortSignal):Promise<File> {
 requireCamera();
 if(signal?.aborted)throw new DOMException('The operation was aborted.','AbortError');
 const current=(await camera.getCapture({id:descriptor.id})).capture;
 if(signal?.aborted)throw new DOMException('The operation was aborted.','AbortError');
 if(!validDescriptor(current)||current.id!==descriptor.id||!current.visible)throw new Error('This private camera source is no longer available.');
 const uri=variant==='enhanced'?(current.enhancedUrl??current.sourceUrl):current.sourceUrl;
 const response=await fetch(Capacitor.convertFileSrc(uri),{signal});
 if(signal?.aborted)throw new DOMException('The operation was aborted.','AbortError');
 if(!response.ok)throw new Error('Could not read this private camera source.');
 const blob=await response.blob();
 if(signal?.aborted)throw new DOMException('The operation was aborted.','AbortError');
 if(blob.size<=0||blob.size>512*1024*1024)throw new Error('This camera source is empty or exceeds the 512 MB safety ceiling.');
 return new File([blob],current.name,{type:current.type,lastModified:current.addedAt});
}

export async function readIOSCaptureThumbnail(descriptor:IOSCaptureDescriptor):Promise<{blob:Blob;dataUrl:string}> {
 requireCamera();
 const current=(await camera.getCapture({id:descriptor.id})).capture;
 if(!validDescriptor(current)||current.id!==descriptor.id||!current.visible)throw new Error('This private camera thumbnail is no longer available.');
 const response=await fetch(Capacitor.convertFileSrc(current.thumbnailUrl));
 if(!response.ok)throw new Error('Could not read the camera thumbnail.');
 const blob=await response.blob();
 if(blob.size<=0||blob.size>5*1024*1024)throw new Error('The camera thumbnail is invalid.');
 const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Could not read the thumbnail.'));reader.onerror=()=>reject(reader.error??new Error('Could not read the thumbnail.'));reader.readAsDataURL(blob);});
 return {blob,dataUrl};
}
