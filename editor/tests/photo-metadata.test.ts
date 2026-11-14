import {describe,it,expect} from 'vitest';
import piexif from 'piexifjs';
import {parse} from 'exifr';
import {crc32,readPhotoExif,preservePhotoMetadata} from '../src/photo-metadata';
const bytes=(s:string)=>Uint8Array.from(s,c=>c.charCodeAt(0));
const binary=(a:Uint8Array)=>Array.from(a,n=>String.fromCharCode(n)).join('');
function jpeg(exif?:string){const n=(exif?.length??0)+2;return bytes('\xff\xd8'+(exif?'\xff\xe1'+String.fromCharCode(n>>>8,n&255)+exif:'')+'\xff\xd9');}
const fixture=(userComment='ASCII\0\0\0Dive comment')=>jpeg(piexif.dump({'0th':{271:'Test Camera',272:'DiveCam',274:6,315:'Test Author',33432:'Test Copyright'},
 Exif:{36867:'2026:10:01 12:34:56',36868:'2026:10:01 12:34:56',36881:'+08:00',37521:'123',33434:[1,125],33437:[28,10],37380:[-1,3],37500:'private maker note',37510:userComment,41728:'\x03',40962:64,40963:32},
 GPS:{0:[2,3,0,0],1:'S',2:[[33,1],[12,1],[123456,10000]],3:'W',4:[[151,1],[9,1],[365432,10000]],5:1,6:[123,10],7:[[12,1],[34,1],[56,1]],29:'2026:10:01'}}));
