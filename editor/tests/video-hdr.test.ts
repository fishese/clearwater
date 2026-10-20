import {afterEach,describe,expect,it,vi} from 'vitest';
import {analyse,makeRecipe} from '../src/core/engine';

const media=vi.hoisted(()=>{
 const track={getColorSpace:vi.fn(async()=>({primaries:'bt2020',transfer:'pq',matrix:'bt2020-ncl',fullRange:false})),getCodecParameterString:vi.fn(async()=> 'hev1.1.6.L150.B0'),getDisplayWidth:vi.fn(async()=>3840),getDisplayHeight:vi.fn(async()=>2160),canDecode:vi.fn(async()=>false),getCodec:vi.fn(async()=> 'hevc')};
 const input={getPrimaryVideoTrack:vi.fn(async()=>track),computeDuration:vi.fn(async()=>8),dispose:vi.fn()};
 return {track,input,inputQueue:[] as object[]};
});
class FakeCanvas {
 constructor(public width:number,public height:number){}
 getContext(){return {getImageData:()=>({data:new Uint8ClampedArray(Array.from({length:this.width*this.height},()=>[40,60,80,255]).flat()),width:this.width,height:this.height}),putImageData:vi.fn()};}
 transferToImageBitmap(){return {width:this.width,height:this.height,close:vi.fn()};}
}
class FakeImageData {constructor(public data:Uint8ClampedArray,public width:number,public height:number){}}
vi.mock('mediabunny',()=>({
 Input:class Input {constructor(){return media.inputQueue.shift()??media.input;}},BlobSource:class BlobSource {},MP4:{},QTFF:{},CanvasSink:class CanvasSink {getCanvas(){return Promise.resolve({canvas:new FakeCanvas(2,2)});}},Conversion:class Conversion {},Output:class Output {},Mp4OutputFormat:class Mp4OutputFormat {},BufferTarget:class BufferTarget {},
}));

describe('video worker HDR import protocol',()=>{
 afterEach(()=>{media.inputQueue.length=0;vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();vi.clearAllMocks();});
 it('requests an Android SDR working copy after validating source limits and before WebCodecs decoding',async()=>{
  const messages:Record<string,unknown>[]=[];const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('VideoDecoder',function VideoDecoder(){});
  await import('../src/video.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  const file=new File([new Uint8Array(100)],'IMG_001.MOV',{type:'video/quicktime'});
  await handler({data:{type:'load',gen:7,blob:file}});
  expect(messages).toContainEqual({type:'hdr-needed',gen:7,width:3840,height:2160,duration:8,name:'IMG_001.MOV'});
  expect(media.track.canDecode).not.toHaveBeenCalled();expect(media.input.dispose).toHaveBeenCalledOnce();
 });
 it('rejects clips outside the 10-minute and 34-megapixel bounds before requesting conversion',async()=>{
  const messages:Record<string,unknown>[]=[];const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('VideoDecoder',function VideoDecoder(){});
  media.input.computeDuration.mockResolvedValueOnce(601);await import('../src/video.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:2,blob:new File([new Uint8Array(10)],'long.mp4',{type:'video/mp4'})}});
  expect(messages.some(message=>message.type==='hdr-needed')).toBe(false);expect(messages.find(message=>message.type==='error')).toMatchObject({operation:'load',gen:2,code:'too-long',limit:'10:00',message:'Video is 10:01 long. Max: 10:00. Trim it into shorter clips.'});
 });
 it('bounds a stalled metadata read and marks only the timeout retryable',async()=>{
  vi.useFakeTimers();
  const messages:Record<string,unknown>[]=[];const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('VideoDecoder',function VideoDecoder(){});
  media.input.computeDuration.mockImplementationOnce(()=>new Promise<number>(()=>{}));
  await import('../src/video.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  const loading=handler({data:{type:'load',gen:3,blob:new File([new Uint8Array(10)],'stalled.mov')}});
  await vi.advanceTimersByTimeAsync(45_001);await loading;
  expect(messages.find(message=>message.type==='error')).toMatchObject({operation:'load',gen:3,retryable:true});
  expect(media.input.dispose).toHaveBeenCalledOnce();
 });
 it('does not publish an older video after the user switches files mid-load',async()=>{
  const messages:Record<string,unknown>[]=[];const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('VideoDecoder',function VideoDecoder(){});
  vi.stubGlobal('OffscreenCanvas',FakeCanvas);vi.stubGlobal('ImageData',FakeImageData);
  let releaseOld:(duration:number)=>void=()=>{};
  media.input.computeDuration.mockImplementationOnce(()=>new Promise<number>(resolve=>{releaseOld=resolve;}));
  const newTrack={...media.track,getColorSpace:vi.fn(async()=>({primaries:'smpte432',transfer:'bt709',matrix:'smpte170m',fullRange:true})),canDecode:vi.fn(async()=>true),
   getDisplayWidth:vi.fn(async()=>2),getDisplayHeight:vi.fn(async()=>2),
   computePacketStats:vi.fn(async()=>({averagePacketRate:30})),getFirstTimestamp:vi.fn(async()=>0)};
  const newInput={getPrimaryVideoTrack:vi.fn(async()=>newTrack),computeDuration:vi.fn(async()=>8),
   getPrimaryAudioTrack:vi.fn(async()=>null),dispose:vi.fn()};
  media.inputQueue.push(media.input,newInput);
  await import('../src/video.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  const old=handler({data:{type:'load',gen:4,blob:new File([new Uint8Array(10)],'old.mov')}});
  await vi.waitFor(()=>expect(media.input.computeDuration).toHaveBeenCalledTimes(1));
  await handler({data:{type:'load',gen:5,blob:new File([new Uint8Array(10)],'new.mov')}});
  releaseOld(8);await old;
  expect(messages.filter(message=>message.type==='loaded').map(message=>message.gen)).toEqual([5]);
  expect(media.input.dispose).toHaveBeenCalledOnce();expect(newInput.dispose).not.toHaveBeenCalled();
  const values=new Uint8ClampedArray([40,60,80,255,40,60,80,255,40,60,80,255,40,60,80,255]);
  await handler({data:{type:'render',gen:5,request:1,time:0,recipe:makeRecipe(analyse(values,2,2))}});
  expect(messages.filter(message=>message.type==='rendered').map(message=>message.gen)).toEqual([5]);
  expect(messages.some(message=>message.type==='error')).toBe(false);
 });
 it('reports unsupported codecs as deterministic errors',async()=>{
  const messages:Record<string,unknown>[]=[];const scope={postMessage:(message:Record<string,unknown>)=>messages.push(message)};
  vi.stubGlobal('self',scope);vi.stubGlobal('VideoDecoder',function VideoDecoder(){});
  media.track.getColorSpace.mockResolvedValueOnce({primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false});
  await import('../src/video.worker');
  const handler=(scope as unknown as {onmessage:(event:{data:Record<string,unknown>})=>Promise<void>}).onmessage;
  await handler({data:{type:'load',gen:6,blob:new File([new Uint8Array(10)],'unsupported.mov')}});
  expect(messages.find(message=>message.type==='error')).toMatchObject({operation:'load',gen:6,retryable:false});
 });
});
