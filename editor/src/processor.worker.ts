/// <reference lib="webworker" />
import {aiStatusLabel,isAIEngine} from './core/bundled-models';
import { analyse, renderPixels, suggest } from './core/engine';
import {DEFAULT_MANUAL,type Recipe,type AdaptivePhotoFinish,CustomModel,Suggestion} from './core/types';
import { prepareGuidedField, transferField, type GuidedField } from './core/neural-field';
import type { ModelName } from './models';
import {preservePhotoMetadata} from './photo-metadata';
import {decodePhoto} from './photo-decode';
import type {PhotoInfo,PhotoResolution,PhotoDevice} from './core/photo-size';
import {enhancePixels,enhancementRadii,suggestEnhancement} from './core/enhancement';
import {pickNeutralFromPixels} from './core/white-balance';
import {applyPhotoFinish,fitPhotoFinish,isValidPhotoFinishSettings,preparePhotoFinish} from './core/photo-finish';
import {classifyMediaFailure,currentMediaPlatform,isMediaPlatform,PlatformLimitError,type MediaPlatform} from './core/platform-limits';

const ctx=self as unknown as DedicatedWorkerGlobalScope;
let source:ImageBitmap|null=null, pixels:ImageData|null=null, generation=0;
let latestPreviewRequest=0;
let sourceFile:File|null=null,exportSource:ImageBitmap|null=null,sourceInfo:PhotoInfo|null=null;
let decoding:AbortController|null=null;
let mode:PhotoResolution='auto',device:PhotoDevice={mobile:false};
let fields=new Map<ModelName,Promise<GuidedField>>();
let followUpSuggestions=new Map<string,Suggestion>();
let photoFinishKernels=new Map<string,ReturnType<typeof preparePhotoFinish>>();
let customModel:CustomModel|undefined;
let customTask:Promise<unknown>=Promise.resolve();
async function neural(recipe:Recipe,gen:number,request:number):Promise<GuidedField|undefined> {
  if(!isAIEngine(recipe.engine))return;
  if(recipe.engine==='wave')await customTask;
  const name=recipe.engine,cache=fields,bitmap=source!;
  if(name==='wave'&&(!customModel||(recipe.customModel&&(recipe.customModel.sha256!==customModel.sha256||recipe.customModel.inputRange!==customModel.inputRange||recipe.customModel.outputRange!==customModel.outputRange))))throw new Error('Load the matching custom ONNX file and range settings for this recipe.');
  if(!cache.has(name)) {
    send({type:'model-status',gen,request,message:`Loading and running ${aiStatusLabel(name)}…`});
    const snapshot=new OffscreenCanvas(256,256),c=snapshot.getContext('2d')!;
    c.imageSmoothingQuality='high';c.drawImage(bitmap,0,0,256,256);
    const guide=new Uint8ClampedArray(256*256*4);
    const promise=import('./models').then(async m=>{
      const field=await m.inferField(name,snapshot,guide);
      return prepareGuidedField(guide,field);
    });
    cache.set(name,promise);promise.catch(()=>cache.delete(name));
  }
  return cache.get(name)!;
}
/** Fit the optional Balanced follow-up once from the same 256px AI-corrected photo reference. */
function balancedFollowUp(recipe:Recipe,guided:GuidedField|undefined):Suggestion|undefined {
  if(!guided||!recipe.balancedAfterAI||!source)return;
  const key=JSON.stringify([recipe.engine,recipe.customModel?.sha256,recipe.customModel?.inputRange,recipe.customModel?.outputRange,recipe.strength,recipe.hints]);
  const cached=followUpSuggestions.get(key);if(cached)return cached;
  const canvas=new OffscreenCanvas(256,256),c=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
  c.drawImage(source,0,0,256,256);
  const sample=c.getImageData(0,0,256,256).data;
  const corrected=transferField(sample,256,256,guided);
  const beforeManual=renderPixels(sample,{...recipe,balancedAfterAI:undefined,manual:structuredClone(DEFAULT_MANUAL)},corrected);
  const result=suggest(analyse(beforeManual,256,256),recipe.hints,'balanced');
  if(followUpSuggestions.size>=16)followUpSuggestions.delete(followUpSuggestions.keys().next().value!);
  followUpSuggestions.set(key,result);return result;
}
function photoFinishKernel(settings:AdaptivePhotoFinish) {
  const key=JSON.stringify([settings.look,settings.fit]);
  const cached=photoFinishKernels.get(key);if(cached)return cached;
  const prepared=preparePhotoFinish(settings);
  if(photoFinishKernels.size>=4)photoFinishKernels.delete(photoFinishKernels.keys().next().value!);
  photoFinishKernels.set(key,prepared);return prepared;
}
function hasPhotoFinishEffect(settings:AdaptivePhotoFinish) {
  const fit=settings.fit;
  return fit.active&&settings.amount>0&&(
    fit.colourGains.some(gain=>gain!==1)||fit.toneScale!==1||fit.toneOffset!==0||(fit.chromaGain??1)!==1
  );
}
function currentPhotoFinish(recipe:Recipe):AdaptivePhotoFinish|undefined {
  const settings=recipe.adaptiveFinish;
  return settings&&isValidPhotoFinishSettings(settings)&&hasPhotoFinishEffect(settings)?settings:undefined;
}
function finishPixels(input:Uint8ClampedArray,width:number,height:number,settings:AdaptivePhotoFinish|undefined) {
  return settings?applyPhotoFinish(input,width,height,settings,photoFinishKernel(settings)):input;
}
function withoutAutoContrast(settings:Recipe['enhancement'],finish:AdaptivePhotoFinish|undefined) {
  return finish&&settings?.autoApplied===true?{...settings,contrast:0}:settings;
}
const send=(message:unknown,transfer:Transferable[]=[])=>ctx.postMessage(message,transfer);
ctx.onmessage=async({data})=>{
  const {type,gen,request}=data;
  const platform:MediaPlatform=isMediaPlatform(data.platform)?data.platform:currentMediaPlatform();
  if(type==='render'||type==='enhance'||type==='finish')latestPreviewRequest=request;
  try {
    if(type==='custom-model') {
      customTask=customTask.catch(()=>{}).then(async()=>{const {loadCustomModel}=await import('./models');customModel=await loadCustomModel(data);fields.delete('wave');return customModel;});
      const config=await customTask;if(!data.silent)send({type:'custom-ready',gen,config,restore:data.restore===true});
    } else if(type==='load') {
      generation=gen;latestPreviewRequest=0;decoding?.abort();decoding=new AbortController();
      source?.close();source=null;exportSource?.close();exportSource=null;pixels=null;sourceFile=null;sourceInfo=null;fields=new Map();followUpSuggestions.clear();
      photoFinishKernels.clear();
      mode=data.photoResolution??'auto';device=data.photoDevice??{mobile:false};
      const decoded=await decodePhoto(data.blob,{mode,device,preview:true,platform,signal:decoding.signal,onInfo:info=>send({type:'photo-info',gen,info})});
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
      const recipe=data.recipe as Recipe,guided=await neural(recipe,gen,request);
      if(gen!==generation)return;
      const followUp=balancedFollowUp(recipe,guided);
      const centerX=Math.max(0,Math.min(pixels.width-1,Math.round(data.x))),centerY=Math.max(0,Math.min(pixels.height-1,Math.round(data.y)));
      const left=Math.max(0,centerX-1),top=Math.max(0,centerY-1),right=Math.min(pixels.width,centerX+2),bottom=Math.min(pixels.height,centerY+2);
      const patch=new Uint8ClampedArray((right-left)*(bottom-top)*4),patchBase=guided?new Uint8ClampedArray(patch.length):undefined;
      for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
        const from=(y*pixels.width+x)*4,to=((y-top)*(right-left)+x-left)*4;
        patch.set(pixels.data.subarray(from,from+4),to);
      }
      if(guided){const sampledBase=transferField(patch,right-left,bottom-top,guided,top,pixels.height,left,pixels.width);patchBase?.set(sampledBase);}
      const picked=pickNeutralFromPixels(patch,recipe,patchBase,followUp);
      send({type:'neutral-picked',gen,request,neutral:picked?.manual.neutral??null});
    } else if(type==='enhance' && gen===generation && pixels) {
      const input=pixels,recipe=data.recipe as Recipe,guided=await neural(recipe,gen,request);
      if(gen!==generation||request!==latestPreviewRequest)return;
      const base=guided?transferField(input.data,input.width,input.height,guided):undefined;
      send({type:'enhancement-ready',gen,request,enhancement:suggestEnhancement(renderPixels(input.data,recipe,base,balancedFollowUp(recipe,guided)))});
    } else if(type==='finish' && gen===generation && pixels) {
      const recipe=data.recipe as Recipe,look=data.look;
      if(look!=='natural'&&look!=='vivid')throw new Error('Choose a valid photo finish.');
      const guided=await neural(recipe,gen,request);
      if(gen!==generation||request!==latestPreviewRequest)return;
      const followUp=balancedFollowUp(recipe,guided);
      const referenceCanvas=new OffscreenCanvas(256,256),referenceContext=referenceCanvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
      referenceContext.imageSmoothingEnabled=true;referenceContext.imageSmoothingQuality='high';referenceContext.drawImage(source!,0,0,256,256);
      const reference=referenceContext.getImageData(0,0,256,256).data;
      const base=guided?transferField(reference,256,256,guided):undefined;
      const corrected=renderPixels(reference,recipe,base,followUp);
      const preserveRedCorrection=recipe.hints.filter==='yes'||recipe.auto.mode==='filter'||followUp?.mode==='filter';
      const fit=fitPhotoFinish(corrected,256,256,look,{scene:recipe.hints.scene,filter:recipe.hints.filter,preserveRedCorrection});
      if(gen!==generation||request!==latestPreviewRequest)return;
      const settings:AdaptivePhotoFinish={look,amount:100,fit};
      const kernel=preparePhotoFinish(settings);
      if(gen!==generation||request!==latestPreviewRequest)return;
      const key=JSON.stringify([settings.look,settings.fit]);
      if(photoFinishKernels.size>=4&&!photoFinishKernels.has(key))photoFinishKernels.delete(photoFinishKernels.keys().next().value!);
      photoFinishKernels.set(key,kernel);
      send({type:'finish-ready',gen,request,look,fit});
    } else if(type==='render' && gen===generation && pixels) {
      const recipe=data.recipe as Recipe;
      const input=pixels,guided=await neural(recipe,gen,request);
      if(gen!==generation||request!==latestPreviewRequest)return;
      const base=guided?transferField(input.data,input.width,input.height,guided):undefined;
      const followUp=balancedFollowUp(recipe,guided);
      const canvas=new OffscreenCanvas(input.width,input.height);
      const corrected=renderPixels(input.data,recipe,base,followUp),finish=currentPhotoFinish(recipe),finishedBase=finishPixels(corrected,input.width,input.height,finish),settings=withoutAutoContrast(recipe.enhancement,finish);
      const enabled=settings&&(settings.contrast||settings.clarity||settings.sharpness);
      const points=enabled&&settings.black===0&&settings.white===1?suggestEnhancement(corrected):settings;
      const resolved=settings&&points?{...settings,black:points.black,white:points.white}:settings;
      const finished=enhancePixels(finishedBase,input.width,input.height,resolved,sourceInfo?.exportWidth,sourceInfo?.exportHeight);
      canvas.getContext('2d')!.putImageData(new ImageData(finished,input.width,input.height),0,0);
      const bitmap=canvas.transferToImageBitmap();
      send({type:'rendered',gen,request,bitmap},[bitmap]);
    } else if(type==='export' && gen===generation && source) {
      const originalFile=sourceFile;
      const recipe=data.recipe as Recipe,guided=await neural(recipe,gen,request);
      if(gen!==generation)return;
      const followUp=balancedFollowUp(recipe,guided);
      if(sourceInfo?.large&&!exportSource&&originalFile){
        send({type:'progress',gen,request,progress:1});decoding=new AbortController();
        const decoded=await decodePhoto(originalFile,{mode,device,preview:false,platform,signal:decoding.signal,onInfo:info=>send({type:'photo-info',gen,info})});
        if(gen!==generation){decoded.bitmap.close();return;}exportSource=decoded.bitmap;sourceInfo=decoded.info;send({type:'photo-info',gen,info:sourceInfo});
      }
      const bitmap=exportSource??source;
      const finish=currentPhotoFinish(recipe),autoContrastDisabled=finish!==undefined&&recipe.enhancement?.autoApplied===true;
      const settings=withoutAutoContrast(recipe.enhancement,finish),finishKernel=finish?photoFinishKernel(finish):undefined;
      let resolved=settings;
      if(!autoContrastDisabled&&settings&&(settings.contrast||settings.clarity||settings.sharpness)&&settings.black===0&&settings.white===1){
        const preview=pixels!,previewBase=guided?transferField(preview.data,preview.width,preview.height,guided):undefined;
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
        const base=guided?transferField(input.data,bitmap.width,rows,guided,top,bitmap.height):undefined;
        const corrected=renderPixels(input.data,recipe,base,followUp);
        const finishedBase=finish?applyPhotoFinish(corrected,bitmap.width,rows,finish,finishKernel):corrected;
        const finished=enhancePixels(finishedBase,bitmap.width,rows,resolved,bitmap.width,bitmap.height);
        out.putImageData(new ImageData(finished,bitmap.width,rows),0,top,0,y-top,bitmap.width,height);
        send({type:'progress',gen,request,progress:Math.round((y+height)/bitmap.height*95)});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const blobOptions:{type:string;quality?:number}={type:data.format==='png'?'image/png':'image/jpeg'};
      if(data.format!=='png')blobOptions.quality=data.jpegQuality===0.99?0.99:0.95;
      const rendered=await canvas.convertToBlob(blobOptions);
      const result=data.keepMetadata!==false&&originalFile?await preservePhotoMetadata(originalFile,rendered,bitmap.width,bitmap.height):{blob:rendered};
      if(gen!==generation)throw new Error('Export cancelled.');
      send({type:'exported',gen,request,blob:result.blob,metadataWarning:result.warning});
      }finally{canvas.width=1;canvas.height=1;strip.width=1;exportSource?.close();exportSource=null;}
    } else if(type==='cancel') {generation=gen;decoding?.abort();}
    else if(type==='unload'){generation=gen;decoding?.abort();source?.close();source=null;exportSource?.close();exportSource=null;sourceInfo=null;sourceFile=null;pixels=null;fields=new Map();followUpSuggestions.clear();photoFinishKernels.clear();}
  } catch(error) {
    if((type==='render'||type==='enhance')&&request!==latestPreviewRequest)return;
    if(type==='finish'&&(gen!==generation||request!==latestPreviewRequest))return;
    if(type==='custom-model'&&data.silent)return;
    const fallback=type==='custom-model'?'Could not load this ONNX file. Use a compatible self-contained image model.':'The photo could not be processed.';
    if(type==='custom-model')console.error(error);
    const classified=type==='custom-model'?error instanceof Error?error:new Error(fallback):classifyMediaFailure(error instanceof Error?error:new Error(fallback),platform,type==='export'?'export':'load');
    const limit=classified instanceof PlatformLimitError?classified:undefined;
    send({type:'error',gen,request,operation:type,message:classified instanceof Error?classified.message:fallback,restore:data.restore===true,retryable:limit?false:undefined,...(limit?{code:limit.code,actual:limit.actual,limit:limit.limit,platform:limit.platform}:{})});
  }
};
