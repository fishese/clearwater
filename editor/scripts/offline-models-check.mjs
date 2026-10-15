import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../dist');
const contentTypes={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.onnx':'application/octet-stream','.json':'application/json','.svg':'image/svg+xml'};
let workerSource=await readFile(resolve(root,'sw.js'),'utf8');
const baseCache=workerSource.match(/const CACHE='(clearwater-[^']+)'/)[1];
const baseHash=baseCache.split('-')[1];
const optional=JSON.parse(workerSource.match(/const OPTIONAL=(\[[^;]+\]);/)[1]);
assert.ok(optional.length>0,'The worker must include bundled ONNX and WASM files.');
const modelBodies=Object.fromEntries(optional.map(path=>[path,Buffer.from('test model payload '+path)]));
const testHashes=Object.fromEntries(Object.entries(modelBodies).map(([path,body])=>[path,createHash('sha256').update(body).digest('hex')]));
workerSource=workerSource.replace(/const OPTIONAL_HASHES=\{[^;]+\};/,`const OPTIONAL_HASHES=${JSON.stringify(testHashes)};`);
const selectedModels=['wwe','shallow'];
const selectedPaths=optional.filter(path=>path.endsWith('.wasm')||selectedModels.some(model=>path.endsWith('/'+model+'.onnx')));
const fiveaPath=optional.find(path=>path.endsWith('/fivea.onnx'));
let failingPath=selectedPaths.find(path=>path.endsWith('/wwe.onnx'));
let failEnabled=true;
let corruptNext=false;
let holdPath=null;
const modelHits=new Map();
let updateVersion=0;

