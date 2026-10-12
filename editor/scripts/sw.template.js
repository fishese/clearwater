const BASE=__BASE__;
const CACHE='__CACHE_NAME__';
const ASSETS=__PRECACHE__;
const OPTIONAL=__OPTIONAL__;
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith(CACHE.slice(0,20))&&name!==CACHE)await caches.delete(name);await self.clients.claim();})());});
async function acceptShare(request){
  const form=await request.formData();
  const files=form.getAll('photos').filter(file=>file instanceof File && file.size<=60*1024*1024 && (/\.(jpe?g|png|heic|heif)$/i.test(file.name)||['image/jpeg','image/png','image/heic','image/heif'].includes(file.type)));
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('clearwater-library',1);r.onupgradeneeded=()=>r.result.createObjectStore('photos',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const addedAt=Date.now();
  const records=files.map((file,i)=>({id:crypto.randomUUID(),file,addedAt:addedAt+i/1000}));
  await new Promise((resolve,reject)=>{const t=db.transaction('photos','readwrite');for(const record of records)t.objectStore('photos').put(record);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();
  for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'shared-photos',id:records[0]?.id});
  return Response.redirect(new URL(BASE+'?shared='+encodeURIComponent(records[0]?.id??''),request.url),303);
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(event.request.method==='POST'&&url.pathname===BASE+'share') {event.respondWith(acceptShare(event.request).catch(()=>new Response('Could not save the shared photos. Reopen ClearWater and choose Open photos.',{status:507,headers:{'Content-Type':'text/plain'}})));return;}
  if(event.request.method!=='GET')return;
  // Only application assets are cached; personal photo URLs and API requests never are.
  if(ASSETS.includes(url.pathname)||OPTIONAL.includes(url.pathname)||(event.request.mode==='navigate'&&url.pathname.startsWith(BASE))) event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // These are fixed same-origin build assets. Ignore dev/preview server CORS Vary headers.
    const cached=await cache.match(url.pathname===BASE?BASE+'index.html':url.pathname,{ignoreVary:true});
    if(cached)return cached;
    try{const response=await fetch(event.request);if(response.ok&&OPTIONAL.includes(url.pathname))await cache.put(url.pathname,response.clone());return response;}catch{if((event.request.mode==='navigate'&&url.pathname.startsWith(BASE)))return await cache.match(BASE+'index.html',{ignoreVary:true});throw new Error('Asset unavailable offline.');}
  })());
});
