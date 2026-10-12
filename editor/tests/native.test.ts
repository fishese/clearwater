import {beforeEach,describe,expect,it,vi} from 'vitest';
const bridge=vi.hoisted(()=>({chooseFolder:vi.fn(),listPhotos:vi.fn(),stat:vi.fn(),create:vi.fn(),beginWrite:vi.fn(),writeChunk:vi.fn(),finishWrite:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android',convertFileSrc:(value:string)=>value},registerPlugin:()=>bridge}));
import {chooseAndroidFolder,openAndroidPhotoFolder,readAndroidFolderPhoto} from '../src/native';
import {writeFile} from '../src/file-save';

describe('Android file bridge',()=>{
 beforeEach(()=>{vi.resetAllMocks();bridge.chooseFolder.mockResolvedValue({uri:'content://folder',name:'Output'});bridge.create.mockResolvedValue({uri:'content://new',name:'photo.jpg'});bridge.beginWrite.mockResolvedValue({id:'write-1'});});
 it('streams a multi-chunk photo without changing its bytes',async()=>{
  const folder=await chooseAndroidFolder(),handle=await folder.getFileHandle('photo.jpg',{create:true});
  const bytes=Uint8Array.from({length:700000},(_,i)=>i%251);
  await writeFile(handle,new Blob([bytes]));
  expect(bridge.writeChunk).toHaveBeenCalledTimes(3);
  const saved=Buffer.concat(bridge.writeChunk.mock.calls.map(([chunk])=>Buffer.from(chunk.data,'base64')));
  expect(saved.equals(Buffer.from(bytes))).toBe(true);
  expect(bridge.finishWrite).toHaveBeenCalledWith({id:'write-1',abort:false});
 });
 it('aborts the newly created document if a chunk fails',async()=>{
  bridge.writeChunk.mockRejectedValue(new Error('Storage full'));
  const folder=await chooseAndroidFolder(),handle=await folder.getFileHandle('photo.jpg',{create:true});
  await expect(writeFile(handle,new Blob(['photo']))).rejects.toThrow('Storage full');
  expect(bridge.finishWrite).toHaveBeenCalledWith({id:'write-1',abort:true});
 });
 it('lists supported folder photos in natural filename order without reading their contents',async()=>{
  bridge.listPhotos.mockResolvedValue({photos:[{uri:'content://10',name:'IMG10.JPG',size:42,type:'image/jpeg'},{uri:'content://2',name:'IMG2.JPG',size:42,type:'image/jpeg'},{uri:'content://text',name:'notes.txt',size:20,type:'text/plain'},{uri:'content://large',name:'large.png',size:61*1024*1024,type:'image/png'}]});
  const fetch=vi.spyOn(globalThis,'fetch');
  try{const folder=await openAndroidPhotoFolder();expect(folder.photos.map(photo=>photo.name)).toEqual(['IMG2.JPG','IMG10.JPG']);expect(fetch).not.toHaveBeenCalled();expect(folder.directory.name).toBe('Output');}finally{fetch.mockRestore();}
 });
 it('reads only the requested folder photo and reports missing files',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('photo')).mockResolvedValueOnce(new Response('',{status:404}));
  const photo={uri:'content://2',name:'IMG2.JPG',size:5,type:'image/jpeg'};
  try{const file=await readAndroidFolderPhoto(photo);expect(file.name).toBe('IMG2.JPG');expect(await file.text()).toBe('photo');expect(fetch).toHaveBeenCalledTimes(1);await expect(readAndroidFolderPhoto(photo)).rejects.toThrow('moved or deleted');}finally{fetch.mockRestore();}
 });
 it('refuses to open an existing original for writing',async()=>{
  bridge.stat.mockResolvedValue({exists:true,uri:'content://original',name:'original.jpg'});
  const folder=await chooseAndroidFolder(),handle=await folder.getFileHandle('original.jpg');
  await expect(handle.createWritable()).rejects.toThrow('cannot be overwritten');
  expect(bridge.beginWrite).not.toHaveBeenCalled();
 });
});
