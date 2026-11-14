import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Fault injection is scoped to batch requests. Successful photos still use the
// real processing worker; this checks UI recovery, not a device OOM scenario.
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
const url=process.env.CHECK_URL??'http://127.0.0.1:4173/';
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.addInitScript(()=>{
  const NativeWorker=window.Worker;
  window.__batchFault={at:0,hold:false,loads:0,workers:0,contents:{}};
  window.Worker=class extends NativeWorker {
   batch=false;
   postMessage(data,...rest){
    if(data?.batchDiagnostic){
     if(!this.batch){this.batch=true;window.__batchFault.workers++;}
     if(data.type==='load'){
      const state=window.__batchFault;state.loads++;
      if(state.hold)return;
      if(state.loads===state.at){queueMicrotask(()=>{this.terminate();this.dispatchEvent(new Event('error'));});return;}
     }
    }
    return super.postMessage(data,...rest);
   }
  };
  Object.defineProperty(window,'showDirectoryPicker',{value:async()=>({
   async getFileHandle(name,options){
    const contents=window.__batchFault.contents;
    if(!options?.create&&!(name in contents))throw new DOMException('Missing file','NotFoundError');
    return {async createWritable(){let size=0;return {async write(blob){size=blob.size;},async close(){contents[name]=size;}};}};
   }
  })});
 });
 const page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});
 const hint=page.locator('.web-update-hint-ok');if(await hint.isVisible().catch(()=>false))await hint.click();
 const png=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;const ctx=canvas.getContext('2d');ctx.fillStyle='#287c9b';ctx.fillRect(0,0,64,48);return canvas.toDataURL('image/png').split(',')[1];}),'base64');
 await page.getByRole('button',{name:'Batch process photos'}).click();
 const dialog=page.getByRole('dialog',{name:'Batch process photos'});
 await dialog.locator('input[type=file]').setInputFiles(['one','two','three'].map(name=>({name:`${name}.png`,mimeType:'image/png',buffer:png})));
 await dialog.getByLabel('Correction engine').selectOption('balanced');
 const process=dialog.getByRole('button',{name:'Process photos',exact:true});
 const download=dialog.getByRole('link',{name:'Download ZIP'});
 const reset=async(at,hold=false)=>page.evaluate(({at,hold})=>{Object.assign(window.__batchFault,{at,hold,loads:0});},{at,hold});
 async function zipNames(){
  return download.evaluate(async link=>{
   const bytes=await (await fetch(link.href)).arrayBuffer(),view=new DataView(bytes),names=[];
   let offset=0;
   while(view.getUint32(offset,true)===0x04034b50){
    const size=view.getUint32(offset+18,true),length=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);
    names.push(new TextDecoder().decode(new Uint8Array(bytes,offset+30,length)));
    offset+=30+length+extra+size;
   }
   return names;
  });
 }
 async function stopped(completed){
  await dialog.getByRole('alert').getByText('The photo processing worker stopped.',{exact:false}).waitFor();
  await process.waitFor({state:'visible'});
  assert.equal(await process.isEnabled(),true,'batch is no longer running');
  if(completed)await dialog.getByText(`Processed ${completed} photos.`,{exact:true}).waitFor();
 }
 // Initialization failure must stop before another photo is posted.
 await reset(1);await process.click();await stopped(0);
 assert.equal(await page.evaluate(()=>window.__batchFault.loads),1);
 assert.equal(await download.count(),0);
 // Retry in the same dialog creates a fresh worker and processes every photo.
 await reset(0);await process.click();await dialog.getByText('Processed 3 photos.',{exact:true}).waitFor({timeout:90000});
 assert.deepEqual(await zipNames(),['one-restore.jpg','two-restore.jpg','three-restore.jpg']);
 assert.equal(await dialog.getByRole('alert').count(),0);
 assert.equal(await page.evaluate(()=>window.__batchFault.workers),2);
 // A terminal failure after a successful export retains a valid partial ZIP.
 await reset(2);await process.click();await stopped(1);
 assert.equal(await page.evaluate(()=>window.__batchFault.loads),2);
 assert.deepEqual(await zipNames(),['one-restore.jpg']);
 // Folder output also remains present and later items are not processed.
 await dialog.getByLabel('Selected folder').check();await reset(2);
 await dialog.getByRole('button',{name:'Choose folder and process'}).click();
 await dialog.getByRole('alert').getByText('The photo processing worker stopped.',{exact:false}).waitFor();
 await dialog.getByRole('button',{name:'Choose folder and process'}).waitFor({state:'visible'});
 assert.equal(await dialog.getByRole('button',{name:'Choose folder and process'}).isEnabled(),true);
 const contents=await page.evaluate(()=>window.__batchFault.contents);
 assert.deepEqual(Object.keys(contents),['one.jpg']);assert.ok(contents['one.jpg']>0);
 assert.equal(await page.evaluate(()=>window.__batchFault.loads),2);
 // Cancellation still discards ZIP work, and does not poison a new retry.
 await dialog.getByLabel('ZIP file',{exact:true}).check();await reset(0,true);await process.click();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await dialog.getByText('Batch cancelled. No ZIP was created.',{exact:true}).waitFor();
 assert.equal(await download.count(),0);
 await reset(0);await process.click();await dialog.getByText('Processed 3 photos.',{exact:true}).waitFor({timeout:90000});
 assert.deepEqual(await zipNames(),['one-restore.jpg','two-restore.jpg','three-restore.jpg']);
 console.log('PASS batch terminal failure, partial ZIP/folder retention, cancellation and fresh retry');
 await context.close();
}finally{await browser.close();}
