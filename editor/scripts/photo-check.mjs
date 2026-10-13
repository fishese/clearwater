import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import exifr from 'exifr';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 let page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.CHECK_URL??'http://127.0.0.1:5173/');
 async function open(name){await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve('../analysis/photo-check',name));await page.locator('.filename').filter({hasText:name}).waitFor();await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,{},{timeout:90000});}
 async function save(){const download=page.waitForEvent('download',{timeout:90000});await page.getByRole('button',{name:'Download instead',exact:true}).click();const d=await download;return await readFile(await d.path());}
 async function dimensions(bytes){return await page.evaluate(async a=>{const b=await createImageBitmap(new Blob([new Uint8Array(a)]));const size=[b.width,b.height];b.close();return size;},Array.from(bytes));}
 await open('normal-12mp.png');assert.equal(await page.locator('.large-photo-note').count(),0);assert.deepEqual(await dimensions(await save()),[4000,3000]);
 console.log('PASS ordinary 12 MP photo has no notice or resolution reduction');
 for(const name of ['bayer.dng','linear.dng']){
  await open(name);assert.equal(await page.locator('.large-photo-note').count(),0);let bytes=await save();assert.deepEqual(await dimensions(bytes),[96,128]);assert.equal((await exifr.parse(bytes)).Make,'Test Camera');
  await page.getByRole('combobox',{name:'File format'}).selectOption('png');bytes=await save();assert.deepEqual(await dimensions(bytes),[96,128]);await page.getByRole('combobox',{name:'File format'}).selectOption('jpg');
 }
 console.log('PASS Bayer and linear DNG development, rotation, EXIF and JPEG/PNG exports');
 if(process.env.CHECK_OFFLINE==='1'){
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.context().setOffline(true);await open('bayer.dng');assert.deepEqual(await dimensions(await save()),[96,128]);await page.context().setOffline(false);
  console.log('PASS cached DNG decoding/export offline');
 }
 if(process.env.CHECK_PHONE_DNG==='1')for(const [name,make] of [['pixel-4a.dng','Google'],['iphone-12-pro.dng','Apple']]){
  await open(name);assert.equal(await page.locator('.large-photo-note').count(),0);const bytes=await save(),size=await dimensions(bytes),metadata=await exifr.parse(bytes);
  assert.equal(metadata.Make,make);assert.ok(size[0]*size[1]>10_000_000);assert.ok(size[0]*size[1]<13_000_000);
  console.log('PASS real '+make+' phone DNG development, EXIF and full-size export');
 }
 await open('large-48mp.png');await page.locator('.large-photo-note').waitFor();assert.ok(await page.locator('canvas').first().evaluate(c=>c.width<=1600));
 await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('End');
 await page.getByRole('combobox',{name:'Photo resolution',exact:true}).selectOption('reduced');await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'100');let bytes=await save();let size=await dimensions(bytes);assert.ok(size[0]*size[1]<=12_000_000);assert.ok(size[0]>3000);
 await page.getByRole('combobox',{name:'Photo resolution',exact:true}).selectOption('full');await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 assert.deepEqual(await dimensions(await save()),[8000,6000]);assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'100');
 console.log('PASS 48 MP preview, reduced/full exports and edit preservation');
 // Failed decoder initialization must release the worker and allow a fresh reduced retry.
 await page.close();const failureContext=await browser.newContext({serviceWorkers:'block'});page=await failureContext.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.CHECK_URL??'http://127.0.0.1:5173/');
 let blocked=false;await failureContext.route('**/*libraw*wasm*',async route=>{if(!blocked){blocked=true;await route.fulfill({status:503,body:'Temporarily unavailable'});}else await route.continue();});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve('../analysis/photo-check','bayer.dng'));
 await page.getByRole('button',{name:'Retry reduced',exact:true}).waitFor({timeout:30000});await page.getByRole('button',{name:'Retry reduced',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,{},{timeout:60000});
 assert.deepEqual(await dimensions(await save()),[96,128]);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await mobile.goto(process.env.CHECK_URL??'http://127.0.0.1:5173/');await mobile.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve('../analysis/photo-check','large-48mp.png'));
 await mobile.locator('.large-photo-note').waitFor();await mobile.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 assert.ok((await mobile.locator('.large-photo-note').innerText()).includes('5656 × 4242'));
 await mobile.screenshot({path:'../analysis/photo-check/mobile-large.png'});await mobile.close();
 assert.deepEqual(errors,[]);console.log('PASS decoder failure/retry and mobile layout');
}finally{await browser.close();}
