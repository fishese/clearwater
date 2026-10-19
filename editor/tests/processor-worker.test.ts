import {afterEach,describe,expect,it,vi} from 'vitest';
import {analyse,makeRecipe,renderPixels} from '../src/core/engine';
import {DEFAULT_ENHANCEMENT} from '../src/core/types';
import {suggestEnhancement} from '../src/core/enhancement';
vi.mock('../src/models',()=>({inferField:vi.fn(async()=>(new Float32Array(256*256*3).fill(.04)))}));
const photoFinishMocks=vi.hoisted(()=>{
 const fitFor=(look:'natural'|'vivid')=>({variant:look==='natural'?'tone':'vivid',active:true,reason:'fit',sampleCount:64,colourReason:'fit',colourGains:[1,1,1],...(look==='vivid'?{chromaGain:1.12}:{}),toneScale:1.05,toneOffset:-.01});
 const valid=(value:any)=>!!value&&['natural','vivid'].includes(value.look)&&Number.isFinite(value.amount)&&value.amount>=0&&value.amount<=100&&value.fit?.variant===(value.look==='natural'?'tone':'vivid');
 return {
  fitPhotoFinish:vi.fn((_reference:Uint8ClampedArray,_width:number,_height:number,look:'natural'|'vivid',_options?:Record<string,unknown>)=>fitFor(look)),
  isValidPhotoFinishSettings:vi.fn(valid),
  preparePhotoFinish:vi.fn((settings:any)=>({look:settings.look})),
  applyPhotoFinish:vi.fn((pixels:Uint8ClampedArray)=>pixels),
 };
});
vi.mock('../src/core/photo-finish',()=>photoFinishMocks);

vi.mock('../src/photo-decode',()=>({decodePhoto:vi.fn(async()=>({
 bitmap:{width:2,height:2,close:vi.fn()},
 info:{sourceWidth:2,sourceHeight:2,exportWidth:2,exportHeight:2,large:false,raw:false,mode:'auto'},
}))}));
vi.mock('../src/core/enhancement',()=>({
 enhancePixels:vi.fn((pixels:Uint8ClampedArray)=>pixels),
 enhancementRadii:vi.fn(()=>({clarity:1,sharpness:1})),
 suggestEnhancement:vi.fn(()=>({black:0,white:1,contrast:80,clarity:35,sharpness:25})),
}));

class FakeImageData {
 constructor(public data:Uint8ClampedArray,public width:number,public height:number){}
}
class FakeCanvas {
 static lastBlobOptions:{type?:string;quality?:number}|undefined;
 static lastImageData:FakeImageData|undefined;
 constructor(public width:number,public height:number){}
 getContext(){return {
  drawImage:vi.fn(),clearRect:vi.fn(),putImageData:(image:FakeImageData)=>{FakeCanvas.lastImageData=image;},
  getImageData:()=>{const data=new Uint8ClampedArray(this.width*this.height*4);for(let i=0;i<data.length;i+=4){data[i]=40;data[i+1]=80;data[i+2]=120;data[i+3]=255;}return {data,width:this.width,height:this.height};},
 };}
 transferToImageBitmap(){return {width:this.width,height:this.height,close:vi.fn()};}
 convertToBlob(options?:{type?:string;quality?:number}){FakeCanvas.lastBlobOptions=options;return Promise.resolve(new Blob());}
}

