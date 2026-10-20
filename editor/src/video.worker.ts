/// <reference lib="webworker" />
import {Input,BlobSource,MP4,QTFF,CanvasSink,Conversion,Output,Mp4OutputFormat,BufferTarget,canEncodeVideo,type InputVideoTrack} from 'mediabunny';
import {isAIEngine} from './core/bundled-models';
import {analyse,renderPixels,parseRecipe} from './core/engine';
import {patchMp4CreationDate,readMp4CreationDate,videoExportPlan,videoMetadataTags,videoSize,type VideoExportMode,type VideoInfo} from './core/media';
import {assertVideoBytes,assertVideoDuration,assertVideoFrame,classifyMediaFailure,currentMediaPlatform,isMediaPlatform,PlatformLimitError,type MediaPlatform} from './core/platform-limits';
import {fitColour,colourHistogram,colourAt,applyColour,sampleTimes,bracket,type ColourNode} from './core/video-colour';
import {hasHdrTransfer,hasDolbyVisionMetadata,isDolbyVisionCodec} from './core/video-hdr';
import {pickNeutralFromPixels} from './core/white-balance';
import type {Recipe,CustomModel} from './core/types';
import type {ModelName} from './models';

const ctx=self as unknown as DedicatedWorkerGlobalScope;
let input:Input|undefined,track:InputVideoTrack|undefined,sink:CanvasSink|undefined;
let generation=0,lastRequest=0,pixels:ImageData|undefined,frameTime=-1,start=0,info:VideoInfo|undefined,conversion:Conversion|undefined;
const send=(data:unknown,transfer:Transferable[]=[])=>ctx.postMessage(data,transfer);
let customModel:CustomModel|undefined,customTask:Promise<unknown>=Promise.resolve(),aiQueue:Promise<unknown>=Promise.resolve();
const nodes=new Map<string,ColourNode>(),pendingNodes=new Map<string,Promise<ColourNode>>();
const isAI=(recipe:Recipe)=>isAIEngine(recipe.engine);
const settings=(recipe:Recipe)=>recipe.videoCorrection??{mode:'sampled' as const,interval:5 as const,referenceTime:0};
function timesFor(recipe:Recipe,duration:number){const config=settings(recipe);return config.mode==='fixed'?[Math.min(config.referenceTime,Math.max(0,duration-.001))]:sampleTimes(duration,config.interval);}
async function getNode(recipe:Recipe,time:number,gen:number,request:number):Promise<ColourNode>{
 const key=JSON.stringify([recipe.engine,recipe.customModel?.sha256,recipe.customModel?.inputRange,recipe.customModel?.outputRange,time]);
 const cached=nodes.get(key);if(cached)return cached;const pendingKey=gen+key,existing=pendingNodes.get(pendingKey);if(existing)return existing;
 const opened=input,video=track,first=start,customReady=customTask;if(!opened||!video)throw new Error('Open a video first.');
 const task=aiQueue.catch(()=>{}).then(async()=>{
  if(gen!==generation)throw new Error('Analysis cancelled.');
  if(recipe.engine==='wave'){await customReady;if(!customModel||(recipe.customModel&&(recipe.customModel.sha256!==customModel.sha256||recipe.customModel.inputRange!==customModel.inputRange||recipe.customModel.outputRange!==customModel.outputRange)))throw new Error('Load the matching custom ONNX model and colour ranges for this recipe.');}
  send({type:'model-status',gen,request,message:'Estimating AI colour from sampled frames…'});
  const reader=new CanvasSink(video,{width:256,height:256,fit:'fill',poolSize:1});
  const wrapped=await decodeFrame(reader.getCanvas(first+time));if(!wrapped)throw new Error('Could not decode an AI sample frame.');
  const image=wrapped.canvas.getContext('2d')!.getImageData(0,0,256,256);
  const {inferField}=await import('./models');const residual=await inferField(recipe.engine as ModelName,wrapped.canvas as OffscreenCanvas);
  if(gen!==generation)throw new Error('Analysis cancelled.');
  const node={time,matrix:fitColour(image.data,residual),histogram:colourHistogram(image.data)};nodes.set(key,node);return node;
 });aiQueue=task;pendingNodes.set(pendingKey,task);
 try{return await task;}finally{pendingNodes.delete(pendingKey);}
}
class VideoTransientError extends Error {}
async function bounded<T>(promise:Promise<T>,milliseconds:number,message:string):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new VideoTransientError(message)),Math.max(1,milliseconds));})]);}finally{clearTimeout(timer);}}
async function decodeFrame<T>(promise:Promise<T>):Promise<T>{return bounded(promise,20000,'The video decoder stopped responding. This device may not support this codec. Try an H.264 SDR copy.');}
async function readLoad<T>(promise:Promise<T>,deadline:number,decoder=false):Promise<T>{return bounded(promise,Math.min(decoder?20000:45000,deadline-Date.now()),decoder?'The video decoder stopped responding. This device may not support this codec. Try an H.264 SDR copy.':'The video file stopped responding while reading its tracks. Reopen it or try a shorter H.264 SDR copy.');}
function checkLoad(gen:number){if(gen!==generation)throw new Error('Video load cancelled.');}
function ensureRecipe(value:unknown){const recipe=parseRecipe(value);if(recipe.balancedAfterAI)throw new Error('Balanced after AI is available for photos only.');return recipe;}
async function frame(time:number){if(!sink||!info)throw new Error('Open a video first.');const timestamp=Math.max(start,start+Math.min(time,Math.max(0,info.duration-.001)));const wrapped=await decodeFrame(sink.getCanvas(timestamp));if(!wrapped)throw new Error('Could not decode this video frame.');return wrapped.canvas.getContext('2d')!.getImageData(0,0,wrapped.canvas.width,wrapped.canvas.height);}
function bitmap(image:ImageData){const canvas=new OffscreenCanvas(image.width,image.height);canvas.getContext('2d')!.putImageData(image,0,0);return canvas.transferToImageBitmap();}
ctx.onmessage=async({data})=>{
 const {type,gen,request}=data;
 const platform:MediaPlatform=isMediaPlatform(data.platform)?data.platform:currentMediaPlatform();
 let opening:Input|undefined;
 try {
  if(type==='custom-model'){customTask=aiQueue.catch(()=>{}).then(async()=>{const {loadCustomModel}=await import('./models');customModel=await loadCustomModel(data);return customModel;});aiQueue=customTask;const config=await customTask;if(!data.silent)send({type:'custom-ready',gen,config});return;}
  if(type==='cancel'){generation=gen;await conversion?.cancel();return;}
  if(type==='unload'){generation=gen;lastRequest++;nodes.clear();pendingNodes.clear();const previous=input,pending=conversion;input=undefined;track=undefined;sink=undefined;pixels=undefined;info=undefined;frameTime=-1;start=0;if(pending)await bounded(pending.cancel(),10000,'Video export cancellation timed out.').catch(()=>{});previous?.dispose();return;}
  if(type==='load'){
   generation=gen;lastRequest++;nodes.clear();pendingNodes.clear();const deadline=Date.now()+45000;const previous=input,pending=conversion;input=undefined;track=undefined;pixels=undefined;info=undefined;sink=undefined;frameTime=-1;start=0;if(pending)await bounded(pending.cancel(),10000,'Video export cancellation timed out.').catch(()=>{});previous?.dispose();if(gen!==generation)return;
   if(typeof VideoDecoder==='undefined')throw new Error('This browser cannot decode video for editing. Try a recent Chrome/Edge browser or the Android app.');
   assertVideoBytes(data.blob.size,platform);
   const opened=new Input({source:new BlobSource(data.blob),formats:[MP4,QTFF]});opening=opened;
   const video=await readLoad(opened.getPrimaryVideoTrack(),deadline);checkLoad(gen);if(!video)throw new Error('No video track was found in this MP4/MOV file.');
   const duration=await readLoad(opened.computeDuration(),deadline);checkLoad(gen);
   const width=await readLoad(video.getDisplayWidth(),deadline),height=await readLoad(video.getDisplayHeight(),deadline);checkLoad(gen);
   assertVideoDuration(duration,platform);
   assertVideoFrame(width,height,platform);
   const colorSpace=await readLoad(video.getColorSpace(),deadline);
   const codecString=await readLoad(video.getCodecParameterString(),deadline);
   if(hasHdrTransfer(colorSpace)||isDolbyVisionCodec(codecString)||await readLoad(hasDolbyVisionMetadata(data.blob),deadline)){
    checkLoad(gen);
    if(isMediaPlatform(data.platform)&&data.platform!=='android-apk')throw new PlatformLimitError('hdr-unsupported',data.platform);
    if(gen===generation){opened.dispose();opening=undefined;send({type:'hdr-needed',gen,width,height,duration,name:typeof data.blob.name==='string'?data.blob.name:''});}
    return;
   }
   if(!(await readLoad(video.canDecode(),deadline,true))){checkLoad(gen);throw new Error(`This device cannot decode ${await readLoad(video.getCodec(),deadline)??'this codec'}. iPhone HEVC/MOV support depends on the device. Try an H.264 SDR copy.`);}checkLoad(gen);
   const stats=await readLoad(video.computePacketStats(100),deadline);checkLoad(gen);
   const [outputWidth,outputHeight]=videoSize(width,height);
   const first=Math.max(0,await readLoad(video.getFirstTimestamp(),deadline));checkLoad(gen);
   let creationDate:Date|undefined;try{if(deadline-Date.now()>5000)creationDate=await bounded(readMp4CreationDate(data.blob),5000,'Video date metadata timed out.');}catch(error){console.error(error);}checkLoad(gen);
   const codec=await readLoad(video.getCodec(),deadline),hasAudio=!!(await readLoad(opened.getPrimaryAudioTrack(),deadline));checkLoad(gen);
   const metadata:VideoInfo={duration:Math.max(.001,duration-first),codec:codec??'unknown',hasAudio,outputWidth,outputHeight,frameRate:Math.min(30,Math.max(1,stats.averagePacketRate||30)),sourceWidth:width,sourceHeight:height,sourceFrameRate:Math.max(1,stats.averagePacketRate||30),...(creationDate?{creationDate}:{})};
   const [previewWidth,previewHeight]=videoSize(width,height,960,540);
   const reader=new CanvasSink(video,{width:previewWidth,height:previewHeight,fit:'fill',poolSize:1});
   const wrapped=await readLoad(reader.getCanvas(first),deadline,true);checkLoad(gen);if(!wrapped)throw new Error('Could not decode the first video frame.');
   const image=wrapped.canvas.getContext('2d')!.getImageData(0,0,previewWidth,previewHeight);
   const analysis=analyse(image.data,image.width,image.height),original=bitmap(image);
   send({type:'loaded',gen,width,height,video:metadata,analysis,original},[original]);
   input=opened;opening=undefined;track=video;start=first;info=metadata;sink=reader;pixels=image;frameTime=0;
  }else if(type==='sample-neutral'&&gen===generation){
   const recipe=ensureRecipe(data.recipe),time=Number(data.time)||0,image=frameTime===time&&pixels?pixels:await frame(time);if(gen!==generation)return;
   let base:Uint8ClampedArray|undefined;
   if(isAI(recipe)){const [a,b]=bracket(timesFor(recipe,info!.duration),time),left=await getNode(recipe,a,gen,request),right=await getNode(recipe,b,gen,request);if(gen!==generation)return;base=applyColour(image.data,colourAt(left,right,time,image.data));}
   const centerX=Math.max(0,Math.min(image.width-1,Math.round(data.x))),centerY=Math.max(0,Math.min(image.height-1,Math.round(data.y)));
   const left=Math.max(0,centerX-1),top=Math.max(0,centerY-1),right=Math.min(image.width,centerX+2),bottom=Math.min(image.height,centerY+2);
   const patch=new Uint8ClampedArray((right-left)*(bottom-top)*4),patchBase=base?new Uint8ClampedArray(patch.length):undefined;
   for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
    const from=(y*image.width+x)*4,to=((y-top)*(right-left)+x-left)*4;
    patch.set(image.data.subarray(from,from+4),to);if(base&&patchBase)patchBase.set(base.subarray(from,from+4),to);
   }
   const picked=pickNeutralFromPixels(patch,recipe,patchBase);
   send({type:'neutral-picked',gen,request,neutral:picked?.manual.neutral??null});
  }else if(type==='render'&&gen===generation){
   const id=request;lastRequest=id;const recipe=ensureRecipe(data.recipe),time=Number(data.time)||0;
   const image=frameTime===time&&pixels?pixels:await frame(time);if(gen!==generation||id!==lastRequest)return;
   pixels=image;frameTime=time;let base:Uint8ClampedArray|undefined;
   if(isAI(recipe)){const [a,b]=bracket(timesFor(recipe,info!.duration),time),left=await getNode(recipe,a,gen,request),right=await getNode(recipe,b,gen,request);if(gen!==generation||id!==lastRequest)return;base=applyColour(image.data,colourAt(left,right,time,image.data));}
   const original=bitmap(image),edited=bitmap(new ImageData(renderPixels(image.data,recipe,base),image.width,image.height));
   send({type:'rendered',gen,request,bitmap:edited,original,analysis:analyse(image.data,image.width,image.height)},[edited,original]);
  }else if(type==='export'&&gen===generation&&input&&track&&info){
   if(conversion?.state==='executing')throw new Error('A video export is already running.');
   const recipe:Recipe=ensureRecipe(data.recipe),mode:VideoExportMode=data.exportMode==='source'?'source':'compatible',exportPlan=videoExportPlan({...info,hasAudio:info.hasAudio&&data.keepAudio!==false},mode,platform),target=new BufferTarget();
   if(!exportPlan.supported)throw new PlatformLimitError('too-large',platform,{unit:'bytes',actual:exportPlan.estimatedBytes,limit:exportPlan.maxOutputBytes});
   if(!(await canEncodeVideo('avc',{width:exportPlan.width,height:exportPlan.height,bitrate:exportPlan.bitrate,frameRate:exportPlan.frameRate??info.sourceFrameRate??info.frameRate})))throw new Error(`This device cannot encode H.264 at the requested resolution, frame rate and quality. Choose compatible quality or use a device that supports this export.`);
   const times=timesFor(recipe,info.duration),plan:ColourNode[]=[];
   if(isAI(recipe)){for(let i=0;i<times.length;i++){plan.push(await getNode(recipe,times[i],gen,request));if(gen!==generation)return;send({type:'progress',gen,request,progress:Math.round((i+1)/times.length*20)});}}
   if(gen!==generation)return;
   target.on('write',({end})=>{if(end>exportPlan.maxOutputBytes)throw new PlatformLimitError('too-large',platform,{unit:'bytes',actual:end,limit:exportPlan.maxOutputBytes});});
   const output=new Output({format:new Mp4OutputFormat({fastStart:false}),target});let lastActivity=Date.now();
   const sourceTags=data.keepMetadata===true?await input.getMetadataTags():undefined;
   const tags=videoMetadataTags(sourceTags??{},data.keepMetadata===true);
   const canvas=new OffscreenCanvas(exportPlan.width,exportPlan.height),c=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
   let current:Conversion;
   try{current=await Conversion.init({input,output,tracks:'primary',tags,showWarnings:false,
    video:{codec:'avc',width:exportPlan.width,height:exportPlan.height,fit:'fill',...(exportPlan.frameRate===undefined?{}:{frameRate:exportPlan.frameRate}),bitrate:exportPlan.bitrate,allowTransformationMetadata:false,forceTranscode:true,
     process(sample){if(gen!==generation)throw new Error('Export cancelled.');lastActivity=Date.now();sample.draw(c,0,0,canvas.width,canvas.height);const image=c.getImageData(0,0,canvas.width,canvas.height);let base:Uint8ClampedArray|undefined;
      if(plan.length){const time=Math.max(0,sample.timestamp-start),[a,b]=bracket(times,time),left=plan[times.indexOf(a)],right=plan[times.indexOf(b)];base=applyColour(image.data,colourAt(left,right,time,image.data));}
      c.putImageData(new ImageData(renderPixels(image.data,recipe,base),image.width,image.height),0,0);return canvas;}},
    audio:data.keepAudio===false?{discard:true}:{codec:'aac'}
   });}catch(error){canvas.width=canvas.height=1;throw error;}
   if(gen!==generation){await current.cancel();canvas.width=canvas.height=1;return;}
   if(!current.isValid||!current.utilizedTracks.some(t=>t.isVideoTrack())){await current.cancel();canvas.width=canvas.height=1;throw new Error('H.264 video encoding is unavailable on this device. Try the Android app or a recent Chrome/Edge browser.');}
   if(data.keepAudio!==false&&info.hasAudio&&!current.utilizedTracks.some(t=>t.isAudioTrack())){await current.cancel();canvas.width=canvas.height=1;throw new Error('This audio format cannot be preserved here. Turn off Keep audio to export a silent video.');}
   conversion=current;
   current.onProgress=progress=>{lastActivity=Date.now();if(gen===generation)send({type:'progress',gen,request,progress:Math.min(95,Math.round(plan.length?20+progress*75:progress*95))});};
   let watchdog:ReturnType<typeof setInterval>|undefined;
   const stalled=new Promise<never>((_,reject)=>{watchdog=setInterval(()=>{if(Date.now()-lastActivity>60000)reject(new Error('Video processing stopped responding. Try an H.264 SDR copy or a shorter clip.'));},5000);});
   try{await Promise.race([current.execute(),stalled]);if(gen!==generation)return;if(!target.buffer)throw new Error('Video export produced no output.');let metadataWarning:string|undefined;if(data.keepMetadata===true&&info.creationDate&&!patchMp4CreationDate(target.buffer,info.creationDate))metadataWarning='The video was exported, but its source creation date could not be preserved.';send({type:'exported',gen,request,blob:new Blob([target.buffer],{type:'video/mp4'}),...(metadataWarning?{metadataWarning}:{})});}
   catch(error){await current.cancel().catch(cancelError=>{console.error(cancelError);});throw error;}
   finally{clearInterval(watchdog);if(conversion===current)conversion=undefined;canvas.width=canvas.height=1;}
  }
 }catch(error){if(type==='custom-model'&&data.silent)return;opening?.dispose();if(error instanceof VideoTransientError){console.error(error);if(gen===generation)send({type:'error',gen,request,operation:type,message:error.message,retryable:true});return;}const classified=classifyMediaFailure(error,platform,type==='export'?'export':'load');const limit=classified instanceof PlatformLimitError?classified:undefined;const message=classified instanceof Error?classified.message:'This video could not be processed.';if(gen===generation)send({type:'error',gen,request,operation:type,message,retryable:false,...(limit?{code:limit.code,actual:limit.actual,limit:limit.limit,platform:limit.platform}:{})});}
};
