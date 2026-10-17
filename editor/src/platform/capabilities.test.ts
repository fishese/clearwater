import {describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({platform:'ios',hasExport:true,hasCamera:true}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=>state.platform,isNativePlatform:()=>state.platform==='ios'||state.platform==='android',isPluginAvailable:(name:string)=>name==='ClearWaterExport'?state.hasExport:name==='ClearWaterCamera'?state.hasCamera:false}}));
import {getPlatformCapabilities,platformCapabilities} from './capabilities';

describe('platform capabilities',()=>{
 it('keeps browser stream camera and web updates on the web',()=>{
  expect(platformCapabilities('web')).toMatchObject({nativeShell:false,nativeCamera:false,webStreamCamera:true,androidLinkedCapture:false,androidHdrConversion:false,webServiceWorkerUpdates:true,bundledModels:false});
 });
 it('keeps Android-only capture and HDR capabilities on Android',()=>{
  expect(platformCapabilities('android')).toMatchObject({nativeShell:true,webStreamCamera:true,androidLinkedCapture:true,androidHdrConversion:true,webServiceWorkerUpdates:false,bundledModels:true});
 });
 it('does not expose the web stream camera, web updates, or Android features on iOS',()=>{
  expect(platformCapabilities('ios',true)).toMatchObject({nativeShell:true,nativeCamera:false,webStreamCamera:false,nativeMediaSave:false,androidLinkedCapture:false,androidHdrConversion:false,webServiceWorkerUpdates:false,bundledModels:true});
 });
 it('reports native media saving only when its iOS plugin is available',()=>{
  expect(platformCapabilities('ios',true,true).nativeMediaSave).toBe(true);
  expect(platformCapabilities('android',true,true).nativeMediaSave).toBe(false);
 });
 it('allows native iOS video preview when H.264 encoding is unavailable',()=>{
  vi.stubGlobal('VideoDecoder',function VideoDecoder(){});vi.stubGlobal('OffscreenCanvas',function OffscreenCanvas(){});vi.stubGlobal('VideoEncoder',undefined);
  state.platform='ios';state.hasExport=true;
  expect(getPlatformCapabilities()).toMatchObject({videoEditing:true,videoExport:false,nativeMediaSave:true});
  vi.unstubAllGlobals();
 });
});
