import {PHOTO_MAX_BYTES} from './photo-size';
export const MAX_VIDEO_BYTES=512*1024*1024;
export const MAX_VIDEO_SECONDS=600;
export const MAX_VIDEO_OUTPUT_BYTES=256*1024*1024;
// Reserve space for audio, muxing overhead and encoder bitrate variation.
export const videoBitrate=(duration:number)=>Math.min(8_000_000,Math.max(500_000,Math.floor(MAX_VIDEO_OUTPUT_BYTES*.8*8/Math.max(1,duration)-256_000)));
export function isVideo(file:{name:string;type?:string}){return /\.(mp4|mov)$/i.test(file.name)||['video/mp4','video/quicktime'].includes(file.type??'');}
export function isRaw(file:{name?:string;type?:string}){return /\.dng$/i.test(file.name??'')||['image/dng','image/x-adobe-dng'].includes(file.type??'');}
export function supportedMedia(file:{name:string;type?:string}){return isVideo(file)||isRaw(file)||/\.(jpe?g|png|heic|heif)$/i.test(file.name)||['image/jpeg','image/png','image/heic','image/heif'].includes(file.type??'');}
export function mediaLimit(file:{name:string;type?:string}){return isVideo(file)?MAX_VIDEO_BYTES:PHOTO_MAX_BYTES;}
export function videoSize(width:number,height:number,maxLong=1920,maxShort=1080):[number,number]{
 const scale=Math.min(1,maxLong/Math.max(width,height),maxShort/Math.min(width,height));
 return [Math.max(2,Math.floor(width*scale/2)*2),Math.max(2,Math.floor(height*scale/2)*2)];
}
export function videoTime(seconds:number){const whole=Math.max(0,Math.floor(seconds));return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}`;}
export interface VideoInfo {duration:number;codec:string;hasAudio:boolean;outputWidth:number;outputHeight:number;frameRate:number;hdrToneMapped?:boolean}
