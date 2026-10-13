import {afterEach,describe,expect,it,vi} from 'vitest';

const media=vi.hoisted(()=>{
 const track={hasHighDynamicRange:vi.fn(async()=>true),getDisplayWidth:vi.fn(async()=>3840),getDisplayHeight:vi.fn(async()=>2160),canDecode:vi.fn(async()=>false)};
 const input={getPrimaryVideoTrack:vi.fn(async()=>track),computeDuration:vi.fn(async()=>8),dispose:vi.fn()};
 return {track,input};
});
vi.mock('mediabunny',()=>({
 Input:class Input {constructor(){return media.input;}},BlobSource:class BlobSource {},MP4:{},QTFF:{},CanvasSink:class CanvasSink {},Conversion:class Conversion {},Output:class Output {},Mp4OutputFormat:class Mp4OutputFormat {},BufferTarget:class BufferTarget {},
}));

describe('video worker HDR import protocol',()=>{
 afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();vi.clearAllMocks();});
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
  expect(messages.some(message=>message.type==='hdr-needed')).toBe(false);expect(messages.find(message=>message.type==='error')).toMatchObject({operation:'load',gen:2,message:'Video clips can be up to 10 minutes long.'});
 });
});
