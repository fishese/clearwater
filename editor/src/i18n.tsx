import {useSyncExternalStore} from 'react';
import {detectLanguage,translate,translateMessage,type Language} from './i18n-core';

const storageKey='clearwater-language';
function initialLanguage():Language {
 try{const saved=localStorage.getItem(storageKey);if(saved==='en'||saved==='zh-HK'||saved==='ja')return saved;}catch{/* Storage may be disabled. */}
 return detectLanguage(navigator.languages??[navigator.language]);
}
let language=initialLanguage();
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function setLanguage(next:Language){
 language=next;document.documentElement.lang=next;
 try{localStorage.setItem(storageKey,next);}catch{/* In-memory selection still works. */}
 listeners.forEach(listener=>listener());
}
document.documentElement.lang=language;
window.addEventListener('storage',event=>{if(event.key===storageKey){language=initialLanguage();document.documentElement.lang=language;listeners.forEach(listener=>listener());}});
export function useLanguage(){return useSyncExternalStore(subscribe,()=>language);}
export const t=(key:string,values:readonly unknown[]=[])=>translate(language,key,values);
export const message=(text:string)=>translateMessage(language,text);
export function LanguageSelect(){
 const value=useLanguage();
 return <select className="language-select" aria-label={t('Language')} title={t('Language')} value={value} onChange={event=>setLanguage(event.target.value as Language)}>
  <option value="en" lang="en" label="EN">EN</option><option value="zh-HK" lang="zh-HK" label="中">中</option><option value="ja" lang="ja" label="日">日</option>
 </select>;
}
