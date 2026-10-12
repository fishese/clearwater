/// <reference lib="webworker" />
import { analyse, renderPixels } from './core/engine';
import type { Recipe } from './core/types';

const ctx=self as unknown as DedicatedWorkerGlobalScope;
let source:ImageBitmap|null=null, pixels:ImageData|null=null, generation=0;
const send=(message:unknown,transfer:Transferable[]=[])=>ctx.postMessage(message,transfer);
async function decode(blob:Blob):Promise<ImageBitmap> {
  try {return await createImageBitmap(blob,{imageOrientation:'from-image',colorSpaceConversion:'default'});}
  catch {
    const {heicTo}=await import('heic-to/next');
    return await heicTo({blob,type:'bitmap'});
  }
}
ctx.onmessage=async({data})=>{
  const {type,gen,request}=data;
  try {
    if(type==='load') {
      generation=gen;
      const bitmap=await decode(data.blob);
      if(gen!==generation){bitmap.close();return;}
      if(bitmap.width*bitmap.height>45_000_000){bitmap.close();throw new Error('This prototype supports photos up to 45 megapixels. Please choose a smaller copy.');}
      source?.close();source=bitmap;
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
      const canvas=new OffscreenCanvas(Math.round(bitmap.width*scale),Math.round(bitmap.height*scale));
      const c=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
      c.drawImage(bitmap,0,0,canvas.width,canvas.height);
      pixels=c.getImageData(0,0,canvas.width,canvas.height);
      const original=canvas.transferToImageBitmap();
      send({type:'loaded',gen,width:bitmap.width,height:bitmap.height,analysis:analyse(pixels.data,pixels.width,pixels.height),original},[original]);
    } else if(type==='render' && gen===generation && pixels) {
      const recipe=data.recipe as Recipe;
      const canvas=new OffscreenCanvas(pixels.width,pixels.height);
      canvas.getContext('2d')!.putImageData(new ImageData(renderPixels(pixels.data,recipe),pixels.width,pixels.height),0,0);
      const bitmap=canvas.transferToImageBitmap();
      send({type:'rendered',gen,request,bitmap},[bitmap]);
    } else if(type==='export' && gen===generation && source) {
      const bitmap=source;
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
      const out=canvas.getContext('2d')!;
      const strip=new OffscreenCanvas(bitmap.width,Math.min(256,bitmap.height));
      const c=strip.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
      for(let y=0;y<bitmap.height;y+=256) {
        if(gen!==generation)throw new Error('Export cancelled.');
        const height=Math.min(256,bitmap.height-y);
        c.clearRect(0,0,strip.width,strip.height);
        c.drawImage(bitmap,0,y,bitmap.width,height,0,0,bitmap.width,height);
        const input=c.getImageData(0,0,bitmap.width,height);
        out.putImageData(new ImageData(renderPixels(input.data,data.recipe),bitmap.width,height),0,y);
        send({type:'progress',gen,request,progress:Math.round((y+height)/bitmap.height*95)});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const blob=await canvas.convertToBlob({type:data.format==='png'?'image/png':'image/jpeg',quality:.95});
      if(gen!==generation)throw new Error('Export cancelled.');
      send({type:'exported',gen,request,blob});
      canvas.width=1;canvas.height=1;
    } else if(type==='cancel') {generation=gen;}
  } catch(error) {
    send({type:'error',gen,request,operation:type,message:error instanceof Error?error.message:'The photo could not be processed.'});
  }
};
