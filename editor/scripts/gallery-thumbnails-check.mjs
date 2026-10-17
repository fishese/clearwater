import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import piexif from 'piexifjs';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const bundle = await build({
  stdin: {
    contents: "export {galleryThumbnail} from './src/gallery-thumbnail';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'GalleryThumbnailCheck',
  platform: 'browser',
});

const browser = await chromium.launch({channel:'msedge',headless:true});
const context = await browser.newContext({viewport:{width:1440,height:720}});
await context.addInitScript(() => {
  window.galleryDecodes = [];
  const decode = window.createImageBitmap;
  window.createImageBitmap = function(source, ...args) {
    if (source instanceof File && source.name.startsWith('gallery-')) window.galleryDecodes.push(source.name);
    return decode.call(this, source, ...args);
  };
  localStorage.setItem('clearwater-language','en');
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.CHECK_URL ?? 'http://127.0.0.1:5173/');
  const fixtures = await page.evaluate(async () => {
    const make = async (width,height,type) => {
      const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d');
      context.fillStyle='#b64f35';context.fillRect(0,0,width/2,height);
      context.fillStyle='#246d9e';context.fillRect(width/2,0,width/2,height);
      return Array.from(new Uint8Array(await (await canvas.convertToBlob({type})).arrayBuffer()));
    };
    return {jpeg:await make(400,200,'image/jpeg'),png:await make(200,400,'image/png')};
  });
  const jpeg=Buffer.from(fixtures.jpeg),exif=Buffer.from(piexif.dump({'0th':{274:6}}),'binary');
  const rotated=Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,225,(exif.length+2)>>>8,(exif.length+2)&255]),exif,jpeg.subarray(2)]);
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const orientations=await page.evaluate(async ({jpeg,png}) => {
    const {galleryThumbnail}=GalleryThumbnailCheck;
    const inspect=async (bytes,name,type) => {
      const file=new File([new Uint8Array(bytes)],name,{type});
      const data=await galleryThumbnail(file,new AbortController().signal);
      if(!data)return null;
      const image=new Image();image.src=data;await image.decode();
      return [image.naturalWidth,image.naturalHeight];
    };
    return {jpeg:await inspect(jpeg,'rotation-check.jpg','image/jpeg'),png:await inspect(png,'portrait-check.png','image/png')};
  },{jpeg:[...rotated],png:fixtures.png});
  assert.deepEqual(orientations.jpeg,[80,160]);
  assert.deepEqual(orientations.png,[80,160]);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2000; canvas.height = 1000;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0,0,2000,1000);
    gradient.addColorStop(0,'#247b9f'); gradient.addColorStop(1,'#e6a36b');
    context.fillStyle = gradient; context.fillRect(0,0,2000,1000);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.85));
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('clearwater-library',2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('photos')) request.result.createObjectStore('photos',{keyPath:'id'});
        if (!request.result.objectStoreNames.contains('camera-originals')) request.result.createObjectStore('camera-originals',{keyPath:'id'});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve,reject) => {
      const tx = db.transaction('photos','readwrite');
      const addedAt=Date.now();
      for(let i=0;i<30;i++) {
        const name = `gallery-${String(i).padStart(2,'0')}.jpg`;
        tx.objectStore('photos').put({id:name,file:new File([blob],name,{type:'image/jpeg'}),addedAt:addedAt-i});
      }
      tx.objectStore('photos').put({id:'gallery-unsupported.heic',file:new File([blob],'gallery-unsupported.heic',{type:'image/heic'}),addedAt:addedAt-31});
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.photo-grid .photo-tile').length === 31);
  await page.waitForFunction(() => window.galleryDecodes.includes('gallery-01.jpg') && document.querySelectorAll('.photo-grid .photo-tile')[1]?.querySelector('img')?.src.startsWith('data:image/jpeg'));
  const initial = await page.evaluate(() => ({
    decodes:window.galleryDecodes,
    imageSources:[...document.querySelectorAll('.photo-grid .photo-tile img')].map(image => image.src),
    lastHasImage:!!document.querySelectorAll('.photo-grid .photo-tile')[29]?.querySelector('img'),
    lastName:document.querySelectorAll('.photo-grid .photo-tile')[29]?.querySelector('.photo-select')?.title,
    unsupportedName:document.querySelector('.photo-grid .photo-tile:last-child .photo-select')?.title,
  }));
  assert.ok(initial.decodes.length < 15, `decoded ${initial.decodes.length} originals before scrolling`);
  assert.equal(initial.lastHasImage,false);
  assert.equal(initial.lastName,'gallery-29.jpg');
  assert.equal(initial.unsupportedName,'gallery-unsupported.heic');
  assert.ok(initial.imageSources.every(source => source.startsWith('data:image/jpeg')));
  await page.locator('.photo-grid .photo-tile').nth(29).evaluate(element => element.scrollIntoView({block:'center'}));
  await page.waitForFunction(() => document.querySelectorAll('.photo-grid .photo-tile')[29]?.querySelector('img')?.src.startsWith('data:image/jpeg'));
  const scrolled = await page.evaluate(() => window.galleryDecodes);
  assert.ok(scrolled.includes('gallery-29.jpg'));
  assert.ok(scrolled.length < 30, `decoded all ${scrolled.length} originals`);
  assert.equal(await page.locator('.photo-grid .photo-tile:last-child img').count(),0);
  await page.getByRole('button',{name:'Clear collection',exact:true}).click();
  await page.getByRole('dialog',{name:'Clear collection?'}).getByRole('button',{name:'Clear collection',exact:true}).click();
  await page.waitForFunction(() => document.querySelectorAll('.photo-grid .photo-tile').length === 0);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.photo-grid img').count(),0);
  assert.deepEqual(errors,[]);
  console.log(`PASS lazy gallery thumbnails: ${initial.decodes.length} initial decodes, ${scrolled.length} after scroll, clear is clean`);
} finally {
  await browser.close();
}
