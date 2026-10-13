/// <reference lib="webworker" />
import {LibRaw} from '@colorhythm/libraw-wasm';
import wasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url';
import {fitPhoto,photoInfo,validatePhotoSize} from './core/photo-size';
self.onmessage=async({data})=>{
 let decoder:LibRaw|undefined;
 try{
  const response=await fetch(wasmUrl);if(!response.ok)throw new Error('RAW decoder unavailable. Connect once to download it, then retry.');
  await LibRaw.initialize(await response.arrayBuffer());decoder=new LibRaw();await decoder.waitUntilReady();decoder.open(await data.blob.arrayBuffer());
  const swap=[5,6,7].includes(decoder.getFlip()),w=decoder.getActiveWidth(),h=decoder.getActiveHeight();
  validatePhotoSize(decoder.getRawWidth(),decoder.getRawHeight());
  const info=photoInfo(swap?h:w,swap?w:h,data.blob.size,true,data.mode,data.device);
  self.postMessage({type:'info',info});
  let [width,height]=[info.exportWidth,info.exportHeight];
  if(data.preview&&info.large)[width,height]=fitPhoto(info.sourceWidth,info.sourceHeight,2_560_000,1600);
  decoder.setHalfSize(width*height<w*h?1:0);decoder.setUseCameraWb(1);decoder.setOutputColor(1);decoder.setOutputBps(8);decoder.setDemosaic(3);
  decoder.unpack();decoder.dcrawProcess();const image=decoder.dcrawMakeMemImage();
  if(image.type_!=='LIBRAW_IMAGE_BITMAP'||image.bits!==8||image.colors<3||image.data.length<image.width*image.height*image.colors)throw new Error('Unsupported RAW pixel layout.');
  // Convert RGB in strips, avoiding another full-size RGBA working array.
  const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d')!;
  for(let y=0;y<image.height;y+=128){const rows=Math.min(128,image.height-y),rgba=new Uint8ClampedArray(image.width*rows*4);
   for(let i=0;i<image.width*rows;i++){const at=(y*image.width+i)*image.colors;rgba[i*4]=image.data[at];rgba[i*4+1]=image.data[at+1];rgba[i*4+2]=image.data[at+2];rgba[i*4+3]=255;}
   ctx.putImageData(new ImageData(rgba,image.width,rows),0,y);
  }
  const size=fitPhoto(image.width,image.height,width*height,Math.max(width,height));
  const bitmap=await createImageBitmap(canvas,{resizeWidth:size[0],resizeHeight:size[1],resizeQuality:'high'});
  if(!data.preview){info.exportWidth=bitmap.width;info.exportHeight=bitmap.height;}
  decoder.dispose();decoder=undefined;self.postMessage({type:'decoded',bitmap,info},[bitmap]);
 }catch(error){self.postMessage({type:'error',message:'Could not develop this DNG. Its compression or camera variant may be unsupported, or device memory may be insufficient. Try Reduced resolution. '+(error instanceof Error?error.message:'')});}
 finally{decoder?.dispose();}
};
