import {describe,it,expect} from 'vitest';
import {photoInfo,fitPhoto,validatePhotoSize,PHOTO_RECOMMENDED_BYTES} from '../src/core/photo-size';
import {isRaw,supportedMedia,mediaLimit} from '../src/core/media';
import {photoHeader} from '../src/photo-header';
describe('photo resource policy',()=>{
 it('leaves ordinary images full size without a large-photo notice even on modest phones',()=>{
  for(const [w,h] of [[4000,3000],[6000,4000],[7500,6000]]){
   const info=photoInfo(w,h,PHOTO_RECOMMENDED_BYTES,false,'auto',{mobile:true,memory:2});
   expect(info.large).toBe(false);expect([info.exportWidth,info.exportHeight]).toEqual([w,h]);
  }
 });
 it('accepts 48 MP, chooses conservative phone Auto, and allows an explicit full-size attempt',()=>{
  const auto=photoInfo(8000,6000,70*1024*1024,false,'auto',{mobile:true,memory:4});expect(auto.large).toBe(true);expect(auto.exportWidth*auto.exportHeight).toBeLessThanOrEqual(24_000_000);
  const full=photoInfo(8000,6000,70*1024*1024,false,'full',{mobile:true,memory:4});expect([full.exportWidth,full.exportHeight]).toEqual([8000,6000]);
  expect(photoInfo(8000,6000,1,false,'auto',{mobile:false,memory:8}).exportWidth).toBe(8000);
 });
 it('keeps iOS Auto at 24 MP while Full and desktop Auto can stay larger',()=>{
  const ios=photoInfo(6000,5000,1024,false,'auto',{mobile:true,memory:6},'ios-safari');
  expect(ios.exportWidth*ios.exportHeight).toBeLessThanOrEqual(24_000_000);
  expect(ios.exportWidth).toBeLessThan(6000);
  expect(photoInfo(6000,5000,1024,false,'full',{mobile:true,memory:6},'ios-app')).toMatchObject({exportWidth:6000,exportHeight:5000});
  expect(photoInfo(4000,3000,1024,false,'auto',{mobile:true},'ios-app')).toMatchObject({exportWidth:4000,exportHeight:3000});
  expect(photoInfo(6000,5000,1024,false,'auto',{mobile:false,memory:8},'desktop')).toMatchObject({exportWidth:6000,exportHeight:5000});
  expect(photoInfo(6000,5000,1024,false,'auto',{mobile:true,memory:4},'android-apk').exportWidth).toBe(6000);
 });
 it('does not shrink a 12 MP image just because its file exceeds 60 MB; RAW half-size never upscales',()=>{
  expect(photoInfo(4000,3000,80*1024*1024,true,'auto',{mobile:true}).exportWidth).toBe(4000);
  const raw=photoInfo(8000,6000,80*1024*1024,true,'auto',{mobile:true});expect([raw.exportWidth,raw.exportHeight]).toEqual([4000,3000]);
  expect(fitPhoto(1600,1200,12_000_000)).toEqual([1600,1200]);
 });
 it('accepts supported DNG MIME types and rejects absurd dimensions before pixel decoding',async()=>{
  expect(isRaw({name:'photo.DNG'})).toBe(true);expect(supportedMedia({name:'photo',type:'image/x-adobe-dng'})).toBe(true);expect(mediaLimit({name:'large.dng'})).toBe(512*1024*1024);
  expect(()=>validatePhotoSize(20001,10000)).toThrow('200.1 MP');expect(()=>validatePhotoSize(40000,1)).toThrow('32768 px');
  const head=new Uint8Array(33),v=new DataView(head.buffer);head.set([137,80,78,71]);v.setUint32(16,20001);v.setUint32(20,10000);
  await expect(photoHeader(new Blob([head]))).rejects.toThrow('200.1 MP');
 });
});
