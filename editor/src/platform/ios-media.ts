import {Capacitor,registerPlugin} from '@capacitor/core';

interface IOSPhotoExportPlugin {
 beginExport(options:{name:string;type:string;size:number}):Promise<{id:string}>;
 writeExportChunk(options:{id:string;data:string}):Promise<void>;
 finishExport(options:{id:string;abort:boolean}):Promise<void>;
 shareExport(options:{id:string}):Promise<{completed:boolean;activityType?:string}>;
 discardExport(options:{id:string}):Promise<void>;
}

const exportPlugin=registerPlugin<IOSPhotoExportPlugin>('ClearWaterExport');
const MAX_EXPORT_BYTES=512*1024*1024;
const CHUNK_BYTES=256*1024;
const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/heic','image/heif','image/dng','image/x-adobe-dng','video/mp4','video/quicktime','application/json']);
const TYPE_BY_EXTENSION:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',heic:'image/heic',heif:'image/heif',dng:'image/x-adobe-dng',mp4:'video/mp4',mov:'video/quicktime',json:'application/json'};

export function isIOSPhotoExportAvailable():boolean {
 return Capacitor.getPlatform()==='ios'&&Capacitor.isPluginAvailable('ClearWaterExport');
}

function encodeBase64(bytes:Uint8Array):string {
 const pieces:string[]=[];
 for(let offset=0;offset<bytes.length;offset+=0x8000)pieces.push(String.fromCharCode(...bytes.subarray(offset,offset+0x8000)));
 return btoa(pieces.join(''));
}

/** Opens the iOS share sheet; Photos and Files destinations receive independent copies. */
export async function shareIOSFile(blob:Blob,name='ClearWater-Export'):
 Promise<{completed:boolean;activityType?:string}> {
 if(!isIOSPhotoExportAvailable())throw new Error('Native file export is available in the iOS app.');
 const extension=name.split('.').at(-1)?.toLowerCase()??'';
 const declared=blob.type.toLowerCase().split(';',1)[0].trim();
 const type=!declared||declared==='application/octet-stream'?TYPE_BY_EXTENSION[extension]||declared:declared;
 if(!ALLOWED_TYPES.has(type))throw new Error('This file type cannot be shared from the iOS app.');
 if(blob.size<=0)throw new Error('The exported file is empty.');
 if(blob.size>MAX_EXPORT_BYTES)throw new Error('The exported file exceeds the 512 MB safety ceiling.');
 const {id}=await exportPlugin.beginExport({name,type,size:blob.size});
 let staged=false;
 try{
  for(let offset=0;offset<blob.size;offset+=CHUNK_BYTES){
   const bytes=new Uint8Array(await blob.slice(offset,offset+CHUNK_BYTES).arrayBuffer());
   await exportPlugin.writeExportChunk({id,data:encodeBase64(bytes)});
  }
  await exportPlugin.finishExport({id,abort:false});staged=true;
  return await exportPlugin.shareExport({id});
 }finally{
  if(!staged)await exportPlugin.finishExport({id,abort:true}).catch(()=>{});
  await exportPlugin.discardExport({id}).catch(()=>{});
 }
}

export const shareIOSPhoto=shareIOSFile;
