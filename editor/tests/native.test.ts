import {beforeEach,describe,expect,it,vi} from 'vitest';
const bridge=vi.hoisted(()=>({chooseFolder:vi.fn(),listPhotos:vi.fn(),stat:vi.fn(),create:vi.fn(),createCapture:vi.fn(),copyCameraCapture:vi.fn(),beginWrite:vi.fn(),writeChunk:vi.fn(),finishWrite:vi.fn(),drainShares:vi.fn(),releaseShare:vi.fn(),addListener:vi.fn(),getRememberedModel:vi.fn(),beginModelWrite:vi.fn(),writeModelChunk:vi.fn(),finishModelWrite:vi.fn(),readModelChunk:vi.fn(),clearRememberedModelFile:vi.fn(),forgetRememberedModel:vi.fn()}));
const hdrBridge=vi.hoisted(()=>({beginHdrInput:vi.fn(),writeHdrInputChunk:vi.fn(),finishHdrInput:vi.fn(),convertHdrToSdr:vi.fn(),cancelHdrConversion:vi.fn(),deleteHdrWorkingCopy:vi.fn(),addListener:vi.fn()}));
const backBridge=vi.hoisted(()=>({setEnabled:vi.fn(),exitApp:vi.fn(),addListener:vi.fn(),remove:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android',convertFileSrc:(value:string)=>value},registerPlugin:(name:string)=>name==='ClearWaterHdr'?hdrBridge:name==='ClearWaterBack'?backBridge:bridge}));
import {chooseAndroidFolder,openAndroidPhotoFolder,readAndroidFolderPhoto,receiveAndroidPhotos,readRememberedAndroidModel,saveRememberedAndroidModel,createAndroidHdrWorkingCopy,cancelAndroidHdrWorkingCopy,listenForAndroidBack,exitAndroidApp,saveAndroidCameraCapture} from '../src/native';
import {convertHdrImportRequest} from '../src/hdr-import';
import {writeFile} from '../src/file-save';

describe('Android file bridge',()=>{
 beforeEach(()=>{vi.resetAllMocks();bridge.chooseFolder.mockResolvedValue({uri:'content://folder',name:'Output'});bridge.create.mockResolvedValue({uri:'content://new',name:'photo.jpg'});bridge.createCapture.mockResolvedValue({uri:'content://media/video/42',name:'ClearWater_video.mp4',destination:'Movies/ClearWater/ClearWater_video.mp4'});bridge.copyCameraCapture.mockResolvedValue(undefined);bridge.beginWrite.mockResolvedValue({id:'write-1'});bridge.beginModelWrite.mockResolvedValue({id:'model-1'});bridge.finishModelWrite.mockResolvedValue(undefined);hdrBridge.beginHdrInput.mockResolvedValue({id:'hdr-1'});hdrBridge.writeHdrInputChunk.mockResolvedValue(undefined);hdrBridge.finishHdrInput.mockResolvedValue(undefined);hdrBridge.convertHdrToSdr.mockResolvedValue({id:'hdr-1',uri:'file:///cache/sdr-working-copy.mp4'});hdrBridge.cancelHdrConversion.mockResolvedValue(undefined);hdrBridge.deleteHdrWorkingCopy.mockResolvedValue(undefined);hdrBridge.addListener.mockResolvedValue({remove:vi.fn().mockResolvedValue(undefined)});backBridge.setEnabled.mockResolvedValue(undefined);backBridge.remove.mockResolvedValue(undefined);backBridge.addListener.mockResolvedValue({remove:backBridge.remove});});
 it('copies an owned native video directly without uploading its bytes through JavaScript',async()=>{
  const file=new File(['archived source'],'clearwater-camera-01234567-89ab-4cde-8f01-23456789abcd.mp4',{type:'video/mp4'});
  const saved=await saveAndroidCameraCapture(file,'file:///cache/camera-captures/clearwater-camera-01234567-89ab-4cde-8f01-23456789abcd.mp4');
  expect(saved.uri).toBe('content://media/video/42');
  expect(bridge.createCapture).toHaveBeenCalledWith({name:expect.stringMatching(/^ClearWater_.*\.mp4$/),type:'video/mp4'});
  expect(bridge.copyCameraCapture).toHaveBeenCalledWith({sourceUri:'file:///cache/camera-captures/clearwater-camera-01234567-89ab-4cde-8f01-23456789abcd.mp4',uri:'content://media/video/42'});
  expect(bridge.beginWrite).not.toHaveBeenCalled();expect(bridge.writeChunk).not.toHaveBeenCalled();
 });
 it('propagates native copy failure without falling back to a JavaScript upload',async()=>{
  bridge.copyCameraCapture.mockRejectedValueOnce(new Error('Gallery full'));
  await expect(saveAndroidCameraCapture(new File(['video'],'camera.mp4',{type:'video/mp4'}),'file:///cache/camera-captures/camera.mp4')).rejects.toThrow('Gallery full');
  expect(bridge.beginWrite).not.toHaveBeenCalled();expect(bridge.writeChunk).not.toHaveBeenCalled();
 });
 it('enables the native Back callback while subscribed and disables it on cleanup',async()=>{
  const onBack=vi.fn(),dispose=listenForAndroidBack(onBack);await vi.waitFor(()=>expect(backBridge.setEnabled).toHaveBeenCalledWith({enabled:true}));
  const [,listener]=backBridge.addListener.mock.calls[0];listener();expect(onBack).toHaveBeenCalledOnce();dispose();
  await vi.waitFor(()=>expect(backBridge.setEnabled).toHaveBeenLastCalledWith({enabled:false}));expect(backBridge.remove).toHaveBeenCalledOnce();
 });
 it('forwards an intentional root exit to the native activity',async()=>{await exitAndroidApp();expect(backBridge.exitApp).toHaveBeenCalledOnce();});
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
 it('streams HDR source bytes in bounded chunks and returns a generated SDR working-copy name',async()=>{
  const sourceBytes=Uint8Array.from({length:700000},(_,i)=>i%251),source=new File([sourceBytes],'IMG_0421.MOV',{type:'video/quicktime'}),fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new Blob(['sdr-video'],{type:'video/mp4'})));
  try{
   const progress:number[]=[],copy=await convertHdrImportRequest(source,()=>true,value=>progress.push(value),()=>{});
   if(!copy)throw new Error('The current HDR request should return its converted copy.');
   expect(hdrBridge.beginHdrInput).toHaveBeenCalledWith({name:'IMG_0421.MOV',size:source.size});expect(hdrBridge.writeHdrInputChunk).toHaveBeenCalledTimes(3);
   const restored=Buffer.concat(hdrBridge.writeHdrInputChunk.mock.calls.map(([chunk])=>Buffer.from(chunk.data,'base64')));expect(restored.equals(Buffer.from(sourceBytes))).toBe(true);
   expect(hdrBridge.finishHdrInput).toHaveBeenCalledWith({id:'hdr-1',abort:false});expect(copy.file.name).toBe('hdr-working-copy.mp4');expect(copy.file.name).not.toBe(source.name);
   expect(hdrBridge.deleteHdrWorkingCopy).toHaveBeenCalledWith({id:'hdr-1'});expect(progress.some(value=>value>0)).toBe(true);
  }finally{fetch.mockRestore();}
 });
 it('aborts the staged source when conversion is cancelled during chunked input',async()=>{
  const source=new File([new Uint8Array(400000)],'capture.mov',{type:'video/quicktime'});
  await expect(createAndroidHdrWorkingCopy(source,()=>{},id=>{void cancelAndroidHdrWorkingCopy(id);})).rejects.toMatchObject({name:'AbortError'});
  expect(hdrBridge.finishHdrInput).toHaveBeenCalledWith({id:'hdr-1',abort:true});expect(hdrBridge.convertHdrToSdr).not.toHaveBeenCalled();
 });
 it('discards a converted working copy when its originating photo is no longer current',async()=>{
  const source=new File(['original'],'capture.mov',{type:'video/quicktime'});let current=true,complete:(value:{id:string;uri:string})=>void=()=>{};
  hdrBridge.convertHdrToSdr.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  const pending=convertHdrImportRequest(source,()=>current,()=>{},()=>{});
  await vi.waitFor(()=>expect(hdrBridge.convertHdrToSdr).toHaveBeenCalledOnce());current=false;complete({id:'hdr-1',uri:'file:///cache/sdr-working-copy.mp4'});
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new Blob(['sdr'])));
  try{await expect(pending).resolves.toBeNull();expect(hdrBridge.deleteHdrWorkingCopy).toHaveBeenCalledWith({id:'hdr-1'});}finally{fetch.mockRestore();}
 });
});
