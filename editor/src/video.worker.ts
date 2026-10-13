/// <reference lib="webworker" />
import {Input,BlobSource,MP4,QTFF,CanvasSink,Conversion,Output,Mp4OutputFormat,BufferTarget,type InputVideoTrack} from 'mediabunny';
import {analyse,renderPixels,parseRecipe} from './core/engine';
import {MAX_VIDEO_BYTES,MAX_VIDEO_SECONDS,MAX_VIDEO_OUTPUT_BYTES,videoBitrate,videoSize,type VideoInfo} from './core/media';
import {fitColour,colourHistogram,colourAt,applyColour,sampleTimes,bracket,type ColourNode} from './core/video-colour';
import type {Recipe,CustomModel} from './core/types';
import type {ModelName} from './models';

const ctx=self as unknown as DedicatedWorkerGlobalScope;
let input:Input|undefined,track:InputVideoTrack|undefined,sink:CanvasSink|undefined;
let generation=0,lastRequest=0,pixels:ImageData|undefined,frameTime=-1,start=0,info:VideoInfo|undefined,conversion:Conversion|undefined;
const send=(data:unknown,transfer:Transferable[]=[])=>ctx.postMessage(data,transfer);
let customModel:CustomModel|undefined,customTask:Promise<unknown>=Promise.resolve(),aiQueue:Promise<unknown>=Promise.resolve();
const nodes=new Map<string,ColourNode>(),pendingNodes=new Map<string,Promise<ColourNode>>();
const isAI=(recipe:Recipe)=>['shallow','funie','wave'].includes(recipe.engine);
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
async function decodeFrame<T>(promise:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('The video decoder stopped responding. This device may not support this codec. Try an H.264 SDR copy.')),20000);})]);}finally{clearTimeout(timer);}}
function ensureRecipe(value:unknown){return parseRecipe(value);}
async function frame(time:number){if(!sink||!info)throw new Error('Open a video first.');const timestamp=Math.max(start,start+Math.min(time,Math.max(0,info.duration-.001)));const wrapped=await decodeFrame(sink.getCanvas(timestamp));if(!wrapped)throw new Error('Could not decode this video frame.');return wrapped.canvas.getContext('2d')!.getImageData(0,0,wrapped.canvas.width,wrapped.canvas.height);}
function bitmap(image:ImageData){const canvas=new OffscreenCanvas(image.width,image.height);canvas.getContext('2d')!.putImageData(image,0,0);return canvas.transferToImageBitmap();}
ctx.onmessage=async({data})=>{
 const {type,gen,request}=data;
 let opening:Input|undefined;
 try {
  if(type==='custom-model'){customTask=aiQueue.catch(()=>{}).then(async()=>{const {loadCustomModel}=await import('./models');customModel=await loadCustomModel(data);return customModel;});aiQueue=customTask;const config=await customTask;if(!data.silent)send({type:'custom-ready',gen,config});return;}
  if(type==='cancel'){generation=gen;await conversion?.cancel();return;}
  if(type==='unload'){generation=gen;lastRequest++;nodes.clear();pendingNodes.clear();const previous=input,pending=conversion;input=undefined;sink=undefined;pixels=undefined;await pending?.cancel();previous?.dispose();return;}
  if(type==='load'){
   generation=gen;lastRequest++;nodes.clear();pendingNodes.clear();const previous=input,pending=conversion;input=undefined;pixels=undefined;info=undefined;sink=undefined;frameTime=-1;await pending?.cancel();previous?.dispose();if(gen!==generation)return;
   if(typeof VideoDecoder==='undefined')throw new Error('This browser cannot decode video for editing. Try a recent Chrome/Edge browser or the Android app.');
   if(data.blob.size>MAX_VIDEO_BYTES)throw new Error('This first video version supports clips up to 512 MB.');
   const opened=new Input({source:new BlobSource(data.blob),formats:[MP4,QTFF]});opening=opened;
   const video=await decodeFrame(opened.getPrimaryVideoTrack());if(!video)throw new Error('No video track was found in this MP4/MOV file.');
   if(await video.hasHighDynamicRange())throw new Error('HDR/Dolby Vision video needs tone mapping, which is not ready yet. Use an SDR copy; on iPhone, record with HDR Video turned off.');
   if(!(await decodeFrame(video.canDecode())))throw new Error(`This device cannot decode ${await video.getCodec()??'this codec'}. iPhone HEVC/MOV support depends on the device. Try an H.264 SDR copy.`);
   const duration=await opened.computeDuration(),width=await video.getDisplayWidth(),height=await video.getDisplayHeight();
   if(!Number.isFinite(duration)||duration<=0||duration>MAX_VIDEO_SECONDS+.01)throw new Error('Video clips can be up to 10 minutes long.');
   if(width*height>34_000_000)throw new Error('This video resolution is too large for the editor. Use a smaller copy.');
   const stats=await video.computePacketStats(100),[outputWidth,outputHeight]=videoSize(width,height);
   const first=Math.max(0,await video.getFirstTimestamp());
   const metadata:VideoInfo={duration:Math.max(.001,duration-first),codec:await video.getCodec()??'unknown',hasAudio:!!(await opened.getPrimaryAudioTrack()),outputWidth,outputHeight,frameRate:Math.min(30,Math.max(1,stats.averagePacketRate||30))};
   const [previewWidth,previewHeight]=videoSize(width,height,960,540);
   const reader=new CanvasSink(video,{width:previewWidth,height:previewHeight,fit:'fill',poolSize:1});
   const wrapped=await decodeFrame(reader.getCanvas(first));if(!wrapped)throw new Error('Could not decode the first video frame.');
   if(gen!==generation){opened.dispose();opening=undefined;return;}
   const image=wrapped.canvas.getContext('2d')!.getImageData(0,0,previewWidth,previewHeight);input=opened;opening=undefined;track=video;start=first;info=metadata;sink=reader;pixels=image;frameTime=0;
   const original=bitmap(image);send({type:'loaded',gen,width,height,video:info,analysis:analyse(image.data,image.width,image.height),original},[original]);
  }else if(type==='render'&&gen===generation){
   const id=request;lastRequest=id;const recipe=ensureRecipe(data.recipe),time=Number(data.time)||0;
   const image=frameTime===time&&pixels?pixels:await frame(time);if(gen!==generation||id!==lastRequest)return;
   pixels=image;frameTime=time;let base:Uint8ClampedArray|undefined;
   if(isAI(recipe)){const [a,b]=bracket(timesFor(recipe,info!.duration),time),left=await getNode(recipe,a,gen,request),right=await getNode(recipe,b,gen,request);if(gen!==generation||id!==lastRequest)return;base=applyColour(image.data,colourAt(left,right,time,image.data));}
   const original=bitmap(image),edited=bitmap(new ImageData(renderPixels(image.data,recipe,base),image.width,image.height));
   send({type:'rendered',gen,request,bitmap:edited,original,analysis:analyse(image.data,image.width,image.height)},[edited,original]);
  }else if(type==='export'&&gen===generation&&input&&track&&info){
   if(conversion?.state==='executing')throw new Error('A video export is already running.');
   const recipe:Recipe=ensureRecipe(data.recipe),target=new BufferTarget();
   const times=timesFor(recipe,info.duration),plan:ColourNode[]=[];
   if(isAI(recipe)){for(let i=0;i<times.length;i++){plan.push(await getNode(recipe,times[i],gen,request));if(gen!==generation)return;send({type:'progress',gen,request,progress:Math.round((i+1)/times.length*20)});}}
   if(gen!==generation)return;
   target.on('write',({end})=>{if(end>MAX_VIDEO_OUTPUT_BYTES)throw new Error('The output exceeded the 256 MB export limit. Turn off Keep audio or use a shorter clip.');});
   const output=new Output({format:new Mp4OutputFormat({fastStart:false}),target});let lastActivity=Date.now();
   const canvas=new OffscreenCanvas(info.outputWidth,info.outputHeight),c=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;
   const current=await Conversion.init({input,output,tracks:'primary',tags:{},showWarnings:false,
    video:{codec:'avc',width:info.outputWidth,height:info.outputHeight,fit:'fill',frameRate:info.frameRate,bitrate:videoBitrate(info.duration),allowTransformationMetadata:false,forceTranscode:true,
     process(sample){if(gen!==generation)throw new Error('Export cancelled.');lastActivity=Date.now();sample.draw(c,0,0,canvas.width,canvas.height);const image=c.getImageData(0,0,canvas.width,canvas.height);let base:Uint8ClampedArray|undefined;
      if(plan.length){const time=Math.max(0,sample.timestamp-start),[a,b]=bracket(times,time),left=plan[times.indexOf(a)],right=plan[times.indexOf(b)];base=applyColour(image.data,colourAt(left,right,time,image.data));}
      c.putImageData(new ImageData(renderPixels(image.data,recipe,base),image.width,image.height),0,0);return canvas;}},
    audio:data.keepAudio===false?{discard:true}:{codec:'aac'}
   });
   if(gen!==generation){await current.cancel();return;}
   if(!current.isValid||!current.utilizedTracks.some(t=>t.isVideoTrack())){await current.cancel();throw new Error('H.264 video encoding is unavailable on this device. Try the Android app or a recent Chrome/Edge browser.');}
   if(data.keepAudio!==false&&info.hasAudio&&!current.utilizedTracks.some(t=>t.isAudioTrack())){await current.cancel();throw new Error('This audio format cannot be preserved here. Turn off Keep audio to export a silent video.');}
   conversion=current;
   current.onProgress=progress=>{lastActivity=Date.now();if(gen===generation)send({type:'progress',gen,request,progress:Math.min(95,Math.round(plan.length?20+progress*75:progress*95))});};
   let watchdog:ReturnType<typeof setInterval>|undefined;
   const stalled=new Promise<never>((_,reject)=>{watchdog=setInterval(()=>{if(Date.now()-lastActivity>60000)reject(new Error('Video processing stopped responding. Try an H.264 SDR copy or a shorter clip.'));},5000);});
   try{await Promise.race([current.execute(),stalled]);if(gen!==generation)return;if(!target.buffer)throw new Error('Video export produced no output.');send({type:'exported',gen,request,blob:new Blob([target.buffer],{type:'video/mp4'})});}
   catch(error){await current.cancel().catch(()=>{});throw error;}
   finally{clearInterval(watchdog);if(conversion===current)conversion=undefined;canvas.width=canvas.height=1;}
  }
 }catch(error){if(type==='custom-model'&&data.silent)return;opening?.dispose();let message=error instanceof Error?error.message:'This video could not be processed.';if(/unsupported configuration/i.test(message))message='This device cannot decode or encode this video configuration. HEVC support varies by device. Try an H.264 SDR copy.';if(gen===generation)send({type:'error',gen,request,operation:type,message});}
};
