import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
import type {LocalDirectoryHandle,LocalFileHandle} from './file-save';
import {mediaLimit,supportedMedia} from './core/media';
import type {CustomModel} from './core/types';

type SharedPhoto={id:string;path:string;name:string;type:string};
interface NativeHdr {
 beginHdrInput(options:{name:string;size:number}):Promise<{id:string}>;
 writeHdrInputChunk(options:{id:string;data:string}):Promise<void>;
 finishHdrInput(options:{id:string;abort:boolean}):Promise<void>;
 convertHdrToSdr(options:{id:string}):Promise<{id:string;uri:string}>;
 cancelHdrConversion(options:{id:string}):Promise<void>;
 deleteHdrWorkingCopy(options:{id:string}):Promise<void>;
 addListener(name:'hdrConversionProgress',listener:(event:{id:string;progress:number})=>void):Promise<PluginListenerHandle>;
}
interface NativeBack {
 setEnabled(options:{enabled:boolean}):Promise<void>;
 exitApp():Promise<void>;
 addListener(name:'back',listener:()=>void):Promise<PluginListenerHandle>;
}
export type AndroidFolderPhoto={uri:string;name:string;type:string;size:number};
export type AndroidPhotoFolder={name:string;directory:LocalDirectoryHandle;photos:AndroidFolderPhoto[]};
interface NativeFiles {
 chooseFolder():Promise<{uri:string;name:string}>;
 stat(options:{folder:string;name:string}):Promise<{exists:boolean;directory?:boolean;uri?:string;name?:string;size?:number}>;
 listPhotos(options:{folder:string}):Promise<{photos:AndroidFolderPhoto[]}>;
 create(options:{folder:string;name:string}):Promise<{uri:string;name:string}>;
 createCapture(options:{name:string;type:string}):Promise<{uri:string;name:string;destination:string}>;
 copyCameraCapture(options:{sourceUri:string;uri:string}):Promise<void>;
 beginCameraUpdate(options:{uri:string}):Promise<{id:string}>;
 deleteCameraCapture(options:{uri:string}):Promise<void>;
 probeAndroidSources(options:{uris:string[]}):Promise<{states:Record<string,'present'|'missing'|'unavailable'|'trashed'>}>;
 beginWrite(options:{uri:string}):Promise<{id:string}>;
 writeChunk(options:{id:string;data:string}):Promise<void>;
 finishWrite(options:{id:string;abort:boolean}):Promise<void>;
 drainShares():Promise<{photos:SharedPhoto[];error?:string}>;
 releaseShare(options:{id:string}):Promise<void>;
 addListener(name:'sharesAvailable',listener:()=>void):Promise<PluginListenerHandle>;
 getRememberedModel():Promise<{present:boolean;hasFile:boolean;config?:CustomModel;size?:number}>;
 beginModelWrite(options:{size:number}):Promise<{id:string}>;
 writeModelChunk(options:{id:string;data:string}):Promise<void>;
 finishModelWrite(options:{id:string;abort:boolean;config?:CustomModel}):Promise<void>;
 readModelChunk(options:{offset:number;length:number}):Promise<{data:string;done:boolean}>;
 clearRememberedModelFile():Promise<void>;
 forgetRememberedModel():Promise<void>;
}
const files=registerPlugin<NativeFiles>('ClearWaterFiles');
const hdr=registerPlugin<NativeHdr>('ClearWaterHdr');
const back=registerPlugin<NativeBack>('ClearWaterBack');
let backListeners=0;
const cancelledHdrJobs=new Set<string>();
export const isAndroid=()=>Capacitor.getPlatform()==='android';
function base64Chunk(bytes:Uint8Array){
 const parts:string[]=[];
 // Keep each argument list bounded while converting a whole write chunk at once.
 for(let offset=0;offset<bytes.length;offset+=0x8000)parts.push(String.fromCharCode(...bytes.subarray(offset,offset+0x8000)));
 return btoa(parts.join(''));
}
export async function createAndroidHdrWorkingCopy(source:File,onProgress:(progress:number)=>void,onJob:(id:string)=>void):Promise<{id:string;file:File}> {
 if(!isAndroid())throw new Error('HDR video conversion is available in the Android app.');
 if(source.size<=0||source.size>512*1024*1024)throw new Error('HDR videos must be no larger than 512 MB.');
 const {id}=await hdr.beginHdrInput({name:source.name,size:source.size});onJob(id);let staged=false,outputReady=false;let listener:PluginListenerHandle|undefined;
 try{
  for(let offset=0;offset<source.size;offset+=256*1024){if(cancelledHdrJobs.has(id))throw new DOMException('HDR conversion cancelled.','AbortError');const bytes=new Uint8Array(await source.slice(offset,offset+256*1024).arrayBuffer());await hdr.writeHdrInputChunk({id,data:base64Chunk(bytes)});onProgress(Math.round((offset+bytes.length)/source.size*5));}
  if(cancelledHdrJobs.has(id))throw new DOMException('HDR conversion cancelled.','AbortError');
  await hdr.finishHdrInput({id,abort:false});staged=true;
  listener=await hdr.addListener('hdrConversionProgress',event=>{if(event.id===id)onProgress(5+Math.round(Math.max(0,Math.min(100,event.progress))*.95));});
  if(cancelledHdrJobs.has(id))throw new DOMException('HDR conversion cancelled.','AbortError');
  const result=await hdr.convertHdrToSdr({id});outputReady=true;
  const response=await fetch(Capacitor.convertFileSrc(result.uri));if(!response.ok)throw new Error('Could not read the SDR working copy.');
  const blob=await response.blob();if(!blob.size)throw new Error('The SDR working copy was empty.');
  return {id,file:new File([blob],'hdr-working-copy.mp4',{type:'video/mp4'})};
 }finally{
  cancelledHdrJobs.delete(id);if(listener)await listener.remove().catch(()=>{});
  if(!staged)await hdr.finishHdrInput({id,abort:true}).catch(()=>{});
  else if(!outputReady)await hdr.cancelHdrConversion({id}).catch(()=>{});
  if(outputReady)await hdr.deleteHdrWorkingCopy({id}).catch(()=>{});
 }
}
export async function cancelAndroidHdrWorkingCopy(id:string){cancelledHdrJobs.add(id);await hdr.cancelHdrConversion({id}).catch(()=>{});}
export async function readRememberedAndroidModel():Promise<{config:CustomModel;blob:Blob|null}|null>{
 const info=await files.getRememberedModel();if(!info.present||!info.config)return null;
 if(!info.hasFile||!info.size||info.size>64*1024*1024)return {config:info.config,blob:null};
 try{
  const chunks:BlobPart[]=[];let offset=0;
  while(offset<info.size){const result=await files.readModelChunk({offset,length:Math.min(256*1024,info.size-offset)});if(!result.data)throw new Error('Saved custom model is damaged.');const binary=atob(result.data),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);chunks.push(bytes);offset+=bytes.length;if(result.done&&offset<info.size)throw new Error('Saved custom model is incomplete.');}
  if(offset!==info.size)throw new Error('Saved custom model is damaged.');
  return {config:info.config,blob:new Blob(chunks,{type:'application/octet-stream'})};
 }catch{return {config:info.config,blob:null};}
}
export async function saveRememberedAndroidModel(blob:Blob,config:CustomModel){
 if(blob.size<=0||blob.size>64*1024*1024)throw new Error('Choose a self-contained ONNX model under 64 MB.');
 const {id}=await files.beginModelWrite({size:blob.size});let committed=false;
 try{
  for(let offset=0;offset<blob.size;offset+=256*1024){const bytes=new Uint8Array(await blob.slice(offset,offset+256*1024).arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);await files.writeModelChunk({id,data:btoa(binary)});}
  await files.finishModelWrite({id,abort:false,config});committed=true;
 }finally{if(!committed)await files.finishModelWrite({id,abort:true}).catch(()=>{});}
}
export const clearRememberedAndroidModelFile=()=>files.clearRememberedModelFile();
export const forgetRememberedAndroidModel=()=>files.forgetRememberedModel();
export function listenForAndroidBack(onBack:()=>void):()=>void{
 if(!isAndroid())return ()=>{};
 let stopped=false,listener:PluginListenerHandle|undefined;
 backListeners++;
 void back.addListener('back',onBack).then(async handle=>{
  if(stopped){await handle.remove().catch(()=>{});return;}
  listener=handle;
  try{await back.setEnabled({enabled:true});}
  catch{listener=undefined;await handle.remove().catch(()=>{});if(!stopped){stopped=true;backListeners=Math.max(0,backListeners-1);if(backListeners===0)await back.setEnabled({enabled:false}).catch(()=>{});}}
 }).catch(()=>{if(!stopped){backListeners=Math.max(0,backListeners-1);if(backListeners===0)void back.setEnabled({enabled:false}).catch(()=>{});}});
 return ()=>{if(stopped)return;stopped=true;backListeners=Math.max(0,backListeners-1);if(backListeners===0)void back.setEnabled({enabled:false}).catch(()=>{});if(listener)void listener.remove().catch(()=>{});};
}
export const exitAndroidApp=()=>back.exitApp();
export async function saveAndroidCameraCapture(file:File,sourceUri?:string):Promise<{uri:string;name:string;destination:string}>{
 if(!isAndroid())throw new Error('Camera captures can only be saved from the Android app.');
 const type=file.type.toLowerCase();
 const video=type==='video/mp4';
 if(!video&&type!=='image/jpeg')throw new Error('Camera captures must be JPEG photos or MP4 videos.');
 if(file.size<=0)throw new Error('The camera capture is empty.');
  if(sourceUri&&!video)throw new Error('Only native camera videos can be copied directly.');
 const generatedName=()=>{const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');return `ClearWater_${stamp}_${crypto.randomUUID()}.${video?'mp4':'jpg'}`;};
 const supplied=file.name;
 const safeCameraName=/^clearwater-camera-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i.test(supplied);
 const legacyName=/^ClearWater_\d{8}T\d{6}Z_[0-9a-f-]{36}\.(?:jpg|mp4)$/i.test(supplied)&&supplied.toLowerCase().endsWith(video?'.mp4':'.jpg');
 const name=safeCameraName&&!video||legacyName?supplied:generatedName();
 const created=await files.createCapture({name,type:video?'video/mp4':'image/jpeg'});
  if(sourceUri){await files.copyCameraCapture({sourceUri,uri:created.uri});return created;}
 const {id}=await files.beginWrite({uri:created.uri});let committed=false;
 try{
  for(let offset=0;offset<file.size;offset+=256*1024){const bytes=new Uint8Array(await file.slice(offset,offset+256*1024).arrayBuffer());await files.writeChunk({id,data:base64Chunk(bytes)});}
  await files.finishWrite({id,abort:false});committed=true;
 }finally{if(!committed)await files.finishWrite({id,abort:true}).catch(()=>{});}
 return created;
}
export async function deleteAndroidCameraCapture(uri:string):Promise<void>{
 if(!isAndroid())throw new Error('Camera captures can only be deleted from the Android app.');
 await files.deleteCameraCapture({uri});
}
export async function replaceAndroidCameraCapture(uri:string,blob:Blob):Promise<void>{
 if(!isAndroid())throw new Error('Camera captures can only be updated from the Android app.');
 if(!uri||blob.size<=0)throw new Error('The updated camera photo is empty.');
 const {id}=await files.beginCameraUpdate({uri});let committed=false;
 try{
  for(let offset=0;offset<blob.size;offset+=256*1024){const bytes=new Uint8Array(await blob.slice(offset,offset+256*1024).arrayBuffer());await files.writeChunk({id,data:base64Chunk(bytes)});}
  await files.finishWrite({id,abort:false});committed=true;
 }finally{if(!committed)await files.finishWrite({id,abort:true}).catch(()=>{});}
}
export async function probeAndroidSources(uris:readonly string[]):Promise<Record<string,'present'|'missing'|'unavailable'|'trashed'>>{
 const unique=[...new Set(uris.filter(uri=>typeof uri==='string'&&uri.length>0))];
 if(!isAndroid())return Object.fromEntries(unique.map(uri=>[uri,'unavailable']));
 if(!unique.length)return {};
 const result=await files.probeAndroidSources({uris:unique});
 const valid=new Set(['present','missing','unavailable','trashed']);
 return Object.fromEntries(unique.map(uri=>[uri,valid.has(result?.states?.[uri])?result.states[uri]:'unavailable']));
}
function fileHandle(uri:string,name:string,created=false,size?:number):LocalFileHandle {
 return {name,size,getFile:async()=>{const response=await fetch(Capacitor.convertFileSrc(uri));if(!response.ok)throw new Error('Cannot read source file.');return new File([await response.blob()],name);},async createWritable(){
   if(!created)throw new Error('Existing files cannot be overwritten.');
   const {id}=await files.beginWrite({uri});
   return {async write(blob){for(let offset=0;offset<blob.size;offset+=256*1024){const bytes=new Uint8Array(await blob.slice(offset,offset+256*1024).arrayBuffer());await files.writeChunk({id,data:base64Chunk(bytes)});}},async close(){await files.finishWrite({id,abort:false});},async abort(){await files.finishWrite({id,abort:true});}};
 }};
}
function directoryHandle(folder:{uri:string;name:string}):LocalDirectoryHandle {
 return {name:folder.name,async getFileHandle(name,options){
   if(options?.create){const created=await files.create({folder:folder.uri,name});return fileHandle(created.uri,created.name,true);}
   const entry=await files.stat({folder:folder.uri,name});
   if(!entry.exists)throw new DOMException('Missing file','NotFoundError');
   if(entry.directory)throw new DOMException('Name belongs to a folder','TypeMismatchError');
   return fileHandle(entry.uri!,entry.name!,false,entry.size);
 }};
}
async function pickFolder(){try{return await files.chooseFolder();}catch(error){if((error as {code?:string})?.code==='CANCELLED')throw new DOMException('Folder selection cancelled.','AbortError');throw error;}}
export async function chooseAndroidFolder():Promise<LocalDirectoryHandle>{return directoryHandle(await pickFolder());}
export async function openAndroidPhotoFolder():Promise<AndroidPhotoFolder>{
 const folder=await pickFolder(),result=await files.listPhotos({folder:folder.uri});
 const photos=result.photos.filter(photo=>supportedMedia(photo)&&photo.size<=mediaLimit(photo))
  .sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})||a.uri.localeCompare(b.uri));
 return {name:folder.name,directory:directoryHandle(folder),photos};
}
export async function readAndroidFolderPhoto(photo:AndroidFolderPhoto):Promise<File>{
 const response=await fetch(Capacitor.convertFileSrc(photo.uri));if(!response.ok)throw new Error('Could not read this file. It may have been moved or deleted.');
 const reader=response.body?.getReader();let blob:Blob;
 if(reader){const chunks:Uint8Array<ArrayBuffer>[]=[];let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>mediaLimit(photo))throw new Error('This file exceeds the 512 MB safety ceiling.');chunks.push(new Uint8Array(part.value));}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}blob=new Blob(chunks);}
 else blob=await response.blob();
 if(blob.size>mediaLimit(photo))throw new Error('This file exceeds the 512 MB safety ceiling.');
 return new File([blob],photo.name,{type:photo.type});
}
export async function receiveAndroidPhotos(onFiles:(photos:File[])=>void,onError:(message:string)=>void){
 let running=false,pending=false,stopped=false;
 const drain=async()=>{if(stopped)return;if(running){pending=true;return;}running=true;try{
   do {pending=false;const result=await files.drainShares();if(result.error)onError(result.error);
    for(const item of result.photos){try{const response=await fetch(Capacitor.convertFileSrc(item.path));if(!response.ok)throw new Error('Read failed');onFiles([new File([await response.blob()],item.name,{type:item.type})]);}catch{onError('Could not import a shared file. Share it again or use Open files.');}finally{await files.releaseShare({id:item.id}).catch(()=>{});}}
   }while(pending&&!stopped);
 }catch{onError('Could not receive shared files.');}finally{running=false;}};
 const listener=await files.addListener('sharesAvailable',()=>void drain());await drain();
 return ()=>{stopped=true;void listener.remove();};
}
