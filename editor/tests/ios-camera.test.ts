import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';

const state=vi.hoisted(()=>({platform:'ios',available:true,camera:{
 open:vi.fn(),listCaptures:vi.fn(),drainCaptures:vi.fn(),getCapture:vi.fn(),acknowledgeCapture:vi.fn(),setCaptureRecipe:vi.fn(),setCaptureVisible:vi.fn(),deleteCapture:vi.fn(),saveCaptureToPhotos:vi.fn(),shareCapture:vi.fn(),addListener:vi.fn()
}}));
vi.mock('@capacitor/core',()=>({
 Capacitor:{getPlatform:()=>state.platform,isPluginAvailable:()=>state.available,convertFileSrc:(url:string)=>`capacitor:${url}`},
 registerPlugin:()=>state.camera
}));
import {drainIOSCaptures,isIOSCameraAvailable,listIOSCaptures,readIOSCaptureFile,toIOSStoredPhotos,type IOSCaptureDescriptor} from '../src/platform/ios-camera';

const descriptor=(overrides:Record<string,unknown>={}):IOSCaptureDescriptor=>({schemaVersion:1,id:'8e412a77-8448-4f80-9041-9775d4eff00b',kind:'photo',name:'ClearWater_capture.jpg',type:'image/jpeg',sourceUrl:'file:///private/captures/original.jpg',thumbnailUrl:'file:///private/captures/thumbnail.jpg',enhancedUrl:'file:///private/captures/enhanced.jpg',width:10,height:10,bytes:4,addedAt:123,recipeVersion:1,recipe:{},visible:true,pending:false,photosSaved:false,...overrides} as IOSCaptureDescriptor);

describe('iOS private capture adapter',()=>{
 beforeEach(()=>{
  vi.resetAllMocks();state.platform='ios';state.available=true;
  state.camera.listCaptures.mockResolvedValue({captures:[descriptor(),descriptor({schemaVersion:2}),descriptor({sourceUrl:'http://example.invalid/file'})]});
  state.camera.drainCaptures.mockResolvedValue({captures:[descriptor({pending:true})]});
 });

 it('requires the registered iOS camera plugin and filters malformed descriptors',async()=>{
  expect(isIOSCameraAvailable()).toBe(true);
  expect(await listIOSCaptures()).toHaveLength(1);
  state.available=false;expect(isIOSCameraAvailable()).toBe(false);
  await expect(drainIOSCaptures()).rejects.toThrow('unavailable');
 });

 it('resolves the selected source by ID again before reading its private file',async()=>{
  const stale=descriptor({sourceUrl:'file:///untrusted/stale.jpg'});
  state.camera.getCapture.mockResolvedValue({capture:descriptor({sourceUrl:'file:///private/captures/current.jpg',name:'current.jpg'})});
  const fetchMock=vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['safe'])});
  vi.stubGlobal('fetch',fetchMock);
  const file=await readIOSCaptureFile(stale);
  expect(state.camera.getCapture).toHaveBeenCalledWith({id:stale.id});
  expect(fetchMock).toHaveBeenCalledWith('capacitor:file:///private/captures/current.jpg',{signal:undefined});
  expect(file.name).toBe('current.jpg');
  expect(await file.text()).toBe('safe');
  vi.unstubAllGlobals();
 });

 it('does not fetch a capture hidden after its descriptor was listed',async()=>{
  const listed=descriptor();state.camera.getCapture.mockResolvedValue({capture:descriptor({visible:false})});
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  await expect(readIOSCaptureFile(listed)).rejects.toThrow('no longer available');
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
 });

 it('lists only bounded thumbnail data and does not fetch the original during library hydration',async()=>{
  const video=descriptor({kind:'video',type:'video/mp4',name:'ClearWater_capture.mp4',sourceUrl:'file:///private/captures/enhanced.mp4',enhancedUrl:undefined,bytes:100_000_000});
  state.camera.getCapture.mockResolvedValue({capture:video});
  const fetchMock=vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['thumb'],{type:'image/jpeg'})});
  class FakeReader { result:string|null=null;error:Error|null=null;onload:(()=>void)|null=null;onerror:(()=>void)|null=null;readAsDataURL(){this.result='data:image/jpeg;base64,dGh1bWI=';queueMicrotask(()=>this.onload?.());} }
  vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('FileReader',FakeReader);
  const [photo]=await toIOSStoredPhotos([video]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('capacitor:file:///private/captures/thumbnail.jpg');
  expect(photo.nativeCapture?.loaded).toBe(false);
  expect(photo.file.size).toBe(5);
  vi.unstubAllGlobals();
 });

 it('passes cancellation through to the selected-file fetch',async()=>{
  const current=descriptor();state.camera.getCapture.mockResolvedValue({capture:current});
  const controller=new AbortController();const fetchMock=vi.fn((_url:string,options:{signal?:AbortSignal})=>new Promise((_resolve,reject)=>{const signal=options.signal;if(signal?.aborted){reject(new DOMException('Aborted','AbortError'));return;}signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});}));
  vi.stubGlobal('fetch',fetchMock);
  const promise=readIOSCaptureFile(current,'source',controller.signal);await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalled());controller.abort();
  await expect(promise).rejects.toMatchObject({name:'AbortError'});
  expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  vi.unstubAllGlobals();
 });

 it('checks cancellation before and after fetching fresh native metadata',async()=>{
  const current=descriptor(),controller=new AbortController(),fetchMock=vi.fn();
  vi.stubGlobal('fetch',fetchMock);
  controller.abort();
  await expect(readIOSCaptureFile(current,'source',controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(state.camera.getCapture).not.toHaveBeenCalled();

  const lateController=new AbortController();let resolveCapture:(value:{capture:IOSCaptureDescriptor})=>void=()=>{};
  state.camera.getCapture.mockReturnValueOnce(new Promise(resolve=>{resolveCapture=resolve;}));
  const pending=readIOSCaptureFile(current,'source',lateController.signal);
  await vi.waitFor(()=>expect(state.camera.getCapture).toHaveBeenCalled());
  lateController.abort();resolveCapture({capture:current});
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
 });
});

describe('native camera localization bridge',()=>{
 it('passes every Swift camera string through all three locale catalogs',()=>{
  const native=readFileSync(new URL('../ios/App/App/ClearWaterCameraViewController.swift',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const nativeKeys=[...native.matchAll(/text\("([^"\\]*(?:\\.[^"\\]*)*)"\s*,/g)].map(match=>match[1]);
  const stringsBlock=app.match(/const strings=\[([\s\S]*?)\];/);
  expect(stringsBlock,'launchIOSCamera string catalog').toBeTruthy();
  const bridgeKeys=new Set([...(stringsBlock?.[1].matchAll(/'([^']+)'/g)??[])].map(match=>match[1]));
  const catalogs=['en','zh-HK','ja'].map(locale=>JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`,import.meta.url),'utf8')) as Record<string,string>);
  for(const key of new Set(nativeKeys)){
   expect(bridgeKeys.has(key),`App bridge passes native key: ${key}`).toBe(true);
   for(const [index,catalog] of catalogs.entries())expect(typeof catalog[key]==='string'&&catalog[key].trim().length>0,`${['en','zh-HK','ja'][index]} catalog translates ${key}`).toBe(true);
  }
 });
});
