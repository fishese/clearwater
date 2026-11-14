import {parse} from 'exifr';
import piexif from 'piexifjs';

type Directory=Record<number,unknown>;
// Piexifjs predates the EXIF 2.31 timezone fields used by recent phone cameras.
Object.assign(piexif.TAGS.Exif,{
 0x9010:{name:'OffsetTime',type:'Ascii'},0x9011:{name:'OffsetTimeOriginal',type:'Ascii'},0x9012:{name:'OffsetTimeDigitized',type:'Ascii'},
});
const ifd0Tags=new Set([270,271,272,282,283,296,305,306,315,316,33432,40091,40092,40093,40094,40095]);
const excludedExif=new Set([37121,37122,37500,40965,40961,40962,40963]); // Old encoding, MakerNote, pointers, colour/dimensions.
const warning='Some EXIF/GPS metadata could not be preserved. The restored photo was still exported.';
const bytes=(s:string)=>Uint8Array.from(s,c=>c.charCodeAt(0));
const binary=(a:ArrayLike<number>)=>Array.from(a,n=>String.fromCharCode(n)).join('');

function rational(n:unknown,signed:boolean):[number,number] {
 if(typeof n!=='number'||!Number.isFinite(n)||(!signed&&n<0))throw new Error('Invalid fraction');
 const limit=signed?0x7fffffff:0xffffffff;
 if(Math.abs(n)>limit)throw new Error('Fraction too large');
 // Keep useful GPS/exposure precision without exceeding TIFF's 32-bit fraction fields.
 const denominator=Math.min(1_000_000,Math.floor(limit/Math.max(1,Math.abs(n))));
 const numerator=Math.round(n*denominator);
 const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
 const divisor=gcd(Math.abs(numerator),denominator)||1;
 return [numerator/divisor,denominator/divisor];
}
function valueFor(value:unknown,type:string):unknown {
 if(type==='Ascii'){
  if(typeof value!=='string'||value.length>8192||Array.from(value).some(c=>c.charCodeAt(0)>255))throw new Error('Invalid text');
  return value;
 }
 if(type==='Undefined'){
  if(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=255)return binary([value]);
  // Undefined EXIF tags are bytes, not text. Keep piexifjs' binary-string
  // representation byte-for-byte and reject decoded Unicode strings.
  if(typeof value==='string'&&value.length<=8192&&Array.from(value).every(c=>c.charCodeAt(0)<=255))return value;
  if((Array.isArray(value)||ArrayBuffer.isView(value))&&(value as ArrayLike<number>).length<=8192)return binary(value as ArrayLike<number>);
  throw new Error('Invalid bytes');
 }
 const array=Array.isArray(value)||ArrayBuffer.isView(value)?Array.from(value as ArrayLike<number>):[value];
 if(array.length>4096)throw new Error('Tag too large');
 if(type==='Rational'||type==='SRational'){
  const fractions=array.map(n=>rational(n,type==='SRational'));
  return fractions.length===1?fractions[0]:fractions;
 }
 const limits:Record<string,[number,number]>={Byte:[0,255],Short:[0,65535],Long:[0,0xffffffff],SLong:[-0x80000000,0x7fffffff]};
 const limit=limits[type];
 if(!limit||array.some(n=>typeof n!=='number'||!Number.isInteger(n)||n<limit[0]||n>limit[1]))throw new Error('Invalid number');
 return array.length===1?array[0]:array;
}

async function rawJpegUserComment(source:Blob|Uint8Array):Promise<string|undefined> {
 try{
  // exifr exposes Undefined values as strings and can UTF-8-replace bytes in
  // an EXIF Unicode UserComment. Read this one tag through piexifjs directly,
  // whose JPEG loader returns the original APP1 bytes as a binary string.
  const head=source instanceof Blob
   ?new Uint8Array(await source.slice(0,131072).arrayBuffer())
   :source.subarray(0,131072);
  if(head[0]!==255||head[1]!==216)return;
  let offset=2;
  while(offset+4<=head.length&&head[offset]===255){
   while(head[offset]===255)offset++;
   const marker=head[offset++];
   if(marker===218||marker===217)break;
   if(marker===1||(marker>=208&&marker<=215))continue;
   const size=(head[offset]<<8)|head[offset+1],start=offset+2,end=offset+size;
   if(size<2||end>head.length)break;
   if(marker===225&&end-start>=6&&binary(head.subarray(start,start+6))==='Exif\0\0'){
    const value=piexif.load(binary(head.subarray(start,end))).Exif?.[37510];
    return typeof value==='string'?value:undefined;
   }
   offset=end;
  }
 }catch{return;}
}

