import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../..');
const base=process.env.CHECK_URL??'http://127.0.0.1:5173';
const locales=Object.fromEntries(await Promise.all(['en','zh-HK','ja'].map(async language=>[language,JSON.parse(await readFile(resolve(root,`editor/src/locales/${language}.json`),'utf8'))])));
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>{window.savedFiles={'exports/kept.jpg':123};});
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(base);
  const photos=['IMG_7386-green tint.JPG','IMG_E7433-too bright.JPG'];
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles(photos.map(file=>root+'/Sample photos/'+file));
  const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,{timeout:120000});
  await ready();
  await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('ArrowUp');
  await page.getByRole('button',{name:'Clear collection',exact:true}).click();
  await page.getByRole('dialog',{name:'Clear collection?'}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog',{name:'Clear collection?'}).waitFor({state:'detached'});
  assert.equal(await page.getByText('02',{exact:true}).count(),1);
  await page.reload();await ready();
  assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'1');

  await page.evaluate(()=>{
    const prototype=IDBDatabase.prototype,transaction=prototype.transaction;let fail=true;
    prototype.transaction=function(stores,mode,...rest){if(fail&&stores==='photos'&&mode==='readwrite'){fail=false;throw new DOMException('Storage unavailable','InvalidStateError');}return transaction.call(this,stores,mode,...rest);};
  });
  await page.getByRole('button',{name:'Clear collection',exact:true}).click();
  await page.getByRole('dialog',{name:'Clear collection?'}).getByRole('button',{name:'Clear collection',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Could not clear collection'}).waitFor();
  assert.equal(await page.locator('.photo-grid .photo-tile').count(),2);
  await ready();await page.getByRole('dialog',{name:'Clear collection?'}).getByRole('button',{name:'Cancel',exact:true}).click();

  await page.evaluate(async()=>{
    localStorage.setItem('clearwater-language','en');
    const open=(name,version,upgrade)=>new Promise((resolve,reject)=>{const request=indexedDB.open(name,version);request.onupgradeneeded=()=>upgrade(request.result);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const custom=await open('clearwater-custom-model',1,db=>db.createObjectStore('model'));
    await new Promise((resolve,reject)=>{const tx=custom.transaction('model','readwrite');tx.objectStore('model').put({sentinel:'keep model storage'},'clear-check');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});custom.close();
    const db=await open('clearwater-library',1,db=>db.createObjectStore('photos',{keyPath:'id'}));
    await new Promise((resolve,reject)=>{const tx=db.transaction('photos','readwrite');tx.objectStore('photos').put({id:'clear-check-pending-share',file:new File(['shared bytes'],'shared-after-clear.jpg',{type:'image/jpeg'}),addedAt:Date.now(),pendingShare:true});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  });
  await page.getByRole('button',{name:'Clear collection',exact:true}).click();
  await page.getByRole('dialog',{name:'Clear collection?'}).getByRole('button',{name:'Clear collection',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.photo-grid')?.children.length===0,{timeout:30000});
  const cleared=await page.evaluate(async()=>{
    const read=(name,store,key)=>new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>{const db=request.result,tx=db.transaction(store,'readonly'),r=tx.objectStore(store).get(key);r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);};request.onerror=()=>reject(request.error);});
    const all=(name,store)=>new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>{const db=request.result,tx=db.transaction(store,'readonly'),r=tx.objectStore(store).getAll();r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);};request.onerror=()=>reject(request.error);});
    return {photos:await all('clearwater-library','photos'),model:await read('clearwater-custom-model','model','clear-check'),language:localStorage.getItem('clearwater-language'),export:window.savedFiles['exports/kept.jpg']};
  });
  assert.equal(cleared.photos.length,1);assert.equal(cleared.photos[0].pendingShare,true);
  assert.deepEqual(cleared.model,{sentinel:'keep model storage'});assert.equal(cleared.language,'en');assert.equal(cleared.export,123);
  await page.reload();
  await page.locator('.photo-grid .photo-tile').waitFor();
  assert.equal(await page.locator('.photo-grid .photo-tile').count(),1);
  assert.match(await page.locator('.photo-grid').innerText(),/shared-after-clear/);
  await page.setViewportSize({width:800,height:800});
  await page.getByRole('button',{name:'Clear collection',exact:true}).waitFor();

  await page.evaluate(async()=>{
    const request=indexedDB.open('clearwater-library');
    const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const photos=await new Promise((resolve,reject)=>{const tx=db.transaction('photos','readonly'),get=tx.objectStore('photos').get('clear-check-pending-share');get.onsuccess=()=>resolve(get.result?[get.result]:[]);get.onerror=()=>reject(get.error);});
    const file=photos[0].file,bytes=await file.arrayBuffer(),tx=db.transaction('photos','readwrite'),store=tx.objectStore('photos');
    for(let i=0;i<99;i++)store.put({id:`large-clear-check-${i}`,file:new File([bytes],`large-clear-${String(i).padStart(3,'0')}.jpg`,{type:'image/jpeg'}),thumbnail:'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',addedAt:Date.now()+i+1});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  });
  await page.setViewportSize({width:320,height:640});
  for(const language of ['en','zh-HK','ja']){
    await page.evaluate(value=>localStorage.setItem('clearwater-language',value),language);
    await page.reload();
    await page.waitForFunction(()=>document.querySelectorAll('.photo-grid .photo-tile').length===100,{timeout:30000});
    const strings=locales[language],clearButton=page.getByRole('button',{name:strings['Clear collection'],exact:true});
    await page.waitForFunction(()=>{const button=document.querySelector('.clear-collection-button');return !!button&&!button.disabled;});
    assert.equal(await clearButton.evaluate(button=>button.classList.contains('large-collection')),true);
    assert.equal(await clearButton.getAttribute('title'),strings['Large collection']);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const target=await clearButton.boundingBox();assert.ok(target&&target.width>=40&&target.height>=40);
    await clearButton.click();
    const dialog=page.getByRole('dialog',{name:strings['Clear collection?'],exact:true});await dialog.waitFor();
    await dialog.getByText(strings['Removes thumbnails, app copies and saved edits. Original and exported files stay untouched.'],{exact:true}).waitFor();
    const bounds=await dialog.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=320&&bounds.y+bounds.height<=640);
    await dialog.getByRole('button',{name:strings.Cancel,exact:true}).click();
    await dialog.waitFor({state:'detached'});assert.equal(await page.locator('.photo-grid .photo-tile').count(),100);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS clear confirmation cancel/confirm, failure rollback, saved edit and reload, queued share preservation, retained model/language/export data, and >=100-item highlight plus 320px confirmation layout in English, Chinese HK, and Japanese.');
}finally{await browser.close();}
