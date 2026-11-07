import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
const url=process.env.CHECK_URL??'http://127.0.0.1:4173/';
async function imageBytes(page){return Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=128;c.height=96;const x=c.getContext('2d');x.fillStyle='#287c9b';x.fillRect(0,0,128,96);x.fillStyle='#c96638';x.fillRect(24,15,45,40);return c.toDataURL('image/png').split(',')[1];}),'base64');}
async function open(page,files){
 await page.goto(url,{waitUntil:'domcontentloaded'});const hint=page.locator('.web-update-hint-ok');if(await hint.isVisible().catch(()=>false))await hint.click();
 await page.getByRole('button',{name:'Batch process photos'}).click();const dialog=page.getByRole('dialog',{name:'Batch process photos'});await dialog.waitFor();
 await dialog.locator('input[type=file]').setInputFiles(files);await dialog.getByLabel('Correction engine').selectOption('balanced');await dialog.getByLabel('Auto enhance').check();return dialog;
}
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true,serviceWorkers:'block'});
 await context.addInitScript(()=>{
  const contents=new Map([['one.jpg','original']]);window.__batchTest={contents,holdPicker:false,resolvePicker:null,pickerCalls:0};
  const folder={name:'test',async getFileHandle(name,options){
   if(!options?.create&&!contents.has(name))throw new DOMException('Missing file','NotFoundError');
   if(options?.create&&!contents.has(name))contents.set(name,'created');
   return {name,async createWritable(){let value;return {async write(blob){value=new Uint8Array(await blob.arrayBuffer());},async close(){contents.set(name,value);},async abort(){contents.delete(name);}};}};
  }};
  Object.defineProperty(window,'showDirectoryPicker',{value:()=>{window.__batchTest.pickerCalls++;return window.__batchTest.holdPicker?new Promise(resolve=>{window.__batchTest.resolvePicker=()=>resolve(folder);}):Promise.resolve(folder);}});
 });
 const page=await context.newPage(),png=await imageBytes(page),files=[{name:'one.png',mimeType:'image/png',buffer:png},{name:'two.png',mimeType:'image/png',buffer:png}];
 let dialog=await open(page,files);await dialog.getByLabel('Selected folder').check();await dialog.getByRole('button',{name:'Choose folder and process'}).click();
 await dialog.getByText('Processed 2 photos.').waitFor({timeout:90000});
 const results=await page.evaluate(()=>Array.from(window.__batchTest.contents.entries(),([name,value])=>({name,size:typeof value==='string'?value:value?.length})));
 assert.deepEqual(results.map(x=>x.name),['one.jpg','one (1).jpg','two.jpg']);assert.equal(results[0].size,'original');assert.ok(results[1].size>0&&results[2].size>0);
 await dialog.getByRole('button',{name:'Close'}).click();
 await page.evaluate(()=>{window.__batchTest.holdPicker=true;});await page.getByRole('button',{name:'Batch process photos'}).click();dialog=page.getByRole('dialog',{name:'Batch process photos'});await dialog.locator('input[type=file]').setInputFiles(files);await dialog.getByLabel('Correction engine').selectOption('balanced');await dialog.getByLabel('Selected folder').check();await dialog.getByRole('button',{name:'Choose folder and process'}).evaluate(button=>{button.click();button.click();});
 assert.equal(await page.evaluate(()=>window.__batchTest.pickerCalls),2,'rapid repeated taps must not open another picker');
 await page.waitForFunction(()=>typeof window.__batchTest.resolvePicker==='function');await dialog.getByRole('button',{name:'Close'}).click();await page.evaluate(()=>window.__batchTest.resolvePicker());await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.__batchTest.contents.size),3,'closing a pending folder picker must not create files');
 // Batch processing must not replace the editor's current recipe or history.
 await page.locator('input[type=file][multiple]').first().setInputFiles(files[0]);await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:90000});
 await page.locator('[data-control-tab="enhancement"]').click();await page.locator('[data-control-subtab="colour"]').click();const warmth=page.getByLabel('Warmth',{exact:true});await warmth.focus();await warmth.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('input[aria-label="Warmth"]')?.value==='1');
 await page.getByRole('button',{name:'Batch process photos'}).click();dialog=page.getByRole('dialog',{name:'Batch process photos'});await dialog.getByLabel('Correction engine').selectOption('balanced');await dialog.getByRole('button',{name:'Process photos'}).click();await dialog.getByText('Processed 1 photos.').waitFor({timeout:90000});await dialog.getByRole('button',{name:'Close'}).click();
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:90000});await page.locator('[data-control-tab="enhancement"]').click();await page.locator('[data-control-subtab="colour"]').click();assert.equal(await warmth.inputValue(),'1','editor recipe remains unchanged after batch processing');assert.equal(await page.getByRole('button',{name:'Undo'}).isDisabled(),false,'existing undo history is preserved');
 console.log('PASS batch folder output, collision safety, and pending-picker cancellation');await context.close();
}finally{await browser.close();}