function rawTiffUserComment(tiff:Uint8Array):string|false|undefined {
 try{
  const view=new DataView(tiff.buffer,tiff.byteOffset,tiff.length),order=binary(tiff.subarray(0,2));
  if(order!=='II'&&order!=='MM')return false;
  const little=order==='II';
  const u16=(at:number)=>view.getUint16(at,little),u32=(at:number)=>view.getUint32(at,little);
  if(u16(2)!==42)return false;
  const find=(at:number,tag:number):number|undefined=>{
   if(at<8||at>tiff.length-2)throw new Error('Invalid IFD');
   const count=u16(at);
   if(count>Math.floor((tiff.length-at-2)/12))throw new Error('Truncated IFD');
   for(let i=0;i<count;i++){const entry=at+2+i*12;if(u16(entry)===tag)return entry;}
  };
  const pointer=find(u32(4),34665);
  if(pointer===undefined)return;
  if(u16(pointer+2)!==4||u32(pointer+4)!==1)return false;
  const comment=find(u32(pointer+8),37510);
  if(comment===undefined)return;
  const type=u16(comment+2),count=u32(comment+4),start=count<=4?comment+8:u32(comment+8);
  // piexifjs writes this tag as ASCII (including a terminator); cameras
  // normally use Undefined. Preserve both representations without decoding.
  if(![2,7].includes(type)||count>8192+(type===2?1:0)||(count>4&&start<8)||start>tiff.length-count)return false;
  const end=start+count;
  return binary(tiff.subarray(start,type===2&&count>0&&tiff[end-1]===0?end-1:end));
 }catch{return false;}
}

async function rawPngExif(source:Blob|Uint8Array):Promise<{tiff?:Uint8Array;comment?:string|false}|undefined> {
 const length=source instanceof Blob?source.size:source.length;
 const read=async(start:number,size:number)=>source instanceof Blob
  ?new Uint8Array(await source.slice(start,start+size).arrayBuffer()):source.subarray(start,start+size);
 const signature=await read(0,8);
 if(binary(signature)!=='\x89PNG\r\n\x1a\n')return;
 try{
  // Seek over image data rather than reading it. Bound chunk traversal and
  // the EXIF payload independently, including when eXIf follows a large IDAT.
  let offset=8;
  for(let chunks=0;chunks<4096&&offset+12<=length;chunks++){
   const header=await read(offset,8),size=new DataView(header.buffer,header.byteOffset,8).getUint32(0);
   if(size>length-offset-12)return {comment:false};
   const type=binary(header.subarray(4));
   if(type==='IEND')return {};
   if(type==='eXIf'){
    if(size<8||size>65527)return {comment:false};
    const chunk=await read(offset+4,size+8),tiff=chunk.subarray(4,size+4);
    if(crc32(chunk.subarray(0,size+4))!==new DataView(chunk.buffer,chunk.byteOffset+size+4,4).getUint32(0))return {comment:false};
    return {tiff,comment:rawTiffUserComment(tiff)};
   }
   offset+=size+12;
  }
  return {comment:false};
 }catch{return {comment:false};}
}

