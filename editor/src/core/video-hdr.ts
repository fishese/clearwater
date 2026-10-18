/** Wide colour primaries and a 10-bit codec do not, by themselves, mean HDR. */
export function hasHdrTransfer(colorSpace: {primaries?: string | null;transfer?: string | null;matrix?: string | null;fullRange?: boolean | null}): boolean {
 return colorSpace.transfer === 'pq' || colorSpace.transfer === 'hlg'
  || colorSpace.transfer === 'smpte2084' || colorSpace.transfer === 'arib-std-b67';
}

export function isDolbyVisionCodec(codec: string | null | undefined): boolean {
 return /^(?:dvav|dva1|dvhe|dvh1)(?:\.|$)/i.test(codec ?? '');
}

const dolbyVisionConfigBoxes=new Set(['dvcC','dvvC','dvwC']);
const sampleEntryContainers=new Set(['moov','trak','mdia','minf','stbl']);
const visualSampleEntries=new Set(['avc1','avc3','hvc1','hev1','av01','vp09']);

function boxAt(bytes:Uint8Array,offset:number,end:number):{type:string;start:number;end:number}|null{
 if(offset+8>end)return null;
 const view=new DataView(bytes.buffer,bytes.byteOffset+offset,Math.min(16,end-offset));
 let size=view.getUint32(0),headerSize=8;
 if(size===1){if(offset+16>end)return null;size=Number(view.getBigUint64(8));headerSize=16;}
 else if(size===0)size=end-offset;
 if(!Number.isSafeInteger(size)||size<headerSize||offset+size>end)return null;
 return {type:String.fromCharCode(bytes[offset+4],bytes[offset+5],bytes[offset+6],bytes[offset+7]),start:offset+headerSize,end:offset+size};
}

function hasDolbyVisionSampleEntry(bytes:Uint8Array,start:number,end:number,budget:{boxes:number}):boolean{
 if(start+8>end)return false; // stsd version/flags and entry count
 let entry=start+8;
 while(entry<end&&budget.boxes++<4096){
  const sample=boxAt(bytes,entry,end);if(!sample)return false;
  if(isDolbyVisionCodec(sample.type))return true;
  // VisualSampleEntry has 78 bytes before its child configuration boxes.
  if(visualSampleEntries.has(sample.type)&&sample.start+78<=sample.end){
   let child=sample.start+78;
   while(child<sample.end&&budget.boxes++<4096){
    const config=boxAt(bytes,child,sample.end);if(!config)break;
    if(dolbyVisionConfigBoxes.has(config.type))return true;
    child=config.end;
   }
  }
  entry=sample.end;
 }
 return false;
}

function hasDolbyVisionBoxes(bytes:Uint8Array,start:number,end:number,budget:{boxes:number},depth=0):boolean{
 if(depth>8)return false;
 let offset=start;
 while(offset<end&&budget.boxes++<4096){
  const box=boxAt(bytes,offset,end);if(!box)return false;
  if(box.type==='stsd'&&hasDolbyVisionSampleEntry(bytes,box.start,box.end,budget))return true;
  if(sampleEntryContainers.has(box.type)&&hasDolbyVisionBoxes(bytes,box.start,box.end,budget,depth+1))return true;
  offset=box.end;
 }
 return false;
}

/** Mediabunny does not expose Dolby Vision sample-entry boxes, so check the MOV/MP4 moov atom. */
export async function hasDolbyVisionMetadata(blob: Blob): Promise<boolean> {
 let offset=0;
 for(let atoms=0;atoms<4096&&offset+8<=blob.size;atoms++){
  const header=new DataView(await blob.slice(offset,Math.min(offset+16,blob.size)).arrayBuffer());
  let size=header.getUint32(0),headerSize=8;
  const type=String.fromCharCode(...new Uint8Array(header.buffer,4,4));
  if(size===1){if(header.byteLength<16)return false;size=Number(header.getBigUint64(8));headerSize=16;}
  else if(size===0)size=blob.size-offset;
  if(!Number.isSafeInteger(size)||size<headerSize||offset+size>blob.size)return false;
  if(type==='moov'){
   // A moov atom is normally small; cap this read to keep import memory bounded.
   if(size>64*1024*1024)return false;
   const bytes=new Uint8Array(await blob.slice(offset+headerSize,offset+size).arrayBuffer());
   return hasDolbyVisionBoxes(bytes,0,bytes.length,{boxes:0});
  }
  offset+=size;
 }
 return false;
}
