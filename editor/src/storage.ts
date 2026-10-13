import type { Recipe } from './core/types';
export interface StoredPhoto { id:string; file:File; recipe?:Recipe; thumbnail?:string;addedAt?:number;pendingShare?:boolean }
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
let writeQueue:Promise<void>=Promise.resolve();
function enqueueWrite<T>(run:()=>Promise<T>):Promise<T>{
  const next=writeQueue.then(run,run);
  writeQueue=next.then(()=>undefined,()=>undefined);
  return next;
}
export const listPhotos=async()=>((await transaction('readonly',s=>s.getAll())) as StoredPhoto[]).filter(photo=>photo.pendingShare!==true).sort((a,b)=>(a.addedAt??0)-(b.addedAt??0)||a.file.name.localeCompare(b.file.name));
export const savePhoto=(photo:StoredPhoto)=>enqueueWrite(()=>transaction('readwrite',s=>s.put(photo)));
export const deletePhoto=(id:string)=>enqueueWrite(()=>transaction('readwrite',s=>s.delete(id)));
/** Move service-worker share records into the visible collection after intake completes. */
export function promoteSharedPhotos(ids?:readonly string[]):Promise<void>{
  return enqueueWrite(async()=>{
    const db=await openDB();
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('photos','readwrite'),store=tx.objectStore('photos'),request=store.getAll(),wanted=ids?new Set(ids):null;
      request.onsuccess=()=>{for(const record of request.result as StoredPhoto[])if(record.pendingShare===true&&(!wanted||wanted.has(record.id))){const {pendingShare:_,...photo}=record;store.put(photo);}};
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error??new Error('Could not add shared files.'));tx.onabort=()=>reject(tx.error??new Error('Could not add shared files.'));
    }).finally(()=>db.close());
  });
}
/** Remove only the app's imported photo and recipe records. Other databases and stores are untouched. */
export function clearPhotos():Promise<void> {
  return enqueueWrite(async()=>{
  const db=await openDB();
  await new Promise<void>((resolve,reject)=>{
    const t=db.transaction('photos','readwrite'),request=t.objectStore('photos').openCursor();
    request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const record=cursor.value as StoredPhoto;if(record.pendingShare!==true)cursor.delete();cursor.continue();};
    t.oncomplete=()=>resolve();
    t.onerror=()=>reject(t.error??new Error('Could not clear the photo collection.'));
    t.onabort=()=>reject(t.error??new Error('Could not clear the photo collection.'));
  }).finally(()=>db.close());
  });
}
