import {isAndroid} from './native';
export type OfflineModel='wwe'|'shallow'|'funie';
export type OfflineModelState={state:'checking'|'downloading'|'ready'|'incomplete';cached:number;total:number};
export type OfflineSettings={automatic:boolean;models:OfflineModel[]};
const key='clearwater-offline-settings',allowed:OfflineModel[]=['wwe','shallow','funie'];
function loadSettings():OfflineSettings{
 try{const saved=JSON.parse(localStorage.getItem(key)??'null');if(saved&&typeof saved.automatic==='boolean'&&Array.isArray(saved.models))return {automatic:saved.automatic,models:allowed.filter(m=>saved.models.includes(m))};}catch{/* Keep session defaults if storage is unavailable. */}
 return {automatic:true,models:['wwe','shallow']};
}
let settings=loadSettings(),snapshot:OfflineModelState={state:'checking',cached:0,total:0};
const listeners=new Set<()=>void>();
export const subscribeOfflineModels=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const getOfflineModelState=()=>snapshot;
export const getOfflineSettings=()=>settings;
const emit=()=>{for(const listener of listeners)listener();};
const publish=(next:OfflineModelState)=>{snapshot=next;emit();};
let pendingDownload=false,running=false,started=false,installedThisSession=false,requestId=0,selectionVersion=0,configuring=false;
let configureQueue:Promise<void>=Promise.resolve();
const installed=()=>installedThisSession||(navigator as Navigator&{standalone?:boolean}).standalone===true||window.matchMedia('(display-mode: standalone)').matches||window.matchMedia('(display-mode: fullscreen)').matches;
const saveSettings=()=>{try{localStorage.setItem(key,JSON.stringify(settings));}catch{/* Session choices still apply. */}emit();};
export function setAutomaticOfflineModels(value:boolean){
 settings={...settings,automatic:value};saveSettings();
 if(!value){pendingDownload=false;navigator.serviceWorker?.controller?.postMessage({type:'STOP_OFFLINE_MODELS'});}
 else if(installed())refreshOfflineModels(true);
}
export function setSelectedOfflineModels(models:OfflineModel[]){
 const previous=settings.models;
 settings={...settings,models:allowed.filter(m=>models.includes(m))};saveSettings();
 const version=++selectionVersion,removed=previous.filter(m=>!settings.models.includes(m));
 navigator.serviceWorker?.controller?.postMessage({type:'STOP_OFFLINE_MODELS'});
 requestId++;running=false;pendingDownload=false;configuring=true;publish({...snapshot,state:'checking'});
 configureQueue=configureQueue.then(async()=>{
  const worker=navigator.serviceWorker?.controller;
  if(worker)for(const model of removed)await new Promise<void>(resolve=>{
   const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve();},30000);
   channel.port1.onmessage=()=>{clearTimeout(timer);channel.port1.close();resolve();};
   try{worker.postMessage({type:'REMOVE_OFFLINE_MODEL',model,models:settings.models},[channel.port2]);}catch{clearTimeout(timer);channel.port1.close();resolve();}
  });
 }).catch(()=>{}).then(()=>{if(version===selectionVersion){configuring=false;refreshOfflineModels(settings.automatic&&installed()&&navigator.onLine);}});
}
/** Ask the controlling worker without blocking editing or the initial app installation. */
export function refreshOfflineModels(download=false){
 if(isAndroid()||!('serviceWorker' in navigator)||configuring)return;
 if(running){if(download)pendingDownload=true;return;}
 const worker=navigator.serviceWorker.controller;
 if(!worker){publish({...snapshot,state:'incomplete'});return;}
 running=true;
 const id=++requestId,channel=new MessageChannel();
 let timer:ReturnType<typeof setTimeout>;
 const finish=()=>{clearTimeout(timer);channel.port1.close();if(id===requestId){running=false;if(pendingDownload){pendingDownload=false;queueMicrotask(()=>refreshOfflineModels(true));}}};
 const timedOut=()=>{finish();if(id===requestId)publish({...snapshot,state:'incomplete'});};
 timer=setTimeout(timedOut,300000);
 channel.port1.onmessage=event=>{
  if(id!==requestId){clearTimeout(timer);channel.port1.close();return;}
  const value=event.data as OfflineModelState;
  if(!value||!['downloading','ready','incomplete'].includes(value.state)||!Number.isInteger(value.cached)||!Number.isInteger(value.total)||value.cached<0||value.total<value.cached)return;
  publish({state:value.state,cached:value.cached,total:value.total});clearTimeout(timer);
  if(value.state==='downloading')timer=setTimeout(timedOut,300000);else finish();
 };
 try{worker.postMessage({type:download?'CACHE_OFFLINE_MODELS':'OFFLINE_MODELS_STATUS',models:settings.models},[channel.port2]);}catch{timedOut();}
}
export function initialiseOfflineModels(){
 if(started||isAndroid()||!('serviceWorker' in navigator))return;
 started=true;
 const refresh=()=>{
  if(installed()&&settings.automatic&&navigator.onLine){void navigator.storage?.persist?.().catch(()=>false);refreshOfflineModels(true);}
  else refreshOfflineModels();
 };
 window.addEventListener('online',refresh);
 window.addEventListener('appinstalled',()=>{installedThisSession=true;refresh();});
 window.matchMedia('(display-mode: standalone)').addEventListener('change',refresh);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
 window.addEventListener('storage',event=>{if(event.key===key){settings=loadSettings();emit();refresh();}});
 navigator.serviceWorker.addEventListener('controllerchange',()=>{requestId++;running=false;refresh();});
 void navigator.serviceWorker.ready.then(refresh).catch(()=>publish({...snapshot,state:'incomplete'}));
}
