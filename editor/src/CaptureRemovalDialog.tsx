import {useEffect,useRef,useState} from 'react';
import {t,useLanguage} from './i18n';
import './capture-removal.css';

type CaptureRemovalDialogProps={
 filename:string;
 onCancel:()=>void;
 onHide:()=>void;
 onDelete:()=>void;
 busy:boolean;
 error?:string;
};

export default function CaptureRemovalDialog({filename,onCancel,onHide,onDelete,busy,error}:CaptureRemovalDialogProps){
 useLanguage();
 const cancelButton=useRef<HTMLButtonElement>(null),[pendingAction,setPendingAction]=useState<''|'hide'|'delete'>('');

 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  cancelButton.current?.focus();
  return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);

 useEffect(()=>{if(!busy)setPendingAction('');},[busy]);
 function run(action:'hide'|'delete'){
  if(busy)return;
  setPendingAction(action);
  (action==='hide'?onHide:onDelete)();
 }

 function onKeyDown(event:React.KeyboardEvent<HTMLDivElement>){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)onCancel();return;}
  if(event.key!=='Tab')return;
  const items=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'));
  if(!items.length)return;
  const first=items[0],last=items[items.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 }

 return <div className="modal-shade capture-removal-shade"><section className="export-dialog clear-dialog capture-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-removal-title" aria-describedby="capture-removal-description" aria-busy={busy} onKeyDown={onKeyDown}>
  <h2 id="capture-removal-title">{t('Remove {0} from ClearWater?',[filename])}</h2>
  <p id="capture-removal-description">{t('Choose whether to keep this capture in ClearWater. Hiding it keeps the files for recovery; deletion permanently removes them.')}</p>
  <div className="capture-removal-choice"><h3>{t('Hide capture')}</h3><p>{t('Hide this capture from the collection? Its private files stay in the app. Restore it later in Settings. Any Photos copy stays untouched.')}</p><button className="button primary" disabled={busy} onClick={()=>run('hide')}>{busy&&pendingAction==='hide'?t('Hiding…'):t('Hide capture')}</button></div>
  <div className="capture-removal-choice capture-removal-permanent"><h3>{t('Delete from ClearWater')}</h3><p>{t('This permanently removes this capture’s private source files and saved edits from this device. It cannot be undone. Any Photos copy stays untouched.')}</p><button className="button secondary capture-removal-delete" disabled={busy} onClick={()=>run('delete')}>{busy&&pendingAction==='delete'?t('Deleting…'):t('Delete permanently')}</button></div>
  {busy&&<p className="visually-hidden" role="status" aria-live="polite">{t(pendingAction==='hide'?'Hiding…':'Deleting…')}</p>}
  {error&&<p className="clear-error" role="alert">{error}</p>}
  <div className="clear-actions"><button ref={cancelButton} className="button secondary" disabled={busy} onClick={onCancel}>{t('Cancel')}</button></div>
 </section></div>;
}
