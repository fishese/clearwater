import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const editorRoot=resolve(import.meta.dirname,'..');
const bundle=await build({
  stdin:{contents:"import * as storage from './src/storage'; globalThis.CameraArchiveCheck=storage;",resolveDir:editorRoot,sourcefile:'camera-archive-check.ts',loader:'ts'},
  bundle:true,write:false,format:'iife',globalName:'CameraArchiveCheckBundle',platform:'browser',target:'es2022',
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRYkAAAAASUVORK5CYII=','base64');
const sourceBytes=Array.from(png),replacementBytes=Array.from(Buffer.from('edited-pixels'));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();
  await page.route('https://camera-archive-check.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Camera archive check</title>'}));
  await page.goto('https://camera-archive-check.test/');
  await page.evaluate(async({sourceBytes})=>{
    const file=(name,bytes,type)=>new File([new Uint8Array(bytes)],name,{type});
    const request=indexedDB.open('clearwater-library',1);
    const db=await new Promise((resolve,reject)=>{request.onupgradeneeded=()=>request.result.createObjectStore('photos',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('photos','readwrite'),store=tx.objectStore('photos');
      store.put({id:'legacy-photo',file:file('legacy.png',sourceBytes,'image/png'),recipe:{exposure:1},addedAt:1});
      store.put({id:'pending-share',file:file('share.png',sourceBytes,'image/png'),pendingShare:true,addedAt:9});
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    db.close();
  },{sourceBytes});
  await page.addScriptTag({content:bundle.outputFiles[0].text});

  const migration=await page.evaluate(async()=>{
    const db=await CameraArchiveCheck.openDB(),version=db.version,stores=[...db.objectStoreNames];db.close();
    const photos=await CameraArchiveCheck.listPhotos();
    return {version,stores,photos:photos.map(photo=>photo.id)};
  });
  assert.equal(migration.version,2,'the v1 database should migrate to v2');
  assert.deepEqual(migration.stores,['camera-originals','photos']);
  assert.deepEqual(migration.photos,['legacy-photo'],'v1 files survive and pending shares remain hidden');

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
  assert.equal(lifecycle.archivedName,'IMG_gallery_1.png','archive file names follow the enhanced gallery name');
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
  console.log('PASS v1 IndexedDB migration, camera archive/name alias, metadata-only edits, original-byte preservation, clear/recovery, pending-share retention, newest-first camera originals, collection-only removal, and full deletion.');
}finally{await browser.close();}
