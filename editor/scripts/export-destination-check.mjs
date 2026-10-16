import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
 await context.addInitScript(()=>{
  const files=new Map();window.__savedNames=JSON.parse(sessionStorage.getItem('savedNames')??'[]');window.__cancelPicker=false;
  window.showDirectoryPicker=async()=>{
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
 assert.deepEqual(errors,[]);
 console.log('PASS output-only destination, filename collision suffix, and cancellation before export');
}finally{await browser.close();}
