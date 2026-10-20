import {currentMediaPlatform,limitsFor,PlatformLimitError,type MediaPlatform} from './platform-limits';
const desktopLimits=limitsFor('desktop');
export const MAX_VIDEO_BYTES=desktopLimits.videoBytes;
export const MAX_VIDEO_SECONDS=desktopLimits.videoSeconds;
export const MAX_VIDEO_OUTPUT_BYTES=desktopLimits.compactExportBytes;
export const MAX_SOURCE_VIDEO_OUTPUT_BYTES=desktopLimits.sourceExportBytes;
// Reserve space for audio, muxing overhead and encoder bitrate variation.
export const videoBitrate=(duration:number,outputBytes=MAX_VIDEO_OUTPUT_BYTES)=>Math.min(8_000_000,Math.max(500_000,Math.floor(outputBytes*.8*8/Math.max(1,duration)-256_000)));
export function isVideo(file:{name:string;type?:string}){return /\.(mp4|mov)$/i.test(file.name)||['video/mp4','video/quicktime'].includes(file.type??'');}
export function isRaw(file:{name?:string;type?:string}){return /\.dng$/i.test(file.name??'')||['image/dng','image/x-adobe-dng'].includes(file.type??'');}
export function supportedMedia(file:{name:string;type?:string}){return isVideo(file)||isRaw(file)||/\.(jpe?g|png|heic|heif)$/i.test(file.name)||['image/jpeg','image/png','image/heic','image/heif'].includes(file.type??'');}
export function mediaLimit(file:{name:string;type?:string},platform:MediaPlatform=currentMediaPlatform()){const row=limitsFor(platform);return isVideo(file)?row.videoBytes:row.photoBytes;}
export function videoSize(width:number,height:number,maxLong=1920,maxShort=1080):[number,number]{
 const scale=Math.min(1,maxLong/Math.max(width,height),maxShort/Math.min(width,height));
 return [Math.max(2,Math.floor(width*scale/2)*2),Math.max(2,Math.floor(height*scale/2)*2)];
}
export function videoTime(seconds:number){const whole=Math.max(0,Math.floor(seconds));return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}`;}
export type VideoExportMode='compatible'|'source';
export interface VideoExportPlan {mode:VideoExportMode;width:number;height:number;bitrate:number;estimatedBytes:number;maxOutputBytes:number;frameRate?:number;supported:boolean;reason?:string}
export interface VideoMetadataTags {title?:string;description?:string;comment?:string;date?:Date}
const MP4_EPOCH_OFFSET=2_082_844_800;
const MP4_CONTAINER_BOXES=new Set(['moov','trak','mdia']);
const MP4_TIME_BOXES=new Set(['mvhd','tkhd','mdhd']);
function readU32(data:DataView,offset:number){return data.getUint32(offset,false);}
async function boxHeader(blob:Blob,offset:number,end:number){
 if(offset+8>end)return null;
 const bytes=await blob.slice(offset,Math.min(end,offset+16)).arrayBuffer(),view=new DataView(bytes);
 const size32=readU32(view,0),type=String.fromCharCode(view.getUint8(4),view.getUint8(5),view.getUint8(6),view.getUint8(7));
 let size=BigInt(size32),headerSize=8;
 if(size32===1){if(bytes.byteLength<16)return null;size=view.getBigUint64(8,false);headerSize=16;}
 else if(size32===0)size=BigInt(end-offset);
 if(size<BigInt(headerSize)||size>BigInt(end-offset))return null;
 return {type,size:Number(size),headerSize};
}
/** Reads only MP4 box headers and the movie header; large mdat payloads are skipped as Blob ranges. */
export async function readMp4CreationDate(blob:Blob):Promise<Date|undefined>{
 let offset=0,moovStart=-1,moovEnd=0,boxes=0;
 while(offset<blob.size&&boxes++<4096){const header=await boxHeader(blob,offset,blob.size);if(!header)return undefined;if(header.type==='moov'){moovStart=offset+header.headerSize;moovEnd=offset+header.size;break;}offset+=header.size;}
 if(moovStart<0)return undefined;
 offset=moovStart;
 boxes=0;while(offset<moovEnd&&boxes++<4096){const header=await boxHeader(blob,offset,moovEnd);if(!header)return undefined;
  if(header.type==='mvhd'){
   const payloadSize=header.size-header.headerSize;if(payloadSize<4)return undefined;
   const prefix=await blob.slice(offset+header.headerSize,offset+header.headerSize+Math.min(payloadSize,16)).arrayBuffer();
   const view=new DataView(prefix),version=view.getUint8(0);if(version!==0&&version!==1)return undefined;
   if(payloadSize<(version===1?12:8))return undefined;
   const seconds=version===1?Number(view.getBigUint64(4,false)):readU32(view,4);
   if(!Number.isSafeInteger(seconds)||seconds<=0)return undefined;
   const date=new Date((seconds-MP4_EPOCH_OFFSET)*1000);return Number.isFinite(date.getTime())?date:undefined;
  }
  offset+=header.size;
 }
 return undefined;
}
/** Updates the generated MP4 creation headers in place; leaves modification times unchanged. */
export function patchMp4CreationDate(buffer:ArrayBuffer,date:Date):boolean{
 const milliseconds=date instanceof Date?date.getTime():NaN;if(!Number.isFinite(milliseconds))return false;
 const unixSeconds=Math.floor(milliseconds/1000);if(!Number.isFinite(unixSeconds))return false;
 const seconds=BigInt(unixSeconds+MP4_EPOCH_OFFSET);if(seconds<=0n)return false;
 const bytes=new Uint8Array(buffer),view=new DataView(buffer);let patched=0;
 const scan=(start:number,end:number,depth:number)=>{
  if(depth>4)return;
  for(let offset=start;offset+8<=end;){const size32=readU32(view,offset),type=String.fromCharCode(bytes[offset+4],bytes[offset+5],bytes[offset+6],bytes[offset+7]);let size=size32,headerSize=8;
   if(size32===1){if(offset+16>end)break;const large=view.getBigUint64(offset+8,false);if(large>BigInt(Number.MAX_SAFE_INTEGER))break;size=Number(large);headerSize=16;}
   else if(size32===0)size=end-offset;
   if(size<headerSize||offset+size>end)break;
   if(MP4_TIME_BOXES.has(type)){
    const payloadSize=size-headerSize;if(payloadSize<4){offset+=size;continue;}
    const version=view.getUint8(offset+headerSize);
    if(version===0&&payloadSize>=12&&seconds<=0xffff_ffffn){view.setUint32(offset+headerSize+4,Number(seconds),false);patched++;}
    else if(version===1&&payloadSize>=20&&seconds<=0xffff_ffff_ffff_ffffn){view.setBigUint64(offset+headerSize+4,seconds,false);patched++;}
   }else if(MP4_CONTAINER_BOXES.has(type))scan(offset+headerSize,offset+size,depth+1);
   offset+=size;
  }
 };
 scan(0,buffer.byteLength,0);return patched>0;
}
export function videoMetadataTags(tags:VideoMetadataTags,keep:boolean):VideoMetadataTags{
 if(!keep)return {};
 return {...(tags.title?{title:tags.title}:{}),...(tags.description?{description:tags.description}:{}),...(tags.comment?{comment:tags.comment}:{}),...(tags.date?{date:tags.date}:{})};
}
export function videoExportPlan(info:VideoInfo,mode:VideoExportMode='compatible',platform:MediaPlatform=currentMediaPlatform()):VideoExportPlan{
 const source=mode==='source';
 const row=limitsFor(platform);
 const width=source?(info.sourceWidth??info.outputWidth):info.outputWidth;
 const height=source?(info.sourceHeight??info.outputHeight):info.outputHeight;
 const maxOutputBytes=source?row.sourceExportBytes:row.compactExportBytes;
 const frameRate=source?undefined:Math.min(30,Math.max(1,info.frameRate||30));
 // Source mode scales a high-quality 12 Mbps 1080p30 target by pixel count and rate, with a
 // fixed ceiling. It never lowers this target to make a long clip fit the file cap.
 const bitrate=source
  ?Math.min(36_000_000,Math.max(8_000_000,Math.round(12_000_000*(width*height/(1920*1080))*((info.sourceFrameRate??info.frameRate??30)/30))))
  :videoBitrate(info.duration,row.compactExportBytes);
 const audioReserve=info.hasAudio?(source?512_000:256_000)*info.duration:0;
 const estimatedBytes=Math.ceil((bitrate*info.duration+audioReserve)*(source?1.15:1.08)/8);
 const supported=Number.isFinite(estimatedBytes)&&estimatedBytes<=maxOutputBytes;
 const reason=supported?undefined:new PlatformLimitError('too-large',platform,{unit:'bytes',actual:estimatedBytes,limit:maxOutputBytes}).message;
 return {mode,width,height,bitrate,estimatedBytes,maxOutputBytes,...(frameRate===undefined?{}:{frameRate}),supported,...(reason?{reason}:{})};
}
export interface VideoInfo {duration:number;codec:string;hasAudio:boolean;outputWidth:number;outputHeight:number;frameRate:number;sourceWidth?:number;sourceHeight?:number;sourceFrameRate?:number;creationDate?:Date;hdrToneMapped?:boolean}
