import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';

const editorRoot=resolve(import.meta.dirname,'..');
const bundle=await build({
  stdin:{contents:"import * as storage from './src/storage'; globalThis.CameraArchiveCheck=storage;",resolveDir:editorRoot,sourcefile:'camera-archive-check.ts',loader:'ts'},
  bundle:true,write:false,format:'iife',globalName:'CameraArchiveCheckBundle',platform:'browser',target:'es2022',
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRYkAAAAASUVORK5CYII=','base64');
const sourceBytes=Array.from(png),replacementBytes=Array.from(Buffer.from('edited-pixels'));
const browser=process.env.CHECK_BROWSER==='webkit'?await webkit.launch({headless:true}):await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();
  await page.route('http://127.0.0.1:4174/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Camera archive check</title>'}));
  await page.goto('http://127.0.0.1:4174/');
  await page.evaluate(async({sourceBytes})=>{
    const file=(name,bytes,type)=>new File([new Uint8Array(bytes)],name,{type});
    const request=indexedDB.open('clearwater-library',1);
    const db=await new Promise((resolve,reject)=>{request.onupgradeneeded=()=>request.result.createObjectStore('photos',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??new Error('IndexedDB open failed'));});
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('photos','readwrite'),store=tx.objectStore('photos');
      const legacy=store.put({id:'legacy-photo',file:file('legacy.png',sourceBytes,'image/png'),recipe:{exposure:1},addedAt:1});
      const shared=store.put({id:'pending-share',file:file('share.png',sourceBytes,'image/png'),pendingShare:true,addedAt:9});
      legacy.onerror=()=>reject(new Error(`Legacy File put failed: ${legacy.error?.name}: ${legacy.error?.message}`));
      shared.onerror=()=>reject(new Error(`Pending File put failed: ${shared.error?.name}: ${shared.error?.message}`));
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error??new Error('IndexedDB seed transaction failed'));tx.onabort=()=>reject(tx.error??new Error('IndexedDB seed transaction aborted'));
    });
    db.close();
    const v2=indexedDB.open('clearwater-library',2);
    await new Promise((resolve,reject)=>{v2.onupgradeneeded=()=>v2.result.createObjectStore('camera-originals',{keyPath:'id'});v2.onsuccess=resolve;v2.onerror=()=>reject(v2.error??new Error('v2 upgrade failed'));});
    v2.result.close();
  },{sourceBytes});
  await page.addScriptTag({content:bundle.outputFiles[0].text});

  const migration=await page.evaluate(async()=>{
    const db=await CameraArchiveCheck.openDB(),version=db.version,stores=[...db.objectStoreNames];db.close();
    const photos=await CameraArchiveCheck.listPhotos();
    return {version,stores,photos:photos.map(photo=>photo.id)};
  });
  assert.equal(migration.version,3,'the v2 database should migrate to v3');
  assert.deepEqual(migration.stores,['camera-originals','photo-metadata','photos']);
  assert.deepEqual(migration.photos,['legacy-photo'],'v2 files survive and pending shares remain hidden');

  const imported=await page.evaluate(async({sourceBytes})=>{
    const originalPut=IDBObjectStore.prototype.put;
    let fileWrites=0;
    IDBObjectStore.prototype.put=function(value,...args){if(value?.file instanceof File)fileWrites++;return originalPut.call(this,value,...args);};
    try{
      const file=(name,bytes)=>new File([new Uint8Array(bytes)],name,{type:'image/png'});
      await CameraArchiveCheck.savePhoto({id:'to-delete',file:file('delete.png',sourceBytes),addedAt:2});
      await CameraArchiveCheck.deletePhoto('to-delete');
      fileWrites=0;
      await CameraArchiveCheck.savePhoto({id:'legacy-photo',file:file('replacement.png',[1,2,3]),recipe:{exposure:2},addedAt:3});
      await CameraArchiveCheck.savePhoto({id:'legacy-photo',file:file('empty.png',[]),recipe:{exposure:3},addedAt:4});
      const listed=(await CameraArchiveCheck.listPhotos()).find(photo=>photo.id==='legacy-photo');
      const db=await CameraArchiveCheck.openDB();
      const rows=await new Promise((resolve,reject)=>{const tx=db.transaction(['photos','photo-metadata'],'readonly'),raw=tx.objectStore('photos').get('legacy-photo'),meta=tx.objectStore('photo-metadata').get('legacy-photo');tx.oncomplete=()=>resolve({raw:raw.result,meta:meta.result});tx.onerror=()=>reject(tx.error);});
      db.close();
      return {fileWrites,bytes:Array.from(new Uint8Array(await listed.file.arrayBuffer())),size:rows.raw.file.size,recipe:listed.recipe,rawRecipe:rows.raw.recipe,metaRecipe:rows.meta.recipe};
    }finally{IDBObjectStore.prototype.put=originalPut;}
  },{sourceBytes});
  assert.equal(imported.fileWrites,0,'deleting one photo and editing another never re-puts a stored File');
  assert.deepEqual(imported.bytes,sourceBytes,'imported source bytes remain intact after edits');
  assert.equal(imported.size,sourceBytes.length,'the source Blob retains its size after another photo is deleted');
  assert.deepEqual(imported.recipe,{exposure:3},'latest recipe comes from the metadata sidecar');
  assert.deepEqual(imported.rawRecipe,{exposure:1},'legacy File rows are never rewritten');
  assert.deepEqual(imported.metaRecipe,{exposure:3});
  const failedWrite=await page.evaluate(async({sourceBytes})=>{
    const originalPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...args){if(this.name==='photo-metadata'&&value?.id==='legacy-photo')throw new DOMException('Metadata write blocked','UnknownError');return originalPut.call(this,value,...args);};
    try{
      const file=new File([new Uint8Array(sourceBytes)],'legacy.png',{type:'image/png'});
      const failure=await Promise.race([
        CameraArchiveCheck.savePhoto({id:'legacy-photo',file,recipe:{exposure:99}}).then(()=>null,error=>error?.name??'error'),
        new Promise(resolve=>setTimeout(()=>resolve('timeout'),2000)),
      ]);
      return failure;
    }finally{IDBObjectStore.prototype.put=originalPut;}
  },{sourceBytes});
  assert.equal(failedWrite,'AbortError','a synchronous metadata put failure aborts and rejects the save');
  await page.reload();
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const afterReload=await page.evaluate(async()=>{
    const photo=(await CameraArchiveCheck.listPhotos()).find(photo=>photo.id==='legacy-photo');
    return {bytes:Array.from(new Uint8Array(await photo.file.arrayBuffer())),recipe:photo.recipe};
  });
  assert.deepEqual(afterReload.bytes,sourceBytes,'imported source bytes survive a fresh IndexedDB read');
  assert.deepEqual(afterReload.recipe,{exposure:3},'sidecar edits survive reload');

  const promoted=await page.evaluate(async({sourceBytes})=>{
    const file=new File([new Uint8Array(sourceBytes)],'shared.png',{type:'image/png'});
    await CameraArchiveCheck.savePhoto({id:'promoted-share',file,pendingShare:true,addedAt:5});
    await CameraArchiveCheck.promoteSharedPhotos(['promoted-share']);
    await CameraArchiveCheck.savePhoto({id:'promoted-share',file,recipe:{exposure:4},addedAt:5});
    const visible=(await CameraArchiveCheck.listPhotos()).some(photo=>photo.id==='promoted-share');
    await CameraArchiveCheck.clearPhotos();
    const remaining=(await CameraArchiveCheck.listPhotos()).some(photo=>photo.id==='promoted-share');
    const db=await CameraArchiveCheck.openDB();
    const raw=await new Promise((resolve,reject)=>{const request=db.transaction('photos').objectStore('photos').get('promoted-share');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();
    return {visible,remaining,raw:raw??null};
  },{sourceBytes});
  assert.equal(promoted.visible,true,'a promoted share stays visible after an edit');
  assert.equal(promoted.remaining,false,'clear removes a promoted share even when its raw row says pending');
  assert.equal(promoted.raw,null,'clear removes the original Blob of a promoted share');

  const lifecycle=await page.evaluate(async({sourceBytes,replacementBytes})=>{
    const file=(name,bytes)=>new File([new Uint8Array(bytes)],name,{type:'image/png',lastModified:1234});
    const first={id:'camera-first',file:file('raw-camera.png',sourceBytes),recipe:{exposure:1},thumbnail:'old',addedAt:2,cameraCapture:{},sourceUri:'content://camera/original'};
    await CameraArchiveCheck.savePhoto(first);
    await CameraArchiveCheck.savePhoto({...first,file:file('edited-render.png',replacementBytes),recipe:{exposure:2},thumbnail:'updated',addedAt:4,cameraCapture:{uri:'content://gallery/first',name:'IMG_gallery_1.png',renderedSha256:'hash-1'}});
    await CameraArchiveCheck.savePhoto({id:'camera-second',file:file('second.png',sourceBytes),addedAt:3,cameraCapture:{uri:'content://gallery/second',name:'IMG_gallery_2.png'}});

    const db=await CameraArchiveCheck.openDB();
    const rows=await new Promise((resolve,reject)=>{const request=db.transaction('photos','readonly').objectStore('photos').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const archived=await new Promise((resolve,reject)=>{const request=db.transaction('camera-originals','readonly').objectStore('camera-originals').get('camera-first');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    db.close();
    const listed=await CameraArchiveCheck.listPhotos(),camera=listed.find(photo=>photo.id==='camera-first');
    const originalBytes=Array.from(new Uint8Array(await camera.file.arrayBuffer()));
    const archivedBytes=Array.from(new Uint8Array(await archived.file.arrayBuffer()));
    const archiveOrder=(await CameraArchiveCheck.listCameraOriginals()).map(photo=>photo.id);
    await CameraArchiveCheck.clearPhotos();
    const afterClearDb=await CameraArchiveCheck.openDB();
    const remaining=await new Promise((resolve,reject)=>{const request=afterClearDb.transaction('photos','readonly').objectStore('photos').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    afterClearDb.close();
    const recovered=await CameraArchiveCheck.listCameraOriginals(),firstOriginal=recovered.find(photo=>photo.id==='camera-first');
    await CameraArchiveCheck.savePhoto(firstOriginal);
    const restored=(await CameraArchiveCheck.listPhotos()).find(photo=>photo.id==='camera-first');
    await CameraArchiveCheck.removePhotoFromCollection('camera-first');
    const removedFromCollection=(await CameraArchiveCheck.listPhotos()).some(photo=>photo.id==='camera-first');
    const retainedAfterRemove=(await CameraArchiveCheck.listCameraOriginals()).some(photo=>photo.id==='camera-first');
    await CameraArchiveCheck.savePhoto(firstOriginal);
    await CameraArchiveCheck.deletePhoto('camera-first');
    const deletedDb=await CameraArchiveCheck.openDB();
    const deleted=await new Promise((resolve,reject)=>{
      const tx=deletedDb.transaction(['photos','camera-originals'],'readonly'),p=tx.objectStore('photos').get('camera-first'),o=tx.objectStore('camera-originals').get('camera-first');
      tx.oncomplete=()=>resolve({photo:p.result,original:o.result});tx.onerror=()=>reject(tx.error);
    });
    deletedDb.close();
    return {
      metadataHasNoFile:rows.filter(row=>row.id==='camera-first').every(row=>!('file'in row)),
      archivedName:archived.file.name,archivedBytes,originalBytes,sourceBytes,
      listedName:camera.file.name,recipe:camera.recipe,sourceUri:camera.sourceUri,capture:camera.cameraCapture,
      archiveOrder,clearPreservedPending:remaining.length===1&&remaining[0].id==='pending-share'&&remaining[0].pendingShare===true,
      recoveredName:firstOriginal.file.name,recoveredBytes:Array.from(new Uint8Array(await firstOriginal.file.arrayBuffer())),
      restoredName:restored.file.name,restoredRecipe:restored.recipe,
      removedFromCollection,retainedAfterRemove,deletedPhoto:deleted.photo??null,deletedOriginal:deleted.original??null,
    };
  },{sourceBytes,replacementBytes});
  assert.equal(lifecycle.metadataHasNoFile,true,'camera metadata rows do not retain duplicate source files');
  assert.equal(lifecycle.archivedName,'raw-camera.png','archive retains its original File without rewriting its Blob');
  assert.deepEqual(lifecycle.archivedBytes,sourceBytes,'later edits must not replace archived source bytes');
  assert.deepEqual(lifecycle.originalBytes,sourceBytes,'joined collection photos return original source bytes');
  assert.deepEqual(lifecycle.recoveredBytes,sourceBytes,'the archive remains recoverable after collection clearing');
  assert.equal(lifecycle.listedName,'IMG_gallery_1.png');
  assert.equal(lifecycle.recoveredName,'IMG_gallery_1.png');
  assert.equal(lifecycle.restoredName,'IMG_gallery_1.png');
  assert.deepEqual(lifecycle.recipe,{exposure:2},'edited recipes are joined from the metadata row');
  assert.deepEqual(lifecycle.restoredRecipe,{exposure:2},'camera metadata updates survive collection clearing');
  assert.equal(lifecycle.sourceUri,'content://camera/original');
  assert.equal(lifecycle.capture.uri,'content://gallery/first');
  assert.deepEqual(lifecycle.archiveOrder,['camera-first','camera-second'],'camera originals sort newest first');
  assert.equal(lifecycle.clearPreservedPending,true,'clearing the collection preserves queued shares');
  assert.equal(lifecycle.removedFromCollection,false);
  assert.equal(lifecycle.retainedAfterRemove,true,'removing collection metadata keeps the camera original');
  assert.equal(lifecycle.deletedPhoto,null,'explicit deletion removes the metadata row');
  assert.equal(lifecycle.deletedOriginal,null,'explicit deletion removes the camera archive');
  console.log('PASS v2-to-v3 IndexedDB upgrade, delete-then-edit without File rewrites, source bytes and recipes after reload, failed-write rejection, share promotion/clear, camera archive/name alias, original-byte preservation, clear/recovery, pending-share retention, and full deletion.');
}finally{await browser.close();}
