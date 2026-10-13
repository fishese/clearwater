export type PhotoResolution='auto'|'full'|'reduced';
export interface PhotoDevice {memory?:number;mobile:boolean}
export interface PhotoInfo {sourceWidth:number;sourceHeight:number;exportWidth:number;exportHeight:number;large:boolean;raw:boolean;mode:PhotoResolution}
export const PHOTO_RECOMMENDED_PIXELS=45_000_000,PHOTO_RECOMMENDED_BYTES=60*1024*1024;
export const PHOTO_MAX_PIXELS=200_000_000,PHOTO_MAX_DIMENSION=32768,PHOTO_MAX_BYTES=512*1024*1024;
export function validatePhotoSize(width:number,height:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>PHOTO_MAX_DIMENSION||height>PHOTO_MAX_DIMENSION||width*height>PHOTO_MAX_PIXELS)throw new Error('Photo exceeds the safety ceiling: 200 MP or 32,768 pixels on either side.');
}
export function fitPhoto(width:number,height:number,maxPixels:number,maxLong=PHOTO_MAX_DIMENSION):[number,number]{
 const scale=Math.min(1,Math.sqrt(maxPixels/(width*height)),maxLong/Math.max(width,height));
 return [Math.max(1,Math.floor(width*scale)),Math.max(1,Math.floor(height*scale))];
}
export function photoInfo(width:number,height:number,bytes:number,raw:boolean,mode:PhotoResolution,device:PhotoDevice):PhotoInfo {
 validatePhotoSize(width,height);
 const large=width*height>PHOTO_RECOMMENDED_PIXELS||bytes>PHOTO_RECOMMENDED_BYTES;
 const budget=mode==='full'?PHOTO_MAX_PIXELS:mode==='reduced'?12_000_000:!large?PHOTO_RECOMMENDED_PIXELS:
  device.mobile||(device.memory!==undefined&&device.memory<=4)?24_000_000:(device.memory??0)>=8?80_000_000:45_000_000;
 // LibRaw's memory-saving development halves each axis; never upscale it afterwards.
 const half=raw&&width*height>budget;
 const [exportWidth,exportHeight]=fitPhoto(half?Math.ceil(width/2):width,half?Math.ceil(height/2):height,budget);
 return {sourceWidth:width,sourceHeight:height,exportWidth,exportHeight,large,raw,mode};
}
