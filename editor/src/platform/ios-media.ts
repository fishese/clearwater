import {Capacitor,registerPlugin} from '@capacitor/core';
import {assertExportBytes,detectMediaPlatform,normalizeMediaError,type MediaPlatform} from '../core/platform-limits';

interface IOSPhotoExportPlugin {
 beginExport(options:{name:string;type:string;size:number}):Promise<{id:string}>;
 writeExportChunk(options:{id:string;data:string}):Promise<void>;
 finishExport(options:{id:string;abort:boolean}):Promise<void>;
 shareExport(options:{id:string}):Promise<{completed:boolean;activityType?:string}>;
 discardExport(options:{id:string}):Promise<void>;
 chooseBatchFolder():Promise<{id:string;name:string}>;
 saveBatchExport(options:{folderId:string;id:string;name:string}):Promise<{name:string}>;
 releaseBatchFolder(options:{id:string}):Promise<void>;
}

const exportPlugin=registerPlugin<IOSPhotoExportPlugin>('ClearWaterExport');
function exportPlatform():MediaPlatform {
 const nav=typeof navigator==='undefined'?undefined:navigator;
 return detectMediaPlatform({capacitorPlatform:Capacitor.getPlatform(),userAgent:nav?.userAgent??'',navigatorPlatform:nav?.platform??'',maxTouchPoints:nav?.maxTouchPoints??0});
}
const CHUNK_BYTES=256*1024;
const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/heic','image/heif','image/dng','image/x-adobe-dng','video/mp4','video/quicktime','application/json','application/zip']);
const TYPE_BY_EXTENSION:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',heic:'image/heic',heif:'image/heif',dng:'image/x-adobe-dng',mp4:'video/mp4',mov:'video/quicktime',json:'application/json',zip:'application/zip'};

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
 if(type==='application/zip'&&extension!=='zip')throw new Error('The file name and type do not match.');
 if(blob.size<=0)throw new Error('The exported file is empty.');
 const platform=exportPlatform();
 assertExportBytes(blob.size,type.startsWith('video/')?'video':'photo',platform);
 const {id}=await exportPlugin.beginExport({name,type,size:blob.size});
 let staged=false;
 try{
  for(let offset=0;offset<blob.size;offset+=CHUNK_BYTES){
   const bytes=new Uint8Array(await blob.slice(offset,offset+CHUNK_BYTES).arrayBuffer());
   await exportPlugin.writeExportChunk({id,data:encodeBase64(bytes)});
  }
  await exportPlugin.finishExport({id,abort:false});staged=true;
  return await exportPlugin.shareExport({id});
 }catch(error){
  console.error(error);
  throw normalizeMediaError(error,platform);
 }finally{
  if(!staged)await exportPlugin.finishExport({id,abort:true}).catch(error=>{console.error(error);});
  await exportPlugin.discardExport({id}).catch(error=>{console.error(error);});
 }
}

export const shareIOSPhoto=shareIOSFile;

export interface IOSBatchFolder {name:string;write(name:string,blob:Blob):Promise<string>;close():Promise<void>}

/** Select once, then copy staged photos to the scoped folder without overwriting. */
export async function chooseIOSBatchFolder():Promise<IOSBatchFolder>{
 if(!isIOSPhotoExportAvailable())throw new Error('Native file export is available in the iOS app.');
 let folder:{id:string;name:string};
 try{folder=await exportPlugin.chooseBatchFolder();}
 catch(error){if((error as {code?:string})?.code==='CANCELLED')throw new DOMException('Folder selection cancelled.','AbortError');throw error;}
 let closed=false;
 return {name:folder.name,async write(name,blob){
  if(closed)throw new Error('The output folder is no longer available.');
  const type=blob.type.toLowerCase().split(';',1)[0].trim(),extension=name.split('.').at(-1)?.toLowerCase();
  if(!((type==='image/jpeg'&&(extension==='jpg'||extension==='jpeg'))||(type==='image/png'&&extension==='png')))throw new Error('This file type cannot be saved.');
  if(blob.size<=0)throw new Error('The exported file is empty.');
  assertExportBytes(blob.size,'photo',exportPlatform());
  const {id}=await exportPlugin.beginExport({name,type,size:blob.size});let staged=false;
  try{
   for(let offset=0;offset<blob.size;offset+=CHUNK_BYTES){const bytes=new Uint8Array(await blob.slice(offset,offset+CHUNK_BYTES).arrayBuffer());await exportPlugin.writeExportChunk({id,data:encodeBase64(bytes)});}
   await exportPlugin.finishExport({id,abort:false});staged=true;
   const saved=await exportPlugin.saveBatchExport({folderId:folder.id,id,name});return saved.name;
  }finally{
   if(!staged)await exportPlugin.finishExport({id,abort:true}).catch(()=>{});
   await exportPlugin.discardExport({id}).catch(()=>{});
  }
 },async close(){if(closed)return;closed=true;await exportPlugin.releaseBatchFolder({id:folder.id});}};
}
