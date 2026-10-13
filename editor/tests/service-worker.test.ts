import {readFile} from 'node:fs/promises';
import {describe,expect,it,vi} from 'vitest';

const template=await readFile(new URL('../scripts/sw.template.js',import.meta.url),'utf8');
function worker(cache:CacheLike,fetcher:(request:Request)=>Promise<Response>,indexedDB:Record<string,unknown>={}){
 const listeners=new Map<string,(event:any)=>void>();
 const self={location:{origin:'https://clearwater.test'},clients:{matchAll:vi.fn(async()=>[])},addEventListener:(name:string,listener:(event:any)=>void)=>listeners.set(name,listener)};
 const caches={open:vi.fn(async()=>cache)};
 const source=template.replace('__CACHE_NAME__','"clearwater-test"').replace('__BASE__','"/"').replace('__PRECACHE__','[]').replace('__OPTIONAL__','["/model.wasm"]');
 new Function('self','caches','fetch','URL','Response','File','indexedDB','crypto',source)(self,caches,fetcher,URL,Response,File,indexedDB,crypto);
 return {onFetch:listeners.get('fetch')!,caches};
}
type CacheLike={match:(request:string,options?:CacheQueryOptions)=>Promise<Response|undefined>;put:(request:string,response:Response)=>Promise<void>};
function request(onFetch:(event:any)=>void){
 let response:Promise<Response>|undefined;
 onFetch({request:new Request('https://clearwater.test/model.wasm'),respondWith(value:Promise<Response>){response=value;}});
 return response!;
}

describe('service worker optional asset caching',()=>{
 it('returns a fetched model when storing the optional cache entry fails',async()=>{
  const cache:CacheLike={match:vi.fn(async()=>undefined),put:vi.fn(async()=>{throw new Error('QuotaExceededError');})};
  const fetcher=vi.fn(async()=>new Response('model bytes'));
  const {onFetch}=worker(cache,fetcher);
  const response=await request(onFetch);
  expect(await response.text()).toBe('model bytes');
  expect(fetcher).toHaveBeenCalledOnce();expect(cache.put).toHaveBeenCalledOnce();
 });

 it('still reports an unavailable asset when the network fetch itself fails',async()=>{
  const cache:CacheLike={match:vi.fn(async()=>undefined),put:vi.fn()};
  const fetcher=vi.fn(async()=>{throw new TypeError('Network unavailable');});
  const {onFetch}=worker(cache,fetcher);
  await expect(request(onFetch)).rejects.toThrow('Asset unavailable offline.');
  expect(fetcher).toHaveBeenCalledOnce();expect(cache.put).not.toHaveBeenCalled();
 });

 it('closes the library database when saving a shared file aborts',async()=>{
  const transaction:any={objectStore:()=>({put:vi.fn()}),error:null};
  const database={transaction:vi.fn(()=>{setTimeout(()=>transaction.onabort?.(),0);return transaction;}),close:vi.fn()};
  const openRequest:any={result:database};
  const indexedDB={open:vi.fn(()=>{setTimeout(()=>openRequest.onsuccess?.(),0);return openRequest;})};
  const {onFetch}=worker({match:vi.fn(async()=>undefined),put:vi.fn()},vi.fn(async()=>new Response()),indexedDB);
  const form=new FormData();form.append('photos',new File(['photo'],'shared.jpg',{type:'image/jpeg'}));
  let response:Promise<Response>|undefined;
  onFetch({request:new Request('https://clearwater.test/share',{method:'POST',body:form}),respondWith(value:Promise<Response>){response=value;}});
  const result=await response!;
  expect(result.status).toBe(507);expect(database.close).toHaveBeenCalledOnce();
 });

 it('keeps incoming shares marked as queued until the app promotes them',async()=>{
  const saved:Record<string,unknown>[]=[];
  const transaction:any={objectStore:()=>({put:(record:Record<string,unknown>)=>saved.push(record)}),error:null};
  const database={transaction:vi.fn(()=>{setTimeout(()=>transaction.oncomplete?.(),0);return transaction;}),close:vi.fn()};
  const openRequest:any={result:database};
  const indexedDB={open:vi.fn(()=>{setTimeout(()=>openRequest.onsuccess?.(),0);return openRequest;})};
  const {onFetch}=worker({match:vi.fn(async()=>undefined),put:vi.fn()},vi.fn(async()=>new Response()),indexedDB);
  const form=new FormData();form.append('photos',new File(['photo'],'shared.jpg',{type:'image/jpeg'}));
  let response:Promise<Response>|undefined;
  onFetch({request:new Request('https://clearwater.test/share',{method:'POST',body:form}),respondWith(value:Promise<Response>){response=value;}});
  const result=await response!;
  expect(result.status).toBe(303);expect(saved).toHaveLength(1);expect(saved[0].pendingShare).toBe(true);expect(database.close).toHaveBeenCalledOnce();
 });
});
