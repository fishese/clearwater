import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
import type {LocalDirectoryHandle,LocalFileHandle} from './file-save';
import {mediaLimit,supportedMedia} from './core/media';

type SharedPhoto={id:string;path:string;name:string;type:string};
export type AndroidFolderPhoto={uri:string;name:string;type:string;size:number};
export type AndroidPhotoFolder={name:string;directory:LocalDirectoryHandle;photos:AndroidFolderPhoto[]};
interface NativeFiles {
 chooseFolder():Promise<{uri:string;name:string}>;
 stat(options:{folder:string;name:string}):Promise<{exists:boolean;directory?:boolean;uri?:string;name?:string;size?:number}>;
 listPhotos(options:{folder:string}):Promise<{photos:AndroidFolderPhoto[]}>;
 create(options:{folder:string;name:string}):Promise<{uri:string;name:string}>;
 beginWrite(options:{uri:string}):Promise<{id:string}>;
 writeChunk(options:{id:string;data:string}):Promise<void>;
 finishWrite(options:{id:string;abort:boolean}):Promise<void>;
 drainShares():Promise<{photos:SharedPhoto[];error?:string}>;
 releaseShare(options:{id:string}):Promise<void>;
 addListener(name:'sharesAvailable',listener:()=>void):Promise<PluginListenerHandle>;
}
const files=registerPlugin<NativeFiles>('ClearWaterFiles');
export const isAndroid=()=>Capacitor.getPlatform()==='android';
function fileHandle(uri:string,name:string,created=false,size?:number):LocalFileHandle {
 return {name,size,getFile:async()=>{const response=await fetch(Capacitor.convertFileSrc(uri));if(!response.ok)throw new Error('Cannot read source file.');return new File([await response.blob()],name);},async createWritable(){
   if(!created)throw new Error('Existing files cannot be overwritten.');
   const {id}=await files.beginWrite({uri});
   return {async write(blob){for(let offset=0;offset<blob.size;offset+=256*1024){const bytes=new Uint8Array(await blob.slice(offset,offset+256*1024).arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);await files.writeChunk({id,data:btoa(binary)});}},async close(){await files.finishWrite({id,abort:false});},async abort(){await files.finishWrite({id,abort:true});}};
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
    for(const item of result.photos){try{const response=await fetch(Capacitor.convertFileSrc(item.path));if(!response.ok)throw new Error('Read failed');onFiles([new File([await response.blob()],item.name,{type:item.type})]);await files.releaseShare({id:item.id});}catch{onError('Could not import a shared file. Share it again or use Open files.');}}
   }while(pending&&!stopped);
 }catch{onError('Could not receive shared files.');}finally{running=false;}};
 const listener=await files.addListener('sharesAvailable',()=>void drain());await drain();
 return ()=>{stopped=true;void listener.remove();};
}
