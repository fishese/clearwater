import {afterEach,describe,expect,it,vi} from 'vitest';
import {savePhoto,type StoredPhoto} from '../src/storage';

function memoryIndexedDB(){
 const stores=new Map<string,Map<string,unknown>>();
 const factory={open:()=>{
  const request:any={};const db:any={close(){},objectStoreNames:{contains:()=>true},transaction(names:string|string[]){
   const tx:any={oncomplete:null,onerror:null,onabort:null,objectStore(name:string){
    let rows=stores.get(name);if(!rows){rows=new Map();stores.set(name,rows);}
    return {get(id:string){const result:any={onsuccess:null,onerror:null};queueMicrotask(()=>{result.result=rows!.get(id);result.onsuccess?.();});return result;},put(value:any){rows!.set(value.id,value);queueMicrotask(()=>tx.oncomplete?.());},delete(id:string){rows!.delete(id);queueMicrotask(()=>tx.oncomplete?.());}};
   }};
   return tx;
  }};
  queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;
 }};
 return {factory:factory as unknown as IDBFactory,stores};
}

afterEach(()=>vi.unstubAllGlobals());

describe('photo source persistence',()=>{
 it('keeps the first valid imported bytes across recipe writes and rejects empty replacements',async()=>{
  const {factory,stores}=memoryIndexedDB();vi.stubGlobal('indexedDB',factory);
  const original=new File(['original-camera-roll-bytes'],'imported.jpg',{type:'image/jpeg'});
  const photo:StoredPhoto={id:'imported-photo',file:original,addedAt:1};
  await savePhoto(photo);
  await savePhoto({...photo,file:new File(['different-bytes'],'imported.jpg',{type:'image/jpeg'}),recipe:{version:1} as any});
  await savePhoto({...photo,file:new File([],'imported.jpg',{type:'image/jpeg'}),recipe:{version:2} as any});
  const saved=stores.get('photos')?.get(photo.id) as StoredPhoto;
  expect(await saved.file.text()).toBe('original-camera-roll-bytes');
  expect(saved.recipe?.version).toBe(2);
 });
});
