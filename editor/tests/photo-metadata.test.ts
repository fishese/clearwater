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
describe('photo EXIF preservation',()=>{
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
  const rendered=new Blob([jpeg()],{type:'image/jpeg'}),result=await preservePhotoMetadata(new Blob([bytes('invalid')]),rendered,1,1);
  expect(result.blob).toBe(rendered);expect(result.warning).toBeDefined();
 });
});
