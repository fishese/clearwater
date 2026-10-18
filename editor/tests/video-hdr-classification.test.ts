import {describe,expect,it} from 'vitest';
import {hasDolbyVisionMetadata,hasHdrTransfer,isDolbyVisionCodec} from '../src/core/video-hdr';

function box(type:string,content:Uint8Array=new Uint8Array()):Uint8Array{
 const bytes=new Uint8Array(8+content.length);
 new DataView(bytes.buffer).setUint32(0,bytes.length);
 for(let i=0;i<4;i++)bytes[4+i]=type.charCodeAt(i);
 bytes.set(content,8);return bytes;
}
function join(...parts:Uint8Array[]):Uint8Array{
 const bytes=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));
 let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
function videoFile(entryType:string,configType?:string):Blob{
 const child=configType?box(configType,new Uint8Array(4)):new Uint8Array();
 const entry=box(entryType,join(new Uint8Array(78),child));
 const stsd=box('stsd',join(new Uint8Array(4),new Uint8Array([0,0,0,1]),entry));
 return new Blob([box('ftyp',new Uint8Array(8)),box('moov',box('trak',box('mdia',box('minf',box('stbl',stsd)))))]);
}

describe('video HDR classification',()=>{
 it('keeps P3 and BT.2020 SDR, including 10-bit/full-range sources, on the normal path',()=>{
  expect(hasHdrTransfer({primaries:'smpte432',transfer:'bt709',matrix:'smpte170m',fullRange:true})).toBe(false);
  expect(hasHdrTransfer({primaries:'bt2020',transfer:'bt709',matrix:'bt2020-ncl',fullRange:false})).toBe(false);
  expect(hasHdrTransfer({primaries:'bt2020'})).toBe(false);
 });
 it('routes PQ and HLG to HDR conversion regardless of primaries',()=>{
  expect(hasHdrTransfer({primaries:'bt709',transfer:'pq'})).toBe(true);
  expect(hasHdrTransfer({primaries:'smpte432',transfer:'hlg'})).toBe(true);
  expect(hasHdrTransfer({transfer:'smpte2084'})).toBe(true);
  expect(hasHdrTransfer({transfer:'arib-std-b67'})).toBe(true);
 });
 it('recognizes Dolby Vision codec strings and sample entry configuration',async()=>{
  expect(isDolbyVisionCodec('dvh1.08.04')).toBe(true);
  expect(isDolbyVisionCodec('dvhe.05.06')).toBe(true);
  expect(isDolbyVisionCodec('hev1.1.6.L150.B0')).toBe(false);
  expect(await hasDolbyVisionMetadata(videoFile('dvh1'))).toBe(true);
  expect(await hasDolbyVisionMetadata(videoFile('hvc1','dvcC'))).toBe(true);
  expect(await hasDolbyVisionMetadata(videoFile('hev1','dvvC'))).toBe(true);
 });
 it('does not mistake unrelated box payload for Dolby Vision signaling',async()=>{
  const text=new TextEncoder().encode('dvcC dvh1');
  expect(await hasDolbyVisionMetadata(new Blob([box('moov',box('udta',text))]))).toBe(false);
  expect(await hasDolbyVisionMetadata(videoFile('hev1'))).toBe(false);
  expect(await hasDolbyVisionMetadata(videoFile('lpcm','dvcC'))).toBe(false);
 });
});
