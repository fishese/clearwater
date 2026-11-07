import {describe,it,expect} from 'vitest';
import {BatchZip,uniqueBatchName} from './batch-zip';

describe('batch ZIP',()=>{
  it('writes stored UTF-8 entries with standard CRC and central-directory offsets',async()=>{
    const zip=new BatchZip(10000);await zip.add('相片.jpg',new Blob(['123456789']));await zip.add('two.png',new Blob(['second']));
    const result=zip.finish(),bytes=new Uint8Array(await result.arrayBuffer()),view=new DataView(bytes.buffer);
    expect(result.type).toBe('application/zip');
    expect(view.getUint32(0,true)).toBe(0x04034b50);
    expect(view.getUint16(6,true)&0x0800).toBeTruthy();
    expect(view.getUint32(14,true)).toBe(0xcbf43926); // CRC-32 test vector.
    expect(view.getUint32(bytes.length-22,true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length-12,true)).toBe(2);
    const directory=view.getUint32(bytes.length-6,true);
    expect(view.getUint32(directory,true)).toBe(0x02014b50);
    expect(view.getUint32(directory+42,true)).toBe(0);
  });
  it('rejects unsafe or duplicate names and respects the actual ZIP size limit',async()=>{
    const zip=new BatchZip(130);
    await expect(zip.add('../outside.jpg',new Blob(['x']))).rejects.toThrow('Invalid ZIP filename');
    await zip.add('a',new Blob(['x']));
    await expect(zip.add('a',new Blob(['x']))).rejects.toThrow('Duplicate');
    await expect(zip.add('b',new Blob(['x']))).rejects.toThrow('size limit');
  });
  it('preserves prior entries if an addition is cancelled',async()=>{
    const zip=new BatchZip(10000);await zip.add('a.jpg',new Blob(['first']));
    const abort=new AbortController();abort.abort();
    await expect(zip.add('b.jpg',new Blob(['second']),abort.signal)).rejects.toMatchObject({name:'AbortError'});
    expect((await zip.finish().arrayBuffer()).byteLength).toBeGreaterThan(22);
  });
  it('creates case-insensitively unique filenames',()=>{
    const used=new Set<string>();expect(uniqueBatchName('Fish.jpg',used)).toBe('Fish.jpg');expect(uniqueBatchName('fish.jpg',used)).toBe('fish (1).jpg');
  });
});
