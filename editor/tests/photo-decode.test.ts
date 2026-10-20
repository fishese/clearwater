import {afterEach,describe,expect,it,vi} from 'vitest';
import {decodePhoto} from '../src/photo-decode';

vi.mock('../src/core/media',()=>({isRaw:()=>false}));
vi.mock('../src/photo-header',()=>({photoHeader:vi.fn(async()=>[2,2])}));

describe('photo decode cancellation',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it('closes a JPG bitmap that finishes decoding after its photo was switched away',async()=>{
  let release:(bitmap:ImageBitmap)=>void=()=>{},started:()=>void=()=>{};
  const bitmapStarted=new Promise<void>(resolve=>{started=resolve;});
  const decoded={width:2,height:2,close:vi.fn()} as unknown as ImageBitmap;
  vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise<ImageBitmap>(resolve=>{release=resolve;started();})));
  const controller=new AbortController(),blob=Object.assign(new Blob(['jpg'],{type:'image/jpeg'}),{name:'photo.jpg'}) as File;
  const decoding=decodePhoto(blob,{mode:'auto',device:{mobile:false},preview:true,platform:'android-apk',signal:controller.signal,onInfo:()=>{}});
  await bitmapStarted;controller.abort();release(decoded);
  await expect(decoding).rejects.toMatchObject({name:'AbortError'});
  expect(decoded.close).toHaveBeenCalledOnce();
 });
});
