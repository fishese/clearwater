import {describe,it,expect,vi} from 'vitest';
import {restoredName,createUniqueFile,writeFile,type LocalDirectoryHandle} from '../src/file-save';
describe('local exports',()=>{
  it('names restored copies using the original stem and selected output format',()=>{
    expect(restoredName('dive.photo.HEIC','jpg')).toBe('dive.photo-restore.jpg');
    expect(restoredName('dive.JPG','png')).toBe('dive-restore.png');
    expect(restoredName('bad/name?.png','jpg')).toBe('bad_name_-restore.jpg');
    expect(restoredName('dive.photo.HEIC','jpg',false)).toBe('dive.photo.jpg');
  });
  it('keeps existing folder files and finds a fresh numbered name',async()=>{
    const existing=new Set(['dive-restore.jpg','dive-restore (1).jpg']);
    const handle={createWritable:vi.fn()};
    const folder:LocalDirectoryHandle={name:'output',getFileHandle:vi.fn(async(name,options)=>{
      if(options?.create){existing.add(name);return handle;}
      if(existing.has(name))return handle;
      throw new DOMException('Missing','NotFoundError');
    })};
    expect((await createUniqueFile(folder,'dive-restore.jpg')).name).toBe('dive-restore (2).jpg');
    expect(existing.size).toBe(3);
  });
  it('does not treat permission failures as missing files',async()=>{
    const getFileHandle=vi.fn(async()=>{throw new DOMException('Denied','NotAllowedError');});
    await expect(createUniqueFile({name:'output',getFileHandle},'dive-restore.jpg')).rejects.toThrow('Denied');
    expect(getFileHandle).toHaveBeenCalledTimes(1);
  });
  it('aborts a failed write instead of committing partial bytes',async()=>{
    const stream={write:vi.fn(async()=>{throw new Error('Disk full');}),close:vi.fn(),abort:vi.fn(async()=>{})};
    await expect(writeFile({createWritable:async()=>stream},new Blob(['photo']))).rejects.toThrow('Disk full');
    expect(stream.abort).toHaveBeenCalledOnce();expect(stream.close).not.toHaveBeenCalled();
  });
});
