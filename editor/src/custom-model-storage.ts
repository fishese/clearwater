import type {CustomModel} from './core/types';
import {isAndroid,readRememberedAndroidModel,saveRememberedAndroidModel,clearRememberedAndroidModelFile,forgetRememberedAndroidModel} from './native';

const DB='clearwater-custom-model';
const STORE='model';
export interface RememberedCustomModel {config:CustomModel;blob:Blob|null}
function validConfig(value:unknown):value is CustomModel {
 const model=value as CustomModel|null;
 return !!model&&typeof model.sha256==='string'&&/^[a-f0-9]{64}$/.test(model.sha256)&&typeof model.name==='string'&&model.name.length<=255&&['unit','signed'].includes(model.inputRange)&&['unit','signed'].includes(model.outputRange);
}
function openModelDb():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function request<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
 const db=await openModelDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),r=run(tx.objectStore(STORE));let result:T;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>{db.close();reject(tx.error);};});
}
export async function rememberCustomModel(blob:Blob,config:CustomModel){
 if(!validConfig(config)||blob.size<=0||blob.size>64*1024*1024)throw new Error('Invalid custom model settings.');
 if(isAndroid())return saveRememberedAndroidModel(blob,config);
 // A single IDB put commits the descriptor and bytes together, preserving the previous record if quota fails.
 await request('readwrite',store=>store.put({config,blob},'current'));
}
export async function loadRememberedCustomModel():Promise<RememberedCustomModel|null>{
 if(isAndroid()){
  const saved=await readRememberedAndroidModel();if(!saved)return null;
  return {config:saved.config,blob:saved.blob};
 }
 const saved=await request<unknown>('readonly',store=>store.get('current')) as {config?:unknown;blob?:Blob}|undefined;
 if(!saved)return null;
 if(!validConfig(saved.config))throw new Error('Saved custom model settings are damaged.');
 return {config:saved.config,blob:saved.blob instanceof Blob?saved.blob:null};
}
export async function forgetCustomModel(){
 if(isAndroid())return forgetRememberedAndroidModel();
 await request('readwrite',store=>store.delete('current'));
}
export async function clearRememberedCustomModelFile(){
 if(isAndroid())return clearRememberedAndroidModelFile();
 const saved=await request<{config:CustomModel;blob:Blob|null}|undefined>('readonly',store=>store.get('current'));
 if(saved)await request('readwrite',store=>store.put({config:saved.config,blob:null},'current'));
}
