import type { Recipe } from './core/types';
export interface StoredPhoto { id:string; file:File; recipe?:Recipe; thumbnail?:string }
const DB='clearwater-library';
export function openDB():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>{r.result.createObjectStore('photos',{keyPath:'id'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
async function transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const t=db.transaction('photos',mode),r=run(t.objectStore('photos'));let value:T;
    r.onsuccess=()=>{value=r.result;};t.oncomplete=()=>{db.close();resolve(value);};
    t.onerror=()=>{db.close();reject(t.error);};t.onabort=()=>{db.close();reject(t.error);};
  });
}
export const listPhotos=()=>transaction('readonly',s=>s.getAll()) as Promise<StoredPhoto[]>;
export const savePhoto=(photo:StoredPhoto)=>transaction('readwrite',s=>s.put(photo));
export const deletePhoto=(id:string)=>transaction('readwrite',s=>s.delete(id));
