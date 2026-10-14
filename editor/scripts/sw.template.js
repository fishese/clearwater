const BASE=__BASE__;
const CACHE='__CACHE_NAME__';
const ASSETS=__PRECACHE__;
const OPTIONAL=__OPTIONAL__;
const OPTIONAL_HASHES=__OPTIONAL_HASHES__;
const OPTIONAL_CACHE='clearwater-models-'+CACHE.split('-')[1];
const APP_CACHE_PREFIX='clearwater-'+CACHE.split('-')[1]+'-';
const MODEL_IDS=['wwe','shallow','funie'];
let modelDownload=null;
let stopModelDownload=false;
let modelFetchController=null;
let modelState={state:'incomplete',cached:0,total:OPTIONAL.length};
let modelRunAssets=[];
let lastSelectedModels=MODEL_IDS.slice();
const modelPorts=new Set();
function modelKey(path){return new Request(new URL(path+'?__clearwater_sha256='+OPTIONAL_HASHES[path],self.location.origin));}
function selectedModels(value){return Array.isArray(value)?[...new Set(value.filter(model=>MODEL_IDS.includes(model)))]:MODEL_IDS.slice();}
function assetsForModels(models){return models.length?OPTIONAL.filter(path=>path.endsWith('.wasm')||models.some(model=>path.endsWith('/'+model+'.onnx'))):[];}
async function isExpectedModel(path,response){
  if(!response.ok)return false;
  const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
  const actual=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return actual===OPTIONAL_HASHES[path];
}
function reportModelState(port,state=modelState){try{port?.postMessage({...state});}catch{}}
function broadcastModelState(){for(const port of modelPorts)reportModelState(port);}
async function countCachedModels(cache,paths=OPTIONAL){let cached=0;for(const path of paths)if(await cache.match(modelKey(path)))cached++;return cached;}
function cacheOfflineModels(models,port){
  const paths=assetsForModels(models);lastSelectedModels=models;
  if(modelDownload&&stopModelDownload){reportModelState(port,{state:'downloading',cached:0,total:paths.length});return modelDownload.then(()=>cacheOfflineModels(models,port));}
    if(port)modelPorts.add(port);
    if(modelDownload){for(const path of paths)if(!modelRunAssets.includes(path))modelRunAssets.push(path);modelState={...modelState,state:'downloading',total:modelRunAssets.length};reportModelState(port);return modelDownload;}
    stopModelDownload=false;
    modelRunAssets=paths.slice();
    modelState={state:paths.length?'downloading':'ready',cached:0,total:paths.length};reportModelState(port);
    modelDownload=(async()=>{
      const cache=await caches.open(OPTIONAL_CACHE);
      let cached=await countCachedModels(cache,modelRunAssets);
      modelState={state:cached===modelRunAssets.length?'ready':'downloading',cached,total:modelRunAssets.length};broadcastModelState();
      for(const path of modelRunAssets){
        if(stopModelDownload)break;
        if(await cache.match(modelKey(path)))continue;
        try{
          modelFetchController=new AbortController();
          const response=await fetch(new Request(path,{cache:'reload',signal:modelFetchController.signal}));
          if(await isExpectedModel(path,response))await cache.put(modelKey(path),response.clone());
        }catch{/* Keep earlier assets and continue; a later request resumes the missing set. */}
        finally{modelFetchController=null;}
        if(stopModelDownload)break;
        cached=await countCachedModels(cache,modelRunAssets);
        modelState={state:'downloading',cached,total:modelRunAssets.length};broadcastModelState();
      }
      cached=await countCachedModels(cache,modelRunAssets);
      modelState={state:cached===modelRunAssets.length?'ready':'incomplete',cached,total:modelRunAssets.length};broadcastModelState();
    })().catch(async()=>{
      let cached=0;try{cached=await countCachedModels(await caches.open(OPTIONAL_CACHE),modelRunAssets);}catch{}
      modelState={state:cached===modelRunAssets.length?'ready':'incomplete',cached,total:modelRunAssets.length};broadcastModelState();
    }).finally(()=>{modelDownload=null;modelFetchController=null;stopModelDownload=false;modelRunAssets=[];for(const activePort of modelPorts)try{activePort.close();}catch{}modelPorts.clear();});

    return modelDownload;
}
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE_UPDATE'){event.waitUntil(self.skipWaiting());return;}
  const port=event.ports?.[0];
  if(event.data?.type==='OFFLINE_MODELS_STATUS'){
    const models=selectedModels(event.data.models),paths=assetsForModels(models);lastSelectedModels=models;
    event.waitUntil((async()=>{const cache=await caches.open(OPTIONAL_CACHE);const cached=await countCachedModels(cache,paths);const state={state:cached===paths.length?'ready':'incomplete',cached,total:paths.length};reportModelState(port,state);})());
    return;
  }
  if(event.data?.type==='REMOVE_OFFLINE_MODEL'){
    const model=event.data.model;
    if(!MODEL_IDS.includes(model)){reportModelState(port,{state:'incomplete',cached:0,total:0});return;}
    event.waitUntil((async()=>{
      if(modelDownload){stopModelDownload=true;modelFetchController?.abort();await modelDownload;}
      const cache=await caches.open(OPTIONAL_CACHE),modelPath=OPTIONAL.find(path=>path.endsWith('/'+model+'.onnx'));
      if(modelPath)for(const request of await cache.keys())if(new URL(request.url).pathname===modelPath)await cache.delete(request);
      lastSelectedModels=selectedModels(event.data.models??lastSelectedModels).filter(selected=>selected!==model);
      const paths=assetsForModels(lastSelectedModels),cached=await countCachedModels(cache,paths);
      reportModelState(port,{state:cached===paths.length?'ready':'incomplete',cached,total:paths.length});
    })());
    return;
  }
  if(event.data?.type==='STOP_OFFLINE_MODELS'){
    if(modelDownload){stopModelDownload=true;modelFetchController?.abort();if(port)modelPorts.add(port);event.waitUntil(modelDownload);}
    else if(port)event.waitUntil((async()=>{const paths=assetsForModels(lastSelectedModels),cache=await caches.open(OPTIONAL_CACHE);const cached=await countCachedModels(cache,paths);reportModelState(port,{state:cached===paths.length?'ready':'incomplete',cached,total:paths.length});})());
    return;
  }
  if(event.data?.type==='CACHE_OFFLINE_MODELS')event.waitUntil(cacheOfflineModels(selectedModels(event.data.models),port));
});
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const modelCache=await caches.open(OPTIONAL_CACHE);for(const name of await caches.keys())if(name.startsWith(APP_CACHE_PREFIX)&&name!==CACHE){const previous=await caches.open(name);for(const path of OPTIONAL)if(!await modelCache.match(modelKey(path))){const response=await previous.match(path,{ignoreVary:true});if(response)try{if(await isExpectedModel(path,response))await modelCache.put(modelKey(path),response);}catch{/* Migration is optional; retain normal update behaviour. */}}await caches.delete(name);} const validKeys=new Set(OPTIONAL.map(path=>modelKey(path).url));for(const request of await modelCache.keys())if(!validKeys.has(request.url))await modelCache.delete(request);await self.clients.claim();})());});
async function acceptShare(request){
  const form=await request.formData();
  const files=form.getAll('photos').filter(file=>file instanceof File && file.size<=512*1024*1024 && (/\.(jpe?g|png|heic|heif|dng|mp4|mov)$/i.test(file.name)||['image/jpeg','image/png','image/heic','image/heif','image/dng','image/x-adobe-dng','video/mp4','video/quicktime'].includes(file.type)));
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('clearwater-library',1);r.onupgradeneeded=()=>r.result.createObjectStore('photos',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const addedAt=Date.now();
  const records=files.map((file,i)=>({id:crypto.randomUUID(),file,addedAt:addedAt+i/1000,pendingShare:true}));
  try{await new Promise((resolve,reject)=>{const t=db.transaction('photos','readwrite');for(const record of records)t.objectStore('photos').put(record);t.oncomplete=resolve;const fail=()=>reject(t.error??new Error('Could not save shared files.'));t.onerror=fail;t.onabort=fail;});}finally{db.close();}
  for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'shared-photos',id:records[0]?.id});
  return Response.redirect(new URL(BASE+'?shared='+encodeURIComponent(records[0]?.id??''),request.url),303);
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(event.request.method==='POST'&&url.pathname===BASE+'share') {event.respondWith(acceptShare(event.request).catch(()=>new Response('Could not save the shared files. Reopen ClearWater and choose Open files.',{status:507,headers:{'Content-Type':'text/plain'}})));return;}
  if(event.request.method!=='GET')return;
  // Only application assets are cached; personal photo URLs and API requests never are.
  if(ASSETS.includes(url.pathname)||OPTIONAL.includes(url.pathname)||(event.request.mode==='navigate'&&url.pathname.startsWith(BASE))) event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // These are fixed same-origin build assets. Ignore dev/preview server CORS Vary headers.
    const cached=await cache.match(url.pathname===BASE?BASE+'index.html':url.pathname,{ignoreVary:true});
    if(cached)return cached;
    if(OPTIONAL.includes(url.pathname)){
      const modelCache=await caches.open(OPTIONAL_CACHE),modelRequest=modelKey(url.pathname),model=await modelCache.match(modelRequest);
      if(model)return model;
    }
    let response;try{response=await fetch(OPTIONAL.includes(url.pathname)?new Request(event.request,{cache:'reload'}):event.request);}catch{if(event.request.mode==='navigate'&&url.pathname.startsWith(BASE))return await cache.match(BASE+'index.html',{ignoreVary:true});throw new Error('Asset unavailable offline.');}
    if(OPTIONAL.includes(url.pathname))try{if(await isExpectedModel(url.pathname,response))await (await caches.open(OPTIONAL_CACHE)).put(modelKey(url.pathname),response.clone());}catch{/* Optional model caching must not block the fetched asset. */}
    return response;
  })());
});
