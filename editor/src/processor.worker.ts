/// <reference lib="webworker" />
import { analyse, renderPixels } from './core/engine';
import type { Recipe,CustomModel } from './core/types';
import { transferField } from './core/neural-field';
import type { ModelName } from './models';

const ctx=self as unknown as DedicatedWorkerGlobalScope;
let source:ImageBitmap|null=null, pixels:ImageData|null=null, generation=0;
let fields=new Map<ModelName,Promise<Float32Array>>();
let customModel:CustomModel|undefined;
async function neural(recipe:Recipe,gen:number,request:number):Promise<Float32Array|undefined> {
  if(recipe.engine!=='shallow'&&recipe.engine!=='funie'&&recipe.engine!=='wave')return;
  const name=recipe.engine,cache=fields,bitmap=source!;
  if(name==='wave'&&(!customModel||(recipe.customModel&&(recipe.customModel.sha256!==customModel.sha256||recipe.customModel.inputRange!==customModel.inputRange||recipe.customModel.outputRange!==customModel.outputRange))))throw new Error('Load the matching custom ONNX file and range settings for this recipe.');
  if(!cache.has(name)) {
    send({type:'model-status',gen,request,message:`Loading and running ${name==='shallow'?'Shallow-UWnet':name==='wave'?'custom ONNX model':'FUnIE-GAN'}…`});
    const snapshot=new OffscreenCanvas(256,256),c=snapshot.getContext('2d')!;
    c.imageSmoothingQuality='high';c.drawImage(bitmap,0,0,256,256);
    const promise=import('./models').then(m=>m.inferField(name,snapshot));
    cache.set(name,promise);promise.catch(()=>cache.delete(name));
  }
  return cache.get(name)!;
}
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
    if(type==='custom-model') {
      if(data.permission!==true)throw new Error('Confirm permission to use your model.');
      if(!(data.blob instanceof Blob)||data.blob.size>64*1024*1024)throw new Error('Choose a self-contained ONNX model under 64 MB.');
      if(!['unit','signed'].includes(data.inputRange)||!['unit','signed'].includes(data.outputRange))throw new Error('Select valid model colour ranges.');
      const bytes=await data.blob.arrayBuffer();
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      const config:CustomModel={sha256,name:String(data.blob.name??'custom.onnx').slice(0,255),inputRange:data.inputRange,outputRange:data.outputRange};
      const {registerCustomModel}=await import('./models');
      await registerCustomModel(bytes,config);customModel=config;fields.delete('wave');
      send({type:'custom-ready',gen,config});
    } else if(type==='load') {
      generation=gen;
      const bitmap=await decode(data.blob);
      if(gen!==generation){bitmap.close();return;}
      if(bitmap.width*bitmap.height>45_000_000){bitmap.close();throw new Error('This prototype supports photos up to 45 megapixels. Please choose a smaller copy.');}
      source?.close();source=bitmap;fields=new Map();
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
      const canvas=new OffscreenCanvas(Math.round(bitmap.width*scale),Math.round(bitmap.height*scale));
      const c=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
      c.drawImage(bitmap,0,0,canvas.width,canvas.height);
      pixels=c.getImageData(0,0,canvas.width,canvas.height);
      const original=canvas.transferToImageBitmap();
      send({type:'loaded',gen,width:bitmap.width,height:bitmap.height,analysis:analyse(pixels.data,pixels.width,pixels.height),original},[original]);
    } else if(type==='render' && gen===generation && pixels) {
      const recipe=data.recipe as Recipe;
      const input=pixels,field=await neural(recipe,gen,request);
      if(gen!==generation)return;
      const base=field?transferField(input.data,input.width,input.height,field):undefined;
      const canvas=new OffscreenCanvas(input.width,input.height);
      canvas.getContext('2d')!.putImageData(new ImageData(renderPixels(input.data,recipe,base),input.width,input.height),0,0);
      const bitmap=canvas.transferToImageBitmap();
      send({type:'rendered',gen,request,bitmap},[bitmap]);
    } else if(type==='export' && gen===generation && source) {
      const bitmap=source;
      const field=await neural(data.recipe,gen,request);
      if(gen!==generation)return;
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
        const base=field?transferField(input.data,bitmap.width,height,field,256,y,bitmap.height):undefined;
        out.putImageData(new ImageData(renderPixels(input.data,data.recipe,base),bitmap.width,height),0,y);
        send({type:'progress',gen,request,progress:Math.round((y+height)/bitmap.height*95)});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const blob=await canvas.convertToBlob({type:data.format==='png'?'image/png':'image/jpeg',quality:.95});
      if(gen!==generation)throw new Error('Export cancelled.');
      send({type:'exported',gen,request,blob});
      canvas.width=1;canvas.height=1;
    } else if(type==='cancel') {generation=gen;}
  } catch(error) {
    send({type:'error',gen,request,operation:type,message:error instanceof Error?error.message:type==='custom-model'?'Could not load this ONNX file. Use a compatible self-contained image model.':'The photo could not be processed.'});
  }
};
