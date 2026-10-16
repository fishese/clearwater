import {Capacitor,registerPlugin} from '@capacitor/core';

const MAX_SHARE_BYTES=512*1024*1024;
const CHUNK_BYTES=256*1024;
const allowedMime=new Set(['image/jpeg','image/png','video/mp4']);

interface SharePlugin {
  beginShare(options:{name:string;type:string;size:number}):Promise<{id:string}>;
  writeShareChunk(options:{id:string;data:string}):Promise<void>;
  finishShare(options:{id:string}):Promise<void>;
  cancelShare(options:{id:string}):Promise<void>;
}
const nativeShare=registerPlugin<SharePlugin>('ClearWaterShare');

function validate(file:Blob,name:string){
  if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>MAX_SHARE_BYTES)throw new Error('This file is too large to share.');
  if(name.length<1||name.length>220||name==='.'||name==='..'||/[\\/\u0000-\u001f\u007f]/.test(name)||name.trim()!==name)throw new Error('This file name cannot be shared.');
  const type=(file.type||mimeFromName(name)).toLowerCase().split(';',1)[0].trim();
  if(!allowedMime.has(type))throw new Error('This file type cannot be shared.');
  const lower=name.toLowerCase();
  const extensionMatches=type==='image/jpeg'?(lower.endsWith('.jpg')||lower.endsWith('.jpeg')):type==='image/png'?lower.endsWith('.png'):lower.endsWith('.mp4');
  if(!extensionMatches)throw new Error('The file name and type do not match.');
  return type;
}
function mimeFromName(name:string){const ext=name.toLowerCase().split('.').pop();return ext==='png'?'image/png':ext==='mp4'?'video/mp4':'image/jpeg';}
function encodeBase64(bytes:Uint8Array){
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
  return btoa(binary);
}

export function supportsFileShare():boolean{
  if(Capacitor.getPlatform()==='android')return Capacitor.isPluginAvailable('ClearWaterShare');
  const nav=navigator as Navigator&{canShare?:(data:{files:File[]})=>boolean;share?:(data:{files:File[]})=>Promise<void>};
  return typeof nav.share==='function'&&typeof nav.canShare==='function';
}

/** Stage an immutable export in app-private storage, then hand it to Android's chooser. */
export async function shareExport(blob:Blob,name:string):Promise<void>{
  const type=validate(blob,name);
  if(Capacitor.getPlatform()==='android'){
    const {id}=await nativeShare.beginShare({name,type,size:blob.size});
    try{
      const reader=blob.stream().getReader();let carry=new Uint8Array(0);
      try{
        while(true){
          const {done,value}=await reader.read();
          let bytes=value;
          if(carry.length){const joined=new Uint8Array(carry.length+(value?.length??0));joined.set(carry);if(value)joined.set(value,carry.length);bytes=joined;carry=new Uint8Array(0);}
          if(bytes){let offset=0;while(bytes.length-offset>=CHUNK_BYTES){await nativeShare.writeShareChunk({id,data:encodeBase64(bytes.subarray(offset,offset+CHUNK_BYTES))});offset+=CHUNK_BYTES;}if(offset<bytes.length)carry=bytes.slice(offset);}
          if(done)break;
        }
        if(carry.length)await nativeShare.writeShareChunk({id,data:encodeBase64(carry)});
        await nativeShare.finishShare({id});
      }finally{reader.releaseLock();}
    }catch(error){try{await nativeShare.cancelShare({id});}catch{}throw error;}
    return;
  }
  const nav=navigator as Navigator&{canShare?:(data:{files:File[]})=>boolean;share?:(data:{files:File[]})=>Promise<void>};
  if(typeof nav.share!=='function'||typeof nav.canShare!=='function')throw new Error('File sharing is not available in this browser.');
  const file=new File([blob],name,{type});
  if(!nav.canShare({files:[file]}))throw new Error('This browser cannot share this file.');
  await nav.share({files:[file]});
}
