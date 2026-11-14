import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript(()=>{
  const saved=JSON.parse(sessionStorage.getItem('linked-camera-gallery')||'null');
  window.androidBridge={};window.gallery=saved?.gallery??{};window.galleryWrites={};window.sourceStates=saved?.sourceStates??{};window.galleryDeletes=[];window.nextGallery=saved?.nextGallery??0;
  const methods=['createCapture','beginWrite','beginCameraUpdate','writeChunk','finishWrite','deleteCameraCapture','probeAndroidSources','drainShares','getRememberedModel','releaseShare','setEnabled','exitApp','removeListener'];
  window.Capacitor={PluginHeaders:['ClearWaterFiles','ClearWaterBack'].map(name=>({name,methods:[...methods.map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'}]})),nativeCallback:()=>Promise.resolve('listener'),nativePromise:async(plugin,method,o={})=>{
   if(method==='getRememberedModel')return {present:false,hasFile:false};if(method==='drainShares')return {photos:[]};
   if(method==='createCapture'){const uri='content://media/'+(++window.nextGallery);window.gallery[uri]={name:o.name,bytes:[]};window.sourceStates[uri]='present';return {uri,name:o.name,destination:'Pictures/ClearWater/'+o.name};}
   if(method==='beginWrite'||method==='beginCameraUpdate'){if(method==='beginCameraUpdate'&&window.failNextGalleryUpdate){window.failNextGalleryUpdate=false;throw new Error('Injected gallery write failure');}const id='write-'+crypto.randomUUID();window.galleryWrites[id]={uri:o.uri,chunks:[]};return {id};}
   if(method==='writeChunk'){window.galleryWrites[o.id].chunks.push(o.data);return {};}
   if(method==='finishWrite'){const w=window.galleryWrites[o.id];if(!o.abort)window.gallery[w.uri].bytes=w.chunks.flatMap(s=>Array.from(atob(s),c=>c.charCodeAt(0)));delete window.galleryWrites[o.id];return {};}
   if(method==='probeAndroidSources')return {states:Object.fromEntries(o.uris.map(uri=>[uri,window.sourceStates[uri]??'unavailable']))};
   if(method==='deleteCameraCapture'){window.galleryDeletes.push(o.uri);delete window.gallery[o.uri];window.sourceStates[o.uri]='missing';return {};}
   return {};
  }};
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Dev-server-only negative control: recreate the old captured-render branches
 // in the served module without changing the working tree.
 if(process.env.CHECK_STALE_GALLERY==='1')await page.route('**/src/App.tsx',async route=>{
  const response=await route.fetch(),source=await response.text(),pattern=/target\.kind === "video"/g;
  assert.equal([...source.matchAll(pattern)].length,2,'Both gallery media-kind branches intercepted');
  await route.fulfill({response,body:source.replace(pattern,'video')});
 });
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:4176/');
 const bundle=await build({stdin:{contents: `export {savePhoto} from './src/storage';export {cameraThumbnail} from './src/core/camera-photo';export {Output,BufferTarget,Mp4OutputFormat,CanvasSource} from 'mediabunny';`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'GalleryFixture'});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const stored=await page.evaluate(async()=>{
  const {Output,BufferTarget,Mp4OutputFormat,CanvasSource,savePhoto,cameraThumbnail}=GalleryFixture;
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const ctx=canvas.getContext('2d');
  const draw=i=>{ctx.fillStyle='rgb(30,100,150)';ctx.fillRect(0,0,160,120);ctx.fillStyle='rgb(160,90,45)';ctx.fillRect(i*4,20,45,60);};draw(0);
  const photoBlob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
  const thumbnail=await cameraThumbnail(photoBlob),target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target}),source=new CanvasSource(canvas,{codec:'avc',bitrate:300000});
  output.addVideoTrack(source,{frameRate:12});await output.start();for(let i=0;i<12;i++){draw(i);await source.add(i/12,1/12);}source.close();await output.finalize();
  const photos=[{id:'linked-photo',file:new File([photoBlob],'gallery-photo.jpg',{type:'image/jpeg'}),thumbnail,addedAt:1,cameraCapture:{uri:'content://media/1',name:'gallery-photo.jpg'}},{id:'linked-video',file:new File([target.buffer],'gallery-video.mp4',{type:'video/mp4'}),thumbnail,addedAt:2,cameraCapture:{uri:'content://media/2',name:'gallery-video.mp4',enhancedVideo:true}}];
  for(const photo of photos){await savePhoto(photo);window.gallery[photo.cameraCapture.uri]={name:photo.file.name,bytes:Array.from(new Uint8Array(await photo.file.arrayBuffer()))};window.sourceStates[photo.cameraCapture.uri]='present';}window.nextGallery=2;
  return {photos:photos.map(({file,...photo})=>photo)};
 });
 const photoRecord=stored.photos[0];
 // Reload the actual app with an existing linked video. The worker effect starts
 // before IndexedDB has restored the selection, reproducing the stale closure.
 const videoRecord=stored.photos.find(p=>p.cameraCapture.enhancedVideo);assert.ok(videoRecord,'Linked captured video exists');
 const snapshot=async id=>page.evaluate(async id=>{
  const q=indexedDB.open('clearwater-library'),db=await new Promise(resolve=>q.onsuccess=()=>resolve(q.result));
  const tx=db.transaction(['photos','camera-originals']),p=tx.objectStore('photos').get(id),a=tx.objectStore('camera-originals').get(id);
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  return {thumbnail:p.result.thumbnail,renderedSha256:p.result.cameraCapture.renderedSha256,recipe:p.result.recipe,originalHash:await hash(await a.result.file.arrayBuffer()),galleryHash:await hash(new Uint8Array(window.gallery[p.result.cameraCapture.uri].bytes))};
 },id);
 const videoBefore=await snapshot(videoRecord.id);
 await page.evaluate(()=>sessionStorage.setItem('linked-camera-gallery',JSON.stringify({gallery:window.gallery,sourceStates:window.sourceStates,nextGallery:window.nextGallery})));
 await page.reload();await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 const edit=async key=>{
  await page.locator('[data-control-tab=enhancement]').click();await page.locator('[data-control-subtab=colour]').click();
  await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press(key);
  await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 };
 const saveGallery=async()=>{
  await page.getByRole('button',{name:'Save to gallery',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.export-dialog')&&document.querySelector('.top-actions .primary')?.disabled===false);
  await page.getByRole('status').filter({hasText:/Gallery photo updated\.|Could not update the gallery image\./}).waitFor();
  assert.ok((await page.getByRole('status').allTextContents()).some(text=>text.includes('Gallery photo updated.')),'Edited linked media must update the gallery successfully');
  await page.waitForFunction(()=>!document.querySelector('.export-dialog'));
 };
 await edit('End');await saveGallery();
 const videoAfter=await snapshot(videoRecord.id);
 assert.notEqual(videoAfter.galleryHash,videoBefore.galleryHash,'Cold-load video save replaces gallery bytes');
 assert.equal(videoAfter.originalHash,videoBefore.originalHash,'Video editing source is preserved');
 assert.equal(videoAfter.thumbnail,videoBefore.thumbnail,'Video retains its existing thumbnail');
 assert.equal(videoAfter.renderedSha256,undefined,'Video does not acquire a photo hash');
 console.log('PASS cold-load linked video edit/save using real video worker and mocked Android gallery bridge');
 const photoBefore=await snapshot(photoRecord.id);
 await page.locator('.photo-select').filter({has:page.locator(`img[alt="${photoRecord.cameraCapture.name}"]`)}).click();
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 await page.locator('.photo-select').filter({has:page.locator(`img[alt="${videoRecord.cameraCapture.name}"]`)}).click();
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 await edit('Home');await saveGallery();
 await page.locator('.photo-select').filter({has:page.locator(`img[alt="${photoRecord.cameraCapture.name}"]`)}).click();
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);await edit('End');
 await page.evaluate(()=>window.failNextGalleryUpdate=true);
 await page.getByRole('button',{name:'Save to gallery',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Could not update the gallery image. Your original and edits are kept.'}).waitFor();
 const failed=await snapshot(photoRecord.id);assert.equal(failed.galleryHash,photoBefore.galleryHash);assert.equal(failed.originalHash,photoBefore.originalHash);
 assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'100','Failed save keeps the current edit');
 await saveGallery();const photoAfter=await snapshot(photoRecord.id);
 assert.notEqual(photoAfter.galleryHash,photoBefore.galleryHash);assert.equal(photoAfter.renderedSha256,photoAfter.galleryHash,'Photo hash matches updated bytes');
 assert.notEqual(photoAfter.thumbnail,photoBefore.thumbnail,'Photo thumbnail regenerated after edit');assert.equal(photoAfter.originalHash,photoBefore.originalHash);
 assert.equal(photoAfter.recipe.manual.warmth,100,'Gallery retry exports and persists the current edit');assert.equal(await page.evaluate(()=>Object.keys(window.gallery).length),2);
 console.log('PASS photo→video→photo save, photo thumbnail/hash, gallery failure/retry and original retention (bridge mocked; physical Android still required)');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
