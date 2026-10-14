import {describe,expect,it} from 'vitest';
import {platformCapabilities} from './capabilities';

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
});
