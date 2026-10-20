import {isRaw} from './core/media';
import {fitPhoto,photoInfo,type PhotoInfo,type PhotoResolution,type PhotoDevice} from './core/photo-size';
import {classifyMediaFailure,currentMediaPlatform,type MediaPlatform} from './core/platform-limits';
import {photoHeader} from './photo-header';
export interface PhotoDecodeOptions {mode:PhotoResolution;device:PhotoDevice;preview:boolean;onInfo:(info:PhotoInfo)=>void;signal?:AbortSignal;platform?:MediaPlatform}
export async function decodePhoto(blob:File,options:PhotoDecodeOptions):Promise<{bitmap:ImageBitmap;info:PhotoInfo}>{
 if(isRaw(blob))return await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./raw.worker.ts',import.meta.url),{type:'module'});
  const cleanup=()=>{worker.terminate();options.signal?.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(new DOMException('Photo decoding cancelled.','AbortError'));};
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted){abort();return;}
  worker.onerror=()=>{cleanup();reject(new Error('RAW decoder stopped. Try Reduced resolution.'));};
  worker.onmessage=({data})=>{if(data.type==='info')options.onInfo(data.info);else if(data.type==='decoded'){cleanup();resolve(data);}else if(data.type==='error'){cleanup();reject(new Error(data.message));}};
  worker.postMessage({blob,mode:options.mode,device:options.device,preview:options.preview,platform:options.platform});
 });
 const platform=options.platform??currentMediaPlatform();
 let size=await photoHeader(blob),info=size?photoInfo(...size,blob.size,false,options.mode,options.device,platform):undefined;
 if(info)options.onInfo(info);
 const target=info?(options.preview&&info.large?fitPhoto(...size!,2_560_000,1600):[info.exportWidth,info.exportHeight]):undefined;
 const resizing=info&&target&&(target[0]*target[1]<info.sourceWidth*info.sourceHeight);
 // One axis preserves aspect even when HEIF container rotation differs from EXIF.
 const bitmapOptions:ImageBitmapOptions={imageOrientation:'from-image',colorSpaceConversion:'default',...(resizing?{resizeWidth:target![0],resizeQuality:'high'}:{})};
 let bitmap:ImageBitmap;
 try{bitmap=await createImageBitmap(blob,bitmapOptions);}
 catch(error){
  if(error instanceof DOMException&&error.name==='AbortError')throw error;
  const heic=/\.hei[cf]$/i.test(blob.name)||['image/heic','image/heif'].includes(blob.type);
  if(!heic)throw classifyMediaFailure(error,platform,'decode');
  try{const {heicTo}=await import('heic-to/next');bitmap=await heicTo({blob,type:'bitmap',options:bitmapOptions});}
  catch(heicError){if(heicError instanceof DOMException&&heicError.name==='AbortError')throw heicError;throw classifyMediaFailure(heicError,platform,'decode');}
 }
 try{
  if(!info||!resizing){size=[bitmap.width,bitmap.height];info=photoInfo(...size,blob.size,false,options.mode,options.device,platform);}
  else if(Math.abs(bitmap.width/bitmap.height-info.sourceHeight/info.sourceWidth)<.01&&Math.abs(bitmap.width/bitmap.height-info.sourceWidth/info.sourceHeight)>.01){
   info=photoInfo(info.sourceHeight,info.sourceWidth,blob.size,false,options.mode,options.device,platform);
  }
  const desired=options.preview&&info.large?fitPhoto(info.sourceWidth,info.sourceHeight,2_560_000,1600):[info.exportWidth,info.exportHeight];
  const finalSize=fitPhoto(bitmap.width,bitmap.height,desired[0]*desired[1],Math.max(...desired));
  if(finalSize[0]!==bitmap.width||finalSize[1]!==bitmap.height){const smaller=await createImageBitmap(bitmap,{resizeWidth:finalSize[0],resizeHeight:finalSize[1],resizeQuality:'high'});bitmap.close();bitmap=smaller;}
  if(!options.preview||!info.large){info.exportWidth=bitmap.width;info.exportHeight=bitmap.height;}
  options.onInfo(info);
 }catch(error){bitmap.close();throw error;}
 return {bitmap,info};
}
