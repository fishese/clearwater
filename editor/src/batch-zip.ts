/** Stored ZIP entries avoid recompressing JPEG/PNG data and retain Blob backing
 * storage without copying entire photos into JS arrays. ZIP64 is not supported. */
const MAX_U32=0xffffffff;
const encoder=new TextEncoder();
function header(size:number):{bytes:Uint8Array<ArrayBuffer>;view:DataView}{const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};}
function crcChunk(crc:number,bytes:Uint8Array):number {
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return crc>>>0;
}
function abortIfNeeded(signal?:AbortSignal){if(signal?.aborted)throw new DOMException('Batch cancelled.','AbortError');}
type Entry={name:Uint8Array<ArrayBuffer>;crc:number;size:number;offset:number};

export class BatchZip {
  private entries:Entry[]=[];
  private parts:BlobPart[]=[];
  private names=new Set<string>();
  private offset=0;
  private finalized=false;
  constructor(private readonly maxBytes:number){if(!Number.isSafeInteger(maxBytes)||maxBytes<22||maxBytes>MAX_U32)throw new Error('Invalid ZIP size limit.');}
  async add(name:string,blob:Blob,signal?:AbortSignal):Promise<void> {
    abortIfNeeded(signal);
    if(this.finalized)throw new Error('The ZIP is already finished.');
    if(!name||name==='.'||name==='..'||/[\\/\u0000-\u001f\u007f]/.test(name))throw new Error('Invalid ZIP filename.');
    if(this.names.has(name))throw new Error('Duplicate ZIP filename.');
    if(this.entries.length>=65535)throw new Error('Too many files for one ZIP.');
    const encoded=encoder.encode(name);
    if(encoded.byteLength>65535||blob.size>MAX_U32)throw new Error('A file is too large for this ZIP.');
    // Include central-directory entries and the end record in the limit.
    const directorySize=this.entries.reduce((total,entry)=>total+46+entry.name.length,0)+46+encoded.length+22;
    if(this.offset+30+encoded.length+blob.size+directorySize>this.maxBytes)throw new Error('The ZIP exceeds the batch size limit.');
    let crc=0xffffffff;
    for(let offset=0;offset<blob.size;offset+=1024*1024){abortIfNeeded(signal);crc=crcChunk(crc,new Uint8Array(await blob.slice(offset,offset+1024*1024).arrayBuffer()));}
    abortIfNeeded(signal);crc=(crc^0xffffffff)>>>0;
    const local=header(30);
    local.view.setUint32(0,0x04034b50,true);local.view.setUint16(4,20,true);local.view.setUint16(6,0x0800,true);local.view.setUint16(12,0x21,true);
    local.view.setUint32(14,crc,true);local.view.setUint32(18,blob.size,true);local.view.setUint32(22,blob.size,true);local.view.setUint16(26,encoded.length,true);
    this.entries.push({name:encoded,crc,size:blob.size,offset:this.offset});
    this.parts.push(local.bytes,encoded,blob);this.names.add(name);this.offset+=30+encoded.length+blob.size;
  }
  finish():Blob {
    if(this.finalized)throw new Error('The ZIP is already finished.');
    if(!this.entries.length)throw new Error('There are no photos to save.');
    const centralOffset=this.offset;let centralSize=0;
    for(const entry of this.entries){
      const central=header(46);central.view.setUint32(0,0x02014b50,true);central.view.setUint16(4,20,true);central.view.setUint16(6,20,true);central.view.setUint16(8,0x0800,true);central.view.setUint16(14,0x21,true);
      central.view.setUint32(16,entry.crc,true);central.view.setUint32(20,entry.size,true);central.view.setUint32(24,entry.size,true);central.view.setUint16(28,entry.name.length,true);central.view.setUint32(42,entry.offset,true);
      this.parts.push(central.bytes,entry.name);centralSize+=46+entry.name.length;
    }
    const end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,this.entries.length,true);end.view.setUint16(10,this.entries.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,centralOffset,true);
    this.parts.push(end.bytes);this.finalized=true;
    const result=new Blob(this.parts,{type:'application/zip'});this.parts=[];this.entries=[];this.names.clear();return result;
  }
}

/** Avoid duplicate names without changing existing files or earlier entries. */
export function uniqueBatchName(name:string,used:Set<string>):string {
  const dot=name.lastIndexOf('.'),rawStem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';
  // Leave space for collision suffixes on iOS and common 255-byte filesystems.
  let stem='';for(const character of rawStem){if(encoder.encode(stem+character+ext).length>200)break;stem+=character;}
  stem=stem||'photo';
  for(let i=0;i<10000;i++){const candidate=i===0?`${stem}${ext}`:`${stem} (${i})${ext}`,key=candidate.toLocaleLowerCase('en-US');if(!used.has(key)){used.add(key);return candidate;}}
  throw new Error('Too many files with the same name.');
}
