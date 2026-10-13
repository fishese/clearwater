/// <reference lib="webworker" />
import { analyse, renderPixels } from './core/engine';
import type { Recipe,CustomModel } from './core/types';
import { transferField } from './core/neural-field';
import type { ModelName } from './models';
import {preservePhotoMetadata} from './photo-metadata';
import {decodePhoto} from './photo-decode';
import type {PhotoInfo,PhotoResolution,PhotoDevice} from './core/photo-size';

const ctx=self as unknown as DedicatedWorkerGlobalScope;
let source:ImageBitmap|null=null, pixels:ImageData|null=null, generation=0;
let sourceFile:File|null=null,exportSource:ImageBitmap|null=null,sourceInfo:PhotoInfo|null=null;
let decoding:AbortController|null=null;
let mode:PhotoResolution='auto',device:PhotoDevice={mobile:false};
let fields=new Map<ModelName,Promise<Float32Array>>();
let customModel:CustomModel|undefined;
let customTask:Promise<unknown>=Promise.resolve();
async function neural(recipe:Recipe,gen:number,request:number):Promise<Float32Array|undefined> {
  if(recipe.engine!=='shallow'&&recipe.engine!=='funie'&&recipe.engine!=='wave')return;
  if(recipe.engine==='wave')await customTask;
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
ctx.onmessage=async({data})=>{
  const {type,gen,request}=data;
  try {
    if(type==='custom-model') {
      customTask=customTask.catch(()=>{}).then(async()=>{const {loadCustomModel}=await import('./models');customModel=await loadCustomModel(data);fields.delete('wave');return customModel;});
      const config=await customTask;if(!data.silent)send({type:'custom-ready',gen,config});
    } else if(type==='load') {
      generation=gen;decoding?.abort();decoding=new AbortController();
      source?.close();source=null;exportSource?.close();exportSource=null;pixels=null;sourceFile=null;sourceInfo=null;fields=new Map();
      mode=data.photoResolution??'auto';device=data.photoDevice??{mobile:false};
      const decoded=await decodePhoto(data.blob,{mode,device,preview:true,signal:decoding.signal,onInfo:info=>send({type:'photo-info',gen,info})});
      const {bitmap}=decoded;
      if(gen!==generation){bitmap.close();return;}
      source=bitmap;sourceFile=data.blob;sourceInfo=decoded.info;
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
      const canvas=new OffscreenCanvas(Math.round(bitmap.width*scale),Math.round(bitmap.height*scale));
      const c=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
      c.drawImage(bitmap,0,0,canvas.width,canvas.height);
      pixels=c.getImageData(0,0,canvas.width,canvas.height);
      const original=canvas.transferToImageBitmap();
      send({type:'loaded',gen,width:sourceInfo.sourceWidth,height:sourceInfo.sourceHeight,analysis:analyse(pixels.data,pixels.width,pixels.height),original,photo:sourceInfo},[original]);
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
      const originalFile=sourceFile;
      const field=await neural(data.recipe,gen,request);
      if(gen!==generation)return;
      if(sourceInfo?.large&&!exportSource&&originalFile){
        send({type:'progress',gen,request,progress:1});decoding=new AbortController();
        const decoded=await decodePhoto(originalFile,{mode,device,preview:false,signal:decoding.signal,onInfo:info=>send({type:'photo-info',gen,info})});
        if(gen!==generation){decoded.bitmap.close();return;}exportSource=decoded.bitmap;sourceInfo=decoded.info;send({type:'photo-info',gen,info:sourceInfo});
      }
      const bitmap=exportSource??source;
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
      const out=canvas.getContext('2d')!;
      const strip=new OffscreenCanvas(bitmap.width,Math.min(256,bitmap.height));
      const c=strip.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
      try{for(let y=0;y<bitmap.height;y+=256) {
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
      const rendered=await canvas.convertToBlob({type:data.format==='png'?'image/png':'image/jpeg',quality:.95});
      const result=data.keepMetadata!==false&&originalFile?await preservePhotoMetadata(originalFile,rendered,bitmap.width,bitmap.height):{blob:rendered};
      if(gen!==generation)throw new Error('Export cancelled.');
      send({type:'exported',gen,request,blob:result.blob,metadataWarning:result.warning});
      }finally{canvas.width=1;canvas.height=1;strip.width=1;exportSource?.close();exportSource=null;}
    } else if(type==='cancel') {generation=gen;decoding?.abort();}
    else if(type==='unload'){generation=gen;decoding?.abort();source?.close();source=null;exportSource?.close();exportSource=null;sourceInfo=null;sourceFile=null;pixels=null;fields=new Map();}
  } catch(error) {
    send({type:'error',gen,request,operation:type,message:error instanceof Error?error.message:type==='custom-model'?'Could not load this ONNX file. Use a compatible self-contained image model.':'The photo could not be processed.'});
  }
};
