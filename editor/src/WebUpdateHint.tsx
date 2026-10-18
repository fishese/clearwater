import {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {t} from './i18n';

const dismissalKey='clearwater-web-update-hint-dismissed';

function wasDismissed(){
 try{return localStorage.getItem(dismissalKey)==='1';}catch{return false;}
}

export default function WebUpdateHint({disabled,updating,onUpdate}:{disabled:boolean;updating:boolean;onUpdate:()=>void}){
 const [visible,setVisible]=useState(()=>!wasDismissed());
 function dismiss(){
  setVisible(false);
  try{localStorage.setItem(dismissalKey,'1');}catch{/* Keep the dismissal for this page session. */}
 }
 return <span className="web-update-anchor">
  <button className="app-update" aria-label={t('Update app')} aria-describedby={visible?'web-update-hint-text':undefined} title={t('Check for updates and reload')} disabled={disabled} onClick={onUpdate}><RefreshCw size={12} className={updating?'spin':undefined}/></button>
  {visible&&<span className="web-update-hint" role="status" aria-live="polite">
   <span id="web-update-hint-text">{t('Updated occasionally. Tap to check for the latest.')}</span>
   <button type="button" className="web-update-hint-ok" onClick={dismiss}>OK</button>
  </span>}
 </span>;
}
