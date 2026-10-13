import {beforeEach,describe,expect,it,vi} from 'vitest';
const bridge=vi.hoisted(()=>({chooseFolder:vi.fn(),listPhotos:vi.fn(),stat:vi.fn(),create:vi.fn(),beginWrite:vi.fn(),writeChunk:vi.fn(),finishWrite:vi.fn(),drainShares:vi.fn(),releaseShare:vi.fn(),addListener:vi.fn(),getRememberedModel:vi.fn(),beginModelWrite:vi.fn(),writeModelChunk:vi.fn(),finishModelWrite:vi.fn(),readModelChunk:vi.fn(),clearRememberedModelFile:vi.fn(),forgetRememberedModel:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android',convertFileSrc:(value:string)=>value},registerPlugin:()=>bridge}));
import {chooseAndroidFolder,openAndroidPhotoFolder,readAndroidFolderPhoto,receiveAndroidPhotos,readRememberedAndroidModel,saveRememberedAndroidModel} from '../src/native';
import {writeFile} from '../src/file-save';

describe('Android file bridge',()=>{
 beforeEach(()=>{vi.resetAllMocks();bridge.chooseFolder.mockResolvedValue({uri:'content://folder',name:'Output'});bridge.create.mockResolvedValue({uri:'content://new',name:'photo.jpg'});bridge.beginWrite.mockResolvedValue({id:'write-1'});bridge.beginModelWrite.mockResolvedValue({id:'model-1'});bridge.finishModelWrite.mockResolvedValue(undefined);});
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
  try{const folder=await openAndroidPhotoFolder();expect(folder.photos.map(photo=>photo.name)).toEqual(['IMG2.JPG','IMG10.JPG','large.png']);expect(fetch).not.toHaveBeenCalled();expect(folder.directory.name).toBe('Output');}finally{fetch.mockRestore();}
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
 it('releases temporary shared files even when reading them fails',async()=>{
  bridge.addListener.mockResolvedValue({remove:vi.fn()});
  bridge.drainShares.mockResolvedValue({photos:[{id:'share-1',path:'/cache/share-1',name:'shared.jpg',type:'image/jpeg'}]});
  bridge.releaseShare.mockResolvedValue(undefined);
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('',{status:404}));
  const onFiles=vi.fn(),onError=vi.fn();
  try{
   await receiveAndroidPhotos(onFiles,onError);
   expect(onFiles).not.toHaveBeenCalled();expect(onError).toHaveBeenCalledOnce();
   expect(bridge.releaseShare).toHaveBeenCalledWith({id:'share-1'});
  }finally{fetch.mockRestore();}
 });
 it('streams a validated custom model into private native storage in bounded chunks',async()=>{
  const bytes=Uint8Array.from({length:700000},(_,i)=>i%251),blob=new Blob([bytes]);
  const config={sha256:'a'.repeat(64),name:'user.onnx',inputRange:'signed' as const,outputRange:'unit' as const};
  await saveRememberedAndroidModel(blob,config);
  expect(bridge.beginModelWrite).toHaveBeenCalledWith({size:blob.size});
  expect(bridge.writeModelChunk).toHaveBeenCalledTimes(3);
  const saved=Buffer.concat(bridge.writeModelChunk.mock.calls.map(([chunk])=>Buffer.from(chunk.data,'base64')));
  expect(saved.equals(Buffer.from(bytes))).toBe(true);
  expect(bridge.finishModelWrite).toHaveBeenCalledWith({id:'model-1',abort:false,config});
 });
 it('aborts native persistence when a model chunk fails, leaving the previous slot untouched',async()=>{
  bridge.writeModelChunk.mockRejectedValueOnce(new Error('Storage full'));
  const config={sha256:'a'.repeat(64),name:'user.onnx',inputRange:'unit' as const,outputRange:'signed' as const};
  await expect(saveRememberedAndroidModel(new Blob([new Uint8Array(300000)]),config)).rejects.toThrow('Storage full');
  expect(bridge.finishModelWrite).toHaveBeenCalledWith({id:'model-1',abort:true});
 });
 it('keeps remembered ranges when the native model file is missing or unreadable',async()=>{
  const config={sha256:'b'.repeat(64),name:'remembered.onnx',inputRange:'signed' as const,outputRange:'signed' as const};
  bridge.getRememberedModel.mockResolvedValue({present:true,hasFile:false,size:7,config});
  await expect(readRememberedAndroidModel()).resolves.toEqual({config,blob:null});
  bridge.getRememberedModel.mockResolvedValue({present:true,hasFile:true,size:3,config});
  bridge.readModelChunk.mockRejectedValue(new Error('Read failed'));
  await expect(readRememberedAndroidModel()).resolves.toEqual({config,blob:null});
 });
});