export async function readPhotoExif(source:Blob|Uint8Array,width:number,height:number):Promise<{exif?:Uint8Array;warning?:string;diagnostic?:string}> {
 let phase='parse';
 try{
  const options={translateKeys:false,translateValues:false,reviveValues:false,mergeOutput:false,sanitize:false,
   ifd0:{pick:[...ifd0Tags]},exif:{pick:Object.keys(piexif.TAGS.Exif).map(Number).filter(tag=>!excludedExif.has(tag))},gps:{pick:Object.keys(piexif.TAGS.GPS).map(Number)},
   ifd1:false,interop:false,makerNote:false,userComment:true,xmp:false,icc:false,iptc:false,jfif:false,ihdr:false,silentErrors:false};
  const pngExif=await rawPngExif(source);
  if(pngExif&&!pngExif.tiff)return pngExif.comment===false?{warning,diagnostic:'CW/meta/parse'}:{};
  // Parse only the bounded TIFF for PNG: exifr's Blob scan can stop before
  // metadata following a large image chunk. JPEG and HEIF parsing is unchanged.
  const parsed=await parse(pngExif?.tiff??source,options);
  if(!parsed)return {};
  const userComment=pngExif?pngExif.comment:await rawJpegUserComment(source);
  const output:Record<string,Directory>={'0th':{},Exif:{},GPS:{}};
  let copied=0,skipped=userComment===false,diagnostic:string|undefined=userComment===false?'CW/meta/tag/Exif/37510/bytes':undefined;phase='tags';
  // A redacted or malformed coordinate must not leave a misleading partial
  // latitude/longitude pair. Non-location EXIF and other valid tags survive.
  const invalidCoordinate=[2,4].find(tag=>{const value=parsed.gps?.[tag];if(value===undefined||value===null)return false;try{valueFor(value,'Rational');return false;}catch{return true;}});
  if(invalidCoordinate!==undefined){skipped=true;diagnostic=`CW/meta/tag/GPS/${invalidCoordinate}`;}
  for(const [block,target] of [['ifd0','0th'],['exif','Exif'],['gps','GPS']]){
   for(const [key,parsedValue] of Object.entries(parsed[block]??{})){
    if(block==='exif'&&Number(key)===37510&&userComment===false)continue;
    const value=block==='exif'&&Number(key)===37510&&userComment!==undefined?userComment:parsedValue;
    // exifr represents zero-length text tags as undefined; there is no
    // metadata value to preserve or warn about in that case.
    if(value===undefined||value===null)continue;
    const tag=Number(key),info=piexif.TAGS[target][tag];
    if(!info||(target==='0th'&&!ifd0Tags.has(tag))||(target==='Exif'&&excludedExif.has(tag)))continue;
    if(target==='GPS'&&invalidCoordinate!==undefined&&[1,2,3,4].includes(tag))continue;
    try{output[target][tag]=valueFor(value,info.type);copied++;}catch{
     skipped=true;const values=Array.isArray(value)||ArrayBuffer.isView(value)?Array.from(value as ArrayLike<unknown>):[value];
     const reason=values.some(v=>typeof v==='number'&&!Number.isFinite(v))?'nonfinite':values.some(v=>typeof v==='number'&&v<0)?'negative':values.some(v=>typeof v!=='number')?'nonnumeric':'other';
     diagnostic??=`CW/meta/tag/${target}/${tag}/${reason}`;
    }
   }
  }
  if(!copied)return skipped?{warning,diagnostic}:{};
  output['0th'][274]=1; // Browser/decoder has already applied source rotation/mirroring.
  output['0th'][256]=width;output['0th'][257]=height;
  output.Exif[40961]=1;output.Exif[40962]=width;output.Exif[40963]=height; // Canvas is sRGB.
  phase='write';const exif=bytes(piexif.dump(output));
  if(exif.length>65533)throw new Error('EXIF exceeds JPEG APP1 size');
  return {exif,warning:skipped?warning:undefined,diagnostic};
 }catch{return {warning,diagnostic:`CW/meta/${phase}`};}
}

export function crc32(data:Uint8Array):number {
 let crc=0xffffffff;
 for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
export async function preservePhotoMetadata(source:Blob,rendered:Blob,width:number,height:number):Promise<{blob:Blob;warning?:string;diagnostic?:string}> {
 const result=await readPhotoExif(source,width,height);
 if(!result.exif)return {blob:rendered,warning:result.warning,diagnostic:result.diagnostic};
 try{
  const header=new Uint8Array(await rendered.slice(0,33).arrayBuffer());
  if(rendered.type==='image/jpeg'&&header[0]===255&&header[1]===216){
   const length=result.exif.length+2;
   return {blob:new Blob([header.slice(0,2),new Uint8Array([255,225,length>>>8,length&255]),result.exif,rendered.slice(2)],{type:rendered.type}),warning:result.warning,diagnostic:result.diagnostic};
  }
  if(rendered.type==='image/png'&&header[0]===137&&binary(header.slice(1,4))==='PNG'&&binary(header.slice(12,16))==='IHDR'){
   // PNG eXIf contains the TIFF payload without JPEG's six-byte Exif prefix.
   const tiff=result.exif.slice(6),chunk=new Uint8Array(tiff.length+12),view=new DataView(chunk.buffer);
   view.setUint32(0,tiff.length);chunk.set(bytes('eXIf'),4);chunk.set(tiff,8);view.setUint32(chunk.length-4,crc32(chunk.subarray(4,chunk.length-4)));
   return {blob:new Blob([rendered.slice(0,33),chunk,rendered.slice(33)],{type:rendered.type}),warning:result.warning,diagnostic:result.diagnostic};
  }
 }catch{/* Metadata must never prevent saving the rendered image. */}
 return {blob:rendered,warning,diagnostic:'CW/meta/insert'};
}
