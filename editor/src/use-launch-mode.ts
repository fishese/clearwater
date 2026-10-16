import {useEffect,useRef} from 'react';
import {nativeCamera,supportsNativeCamera} from './native-camera';

export type LaunchMode='camera'|'edit';
export function requestedLaunchMode(url:string):LaunchMode|null {
 const parsed=new URL(url,'https://clearwater.invalid');
 const mode=parsed.searchParams.get('mode');
 return mode==='camera'||mode==='edit'?mode:null;
}

/** Launcher actions are consumed once; ordinary editor refreshes remain ordinary. */
export function useLaunchMode(onLaunch:(mode:LaunchMode)=>boolean|void){
 const current=useRef(onLaunch);current.current=onLaunch;
 const pending=useRef<LaunchMode|null>(null);
 useEffect(()=>{const mode=pending.current;if(mode&&onLaunch(mode)!==false)pending.current=null;},[onLaunch]);
 useEffect(()=>{
  let disposed=false;
  const deliver=(mode:LaunchMode|null)=>{if(disposed||!mode)return;pending.current=mode;if(current.current(mode)!==false)pending.current=null;};
  const url=new URL(window.location.href),mode=requestedLaunchMode(url.href);
  if(mode){url.searchParams.delete('mode');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);deliver(mode);}
  if(!supportsNativeCamera())return()=>{disposed=true;};
  const listener=nativeCamera.addListener('launchMode',({mode})=>deliver(mode));
  void listener.then(()=>disposed?{mode:null}:nativeCamera.getLaunchMode()).then(({mode})=>deliver(mode)).catch(()=>{});
  return()=>{disposed=true;void listener.then(handle=>handle.remove()).catch(()=>{});};
 },[]);
}
