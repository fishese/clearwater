import { migrateRetiredEngine } from './core/engine';
import type { Recipe } from './core/types';
import { newestPhotos } from './core/library-order';
import type { IOSCaptureDescriptor } from './platform/ios-camera';

export interface CameraCapture { uri?:string; name?:string; renderedSha256?:string; enhancedVideo?:boolean }
export interface NativeCaptureSource { descriptor:IOSCaptureDescriptor; loaded:boolean }
export interface StoredPhoto {
  id:string; file:File; recipe?:Recipe; thumbnail?:string; addedAt?:number; pendingShare?:boolean;
  cameraCapture?:CameraCapture; sourceUri?:string; nativeCapture?:NativeCaptureSource; previewFile?:File;
}
type PhotoMetadata=Omit<StoredPhoto,'file'|'previewFile'|'nativeCapture'>;
function withCurrentEngines<T extends {recipe?:Recipe}>(photo:T):T {
  return photo.recipe?{...photo,recipe:migrateRetiredEngine(photo.recipe as Recipe & {engine:string}) as Recipe}:photo;
}
const DB='clearwater-library';
const PHOTOS='photos';
const CAMERA_ORIGINALS='camera-originals';
const PHOTO_METADATA='photo-metadata';

export function openDB():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB,3);
    r.onupgradeneeded=()=>{
      const db=r.result;
      if(!db.objectStoreNames.contains(PHOTOS))db.createObjectStore(PHOTOS,{keyPath:'id'});
      if(!db.objectStoreNames.contains(CAMERA_ORIGINALS))db.createObjectStore(CAMERA_ORIGINALS,{keyPath:'id'});
      if(!db.objectStoreNames.contains(PHOTO_METADATA))db.createObjectStore(PHOTO_METADATA,{keyPath:'id'});
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
function hasSourceBytes(value:unknown):value is File {
  return hasFile(value)&&(value as File).size>0;
}
function namedCameraFile(original:StoredPhoto,metadata?:PhotoMetadata):File {
  const name=metadata?.cameraCapture?.name??original.cameraCapture?.name;
  if(!name||name===original.file.name)return original.file;
  return new File([original.file],name,{type:original.file.type,lastModified:original.file.lastModified});
}
function validCameraCapture(value:unknown):value is CameraCapture {
  return !!value&&typeof value==='object';
}
async function readStores():Promise<{photos:StoredPhoto[]; originals:StoredPhoto[]; metadata:PhotoMetadata[]}> {
  const db=await openDB();
  const tx=db.transaction([PHOTOS,CAMERA_ORIGINALS,PHOTO_METADATA],'readonly');
  const photos=tx.objectStore(PHOTOS).getAll(),originals=tx.objectStore(CAMERA_ORIGINALS).getAll(),metadata=tx.objectStore(PHOTO_METADATA).getAll();
  let photoRows:StoredPhoto[]=[],originalRows:StoredPhoto[]=[],metadataRows:PhotoMetadata[]=[];
  photos.onsuccess=()=>{photoRows=photos.result as StoredPhoto[];};
  originals.onsuccess=()=>{originalRows=originals.result as StoredPhoto[];};
  metadata.onsuccess=()=>{metadataRows=metadata.result as PhotoMetadata[];};
  return finishTransaction(db,tx,()=>({photos:photoRows,originals:originalRows,metadata:metadataRows}));
}
let writeQueue:Promise<void>=Promise.resolve();
function enqueueWrite<T>(run:()=>Promise<T>):Promise<T>{
  const next=writeQueue.then(run,run);
  writeQueue=next.then(()=>undefined,()=>undefined);
  return next;
}
export const listPhotos=async()=>{
  const {photos,originals,metadata}=await readStores();
  const archived=new Map(originals.filter(p=>hasFile(p.file)&&validCameraCapture(p.cameraCapture)).map(p=>[p.id,p]));
  const updates=new Map(metadata.map(p=>[p.id,p]));
  const joined:StoredPhoto[]=[];
  for(const stored of photos){
    const row={...stored,...updates.get(stored.id)};
    if(row.pendingShare===true)continue;
    const original=row.cameraCapture?archived.get(row.id):undefined;
    if(row.cameraCapture&&!original)continue;
    if(original)joined.push(withCurrentEngines({...original,...row,file:namedCameraFile(original,row)}));
    else if(hasFile(row.file))joined.push(withCurrentEngines(row));
  }
  return newestPhotos(joined);
};
export const savePhoto=(photo:StoredPhoto)=>enqueueWrite(async()=>{
  // iOS camera sources belong to the native manifest. Persisting a hydrated File
  // here would create a second full-size private copy in IndexedDB.
  if(photo.nativeCapture)return;
  const {id,file,recipe,thumbnail,addedAt,pendingShare,cameraCapture,sourceUri}=photo;
  photo={id,file,recipe,thumbnail,addedAt,pendingShare,cameraCapture,sourceUri};
  const db=await openDB();
  const tx=db.transaction(photo.cameraCapture?[PHOTOS,CAMERA_ORIGINALS,PHOTO_METADATA]:[PHOTOS,PHOTO_METADATA],'readwrite');
  const {file:_,...metadata}=photo;
  if(photo.cameraCapture){
    const originals=tx.objectStore(CAMERA_ORIGINALS),existing=originals.get(photo.id);
    existing.onsuccess=()=>{
      const archived=existing.result as StoredPhoto|undefined;
      // Never re-serialize an IndexedDB-backed File just to update a recipe or
      // gallery name. WebKit can fail these repeated Blob writes.
      if((!archived||!hasSourceBytes(archived.file))&&hasSourceBytes(photo.file))originals.put(photo);
    };
    tx.objectStore(PHOTOS).put(metadata);
    tx.objectStore(PHOTO_METADATA).put(metadata);
  }else{
    const store=tx.objectStore(PHOTOS),existing=store.get(photo.id);
    existing.onsuccess=()=>{
      const current=existing.result as StoredPhoto|undefined;
      if(current&&hasSourceBytes(current.file))tx.objectStore(PHOTO_METADATA).put(metadata);
      else if(hasSourceBytes(photo.file)){store.put(photo);tx.objectStore(PHOTO_METADATA).put(metadata);}
    };
  }
  return finishTransaction(db,tx,()=>undefined);
});
export const deletePhoto=(id:string)=>enqueueWrite(async()=>{
  const db=await openDB(),tx=db.transaction([PHOTOS,CAMERA_ORIGINALS,PHOTO_METADATA],'readwrite');
  tx.objectStore(PHOTOS).delete(id);tx.objectStore(CAMERA_ORIGINALS).delete(id);tx.objectStore(PHOTO_METADATA).delete(id);
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
  const {photos,originals,metadata}=await readStores();
  const visible=new Map(photos.filter(p=>validCameraCapture(p.cameraCapture)).map(p=>[p.id,p]));
  const updates=new Map(metadata.map(p=>[p.id,p]));
  return newestPhotos(originals.filter(p=>hasFile(p.file)&&validCameraCapture(p.cameraCapture)).map(original=>{
    const current=updates.get(original.id)??visible.get(original.id);
    return withCurrentEngines({...original,...current,file:namedCameraFile(original,current)});
  }));
};
/** Move service-worker share records into the visible collection after intake completes. */
export function promoteSharedPhotos(ids?:readonly string[]):Promise<void>{
  return enqueueWrite(async()=>{
    const db=await openDB();
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction([PHOTOS,PHOTO_METADATA],'readwrite'),store=tx.objectStore(PHOTOS),updates=tx.objectStore(PHOTO_METADATA),request=store.getAll(),wanted=ids?new Set(ids):null;
      request.onsuccess=()=>{for(const record of request.result as StoredPhoto[])if(record.pendingShare===true&&(!wanted||wanted.has(record.id))){
        const existing=updates.get(record.id);
        existing.onsuccess=()=>{
          if(existing.result){if(existing.result.pendingShare===true)updates.put({...existing.result,pendingShare:false});return;}
          const {file:_,...photo}=record;updates.put({...photo,pendingShare:false});
        };
      }};
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error??new Error('Could not add shared files.'));tx.onabort=()=>reject(tx.error??new Error('Could not add shared files.'));
    }).finally(()=>db.close());
  });
}
/** Remove only the app's imported photo and recipe records. Other databases and stores are untouched. */
export function clearPhotos():Promise<void> {
  return enqueueWrite(async()=>{
  const db=await openDB();
  await new Promise<void>((resolve,reject)=>{
    const t=db.transaction([PHOTOS,PHOTO_METADATA],'readwrite'),updates=t.objectStore(PHOTO_METADATA),metadata=updates.getAll();
    metadata.onsuccess=()=>{
      const current=new Map((metadata.result as PhotoMetadata[]).map(p=>[p.id,p]));
      const request=t.objectStore(PHOTOS).openCursor();
      request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const record=cursor.value as StoredPhoto;
        const pending=current.has(record.id)?current.get(record.id)?.pendingShare:record.pendingShare;
        if(pending!==true){cursor.delete();if(!record.cameraCapture)updates.delete(record.id);}
        cursor.continue();
      };
    };
    t.oncomplete=()=>resolve();
    t.onerror=()=>reject(t.error??new Error('Could not clear the photo collection.'));
    t.onabort=()=>reject(t.error??new Error('Could not clear the photo collection.'));
  }).finally(()=>db.close());
  });
}