describe('photo processor request sequencing',()=>{
 afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();vi.clearAllMocks();FakeCanvas.lastImageData=undefined;});

 it('drops superseded same-file previews and skips auto analysis for disabled enhancement',async()=>{
  const messages:Record<string,unknown>[]=[];
  const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const pixels=new Uint8ClampedArray([40,60,80,255,80,100,120,255,120,140,160,255,160,180,200,255]);
  const recipe=makeRecipe(analyse(pixels,2,2));recipe.enhancement={...DEFAULT_ENHANCEMENT};
  const first=handler({data:{type:'render',gen:1,request:10,recipe}});
  const second=handler({data:{type:'render',gen:1,request:11,recipe}});
  await Promise.all([first,second]);
  expect(messages.filter(message=>message.type==='rendered').map(message=>message.request)).toEqual([11]);
  expect(suggestEnhancement).not.toHaveBeenCalled();
  expect(photoFinishMocks.applyPhotoFinish).not.toHaveBeenCalled();
 });

 it('keeps the legacy no-finish render pixels and does not call finish helpers',async()=>{
  const messages:Record<string,unknown>[]=[];
  const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const recipe=makeRecipe(analyse(new Uint8ClampedArray([40,80,120,255]),1,1));
  await handler({data:{type:'render',gen:1,request:12,recipe}});
  const original=new Uint8ClampedArray(16);
  for(let i=0;i<original.length;i+=4){original[i]=40;original[i+1]=80;original[i+2]=120;original[i+3]=255;}
  expect(FakeCanvas.lastImageData?.data).toEqual(renderPixels(original,recipe));
  expect(photoFinishMocks.preparePhotoFinish).not.toHaveBeenCalled();
  expect(photoFinishMocks.applyPhotoFinish).not.toHaveBeenCalled();
  expect(messages.some(message=>message.type==='rendered'&&message.request===12)).toBe(true);
 });

 it('does not emit a stale enhancement error after a newer request supersedes it',async()=>{
  const messages:Record<string,unknown>[]=[];
  const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const pixels=new Uint8ClampedArray([40,60,80,255,80,100,120,255,120,140,160,255,160,180,200,255]);
  const recipe=makeRecipe(analyse(pixels,2,2));recipe.engine='wave';
  const first=handler({data:{type:'enhance',gen:1,request:20,recipe}});
  const second=handler({data:{type:'enhance',gen:1,request:21,recipe}});
  await Promise.all([first,second]);
  expect(messages.filter(message=>message.type==='error').map(message=>message.request)).toEqual([21]);
 });

 it('uses the requested JPEG quality while keeping the default at 0.95',async()=>{
  const messages:Record<string,unknown>[]=[];
  const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const recipe=makeRecipe(analyse(new Uint8ClampedArray([40,80,120,255]),1,1));
  await handler({data:{type:'export',gen:1,request:1,recipe,format:'jpg',jpegQuality:.99,keepMetadata:false}});
  expect(FakeCanvas.lastBlobOptions).toEqual({type:'image/jpeg',quality:.99});
  await handler({data:{type:'export',gen:1,request:2,recipe,format:'jpg',keepMetadata:false}});
  expect(FakeCanvas.lastBlobOptions).toEqual({type:'image/jpeg',quality:.95});
 });

 it('reuses cached AI inference when Balanced after AI strength or dive hints change',async()=>{
  const messages:Record<string,unknown>[]=[];
  const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const models=await import('../src/models');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const pixels=new Uint8ClampedArray([40,60,80,255,80,100,120,255,120,140,160,255,160,180,200,255]);
  const recipe=makeRecipe(analyse(pixels,2,2));recipe.engine='wwe';recipe.balancedAfterAI={strength:.3};
  await handler({data:{type:'render',gen:1,request:30,recipe}});
  recipe.balancedAfterAI={strength:.7};recipe.hints={...recipe.hints,filter:'yes'};
  await handler({data:{type:'render',gen:1,request:31,recipe}});
  await handler({data:{type:'export',gen:1,request:32,recipe,format:'png',keepMetadata:false}});
  expect(messages.filter(message=>message.type==='rendered').map(message=>message.request)).toEqual([30,31]);
  expect(messages.filter(message=>message.type==='exported').map(message=>message.request)).toEqual([32]);
  expect(models.inferField).toHaveBeenCalledTimes(1);
 });

 it('fits Natural once and reuses the same model inference and prepared fit for preview and export',async()=>{
  const messages:Record<string,any>[]=[];
  const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const models=await import('../src/models');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const pixels=new Uint8ClampedArray([40,80,120,255]);
  const recipe=makeRecipe(analyse(pixels,1,1));recipe.engine='wwe';recipe.balancedAfterAI={strength:.3};
  await handler({data:{type:'finish',gen:1,request:50,recipe,look:'natural'}});
  const ready=messages.find(message=>message.type==='finish-ready')!;
  expect(ready).toMatchObject({gen:1,request:50,look:'natural'});
  expect(ready.fit.variant).toBe('tone');
  recipe.adaptiveFinish={look:'natural',amount:100,fit:ready.fit};
  await handler({data:{type:'render',gen:1,request:51,recipe}});
  await handler({data:{type:'export',gen:1,request:52,recipe,format:'png',keepMetadata:false}});
  expect(photoFinishMocks.fitPhotoFinish).toHaveBeenCalledOnce();
  expect(photoFinishMocks.preparePhotoFinish).toHaveBeenCalledOnce();
  expect(photoFinishMocks.applyPhotoFinish).toHaveBeenCalledTimes(2);
  expect(models.inferField).toHaveBeenCalledOnce();
  expect(messages.some(message=>message.type==='rendered'&&message.request===51)).toBe(true);
  expect(messages.some(message=>message.type==='exported'&&message.request===52)).toBe(true);
 });

 it('preserves existing red correction when the recipe identifies a red filter',async()=>{
  const scope={postMessage:vi.fn()};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const recipe=makeRecipe(analyse(new Uint8ClampedArray([40,80,120,255]),1,1));
  recipe.auto={...recipe.auto,mode:'filter'};
  await handler({data:{type:'finish',gen:1,request:53,recipe,look:'vivid'}});
  expect(photoFinishMocks.fitPhotoFinish).toHaveBeenCalledWith(expect.any(Uint8ClampedArray),256,256,'vivid',expect.objectContaining({
   scene:recipe.hints.scene,filter:recipe.hints.filter,preserveRedCorrection:true,
  }));
 });

 it('suppresses stale Natural fit results after a newer finish request',async()=>{
  const messages:Record<string,unknown>[]=[];
  let releaseModel:(field:Float32Array)=>void=()=>{};
  const models=await import('../src/models');
  vi.mocked(models.inferField).mockImplementationOnce(()=>new Promise(resolve=>{releaseModel=resolve;}));
  const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const pixels=new Uint8ClampedArray([40,80,120,255]);
  const neuralRecipe=makeRecipe(analyse(pixels,1,1));neuralRecipe.engine='wwe';
  const first=handler({data:{type:'finish',gen:1,request:60,recipe:neuralRecipe,look:'natural'}});
  await vi.waitFor(()=>expect(models.inferField).toHaveBeenCalledOnce());
  const latestRecipe=makeRecipe(analyse(pixels,1,1));
  const second=handler({data:{type:'finish',gen:1,request:61,recipe:latestRecipe,look:'vivid'}});
  await second;
  releaseModel(new Float32Array(256*256*3));
  await first;
  expect(messages.filter(message=>message.type==='finish-ready').map(message=>message.request)).toEqual([61]);
  expect(messages.filter(message=>message.type==='error')).toHaveLength(0);
  expect(photoFinishMocks.fitPhotoFinish).toHaveBeenCalledOnce();
 });

 it('drops stale finish errors when a newer request supersedes model inference',async()=>{
  const messages:Record<string,unknown>[]=[];
  let rejectModel:(error:Error)=>void=()=>{};
  const models=await import('../src/models');
  vi.mocked(models.inferField).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{rejectModel=reject;}));
  const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const pixels=new Uint8ClampedArray([40,80,120,255]);
  const neuralRecipe=makeRecipe(analyse(pixels,1,1));neuralRecipe.engine='wwe';
  const first=handler({data:{type:'finish',gen:1,request:70,recipe:neuralRecipe,look:'natural'}});
  await vi.waitFor(()=>expect(models.inferField).toHaveBeenCalledOnce());
  const latestRecipe=makeRecipe(analyse(pixels,1,1));
  const second=handler({data:{type:'finish',gen:1,request:71,recipe:latestRecipe,look:'vivid'}});
  await second;
  rejectModel(new Error('stale model failure'));
  await first;
  expect(messages.filter(message=>message.type==='finish-ready').map(message=>message.request)).toEqual([71]);
  expect(messages.filter(message=>message.type==='error')).toHaveLength(0);
  expect(photoFinishMocks.fitPhotoFinish).toHaveBeenCalledOnce();
 });

 it('drops a finish result when the photo generation changes during inference',async()=>{
  const messages:Record<string,unknown>[]=[];
  let releaseModel:(field:Float32Array)=>void=()=>{};
  const models=await import('../src/models');
  vi.mocked(models.inferField).mockImplementationOnce(()=>new Promise(resolve=>{releaseModel=resolve;}));
  const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const pixels=new Uint8ClampedArray([40,80,120,255]);
  const recipe=makeRecipe(analyse(pixels,1,1));recipe.engine='wwe';
  const first=handler({data:{type:'finish',gen:1,request:75,recipe,look:'natural'}});
  await vi.waitFor(()=>expect(models.inferField).toHaveBeenCalledOnce());
  await handler({data:{type:'load',gen:2,blob:new Blob()}});
  releaseModel(new Float32Array(256*256*3));
  await first;
  expect(messages.filter(message=>message.type==='finish-ready')).toHaveLength(0);
  expect(messages.filter(message=>message.type==='error')).toHaveLength(0);
  expect(photoFinishMocks.fitPhotoFinish).not.toHaveBeenCalled();
 });

 it('disables only auto-applied contrast while preserving detail and manual contrast',async()=>{
  const scope={postMessage:vi.fn()};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const enhancement=await import('../src/core/enhancement');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const pixels=new Uint8ClampedArray([40,80,120,255]);
  const fit={variant:'tone' as const,active:true,reason:'fit' as const,sampleCount:64,colourReason:'fit' as const,colourGains:[1,1,1] as const,toneScale:1.05,toneOffset:0};
  const recipe=makeRecipe(analyse(pixels,1,1));recipe.adaptiveFinish={look:'natural',amount:100,fit};
  recipe.enhancement={...DEFAULT_ENHANCEMENT,contrast:80,clarity:35,sharpness:25,autoApplied:true};
  await handler({data:{type:'render',gen:1,request:80,recipe}});
  expect(enhancement.enhancePixels).toHaveBeenLastCalledWith(expect.any(Uint8ClampedArray),2,2,expect.objectContaining({contrast:0,clarity:35,sharpness:25,brightness:0,autoApplied:true}),2,2);
  recipe.enhancement={...recipe.enhancement,contrast:44,autoApplied:false};
  await handler({data:{type:'render',gen:1,request:81,recipe}});
  expect(enhancement.enhancePixels).toHaveBeenLastCalledWith(expect.any(Uint8ClampedArray),2,2,expect.objectContaining({contrast:44,clarity:35,sharpness:25,autoApplied:false}),2,2);
 });

 it('keeps auto contrast when a saved fit is inactive or has no pixel effect',async()=>{
  const scope={postMessage:vi.fn()};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const enhancement=await import('../src/core/enhancement');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const pixels=new Uint8ClampedArray([40,80,120,255]);
  const identity={variant:'tone' as const,active:true,reason:'fit' as const,sampleCount:64,colourReason:'fit' as const,colourGains:[1,1,1] as const,toneScale:1,toneOffset:0};
  const inactive={...identity,active:false,reason:'flat' as const,sampleCount:64};
  const recipe=makeRecipe(analyse(pixels,1,1));
  recipe.enhancement={...DEFAULT_ENHANCEMENT,contrast:80,clarity:35,sharpness:25,autoApplied:true};
  for(const fit of [inactive,identity]){
   recipe.adaptiveFinish={look:'natural',amount:100,fit};
   await handler({data:{type:'render',gen:1,request:90+(fit.active?1:0),recipe}});
   expect(enhancement.enhancePixels).toHaveBeenLastCalledWith(expect.any(Uint8ClampedArray),2,2,expect.objectContaining({contrast:80,clarity:35,sharpness:25,autoApplied:true}),2,2);
  }
  expect(photoFinishMocks.applyPhotoFinish).not.toHaveBeenCalled();
  expect(photoFinishMocks.preparePhotoFinish).not.toHaveBeenCalled();
 });

 it('samples an AI corrected photo patch before applying the existing neutral gains',async()=>{
  const messages:Record<string,unknown>[]=[];
  const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  await import('../src/processor.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:1,blob:new Blob()}});
  const recipe=makeRecipe(analyse(new Uint8ClampedArray([40,80,120,255]),1,1));
  recipe.engine='wwe';recipe.balancedAfterAI={strength:.3};recipe.manual.neutral=[4,.5,1.7];
  await handler({data:{type:'sample-neutral',gen:1,request:40,x:1,y:1,recipe}});
  const picked=messages.find(message=>message.type==='neutral-picked') as {request:number;neutral:number[]|null}|undefined;
  expect(picked?.request).toBe(40);
  expect(picked?.neutral).toHaveLength(3);
  expect(picked?.neutral?.every(value=>Number.isFinite(value)&&value>=.25&&value<=4)).toBe(true);
  const models=await import('../src/models');expect(models.inferField).toHaveBeenCalledOnce();
 });
});
