import {beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({platform:'ios',pluginAvailable:true,exportBridge:{
 beginExport:vi.fn(),writeExportChunk:vi.fn(),finishExport:vi.fn(),shareExport:vi.fn(),discardExport:vi.fn()
}}));
vi.mock('@capacitor/core',()=>({
 Capacitor:{getPlatform:()=>state.platform,isPluginAvailable:()=>state.pluginAvailable},
 registerPlugin:()=>state.exportBridge
}));
import {isIOSPhotoExportAvailable,shareIOSFile} from '../src/platform/ios-media';

describe('iOS native file export',()=>{
 beforeEach(()=>{
  vi.resetAllMocks();state.platform='ios';state.pluginAvailable=true;
  state.exportBridge.beginExport.mockResolvedValue({id:'export-1'});
  state.exportBridge.writeExportChunk.mockResolvedValue(undefined);
  state.exportBridge.finishExport.mockResolvedValue(undefined);
  state.exportBridge.shareExport.mockResolvedValue({completed:true,activityType:'saveToFiles'});
  state.exportBridge.discardExport.mockResolvedValue(undefined);
 });

 it('reports native export only when the iOS plugin is registered',()=>{
  expect(isIOSPhotoExportAvailable()).toBe(true);
  state.pluginAvailable=false;expect(isIOSPhotoExportAvailable()).toBe(false);
  state.platform='web';state.pluginAvailable=true;expect(isIOSPhotoExportAvailable()).toBe(false);
 });

 it('streams exact JPEG bytes in bounded chunks and waits for the share result',async()=>{
  const source=Uint8Array.from({length:700_000},(_,index)=>index%251);
  const result=await shareIOSFile(new Blob([source],{type:'image/jpeg'}),'restored.jpg');
  expect(result).toEqual({completed:true,activityType:'saveToFiles'});
  expect(state.exportBridge.beginExport).toHaveBeenCalledWith({name:'restored.jpg',type:'image/jpeg',size:source.length});
  expect(state.exportBridge.writeExportChunk).toHaveBeenCalledTimes(3);
  const restored=Buffer.concat(state.exportBridge.writeExportChunk.mock.calls.map(([chunk])=>Buffer.from(chunk.data,'base64')));
  expect(restored.equals(Buffer.from(source))).toBe(true);
  expect(state.exportBridge.finishExport).toHaveBeenCalledWith({id:'export-1',abort:false});
  expect(state.exportBridge.shareExport).toHaveBeenCalledWith({id:'export-1'});
  expect(state.exportBridge.discardExport).toHaveBeenCalledWith({id:'export-1'});
 });

 it('preserves cancellation as completed false and cleans the temporary export',async()=>{
  state.exportBridge.shareExport.mockResolvedValue({completed:false});
  await expect(shareIOSFile(new Blob(['{}'],{type:'application/json'}),'clearwater-recipe.json')).resolves.toEqual({completed:false});
  expect(state.exportBridge.discardExport).toHaveBeenCalledWith({id:'export-1'});
 });

 it('infers known original file types when a picked file has no MIME type',async()=>{
  await shareIOSFile(new Blob(['original'],{type:'application/octet-stream'}),'camera-original.mov');
  expect(state.exportBridge.beginExport).toHaveBeenCalledWith({name:'camera-original.mov',type:'video/quicktime',size:8});
 });

 it('aborts partial files when a chunk write fails',async()=>{
  state.exportBridge.writeExportChunk.mockRejectedValueOnce(new Error('Disk full'));
  await expect(shareIOSFile(new Blob(['image'],{type:'image/png'}),'photo.png')).rejects.toThrow('Disk full');
  expect(state.exportBridge.finishExport).toHaveBeenCalledWith({id:'export-1',abort:true});
  expect(state.exportBridge.shareExport).not.toHaveBeenCalled();
  expect(state.exportBridge.discardExport).toHaveBeenCalledWith({id:'export-1'});
 });

 it('rejects unsupported types, empty data and files above the shared 512 MB ceiling',async()=>{
  await expect(shareIOSFile(new Blob(['x'],{type:'text/plain'}),'note.txt')).rejects.toThrow('type cannot be shared');
  await expect(shareIOSFile(new Blob([], {type:'image/jpeg'}),'empty.jpg')).rejects.toThrow('empty');
  const tooLarge={size:512*1024*1024+1,type:'video/mp4'} as Blob;
  await expect(shareIOSFile(tooLarge,'large.mp4')).rejects.toThrow('512 MB');
  expect(state.exportBridge.beginExport).not.toHaveBeenCalled();
 });

 it('does not call native export when the platform or plugin is unavailable',async()=>{
  state.platform='android';
  expect(isIOSPhotoExportAvailable()).toBe(false);
  await expect(shareIOSFile(new Blob(['x'],{type:'image/jpeg'}),'photo.jpg')).rejects.toThrow('available in the iOS app');
  expect(state.exportBridge.beginExport).not.toHaveBeenCalled();
 });
});