// Node does not provide the worker FileReader API used by exifr's Blob reader.
class Reader {
 result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
 readAsArrayBuffer(blob:Blob){blob.arrayBuffer().then(v=>{this.result=v;this.onload?.();this.onloadend?.();}).catch(()=>this.onerror?.());}
}
Object.assign(globalThis,{FileReader:Reader});
function png(){const data=new Uint8Array(33);data.set([137,80,78,71,13,10,26,10]);const v=new DataView(data.buffer);v.setUint32(8,13);data.set(bytes('IHDR'),12);v.setUint32(16,32);v.setUint32(20,64);data.set([8,2,0,0,0],24);v.setUint32(29,crc32(data.subarray(12,29)));return data;}
function pngChunk(type:string,payload:Uint8Array){const chunk=new Uint8Array(payload.length+12),v=new DataView(chunk.buffer);v.setUint32(0,payload.length);chunk.set(bytes(type),4);chunk.set(payload,8);v.setUint32(chunk.length-4,crc32(chunk.subarray(4,chunk.length-4)));return chunk;}
describe('photo EXIF preservation',()=>{
 it('does not warn for empty EXIF text fields while preserving other metadata',async()=>{
  const input=jpeg(piexif.dump({'0th':{270:'',271:'Test Camera',315:'',33432:''},Exif:{36867:'2026:10:01 12:34:56'}}));
  const result=await readPhotoExif(input,32,64);expect(result.warning).toBeUndefined();expect(result.exif).toBeDefined();
  const output=await parse(jpeg(binary(result.exif!)),{translateValues:false,reviveValues:false});expect(output.Make).toBe('Test Camera');expect(output.DateTimeOriginal).toBe('2026:10:01 12:34:56');
 });
 it('omits an invalid GPS coordinate pair while preserving other EXIF',async()=>{
  const input=fixture(),pattern=Uint8Array.from([0,0,0,33,0,0,0,1,0,0,0,12,0,0,0,1]);
  const offset=Buffer.from(input).indexOf(pattern);expect(offset).toBeGreaterThan(0);input.fill(0,offset+4,offset+8);
  const result=await readPhotoExif(input,32,64);expect(result.warning).toContain('could not be preserved');expect(result.diagnostic).toBe('CW/meta/tag/GPS/2');
  const output=piexif.load(binary(result.exif!));expect(output['0th'][271]).toBe('Test Camera');expect(output.Exif[36867]).toBe('2026:10:01 12:34:56');
  for(const tag of [1,2,3,4])expect(output.GPS[tag]).toBeUndefined();
 });
 it('preserves capture dates, camera, author, rational settings and southern/western GPS; fixes rotation/dimensions and drops MakerNote/thumbnail',async()=>{
  const result=await readPhotoExif(fixture(),32,64);expect(result.warning).toBeUndefined();expect(result.exif).toBeDefined();
  const output=await parse(jpeg(binary(result.exif!)),{translateValues:false,reviveValues:false});
  expect(output.Make).toBe('Test Camera');expect(output.Artist).toBe('Test Author');expect(output.Copyright).toBe('Test Copyright');
  expect(output.DateTimeOriginal).toBe('2026:10:01 12:34:56');expect(output.ExposureTime).toBeCloseTo(1/125,7);
  expect(output.OffsetTimeOriginal).toBe('+08:00');expect(output.SubSecTimeOriginal).toBe('123');
  expect(output.ExposureCompensation).toBeCloseTo(-1/3,5);expect(output.GPSLatitudeRef).toBe('S');expect(output.GPSLongitudeRef).toBe('W');
  expect(output.latitude).toBeCloseTo(-(33+12/60+12.3456/3600),7);expect(output.longitude).toBeCloseTo(-(151+9/60+36.5432/3600),7);
  expect(Array.from(output.GPSAltitudeRef)).toEqual([1]);expect(output.GPSAltitude).toBeCloseTo(12.3);expect(output.Orientation).toBe(1);
  expect(output.ImageWidth).toBe(32);expect(output.ImageHeight).toBe(64);expect(output.ExifImageWidth).toBe(32);expect(output.ExifImageHeight).toBe(64);expect(output.ColorSpace).toBe(1);
  expect(piexif.load(binary(result.exif!)).Exif[37500]).toBeUndefined();expect(piexif.load(binary(result.exif!))['1st']).toEqual({});
  expect(piexif.load(binary(result.exif!)).Exif[37510]).toBe('ASCII\0\0\0Dive comment');
 });
 it('preserves the original bytes of a Unicode EXIF UserComment',async()=>{
  // UNICODE marker followed by UTF-16BE bytes, including a surrogate pair.
  const comment=String.fromCharCode(85,78,73,67,79,68,69,0,0x6f,0x5b,0xd8,0x3d,0xde,0x37);
  const result=await readPhotoExif(fixture(comment),32,64);
  expect(result.warning).toBeUndefined();expect(result.exif).toBeDefined();
  expect(piexif.load(binary(result.exif!)).Exif[37510]).toBe(comment);
 });
 it('preserves Unicode UserComment bytes through JPEG to PNG to JPEG and PNG to PNG',async()=>{
  const comment=String.fromCharCode(85,78,73,67,79,68,69,0,0x6f,0x5b,0xd8,0x3d,0xde,0x37);
  const first=await preservePhotoMetadata(new Blob([fixture(comment)]),new Blob([png()],{type:'image/png'}),32,64);
  expect(first.warning).toBeUndefined();
  for(const type of ['image/jpeg','image/png']){
   const result=await preservePhotoMetadata(first.blob,new Blob([type==='image/jpeg'?jpeg():png()],{type}),48,24);
   expect(result.warning).toBeUndefined();
   const exif=await readPhotoExif(new Uint8Array(await result.blob.arrayBuffer()),48,24);
   expect(exif.warning).toBeUndefined();const output=piexif.load(binary(exif.exif!));
   expect(output.Exif[37510]).toBe(comment);expect(output['0th'][271]).toBe('Test Camera');
   expect(output['0th'][274]).toBe(1);expect(output.Exif[40962]).toBe(48);expect(output.Exif[40963]).toBe(24);
   expect(output.GPS[1]).toBe('S');expect(output.GPS[3]).toBe('W');
  }
 });
 it('finds PNG comments after large image chunks',async()=>{
  const comment='UNICODE\0\x6f\x5b\xd8\x3d\xde\x37',tiff=bytes(piexif.dump({'0th':{271:'PNG camera'},Exif:{37510:comment}})).slice(6);
  const idat=pngChunk('IDAT',new Uint8Array(200000));
  class TrackedBlob extends Blob {
   reads:Array<[number,number]>=[];
   override slice(start=0,end=this.size,type?:string){this.reads.push([start,end]);return super.slice(start,end,type);}
  }
  const source=new TrackedBlob([png(),idat,pngChunk('eXIf',tiff),pngChunk('IEND',new Uint8Array())]);
  for(const input of [source,new Uint8Array(await source.arrayBuffer())]){
   const result=await readPhotoExif(input,32,64);
   expect(result.warning).toBeUndefined();expect(piexif.load(binary(result.exif!)).Exif[37510]).toBe(comment);
  }
  expect(source.reads.length).toBeGreaterThan(0);
  // IDAT payload starts at 41 and ends at 200041; only its header is read.
  for(const [start,end] of source.reads)expect(end<=41||start>=200041).toBe(true);
 });
 it('preserves a standard Undefined UserComment from little-endian PNG TIFF',async()=>{
  const comment=bytes('UNICODE\0\x5b\x6f\x3d\xd8\x37\xde'),tiff=new Uint8Array(44+comment.length),v=new DataView(tiff.buffer);
  tiff.set(bytes('II'));v.setUint16(2,42,true);v.setUint32(4,8,true);
  v.setUint16(8,1,true);v.setUint16(10,34665,true);v.setUint16(12,4,true);v.setUint32(14,1,true);v.setUint32(18,26,true);
  v.setUint16(26,1,true);v.setUint16(28,37510,true);v.setUint16(30,7,true);v.setUint32(32,comment.length,true);v.setUint32(36,44,true);tiff.set(comment,44);
  const result=await readPhotoExif(new Uint8Array(await new Blob([png(),pngChunk('eXIf',tiff)]).arrayBuffer()),32,64);
  expect(result.warning).toBeUndefined();expect(piexif.load(binary(result.exif!)).Exif[37510]).toBe(binary(comment));
 });
 it('does not warn or invent comments in valid PNGs with no UserComment',async()=>{
  for(const metadata of [new Uint8Array(),pngChunk('eXIf',bytes(piexif.dump({'0th':{271:'PNG camera'}})).slice(6))]){
   const result=await readPhotoExif(new Uint8Array(await new Blob([png(),metadata,pngChunk('IEND',new Uint8Array())]).arrayBuffer()),32,64);
   expect(result.warning).toBeUndefined();if(result.exif)expect(piexif.load(binary(result.exif)).Exif[37510]).toBeUndefined();
  }
 });
 it('warns and fails open for truncated or malformed PNG EXIF',async()=>{
  const tiff=bytes(piexif.dump({'0th':{271:'PNG camera'},Exif:{37510:'UNICODE\0\x6f\x5b'}})).slice(6);
  const badCrc=pngChunk('eXIf',tiff);badCrc[badCrc.length-1]^=1;
  const badOffset=tiff.slice(),view=new DataView(badOffset.buffer);
  // The fixture is big-endian TIFF; make the Exif IFD pointer out of bounds.
  const ifd=view.getUint32(4),count=view.getUint16(ifd);
  for(let i=0;i<count;i++){const entry=ifd+2+12*i;if(view.getUint16(entry)===34665)view.setUint32(entry+8,0xffffffff);}
  const badComment=tiff.slice(),commentView=new DataView(badComment.buffer);
  for(let i=0;i<count;i++){
   const entry=ifd+2+12*i;
   if(commentView.getUint16(entry)===34665){const exif=commentView.getUint32(entry+8);commentView.setUint32(exif+2+8,2);}
  }
  const valid=pngChunk('eXIf',tiff);
  for(const chunk of [badCrc,pngChunk('eXIf',badOffset),pngChunk('eXIf',badComment),valid.slice(0,-5)]){
   const rendered=new Blob([jpeg()],{type:'image/jpeg'});
   const result=await preservePhotoMetadata(new Blob([png(),chunk]),rendered,32,64);
   expect(result.warning).toContain('could not be preserved');
   if(result.blob!==rendered){const output=await readPhotoExif(new Uint8Array(await result.blob.arrayBuffer()),32,64);expect(piexif.load(binary(output.exif!)).Exif[37510]).toBeUndefined();}
  }
 });
 it('extracts EXIF from an HEIF item container and writes it to a JPEG export',async()=>{
  const join=(...parts:Uint8Array[])=>new Uint8Array(Buffer.concat(parts));
  const u32=(n:number)=>{const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n);return a;};
  const box=(type:string,payload:Uint8Array)=>join(u32(payload.length+8),bytes(type),payload);
  const full=(type:string,payload:Uint8Array,version=0)=>box(type,join(new Uint8Array([version,0,0,0]),payload));
  const ftyp=box('ftyp',join(bytes('heic'),u32(0),bytes('mif1heic')));
  const exif=bytes(piexif.dump({'0th':{271:'HEIF test camera'},GPS:{1:'N',2:[[1,1],[2,1],[3,1]],3:'E',4:[[4,1],[5,1],[6,1]]}}));
  const item=join(u32(6),exif),iinf=full('iinf',join(bytes('\0\x01'),full('infe',bytes('\0\x01\0\0Exif\0'),2)));
  const meta=(offset:number)=>full('meta',join(iinf,full('iloc',join(bytes('\x44\0\0\x01\0\x01\0\0\0\x01'),u32(offset),u32(item.length)))));
  const heif=join(ftyp,meta(ftyp.length+meta(0).length+8),box('mdat',item));
  const result=await preservePhotoMetadata(new Blob([heif],{type:'image/heic'}),new Blob([jpeg()],{type:'image/jpeg'}),64,32);
  expect(result.warning).toBeUndefined();const output=await parse(new Uint8Array(await result.blob.arrayBuffer()));
  expect(output.Make).toBe('HEIF test camera');expect(output.latitude).toBeCloseTo(1+2/60+3/3600,7);
 });
 it('inserts JPEG APP1 without modifying encoded pixels and supports JPEG to PNG to JPEG metadata',async()=>{
  const original=new Blob([fixture()]),rendered=new Blob([jpeg()],{type:'image/jpeg'});
  const jpg=await preservePhotoMetadata(original,rendered,32,64);expect(jpg.warning).toBeUndefined();
  const jpgBytes=new Uint8Array(await jpg.blob.arrayBuffer());expect(jpgBytes.slice(-2)).toEqual(jpeg().slice(-2));expect((await parse(jpgBytes)).Make).toBe('Test Camera');
  const pngResult=await preservePhotoMetadata(original,new Blob([png()],{type:'image/png'}),32,64);expect(pngResult.warning).toBeUndefined();
  const pngBytes=new Uint8Array(await pngResult.blob.arrayBuffer()),v=new DataView(pngBytes.buffer),length=v.getUint32(33);
  expect(binary(pngBytes.slice(37,41))).toBe('eXIf');expect(v.getUint32(41+length)).toBe(crc32(pngBytes.slice(37,41+length)));
  expect(pngBytes.slice(0,33)).toEqual(png());expect((await parse(pngBytes)).Make).toBe('Test Camera');
  const back=await preservePhotoMetadata(pngResult.blob,rendered,32,64);expect(back.warning).toBeUndefined();expect((await parse(new Uint8Array(await back.blob.arrayBuffer()))).latitude).toBeLessThan(0);
 });
 it('does not fabricate capture metadata when absent, and fails open on invalid metadata',async()=>{
  expect(await readPhotoExif(jpeg(),1,1)).toEqual({});
  expect((await readPhotoExif(bytes('invalid'),1,1)).warning).toContain('could not be preserved');
  expect((await readPhotoExif(bytes('invalid'),1,1)).diagnostic).toBe('CW/meta/parse');
  const rendered=new Blob([jpeg()],{type:'image/jpeg'}),result=await preservePhotoMetadata(new Blob([bytes('invalid')]),rendered,1,1);
  expect(result.blob).toBe(rendered);expect(result.warning).toBeDefined();
 });
});
