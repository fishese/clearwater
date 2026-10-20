import {describe,expect,it} from 'vitest';
import {MAX_SOURCE_VIDEO_OUTPUT_BYTES,MAX_VIDEO_OUTPUT_BYTES,patchMp4CreationDate,readMp4CreationDate,videoExportPlan,videoMetadataTags,type VideoInfo} from '../src/core/media';

const info:VideoInfo={duration:60,codec:'avc',hasAudio:true,outputWidth:1920,outputHeight:1080,frameRate:30,sourceWidth:3840,sourceHeight:2160,sourceFrameRate:60};

describe('video export plans',()=>{
 it('keeps compatible output at 1080p30 under the legacy cap',()=>{
  const plan=videoExportPlan(info,'compatible');
  expect(plan).toMatchObject({mode:'compatible',width:1920,height:1080,frameRate:30,maxOutputBytes:MAX_VIDEO_OUTPUT_BYTES,supported:true});
  expect(plan.bitrate).toBeLessThanOrEqual(8_000_000);
 });
 it('preserves source dimensions and frame timing while scaling bitrate',()=>{
  const plan=videoExportPlan(info,'source');
  expect(plan).toMatchObject({mode:'source',width:3840,height:2160,maxOutputBytes:MAX_SOURCE_VIDEO_OUTPUT_BYTES,supported:true});
  expect(plan.frameRate).toBeUndefined();
  expect(plan.bitrate).toBe(36_000_000);
 });
 it('requests higher quality than the compatible profile at 1080p30',()=>{
  expect(videoExportPlan({...info,sourceWidth:1920,sourceHeight:1080,sourceFrameRate:30},'source').bitrate).toBe(12_000_000);
 });
 it('uses the 256 MB iOS source cap and leaves the desktop cap at 512 MB',()=>{
  const ios=videoExportPlan(info,'source','ios-app');
  const desktop=videoExportPlan(info,'source','desktop');
  expect(ios.maxOutputBytes).toBe(256*1024*1024);
  expect(ios.supported).toBe(false);
  expect(ios.reason).toContain('256 MB');
  expect(desktop.maxOutputBytes).toBe(512*1024*1024);
  expect(desktop.supported).toBe(true);
 });
 it('refuses a source export estimate above its cap instead of lowering bitrate',()=>{
  const plan=videoExportPlan({...info,duration:600},'source');
  expect(plan.supported).toBe(false);
  expect(plan.bitrate).toBe(36_000_000);
  expect(plan.estimatedBytes).toBeGreaterThan(MAX_SOURCE_VIDEO_OUTPUT_BYTES);
  expect(plan.reason).toContain('512 MB');
 });
 it('preserves title, description, comment and date only when metadata retention is enabled',()=>{
  const date=new Date('2025-03-04T05:06:07Z');
  expect(videoMetadataTags({title:'Dive',description:'reef',comment:'Near sunset',date},true)).toEqual({title:'Dive',description:'reef',comment:'Near sunset',date});
  expect(videoMetadataTags({title:'Dive',comment:'Near sunset',date},false)).toEqual({});
 });
 it('reads the source MP4 creation header and patches output movie headers to that date',async()=>{
  const box=(type:string,payload:Uint8Array)=>{const bytes=new Uint8Array(payload.length+8),view=new DataView(bytes.buffer);view.setUint32(0,bytes.length,false);bytes.set([...type].map(char=>char.charCodeAt(0)),4);bytes.set(payload,8);return bytes;};
  const timestamp=new Date('2024-03-04T05:06:07Z'),payload=new Uint8Array(24),view=new DataView(payload.buffer);
  view.setUint32(4,Math.floor(timestamp.getTime()/1000)+2_082_844_800,false);
  const source=new Blob([box('ftyp',new Uint8Array(4)),box('moov',box('mvhd',payload))]);
  const sourceDate=await readMp4CreationDate(source);expect(sourceDate?.toISOString()).toBe(timestamp.toISOString());
  const output=await source.arrayBuffer();expect(patchMp4CreationDate(output,sourceDate!)).toBe(true);
  expect((await readMp4CreationDate(new Blob([output])))?.toISOString()).toBe(timestamp.toISOString());
 });
 it('returns no date for truncated or unknown movie headers and rejects invalid patch dates',async()=>{
  const box=(type:string,payload:Uint8Array)=>{const bytes=new Uint8Array(payload.length+8),view=new DataView(bytes.buffer);view.setUint32(0,bytes.length,false);bytes.set([...type].map(char=>char.charCodeAt(0)),4);bytes.set(payload,8);return bytes;};
  const unknown=new Blob([box('moov',box('mvhd',new Uint8Array([3,0,0,0])))]);
  expect(await readMp4CreationDate(unknown)).toBeUndefined();
  expect(patchMp4CreationDate(await unknown.arrayBuffer(),new Date('invalid'))).toBe(false);
  expect(patchMp4CreationDate(await unknown.arrayBuffer(),new Date('2024-03-04T05:06:07Z'))).toBe(false);
 });
});
