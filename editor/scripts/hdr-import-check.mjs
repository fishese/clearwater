import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../..'),dir=resolve(root,'analysis/video-check');
const hdr=await readFile(resolve(dir,'hdr.mov')),sdr=await readFile(resolve(dir,'h264-audio.mp4'));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1200,height:850}});
 await context.addInitScript(()=>{
  window.androidBridge={};window.hdrCalls=[];window.hdrMode='success';window.rejectHdr=null;
  const hdrMethods=['beginHdrInput','writeHdrInputChunk','finishHdrInput','convertHdrToSdr','cancelHdrConversion','deleteHdrWorkingCopy'];
  const fileMethods=['getRememberedModel','drainShares','releaseShare'];
  window.Capacitor={PluginHeaders:[
   {name:'ClearWaterHdr',methods:[...hdrMethods.map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'promise'}]},
   {name:'ClearWaterFiles',methods:[...fileMethods.map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'promise'}]}
  ],convertFileSrc:uri=>uri,nativeCallback:()=>Promise.resolve('test-listener'),async nativePromise(plugin,method,options){
   if(plugin==='ClearWaterHdr'){
    window.hdrCalls.push({method,options});
    if(method==='beginHdrInput')return {id:'hdr-test'};
    if(method==='convertHdrToSdr'){
     if(window.hdrMode==='cancel')return new Promise((resolve,reject)=>{window.rejectHdr=()=>reject(new DOMException('HDR conversion cancelled.','AbortError'));});
     return {id:'hdr-test',uri:'https://clearwater.test/sdr.mp4'};
    }
    if(method==='cancelHdrConversion'){window.rejectHdr?.();return {};}
    return {};
   }
   if(plugin==='ClearWaterFiles'&&method==='getRememberedModel')return {present:false,hasFile:false};
   if(plugin==='ClearWaterFiles'&&method==='drainShares')return {photos:[]};
   return {};
  }};
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://clearwater.test/sdr.mp4',route=>route.fulfill({status:200,contentType:'video/mp4',body:sdr}));
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:5173/');
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'iPhone-HDR.mov',mimeType:'video/quicktime',buffer:hdr});
 await page.locator('.hdr-note').waitFor({timeout:120000});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 assert.equal(await page.locator('.filename').innerText(),'iPhone-HDR.mov');
 assert.equal(await page.locator('.hdr-note').innerText(),'HDR → SDR working copy. The original file is kept.');
 assert.ok(await page.evaluate(()=>window.hdrCalls.some(call=>call.method==='writeHdrInputChunk')),'source should be streamed to the mocked native bridge');
 const stored=await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('clearwater-library');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const items=await new Promise((resolve,reject)=>{const req=db.transaction('photos').objectStore('photos').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();
  const photo=items.find(item=>item.file.name==='iPhone-HDR.mov');if(!photo)return null;
  const bytes=await photo.file.arrayBuffer();return {name:photo.file.name,type:photo.file.type,size:photo.file.size,digest:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).join(',')};
 });
 assert.deepEqual(stored,{name:'iPhone-HDR.mov',type:'video/quicktime',size:hdr.length,digest:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',hdr))).join(',')});
 assert.equal(await page.evaluate(()=>window.hdrCalls.some(call=>call.method==='deleteHdrWorkingCopy')) ,true,'native temporary output is released after fetch');
 assert.deepEqual(errors,[]);
 console.log('PASS actual App/worker HDR route with tagged PQ fixture and mocked Android bridge; source name and IndexedDB bytes stay original.');
 await context.close();

 const cancelled=await browser.newContext({viewport:{width:1200,height:850}});
 await cancelled.addInitScript(()=>{
  window.androidBridge={};window.hdrMode='cancel';window.rejectHdr=null;
  const methods=['beginHdrInput','writeHdrInputChunk','finishHdrInput','convertHdrToSdr','cancelHdrConversion','deleteHdrWorkingCopy'];
  window.Capacitor={PluginHeaders:[{name:'ClearWaterHdr',methods:[...methods.map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'promise'}]},{name:'ClearWaterFiles',methods:[{name:'getRememberedModel',rtype:'promise'},{name:'drainShares',rtype:'promise'},{name:'releaseShare',rtype:'promise'},{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'promise'}]}],convertFileSrc:uri=>uri,nativeCallback:()=>Promise.resolve('test-listener'),async nativePromise(plugin,method){
   if(plugin==='ClearWaterHdr'&&method==='beginHdrInput')return {id:'cancel-test'};
   if(plugin==='ClearWaterHdr'&&method==='convertHdrToSdr')return new Promise((resolve,reject)=>{window.rejectHdr=()=>reject(new DOMException('HDR conversion cancelled.','AbortError'));});
   if(plugin==='ClearWaterHdr'&&method==='cancelHdrConversion'){window.rejectHdr?.();return {};}
   if(plugin==='ClearWaterFiles'&&method==='getRememberedModel')return {present:false,hasFile:false};
   if(plugin==='ClearWaterFiles'&&method==='drainShares')return {photos:[]};return {};
  }};
 });
 const cancelPage=await cancelled.newPage(),cancelErrors=[];cancelPage.on('pageerror',error=>cancelErrors.push(error.message));
 await cancelPage.goto(process.env.CHECK_URL||'http://127.0.0.1:5173/');
 await cancelPage.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'iPhone-HDR.mov',mimeType:'video/quicktime',buffer:hdr});
 await cancelPage.getByRole('dialog').getByRole('button',{name:'Cancel conversion',exact:true}).waitFor({timeout:120000});
 await cancelPage.getByRole('dialog').getByRole('button',{name:'Cancel conversion',exact:true}).click();
 await cancelPage.getByRole('dialog').waitFor({state:'detached',timeout:30000});
 await cancelPage.getByText('HDR conversion cancelled.',{exact:false}).waitFor({timeout:30000});
 const cancelStored=await cancelPage.evaluate(async()=>{const db=await new Promise(resolve=>{const req=indexedDB.open('clearwater-library');req.onsuccess=()=>resolve(req.result);});const items=await new Promise(resolve=>{const req=db.transaction('photos').objectStore('photos').getAll();req.onsuccess=()=>resolve(req.result);});db.close();return items.filter(item=>item.file.name==='iPhone-HDR.mov').length;});
 assert.equal(cancelStored,1,'cancel leaves one persisted original');assert.deepEqual(cancelErrors,[]);
 console.log('PASS actual App cancellation route preserves the original collection entry.');
 await cancelled.close();
}finally{await browser.close();}
