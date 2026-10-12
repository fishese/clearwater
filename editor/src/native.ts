import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
import type {LocalDirectoryHandle,LocalFileHandle} from './file-save';

type SharedPhoto={id:string;path:string;name:string;type:string};
interface NativeFiles {
 chooseFolder():Promise<{uri:string;name:string}>;
 stat(options:{folder:string;name:string}):Promise<{exists:boolean;directory?:boolean;uri?:string;name?:string}>;
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
function fileHandle(uri:string,name:string,created=false):LocalFileHandle {
 return {name,getFile:async()=>{const response=await fetch(Capacitor.convertFileSrc(uri));if(!response.ok)throw new Error('Cannot read source photo.');return new File([await response.blob()],name);},async createWritable(){
   if(!created)throw new Error('Existing photos cannot be overwritten.');
   const {id}=await files.beginWrite({uri});
   return {async write(blob){for(let offset=0;offset<blob.size;offset+=256*1024){const bytes=new Uint8Array(await blob.slice(offset,offset+256*1024).arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);await files.writeChunk({id,data:btoa(binary)});}},async close(){await files.finishWrite({id,abort:false});},async abort(){await files.finishWrite({id,abort:true});}};
 }};
}
export async function chooseAndroidFolder():Promise<LocalDirectoryHandle>{
 const folder=await files.chooseFolder();
 return {name:folder.name,async getFileHandle(name,options){
   if(options?.create){const created=await files.create({folder:folder.uri,name});return fileHandle(created.uri,created.name,true);}
   const entry=await files.stat({folder:folder.uri,name});
   if(!entry.exists)throw new DOMException('Missing file','NotFoundError');
   if(entry.directory)throw new DOMException('Name belongs to a folder','TypeMismatchError');
   return fileHandle(entry.uri!,entry.name!);
 }};
}
export async function receiveAndroidPhotos(onFiles:(photos:File[])=>void,onError:(message:string)=>void){
 let running=false,pending=false,stopped=false;
 const drain=async()=>{if(stopped)return;if(running){pending=true;return;}running=true;try{
   do {pending=false;const result=await files.drainShares();if(result.error)onError(result.error);
    for(const item of result.photos){try{const response=await fetch(Capacitor.convertFileSrc(item.path));if(!response.ok)throw new Error('Read failed');onFiles([new File([await response.blob()],item.name,{type:item.type})]);await files.releaseShare({id:item.id});}catch{onError('Could not import a shared photo. Share it again or use Open photos.');}}
   }while(pending&&!stopped);
 }catch{onError('Could not receive shared photos.');}finally{running=false;}};
 const listener=await files.addListener('sharesAvailable',()=>void drain());await drain();
 return ()=>{stopped=true;void listener.remove();};
}
