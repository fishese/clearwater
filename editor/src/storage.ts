import { migrateRetiredEngine } from './core/engine';
import type { Recipe } from './core/types';
import { newestPhotos } from './core/library-order';

export interface CameraCapture { uri?:string; name?:string; renderedSha256?:string; enhancedVideo?:boolean }
export interface StoredPhoto {
  id:string; file:File; recipe?:Recipe; thumbnail?:string; addedAt?:number; pendingShare?:boolean;
  cameraCapture?:CameraCapture; sourceUri?:string;
}
type PhotoMetadata=Omit<StoredPhoto,'file'>;
function withCurrentEngines<T extends {recipe?:Recipe}>(photo:T):T {
  return photo.recipe?{...photo,recipe:migrateRetiredEngine(photo.recipe as Recipe & {engine:string}) as Recipe}:photo;
}
const DB='clearwater-library';
const PHOTOS='photos';
const CAMERA_ORIGINALS='camera-originals';

export function openDB():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB,2);
    r.onupgradeneeded=()=>{
      const db=r.result;
      if(!db.objectStoreNames.contains(PHOTOS))db.createObjectStore(PHOTOS,{keyPath:'id'});
      if(!db.objectStoreNames.contains(CAMERA_ORIGINALS))db.createObjectStore(CAMERA_ORIGINALS,{keyPath:'id'});
    };
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
function finishTransaction<T>(db:IDBDatabase,tx:IDBTransaction,value:()=>T):Promise<T>{
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>{db.close();resolve(value());};
    tx.onerror=()=>{db.close();reject(tx.error);};
    tx.onabort=()=>{db.close();reject(tx.error??new Error('The photo library transaction was aborted.'));};
  });
}
function hasFile(value:unknown):value is File {
  return !!value&&typeof value==='object'&&typeof (value as File).name==='string'&&typeof (value as File).slice==='function';
}
function namedCameraFile(original:StoredPhoto,metadata?:PhotoMetadata):File {
  const name=metadata?.cameraCapture?.name??original.cameraCapture?.name;
  if(!name||name===original.file.name)return original.file;
  return new File([original.file],name,{type:original.file.type,lastModified:original.file.lastModified});
}
function validCameraCapture(value:unknown):value is CameraCapture {
  return !!value&&typeof value==='object';
}
async function readStores():Promise<{photos:PhotoMetadata[]; originals:StoredPhoto[]}> {
  const db=await openDB();
  const tx=db.transaction([PHOTOS,CAMERA_ORIGINALS],'readonly');
  const photos=tx.objectStore(PHOTOS).getAll(),originals=tx.objectStore(CAMERA_ORIGINALS).getAll();
  let photoRows:PhotoMetadata[]=[],originalRows:StoredPhoto[]=[];
  photos.onsuccess=()=>{photoRows=photos.result as PhotoMetadata[];};
  originals.onsuccess=()=>{originalRows=originals.result as StoredPhoto[];};
  return finishTransaction(db,tx,()=>({photos:photoRows,originals:originalRows}));
}
let writeQueue:Promise<void>=Promise.resolve();
function enqueueWrite<T>(run:()=>Promise<T>):Promise<T>{
  const next=writeQueue.then(run,run);
  writeQueue=next.then(()=>undefined,()=>undefined);
  return next;
}
export const listPhotos=async()=>{
  const {photos,originals}=await readStores();
  const archived=new Map(originals.filter(p=>hasFile(p.file)&&validCameraCapture(p.cameraCapture)).map(p=>[p.id,p]));
  const joined:StoredPhoto[]=[];
  for(const row of photos){
    if(row.pendingShare===true)continue;
    const original=row.cameraCapture?archived.get(row.id):undefined;
    if(row.cameraCapture&&!original)continue;
    if(original)joined.push(withCurrentEngines({...original,...row,file:namedCameraFile(original,row)}));
    else if(hasFile((row as PhotoMetadata&{file?:unknown}).file))joined.push(withCurrentEngines(row as StoredPhoto));
  }
  return newestPhotos(joined);
};
export const savePhoto=(photo:StoredPhoto)=>enqueueWrite(async()=>{
  const {id,file,recipe,thumbnail,addedAt,pendingShare,cameraCapture,sourceUri}=photo;
  photo={id,file,recipe,thumbnail,addedAt,pendingShare,cameraCapture,sourceUri};
  const db=await openDB();
  const tx=db.transaction(photo.cameraCapture?[PHOTOS,CAMERA_ORIGINALS]:PHOTOS,'readwrite');
  if(photo.cameraCapture){
    const originals=tx.objectStore(CAMERA_ORIGINALS),existing=originals.get(photo.id);
    existing.onsuccess=()=>{
      const archived=existing.result as StoredPhoto|undefined;
      if(!archived||!hasFile(archived.file))originals.put(photo);
      else {
        const {file,...metadata}=photo;
        const name=photo.cameraCapture?.name??archived.file.name;
        const preservedFile=name===archived.file.name?archived.file:new File([archived.file],name,{type:archived.file.type,lastModified:archived.file.lastModified});
        originals.put({...archived,...metadata,file:preservedFile});
      }
    };
    const {file:_,...metadata}=photo;
    tx.objectStore(PHOTOS).put(metadata);
  }else tx.objectStore(PHOTOS).put(photo);
  return finishTransaction(db,tx,()=>undefined);
});
export const deletePhoto=(id:string)=>enqueueWrite(async()=>{
  const db=await openDB(),tx=db.transaction([PHOTOS,CAMERA_ORIGINALS],'readwrite');
  tx.objectStore(PHOTOS).delete(id);tx.objectStore(CAMERA_ORIGINALS).delete(id);
  return finishTransaction(db,tx,()=>undefined);
});
/** Remove a photo from the visible collection while retaining its private camera original. */
export const removePhotoFromCollection=(id:string)=>enqueueWrite(async()=>{
  const db=await openDB(),tx=db.transaction(PHOTOS,'readwrite');
  tx.objectStore(PHOTOS).delete(id);
  return finishTransaction(db,tx,()=>undefined);
});
/** Return camera originals even when their visible collection record has been removed. */
export async function listCameraOriginals():Promise<StoredPhoto[]> {
  const {photos,originals}=await readStores();
  const metadata=new Map(photos.filter(p=>validCameraCapture(p.cameraCapture)).map(p=>[p.id,p]));
  return newestPhotos(originals.filter(p=>hasFile(p.file)&&validCameraCapture(p.cameraCapture)).map(original=>{
    const current=metadata.get(original.id);
    return withCurrentEngines({...original,...current,file:namedCameraFile(original,current)});
  }));
};
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
