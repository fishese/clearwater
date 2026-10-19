type InstallPromptEvent=Event&{
 prompt:()=>Promise<void>;
 userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
};

let pendingPrompt:InstallPromptEvent|null=null;
let installedThisSession=false;
const listeners=new Set<()=>void>();
const notify=()=>{for(const listener of listeners)listener();};

if(typeof window!=='undefined'){
 window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  pendingPrompt=event as InstallPromptEvent;
  notify();
 });
 window.addEventListener('appinstalled',()=>{
  installedThisSession=true;
  pendingPrompt=null;
  notify();
 });
 window.matchMedia('(display-mode: standalone)').addEventListener('change',notify);
}

export type BrowserDevice='android'|'ios'|'desktop';
export function browserDevice(userAgent:string,platform:string,touchPoints:number):BrowserDevice{
 if(/Android/i.test(userAgent))return 'android';
 if(/iPhone|iPad|iPod/i.test(userAgent)||(platform==='MacIntel'&&touchPoints>1))return 'ios';
 return 'desktop';
}

export function currentBrowserDevice():BrowserDevice{
 return browserDevice(navigator.userAgent,navigator.platform,navigator.maxTouchPoints);
}

export type WebInstallState='installed'|'prompt'|'manual';
export function getWebInstallState():WebInstallState{
 if(installedThisSession||(navigator as Navigator&{standalone?:boolean}).standalone===true||window.matchMedia('(display-mode: standalone)').matches||window.matchMedia('(display-mode: fullscreen)').matches)return 'installed';
 return pendingPrompt?'prompt':'manual';
}
export function subscribeWebInstall(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}

export async function promptWebInstall():Promise<'accepted'|'dismissed'|'unavailable'>{
 const event=pendingPrompt;
 if(!event)return 'unavailable';
 pendingPrompt=null;
 notify();
 try{
  await event.prompt();
  return (await event.userChoice).outcome;
 }catch{return 'unavailable';}
}
