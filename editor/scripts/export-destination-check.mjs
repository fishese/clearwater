import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
 await context.addInitScript(()=>{
  const files=new Map();window.__savedNames=JSON.parse(sessionStorage.getItem('savedNames')??'[]');window.__cancelPicker=false;
  window.showDirectoryPicker=async()=>{
   if(window.__holdPicker)await new Promise((resolve,reject)=>{window.__resolvePicker=resolve;window.__rejectPicker=reject;});
   if(window.__cancelPicker)throw new DOMException('cancelled','AbortError');
   return {name:'Output only',async getFileHandle(name,options){
    if(!files.has(name)&&!options?.create)throw new DOMException('missing','NotFoundError');
    if(!files.has(name))files.set(name,{name});
    return {...files.get(name),async createWritable(){let chunks=[];return {async write(blob){chunks.push(blob);},async close(){window.__savedNames.push(name);sessionStorage.setItem('savedNames',JSON.stringify(window.__savedNames));},async abort(){chunks=[];}};}};
   }};
  };
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:4176/');
 const hint=page.locator('.web-update-hint-ok');if(await hint.isVisible())await hint.click();
 const pixels=await page.evaluate(async()=>{const c=new OffscreenCanvas(320,240),x=c.getContext('2d');x.fillStyle='#537d8a';x.fillRect(0,0,320,240);return new Uint8Array(await(await c.convertToBlob({type:'image/png'})).arrayBuffer());});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'original.png',mimeType:'image/png',buffer:Buffer.from(pixels)});
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});await ready();
 await page.getByRole('button',{name:'Export photo',exact:true}).click();
 await page.waitForFunction(()=>window.__savedNames?.length===1,null,{timeout:30000});
 assert.equal(await page.evaluate(()=>window.__savedNames[0]),'original.jpg','the output folder needs no matching source file and uses the original stem');
 assert.equal(await page.getByText('Choose the folder containing the original file.',{exact:true}).count(),0,'destination selection does not run source-folder validation');
 await page.getByRole('button',{name:'Export photo',exact:true}).click();
 await page.waitForFunction(()=>window.__savedNames?.length===2,null,{timeout:30000});
 assert.equal(await page.evaluate(()=>window.__savedNames[1]),'original (1).jpg','existing output names receive a numeric suffix');

 // A cancelled destination picker ends before export rendering or file creation.
 await page.reload();await ready();await page.evaluate(()=>window.__cancelPicker=true);
 await page.getByRole('button',{name:'Export photo',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:5000});
 assert.equal(await page.evaluate(()=>window.__savedNames.length),2,'cancelling the picker does not write a file');
 assert.equal(await page.getByRole('dialog',{name:'Exporting photo'}).count(),0,'cancelling the picker does not render an export');
 // Cancellation while the OS picker is pending must retire its success and error continuations.
 for(const reject of [false,true]){
  await page.reload();await ready();
  await page.evaluate(()=>{window.__holdPicker=true;window.__exports=0;const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(data,...args){if(data?.type==='export')window.__exports++;return post.call(this,data,...args);};});
  await page.getByRole('button',{name:'Export photo',exact:true}).click();
  await page.waitForFunction(()=>!!window.__resolvePicker);
  await page.getByRole('button',{name:'Cancel export',exact:true}).click();
  // Retry owns a different pending picker; the retired continuation cannot close it.
  await page.evaluate(()=>{window.__oldResolve=window.__resolvePicker;window.__oldReject=window.__rejectPicker;window.__resolvePicker=null;});
  await page.getByRole('button',{name:'Export photo',exact:true}).click();
  await page.waitForFunction(()=>!!window.__resolvePicker);
  await page.evaluate(reject=>reject?window.__oldReject(new Error('Retired picker failed')):window.__oldResolve(),reject);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>window.__exports),0,'retired picker must not send export');
  assert.equal(await page.getByRole('dialog',{name:'Exporting photo'}).count(),1,'retired picker must not close retry');
  assert.equal(await page.getByText('Retired picker failed',{exact:true}).count(),0);
  const count=await page.evaluate(()=>window.__savedNames.length);
  await page.evaluate(()=>window.__resolvePicker());
  await page.waitForFunction(count=>window.__savedNames.length===count+1,count);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS output destination, collision, picker cancellation, held success/error and retry ownership');
}finally{await browser.close();}
