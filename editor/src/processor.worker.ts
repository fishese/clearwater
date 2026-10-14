/// <reference lib="webworker" />
import { analyse, renderPixels, suggest } from './core/engine';
import {DEFAULT_MANUAL,type Recipe,CustomModel,Suggestion} from './core/types';
import { transferField } from './core/neural-field';
import type { ModelName } from './models';
import {preservePhotoMetadata} from './photo-metadata';
import {decodePhoto} from './photo-decode';
import type {PhotoInfo,PhotoResolution,PhotoDevice} from './core/photo-size';
import {enhancePixels,enhancementRadii,suggestEnhancement} from './core/enhancement';
import {pickNeutralFromPixels} from './core/white-balance';

const ctx=self as unknown as DedicatedWorkerGlobalScope;
let source:ImageBitmap|null=null, pixels:ImageData|null=null, generation=0;
let latestPreviewRequest=0;
let sourceFile:File|null=null,exportSource:ImageBitmap|null=null,sourceInfo:PhotoInfo|null=null;
let decoding:AbortController|null=null;
let mode:PhotoResolution='auto',device:PhotoDevice={mobile:false};
let fields=new Map<ModelName,Promise<Float32Array>>();
let followUpSuggestions=new Map<string,Suggestion>();
let customModel:CustomModel|undefined;
let customTask:Promise<unknown>=Promise.resolve();
async function neural(recipe:Recipe,gen:number,request:number):Promise<Float32Array|undefined> {
  if(recipe.engine!=='shallow'&&recipe.engine!=='funie'&&recipe.engine!=='wwe'&&recipe.engine!=='wave')return;
  if(recipe.engine==='wave')await customTask;
  const name=recipe.engine,cache=fields,bitmap=source!;
  if(name==='wave'&&(!customModel||(recipe.customModel&&(recipe.customModel.sha256!==customModel.sha256||recipe.customModel.inputRange!==customModel.inputRange||recipe.customModel.outputRange!==customModel.outputRange))))throw new Error('Load the matching custom ONNX file and range settings for this recipe.');
  if(!cache.has(name)) {
    send({type:'model-status',gen,request,message:`Loading and running ${{shallow:'Shallow-UWnet',funie:'FUnIE-GAN',wwe:'WWE-UIE',wave:'custom ONNX model'}[name]}…`});
    const snapshot=new OffscreenCanvas(256,256),c=snapshot.getContext('2d')!;
    c.imageSmoothingQuality='high';c.drawImage(bitmap,0,0,256,256);
    const promise=import('./models').then(m=>m.inferField(name,snapshot));
    cache.set(name,promise);promise.catch(()=>cache.delete(name));
  }
  return cache.get(name)!;
}
/** Fit the optional Balanced follow-up once from the same 256px AI-corrected photo reference. */
function balancedFollowUp(recipe:Recipe,field:Float32Array|undefined):Suggestion|undefined {
  if(!field||!recipe.balancedAfterAI||!source)return;
  const key=JSON.stringify([recipe.engine,recipe.customModel?.sha256,recipe.customModel?.inputRange,recipe.customModel?.outputRange,recipe.strength,recipe.hints]);
  const cached=followUpSuggestions.get(key);if(cached)return cached;
  const canvas=new OffscreenCanvas(256,256),c=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
  c.drawImage(source,0,0,256,256);
  const sample=c.getImageData(0,0,256,256).data;
  const corrected=transferField(sample,256,256,field);
  const beforeManual=renderPixels(sample,{...recipe,balancedAfterAI:undefined,manual:structuredClone(DEFAULT_MANUAL)},corrected);
  const result=suggest(analyse(beforeManual,256,256),recipe.hints,'balanced');
  if(followUpSuggestions.size>=16)followUpSuggestions.delete(followUpSuggestions.keys().next().value!);
  followUpSuggestions.set(key,result);return result;
}
const send=(message:unknown,transfer:Transferable[]=[])=>ctx.postMessage(message,transfer);
ctx.onmessage=async({data})=>{
  const {type,gen,request}=data;
  if(type==='render'||type==='enhance')latestPreviewRequest=request;
  try {
    if(type==='custom-model') {
      customTask=customTask.catch(()=>{}).then(async()=>{const {loadCustomModel}=await import('./models');customModel=await loadCustomModel(data);fields.delete('wave');return customModel;});
      const config=await customTask;if(!data.silent)send({type:'custom-ready',gen,config,restore:data.restore===true});
    } else if(type==='load') {
      generation=gen;decoding?.abort();decoding=new AbortController();
      source?.close();source=null;exportSource?.close();exportSource=null;pixels=null;sourceFile=null;sourceInfo=null;fields=new Map();followUpSuggestions.clear();
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
    } else if(type==='sample-neutral' && gen===generation && pixels) {
      const recipe=data.recipe as Recipe,field=await neural(recipe,gen,request);
      if(gen!==generation)return;
      const followUp=balancedFollowUp(recipe,field);
      const centerX=Math.max(0,Math.min(pixels.width-1,Math.round(data.x))),centerY=Math.max(0,Math.min(pixels.height-1,Math.round(data.y)));
      const left=Math.max(0,centerX-1),top=Math.max(0,centerY-1),right=Math.min(pixels.width,centerX+2),bottom=Math.min(pixels.height,centerY+2);
      const patch=new Uint8ClampedArray((right-left)*(bottom-top)*4),patchBase=field?new Uint8ClampedArray(patch.length):undefined;
      for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
        const from=(y*pixels.width+x)*4,to=((y-top)*(right-left)+x-left)*4;
        patch.set(pixels.data.subarray(from,from+4),to);
      }
      if(field){const sampledBase=transferField(patch,right-left,bottom-top,field,256,top,pixels.height,left,pixels.width);patchBase?.set(sampledBase);}
      const picked=pickNeutralFromPixels(patch,recipe,patchBase,followUp);
      send({type:'neutral-picked',gen,request,neutral:picked?.manual.neutral??null});
    } else if(type==='enhance' && gen===generation && pixels) {
      const input=pixels,recipe=data.recipe as Recipe,field=await neural(recipe,gen,request);
      if(gen!==generation||request!==latestPreviewRequest)return;
      const base=field?transferField(input.data,input.width,input.height,field):undefined;
      send({type:'enhancement-ready',gen,request,enhancement:suggestEnhancement(renderPixels(input.data,recipe,base,balancedFollowUp(recipe,field)))});
    } else if(type==='render' && gen===generation && pixels) {
      const recipe=data.recipe as Recipe;
      const input=pixels,field=await neural(recipe,gen,request);
      if(gen!==generation||request!==latestPreviewRequest)return;
      const base=field?transferField(input.data,input.width,input.height,field):undefined;
      const followUp=balancedFollowUp(recipe,field);
      const canvas=new OffscreenCanvas(input.width,input.height);
      const corrected=renderPixels(input.data,recipe,base,followUp),settings=recipe.enhancement;
      const enabled=settings&&(settings.contrast||settings.clarity||settings.sharpness);
      const points=enabled&&settings.black===0&&settings.white===1?suggestEnhancement(corrected):settings;
      const resolved=settings&&points?{...settings,black:points.black,white:points.white}:settings;
      const finished=enhancePixels(corrected,input.width,input.height,resolved,sourceInfo?.exportWidth,sourceInfo?.exportHeight);
      canvas.getContext('2d')!.putImageData(new ImageData(finished,input.width,input.height),0,0);
      const bitmap=canvas.transferToImageBitmap();
      send({type:'rendered',gen,request,bitmap},[bitmap]);
    } else if(type==='export' && gen===generation && source) {
      const originalFile=sourceFile;
      const recipe=data.recipe as Recipe,field=await neural(recipe,gen,request);
      if(gen!==generation)return;
      const followUp=balancedFollowUp(recipe,field);
      if(sourceInfo?.large&&!exportSource&&originalFile){
        send({type:'progress',gen,request,progress:1});decoding=new AbortController();
        const decoded=await decodePhoto(originalFile,{mode,device,preview:false,signal:decoding.signal,onInfo:info=>send({type:'photo-info',gen,info})});
        if(gen!==generation){decoded.bitmap.close();return;}exportSource=decoded.bitmap;sourceInfo=decoded.info;send({type:'photo-info',gen,info:sourceInfo});
      }
      const bitmap=exportSource??source;
      const settings=(data.recipe as Recipe).enhancement;
      let resolved=settings;
      if(settings&&(settings.contrast||settings.clarity||settings.sharpness)&&settings.black===0&&settings.white===1){
        const preview=pixels!,previewBase=field?transferField(preview.data,preview.width,preview.height,field):undefined;
        const {black,white}=suggestEnhancement(renderPixels(preview.data,recipe,previewBase,followUp));resolved={...settings,black,white};
      }
      const radii=enhancementRadii(bitmap.width,bitmap.height),halo=Math.max(settings?.clarity?radii.clarity:0,settings?.sharpness?radii.sharpness:0);
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
      const out=canvas.getContext('2d')!;
      const strip=new OffscreenCanvas(bitmap.width,Math.min(256+2*halo,bitmap.height));
      const c=strip.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
      try{for(let y=0;y<bitmap.height;y+=256) {
        if(gen!==generation)throw new Error('Export cancelled.');
        const height=Math.min(256,bitmap.height-y);
        const top=Math.max(0,y-halo),bottom=Math.min(bitmap.height,y+height+halo),rows=bottom-top;
        c.clearRect(0,0,strip.width,strip.height);
        c.drawImage(bitmap,0,top,bitmap.width,rows,0,0,bitmap.width,rows);
        const input=c.getImageData(0,0,bitmap.width,rows);
        const base=field?transferField(input.data,bitmap.width,rows,field,256,top,bitmap.height):undefined;
        const finished=enhancePixels(renderPixels(input.data,recipe,base,followUp),bitmap.width,rows,resolved,bitmap.width,bitmap.height);
        out.putImageData(new ImageData(finished,bitmap.width,rows),0,top,0,y-top,bitmap.width,height);
        send({type:'progress',gen,request,progress:Math.round((y+height)/bitmap.height*95)});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const rendered=await canvas.convertToBlob({type:data.format==='png'?'image/png':'image/jpeg',quality:.95});
      const result=data.keepMetadata!==false&&originalFile?await preservePhotoMetadata(originalFile,rendered,bitmap.width,bitmap.height):{blob:rendered};
      if(gen!==generation)throw new Error('Export cancelled.');
      send({type:'exported',gen,request,blob:result.blob,metadataWarning:result.warning});
      }finally{canvas.width=1;canvas.height=1;strip.width=1;exportSource?.close();exportSource=null;}
    } else if(type==='cancel') {generation=gen;decoding?.abort();}
    else if(type==='unload'){generation=gen;decoding?.abort();source?.close();source=null;exportSource?.close();exportSource=null;sourceInfo=null;sourceFile=null;pixels=null;fields=new Map();followUpSuggestions.clear();}
  } catch(error) {
    if((type==='render'||type==='enhance')&&request!==latestPreviewRequest)return;
    if(type==='custom-model'&&data.silent)return;
    send({type:'error',gen,request,operation:type,message:error instanceof Error?error.message:type==='custom-model'?'Could not load this ONNX file. Use a compatible self-contained image model.':'The photo could not be processed.',restore:data.restore===true});
  }
};
