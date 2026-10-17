import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const url=process.env.CHECK_URL??'http://127.0.0.1:5173/';
const modelPath=fileURLToPath(new URL('../public/models/shallow.onnx',import.meta.url));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);
 await page.evaluate(async()=>{
  localStorage.clear();
  for(const name of ['clearwater-library','clearwater-custom-model'])await new Promise(resolve=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=request.onerror=request.onblocked=()=>resolve();});
 });
 await page.reload();
 const fixture=Buffer.from((await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=192;const ctx=canvas.getContext('2d');const gradient=ctx.createLinearGradient(0,0,256,192);gradient.addColorStop(0,'#174e61');gradient.addColorStop(.5,'#47aa94');gradient.addColorStop(1,'#e2c798');ctx.fillStyle=gradient;ctx.fillRect(0,0,256,192);ctx.fillStyle='#f2e9d7';ctx.beginPath();ctx.arc(130,92,34,0,Math.PI*2);ctx.fill();return canvas.toDataURL('image/png');})).split(',')[1],'base64');
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles([
  {name:'first.png',mimeType:'image/png',buffer:fixture},
  {name:'second.png',mimeType:'image/png',buffer:fixture},
 ]);
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,undefined,{timeout:120000});
 await ready();
 const engineGroup=()=>page.locator('details.settings-group').filter({has:page.locator('.engine-details')});
 const openEngine=async()=>{if(!(await engineGroup().evaluate(element=>element.open)))await engineGroup().locator('summary').click();};
 await openEngine();
 const engine=page.getByLabel('Correction engine',{exact:true});
 await engine.selectOption('wave');
 await page.getByLabel('ONNX model file',{exact:true}).setInputFiles(modelPath);
 await page.getByLabel('Model input range',{exact:true}).selectOption('signed');
 await page.getByLabel('Model output range',{exact:true}).selectOption('unit');
 await page.getByLabel('I have permission to use this model and will follow its licence.',{exact:true}).check();
 await page.getByRole('button',{name:'Load model',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.modal-shade')&&document.querySelector('[aria-label="Correction engine"]')?.value==='wave',undefined,{timeout:120000});
 await page.waitForFunction(async()=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('clearwater-custom-model');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const record=await new Promise((resolve,reject)=>{const request=db.transaction('model').objectStore('model').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();return record?.config?.inputRange==='signed'&&record?.blob?.size>0;
 },undefined,{timeout:120000});
 await page.waitForFunction(async()=>{
  const db=await new Promise(resolve=>{const request=indexedDB.open('clearwater-library');request.onsuccess=()=>resolve(request.result);});
  const rows=await new Promise(resolve=>{const tx=db.transaction(['photos','photo-metadata']),photos=tx.objectStore('photos').getAll(),updates=tx.objectStore('photo-metadata').getAll();tx.oncomplete=()=>resolve(photos.result.map(row=>({...row,...updates.result.find(meta=>meta.id===row.id)})));});db.close();return rows.some(row=>row.file.name==='first.png'&&row.recipe?.engine==='wave');
 },undefined,{timeout:120000});
 await page.waitForTimeout(600); // let the debounced recipe write settle before reload
 assert.equal(await page.evaluate(async()=>{const db=await new Promise(resolve=>{const request=indexedDB.open('clearwater-library');request.onsuccess=()=>resolve(request.result);});const rows=await new Promise(resolve=>{const tx=db.transaction(['photos','photo-metadata']),photos=tx.objectStore('photos').getAll(),updates=tx.objectStore('photo-metadata').getAll();tx.oncomplete=()=>resolve(photos.result.map(row=>({...row,...updates.result.find(meta=>meta.id===row.id)})));});db.close();return rows.find(row=>row.file.name==='first.png')?.recipe?.engine;}),'wave','the active Wave recipe has finished persisting before reload');
 await page.reload();
 await ready();
 await openEngine();
 await page.waitForFunction(()=>!document.querySelector('.modal-shade')&&document.querySelector('[aria-label="Correction engine"]')?.value==='wave',undefined,{timeout:120000});

 // A failed replacement must leave the validated file in use after cancelling the picker.
 await page.getByRole('button',{name:'Load another ONNX model',exact:true}).click();
 await page.getByLabel('ONNX model file',{exact:true}).setInputFiles({name:'invalid.onnx',mimeType:'application/octet-stream',buffer:Buffer.from('invalid')});
 await page.getByLabel('I have permission to use this model and will follow its licence.',{exact:true}).check();
 await page.getByRole('button',{name:'Load model',exact:true}).click();
 await page.getByRole('alert').waitFor({timeout:120000});
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Next photo',exact:true}).click();await ready();
 await page.getByRole('button',{name:'Previous photo',exact:true}).click();await ready();
 assert.equal(await engine.inputValue(),'wave','cancelling an invalid replacement keeps the previous model selected');

 // Loading a saved model must not change a recipe that selected Balanced.
 await engine.selectOption('balanced');
 await page.waitForFunction(async()=>{
  const db=await new Promise(resolve=>{const request=indexedDB.open('clearwater-library');request.onsuccess=()=>resolve(request.result);});
  const rows=await new Promise(resolve=>{const tx=db.transaction(['photos','photo-metadata']),photos=tx.objectStore('photos').getAll(),updates=tx.objectStore('photo-metadata').getAll();tx.oncomplete=()=>resolve(photos.result.map(row=>({...row,...updates.result.find(meta=>meta.id===row.id)})));});db.close();return rows.some(row=>row.file.name==='first.png'&&row.recipe?.engine==='balanced');
 },undefined,{timeout:120000});
 await page.waitForTimeout(600); // let the debounced Balanced recipe write settle
 await page.reload();await ready();
 assert.equal(await page.getByLabel('Correction engine',{exact:true}).inputValue(),'balanced','startup restore preserves a Balanced recipe');

 // A damaged stored blob opens the picker with ranges intact and is retained until explicit removal.
 await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const request=indexedDB.open('clearwater-custom-model');request.onsuccess=()=>resolve(request.result);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('model','readwrite');const store=tx.objectStore('model'),request=store.get('current');request.onsuccess=()=>store.put({config:request.result.config,blob:new Blob(['broken'])},'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 });
 await page.reload();
 await page.getByRole('alert').waitFor({timeout:120000});
 assert.equal(await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const request=indexedDB.open('clearwater-custom-model');request.onsuccess=()=>resolve(request.result);});
  const record=await new Promise(resolve=>{const request=db.transaction('model').objectStore('model').get('current');request.onsuccess=()=>resolve(request.result);});db.close();return record.blob.size;
 }),6,'a failed restore preserves the saved bytes until the user removes them');
 assert.equal(await page.getByLabel('Model input range',{exact:true}).inputValue(),'signed');
 assert.equal(await page.getByLabel('Model output range',{exact:true}).inputValue(),'unit');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await openEngine();
 await page.getByRole('button',{name:'Forget saved model',exact:true}).click();
 await page.waitForFunction(async()=>{
  const db=await new Promise(resolve=>{const request=indexedDB.open('clearwater-custom-model');request.onsuccess=()=>resolve(request.result);});
  const record=await new Promise(resolve=>{const request=db.transaction('model').objectStore('model').get('current');request.onsuccess=()=>resolve(request.result);});db.close();return record===undefined;
 });
 assert.deepEqual(errors,[]);
 console.log('PASS custom model bytes and ranges persist across reloads; Balanced recipes stay Balanced; invalid replacements preserve the previous model; missing or damaged blobs retain range preferences and can be explicitly removed.');
} finally {await browser.close();}