const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  if(pathname==='/sw.js'){
    const cacheName=updateVersion===0?baseCache:`clearwater-${baseHash}-uiupdate${String(updateVersion).padStart(6,'0')}`;
    const served=workerSource.replace(`const CACHE='${baseCache}'`,`const CACHE='${cacheName}'`);
    res.writeHead(200,{'Content-Type':'text/javascript'});res.end(served);return;
  }
  if(optional.includes(pathname)){
    if(pathname===holdPath){await new Promise(resolve=>res.once('close',resolve));return;}
    modelHits.set(pathname,(modelHits.get(pathname)??0)+1);
    if(failEnabled&&pathname===failingPath){res.writeHead(503);res.end('temporary offline');return;}
    if(corruptNext&&pathname===failingPath){corruptNext=false;res.writeHead(200,{'Content-Type':'text/html'});res.end('<html>stale response</html>');return;}
    res.writeHead(200,{'Content-Type':pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream'});res.end(modelBodies[pathname]);return;
  }
  try{
    const file=pathname==='/'?'index.html':pathname.slice(1);
    const body=await readFile(resolve(root,file));
    res.writeHead(200,{'Content-Type':contentTypes[extname(file)]??'application/octet-stream'});res.end(body);
  }catch{res.writeHead(404);res.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:process.env.CLEARWATER_BROWSER??'msedge',headless:true});
try{
  const context=await browser.newContext();
  const page=await context.newPage();
  await page.goto(origin);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const callWorker=(type,extra={})=>page.evaluate(({type,extra})=>new Promise((resolve,reject)=>{
    const controller=navigator.serviceWorker.controller;if(!controller){reject(new Error('No controlling service worker'));return;}
    const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('Worker message timed out: '+type));},30000);
    channel.port1.onmessage=event=>{if(event.data?.state==='downloading')return;clearTimeout(timer);channel.port1.close();resolve(event.data);};
    controller.postMessage({type,...extra},[channel.port2]);
  }),{type,extra});
  const startAndStopCache=()=>page.evaluate(models=>new Promise((resolve,reject)=>{
    const controller=navigator.serviceWorker.controller,downloadChannel=new MessageChannel(),stopChannel=new MessageChannel();let stopSent=false;
    const timer=setTimeout(()=>reject(new Error('Worker stop message timed out.')),30000);
    downloadChannel.port1.onmessage=event=>{
      if(event.data?.state==='downloading'&&!stopSent){stopSent=true;controller.postMessage({type:'STOP_OFFLINE_MODELS'},[stopChannel.port2]);}
      if(stopSent&&event.data?.state!=='downloading'){clearTimeout(timer);downloadChannel.port1.close();resolve(event.data);}
    };
    controller.postMessage({type:'CACHE_OFFLINE_MODELS',models},[downloadChannel.port2]);
  }),selectedModels);
  const activateWorkerUpdate=()=>page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready;
    await new Promise(async(resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Updated service worker did not take control.')),30000);
      navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;if(!worker)return;
        worker.addEventListener('statechange',()=>{if(worker.state==='installed')worker.postMessage({type:'ACTIVATE_UPDATE'});});
      },{once:true});
      try{await registration.update();if(registration.waiting)registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});}catch(error){clearTimeout(timer);reject(error);}
    });
  });

  await page.evaluate(path=>fetch(path).then(response=>{if(!response.ok)throw new Error('on-demand model fetch failed');}),fiveaPath);
  const initial=await callWorker('OFFLINE_MODELS_STATUS',{models:selectedModels});
  assert.deepEqual(initial,{state:'incomplete',cached:0,total:selectedPaths.length},'Selected status must exclude an on-demand unselected model.');
  holdPath=failingPath;
  const stopped=await startAndStopCache();
  holdPath=null;
  assert.deepEqual(stopped,{state:'incomplete',cached:0,total:selectedPaths.length},'Stopping automatic caching should retain completed files and finish incomplete.');
  const interrupted=await callWorker('CACHE_OFFLINE_MODELS',{models:selectedModels});
  assert.equal(interrupted.state,'incomplete');assert.equal(interrupted.cached,selectedPaths.length-1,'A failed download must preserve completed assets.');
  failEnabled=false;
  corruptNext=true;
  const rejectedStale=await callWorker('CACHE_OFFLINE_MODELS',{models:selectedModels});
  assert.deepEqual(rejectedStale,{state:'incomplete',cached:selectedPaths.length-1,total:selectedPaths.length},'A stale successful HTTP response must fail digest validation.');
  const retried=await callWorker('CACHE_OFFLINE_MODELS',{models:selectedModels});
  assert.deepEqual(retried,{state:'ready',cached:selectedPaths.length,total:selectedPaths.length},'Retry should fetch only the missing model.');
  assert.equal(modelHits.get(failingPath),3,'Retries should resume only the one missing asset.');
  assert.equal(modelHits.get(fiveaPath),1,'Bulk caching should skip unselected models.');

  await context.setOffline(true);
  const offlineResults=await page.evaluate(async paths=>Promise.all(paths.map(async path=>({path,status:(await fetch(path)).status}))),[...selectedPaths,fiveaPath]);
  assert.ok(offlineResults.every(result=>result.status===200),'Selected models, shared WASM, and explicitly loaded unselected model should load offline.');
  await page.reload();await page.getByRole('heading').waitFor();

  await context.setOffline(false);
  updateVersion=1;
  await activateWorkerUpdate();
  const afterUpdate=await callWorker('OFFLINE_MODELS_STATUS',{models:selectedModels});
  assert.deepEqual(afterUpdate,{state:'ready',cached:selectedPaths.length,total:selectedPaths.length},'UI-only worker update should retain hash-matched selected models.');

  modelBodies[failingPath]=Buffer.from('updated model payload '+failingPath);
  testHashes[failingPath]=createHash('sha256').update(modelBodies[failingPath]).digest('hex');
  workerSource=workerSource.replace(/const OPTIONAL_HASHES=\{[^;]+\};/,`const OPTIONAL_HASHES=${JSON.stringify(testHashes)};`);
  updateVersion=2;
  await activateWorkerUpdate();
  const changedWeight=await callWorker('OFFLINE_MODELS_STATUS',{models:selectedModels});
  assert.deepEqual(changedWeight,{state:'incomplete',cached:selectedPaths.length-1,total:selectedPaths.length},'A changed model digest must miss the old cached file.');
  const refreshed=await callWorker('CACHE_OFFLINE_MODELS',{models:selectedModels});
  assert.deepEqual(refreshed,{state:'ready',cached:selectedPaths.length,total:selectedPaths.length},'A changed model should download and validate at its new digest.');
  assert.equal(modelHits.get(failingPath),4,'A changed model should be fetched again after its digest changes.');

  const removed=await callWorker('REMOVE_OFFLINE_MODEL',{model:'fivea'});
  assert.deepEqual(removed,{state:'ready',cached:selectedPaths.length,total:selectedPaths.length},'Removing an unselected model should preserve selected models and shared runtimes.');
  const removalCheck=await page.evaluate(async path=>{const cache=await caches.open((await caches.keys()).find(name=>name.startsWith('clearwater-models-')));return (await cache.keys()).some(request=>new URL(request.url).pathname===path);},fiveaPath);
  assert.equal(removalCheck,false,'Deselecting a model should remove its cached model file.');
  await context.close();
  console.log(`PASS optional offline cache protocol (${optional.length} ONNX/WASM assets): selection, on-demand, stop/retry, digest validation, cold offline fetch, UI-only reuse, changed-model redownload, and targeted removal.`);
}finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
