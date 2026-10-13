import {parse} from 'exifr';
import {validatePhotoSize} from './core/photo-size';
export async function photoHeader(blob:Blob):Promise<[number,number]|undefined>{
 const head=new Uint8Array(await blob.slice(0,33).arrayBuffer()),view=new DataView(head.buffer);
 let dimensions:[number,number]|undefined,orientation=1;
 if(head[0]===137&&head[1]===80&&head[2]===78&&head.length>=24)dimensions=[view.getUint32(16),view.getUint32(20)];
 if(head[0]===255&&head[1]===216){
  // Jump over JPEG segments without decoding or reading their payloads.
  let offset=2;
  for(let count=0;count<1024&&offset+4<=blob.size;count++){
   const b=new Uint8Array(await blob.slice(offset,offset+12).arrayBuffer());
   if(b[0]!==255)break;
   const marker=b[1];if(marker===255){offset++;continue;}
   if(marker===218||marker===217)break;
   if(marker===1||(marker>=208&&marker<=215)){offset+=2;continue;}
   if(b.length<4)break;const length=b[2]*256+b[3];if(length<2)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&b.length>=9){dimensions=[b[7]*256+b[8],b[5]*256+b[6]];break;}
   offset+=2+length;
  }
 }
 try{
  const exif=await parse(blob,{pick:['ExifImageWidth','ExifImageHeight','ImageWidth','ImageHeight','Orientation'],translateValues:false,reviveValues:false});
  orientation=Number(exif?.Orientation??1);
  if(!dimensions){const width=Number(exif?.ExifImageWidth??exif?.ImageWidth),height=Number(exif?.ExifImageHeight??exif?.ImageHeight);if(width>0&&height>0)dimensions=[width,height];}
 }catch{/* Non-EXIF photos remain usable. */}
 if(!dimensions&&head.length>=12&&String.fromCharCode(...head.slice(4,8))==='ftyp'){
  // Find bounded HEIF image spatial extents in the metadata box (not media data).
  for(let offset=0,count=0;offset+8<=blob.size&&count<64;count++){
   const header=new Uint8Array(await blob.slice(offset,offset+16).arrayBuffer()),v=new DataView(header.buffer),length=v.getUint32(0),kind=String.fromCharCode(...header.slice(4,8));
   if(length<8)break;
   if(kind==='meta'&&length<=8*1024*1024){
    const meta=new Uint8Array(await blob.slice(offset,offset+length).arrayBuffer()),m=new DataView(meta.buffer);
    for(let i=4;i+16<=meta.length;i++)if(meta[i]===105&&meta[i+1]===115&&meta[i+2]===112&&meta[i+3]===101&&m.getUint32(i-4)>=20){
     const w=m.getUint32(i+8),h=m.getUint32(i+12);if(w&&h&&(!dimensions||w*h>dimensions[0]*dimensions[1]))dimensions=[w,h];
    }
    break;
   }offset+=length;
  }
 }
 if(dimensions){validatePhotoSize(...dimensions);if(orientation>=5&&orientation<=8)dimensions=[dimensions[1],dimensions[0]];}
 return dimensions;
}
