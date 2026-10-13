import {afterEach,describe,expect,it,vi} from 'vitest';
import {analyse,makeRecipe} from '../src/core/engine';
import {DEFAULT_ENHANCEMENT} from '../src/core/types';
import {suggestEnhancement} from '../src/core/enhancement';
vi.mock('../src/models',()=>({inferField:vi.fn(async()=>(new Float32Array(256*256*3).fill(.04)))}));

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
 constructor(public width:number,public height:number){}
 getContext(){return {
  drawImage:vi.fn(),clearRect:vi.fn(),putImageData:vi.fn(),
  getImageData:()=>{const data=new Uint8ClampedArray(this.width*this.height*4);for(let i=0;i<data.length;i+=4){data[i]=40;data[i+1]=80;data[i+2]=120;data[i+3]=255;}return {data,width:this.width,height:this.height};},
 };}
 transferToImageBitmap(){return {width:this.width,height:this.height,close:vi.fn()};}
 convertToBlob(){return Promise.resolve(new Blob());}
}

describe('photo processor request sequencing',()=>{
 afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();vi.clearAllMocks();});

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
});
