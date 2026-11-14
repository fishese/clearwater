import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {BatchPhotoProcessor,type BatchPhotoOptions} from './batch-photo';
import {BatchZip,uniqueBatchName} from './batch-zip';
import {chooseFolder,createUniqueFile,restoredName,supportsFolder,writeFile,type LocalDirectoryHandle} from './file-save';
import {isIOSWebBrowser,shareWebBatchArchive} from './export-share';
import {chooseIOSBatchFolder,isIOSPhotoExportAvailable,shareIOSFile,type IOSBatchFolder} from './platform/ios-media';
import {currentMediaPlatform} from './platform/runtime';
import {saveAndroidBatchDownload,chooseAndroidBatchPhotos,readAndroidFolderPhoto} from './native';
import {isVideo,supportedMedia} from './core/media';
import {isAIEngine} from './core/bundled-models';
import {DEFAULT_HINTS,type CustomModel,type Hints,type Recipe} from './core/types';
import type {PhotoDevice,PhotoResolution} from './core/photo-size';
import {t,message} from './i18n';

export interface BatchPhotoItem {id:string;name:string;getFile:(signal:AbortSignal)=>Promise<File>}
type Props={platform:'web'|'android'|'ios'|'unknown';initialEngine:Recipe['engine'];custom?:{file:Blob;config:CustomModel};resolution:PhotoResolution;device:PhotoDevice;onClose:()=>void};
type Failure={name:string;message:string};

export default function BatchDialog({platform,initialEngine,custom,resolution,device,onClose}:Props){
 const [added,setAdded]=useState<BatchPhotoItem[]>([]),[selected,setSelected]=useState<Set<string>>(()=>new Set());
 const [engine,setEngine]=useState<Recipe['engine']>(initialEngine==='wave'&&!custom?'wwe':initialEngine);
 const [hints,setHints]=useState<Hints>({...DEFAULT_HINTS}),[followup,setFollowup]=useState(true),[enhance,setEnhance]=useState(false);
 const [format,setFormat]=useState<'jpg'|'png'>('jpg'),[destination,setDestination]=useState<'zip'|'folder'>('zip');
 const [keepLocation,setKeepLocation]=useState(false);
 const [running,setRunning]=useState(false),[saving,setSaving]=useState(false),[choosing,setChoosing]=useState(false),[progress,setProgress]=useState({current:0,total:0,name:'',percent:0});
 const [archive,setArchive]=useState<Blob|null>(null),[archiveUrl,setArchiveUrl]=useState(''),[failures,setFailures]=useState<Failure[]>([]),[warning,setWarning]=useState(''),[done,setDone]=useState(0);
 const [locationNotice,setLocationNotice]=useState(false);
 const controller=useRef<AbortController|null>(null),processor=useRef<BatchPhotoProcessor|null>(null),mounted=useRef(true),generation=useRef(0);
 const starting=useRef(false),savingNow=useRef(false),picking=useRef(false);
 const dialog=useRef<HTMLDivElement>(null);
 const iosWeb=platform==='web'&&isIOSWebBrowser(platform,navigator.userAgent,navigator.platform,navigator.maxTouchPoints);
 const all=added,chosen=all.filter(item=>selected.has(item.id));
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;controller.current?.abort();processor.current?.cancel();};},[]);
 useEffect(()=>{const opener=document.activeElement as HTMLElement|null;dialog.current?.focus();return()=>{queueMicrotask(()=>opener?.focus());};},[]);
 useEffect(()=>{if(!archive){setArchiveUrl('');return;}const url=URL.createObjectURL(archive);setArchiveUrl(url);return()=>URL.revokeObjectURL(url);},[archive]);
 const addFiles=(event:ChangeEvent<HTMLInputElement>)=>{
  const files=Array.from(event.target.files??[]).filter(file=>supportedMedia(file)&&!isVideo(file));event.target.value='';
  const addedItems=files.map(file=>({id:crypto.randomUUID(),name:file.name,getFile:async()=>file}));
  setAdded(previous=>[...previous,...addedItems]);setSelected(previous=>new Set([...previous,...addedItems.map(item=>item.id)]));
 };
 async function addAndroidPhotos(browse=false){
  if(choosing||running||saving||picking.current)return;picking.current=true;const token=++generation.current;setChoosing(true);
  try{const result=await chooseAndroidBatchPhotos(browse,keepLocation);if(!mounted.current||token!==generation.current)return;
   if(result.locationUnavailable)setLocationNotice(true);
   const entries=result.photos.map(photo=>({id:crypto.randomUUID(),name:photo.name,getFile:async(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Batch cancelled.','AbortError');const file=await readAndroidFolderPhoto(photo,signal);if(signal.aborted)throw new DOMException('Batch cancelled.','AbortError');return file;}}));
   setAdded(previous=>[...previous,...entries]);setSelected(previous=>new Set([...previous,...entries.map(item=>item.id)]));
  }catch(error){if(mounted.current&&token===generation.current&&!(error instanceof DOMException&&error.name==='AbortError'))setWarning(message(error instanceof Error?error.message:'Could not access the selected photos.'));}
  finally{picking.current=false;if(mounted.current&&token===generation.current)setChoosing(false);}
 }
 const cancel=()=>{generation.current++;controller.current?.abort();processor.current?.cancel();};
 const close=()=>{cancel();onClose();};
 async function start(){
  if(!chosen.length||running||saving||choosing||starting.current)return;
  starting.current=true;
  try{await runBatch();}finally{starting.current=false;}
 }
 async function runBatch(){
  const token=++generation.current;
  let folder:LocalDirectoryHandle|undefined,nativeFolder:IOSBatchFolder|undefined;
  if(destination==='folder'){
   setChoosing(true);
   try{if(platform==='ios')nativeFolder=await chooseIOSBatchFolder();else folder=await chooseFolder();}catch(error){if(mounted.current&&token===generation.current&&!(error instanceof DOMException&&error.name==='AbortError'))setWarning(message(error instanceof Error?error.message:'Could not open the output folder.'));return;}
   finally{if(mounted.current&&token===generation.current)setChoosing(false);}
   if(!mounted.current||token!==generation.current){await nativeFolder?.close().catch(()=>{});return;}
  }
  const abort=new AbortController();let batch:BatchPhotoProcessor;
  try{batch=new BatchPhotoProcessor(new Worker(new URL('./processor.worker.ts',import.meta.url),{type:'module'}));}
  catch(error){await nativeFolder?.close().catch(()=>{});if(mounted.current)setWarning(t('The photo processing worker stopped.'));return;}
  controller.current=abort;processor.current=batch;
  const resultFailures:Failure[]=[],names=new Set<string>();let completed=0;const archiveBuilder=destination==='zip'?new BatchZip(128*1024*1024):null;
  setArchive(null);setFailures([]);setWarning('');setDone(0);setRunning(true);setProgress({current:0,total:chosen.length,name:'',percent:0});
  try{
   if(engine==='wave'){if(!custom)throw new Error('Load the custom model before starting the batch.');await batch.prepareCustom(custom);}
   const options:BatchPhotoOptions={engine,hints,balancedAfterAI:followup,autoEnhance:enhance,format,jpegQuality:.95,keepMetadata:true,resolution,device,platform:currentMediaPlatform(),custom};
   for(let i=0;i<chosen.length;i++){
    if(abort.signal.aborted)break;
    const item=chosen[i];setProgress({current:i+1,total:chosen.length,name:item.name,percent:0});
    try{
     const file=await item.getFile(abort.signal);if(abort.signal.aborted)break;
     const result=await batch.process(file,options,percent=>{if(mounted.current)setProgress({current:i+1,total:chosen.length,name:item.name,percent});});
     if(abort.signal.aborted)break;
     const name=uniqueBatchName(restoredName(file.name,format,!(folder||nativeFolder)),names);
     if(folder){const target=await createUniqueFile(folder,name);await writeFile(target.handle,result.blob);}
     else if(nativeFolder)await nativeFolder.write(name,result.blob);
     else if(archiveBuilder)await archiveBuilder.add(name,result.blob,abort.signal);
     completed++;if(result.metadataWarning)resultFailures.push({name:item.name,message:result.metadataWarning});
    }catch(error){
     if(abort.signal.aborted||(error instanceof DOMException&&error.name==='AbortError'))break;
     resultFailures.push({name:item.name,message:error instanceof Error?error.message:'The photo could not be processed.'});
     if(folder||nativeFolder||error instanceof Error&&error.message==='The ZIP exceeds the batch size limit.')break;
    }
   }
   if(archiveBuilder&&completed&&!abort.signal.aborted)setArchive(archiveBuilder.finish());
   if(abort.signal.aborted)setWarning(folder||nativeFolder?t('Batch cancelled. Completed files remain in the folder.'):t('Batch cancelled. No ZIP was created.'));
  }catch(error){if(!abort.signal.aborted)resultFailures.push({name:'',message:error instanceof Error?error.message:'The photo could not be processed.'});}
  finally{batch.close();await nativeFolder?.close().catch(()=>{});if(processor.current===batch)processor.current=null;if(controller.current===abort)controller.current=null;if(mounted.current){setFailures(resultFailures);setDone(completed);setRunning(false);}}
 }
 async function shareArchive(){
  if(!archive||saving||savingNow.current)return;savingNow.current=true;setSaving(true);setWarning('');
  try{
   if(platform==='ios'){const result=await shareIOSFile(archive,'clearwater-batch.zip');if(!result.completed)setWarning(t('Sharing cancelled. You can try again.'));}
   else await shareWebBatchArchive(archive,'clearwater-batch.zip',navigator);
  }catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))setWarning(t(platform==='ios'?'Could not share the ZIP. Try again.':'Could not share the ZIP. Try downloading it instead.'));}
  finally{savingNow.current=false;if(mounted.current)setSaving(false);}
 }
 async function saveAndroidArchive(){
  if(!archive||saving||savingNow.current)return;savingNow.current=true;setSaving(true);setWarning('');
  try{try{const name=await saveAndroidBatchDownload(archive);setWarning(t('Saved {0} to Downloads.',[name]));}catch(error){if((error as {code?:string})?.code!=='UNAVAILABLE')throw error;const folder=await chooseFolder(),target=await createUniqueFile(folder,'clearwater-batch.zip');await writeFile(target.handle,archive);setWarning(t('ZIP saved.'));}}
  catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))setWarning(t('Could not save the ZIP. Choose another folder and try again.'));}
  finally{savingNow.current=false;if(mounted.current)setSaving(false);}
 }
 const setHint=<K extends keyof Hints>(key:K,value:Hints[K])=>setHints(previous=>({...previous,[key]:value}));
 return <div className="modal-shade batch-shade"><div ref={dialog} tabIndex={-1} className="export-dialog batch-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-title" onKeyDown={event=>{if(event.key==='Escape'&&!saving){event.preventDefault();close();return;}if(event.key!=='Tab')return;const focusable=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')).filter(element=>element.getClientRects().length>0);if(!focusable.length){event.preventDefault();return;}const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===event.currentTarget)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}>
  <div className="batch-heading"><h2 id="batch-title">{t('Batch process photos')}</h2><button type="button" className="batch-close" disabled={saving} aria-label={t('Close')} title={t('Close')} onClick={close}>×</button></div>
  <p>{t('Choose photos and settings. Originals and existing edits stay unchanged.')}</p>
  <fieldset disabled={running||saving||choosing}>
   <div className="batch-selection"><div><strong>{t('Photos')} ({chosen.length})</strong><button type="button" className="text-button" onClick={()=>setSelected(new Set(all.map(item=>item.id)))}>{t('Select all')}</button><button type="button" className="text-button" onClick={()=>setSelected(new Set())}>{t('Select none')}</button></div>
    {platform==='android'&&<><label className="batch-check"><input type="checkbox" checked={keepLocation} onChange={event=>setKeepLocation(event.target.checked)}/>{t('Keep photo location (GPS)')}</label><small>{t('Choose this before adding photos. Android may request access and open Browse files; some providers cannot supply location.')}</small></>}
    {platform==='android'?<div className="batch-picker-actions"><button type="button" className="button secondary" onClick={()=>void addAndroidPhotos()}>{t('Add photos')}</button><button type="button" className="button secondary" onClick={()=>void addAndroidPhotos(true)}>{t('Browse files')}</button></div>:<label className="button secondary">{t('Add photos')}<input type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,image/dng,image/x-adobe-dng,.heic,.heif,.dng" onChange={addFiles}/></label>}
    <div className="batch-photos">{all.map(item=><label key={item.id}><input type="checkbox" checked={selected.has(item.id)} onChange={event=>setSelected(previous=>{const next=new Set(previous);if(event.target.checked)next.add(item.id);else next.delete(item.id);return next;})}/><span title={item.name}>{item.name}</span></label>)}</div>
   </div>
   <label>{t('Correction engine')}<select value={engine} onChange={event=>setEngine(event.target.value as Recipe['engine'])}><option value="balanced">{t('Balanced restoration')}</option><option value="baseline">{t('Original RGB heuristic')}</option><option value="wwe">WWE-UIE</option><option value="fivea">Five A+</option><option value="shallow">Shallow-UWnet</option>{custom&&<option value="wave">{custom.config.name}</option>}</select></label>
   <div className="batch-enhancement-options">{isAIEngine(engine)&&<label className="batch-check"><input type="checkbox" checked={followup} onChange={event=>setFollowup(event.target.checked)}/><span>{t('Balanced after AI')}</span></label>}
   <label className="batch-check"><input type="checkbox" checked={enhance} onChange={event=>setEnhance(event.target.checked)}/><span>{t('Auto enhance')}</span></label></div>
   <details><summary>{t('Dive conditions')}</summary><p>{t('These settings affect Balanced restoration and Balanced after AI.')}</p>
    <label>{t('Environment')}<select value={hints.scene} onChange={event=>setHint('scene',event.target.value as Hints['scene'])}><option value="auto">{t('Auto')}</option><option value="underwater">{t('Diving')}</option><option value="surface">{t('Surface')}</option></select></label>
    <label>{t('Red filter')}<select value={hints.filter} onChange={event=>setHint('filter',event.target.value as Hints['filter'])}><option value="auto">{t('Auto')}</option><option value="yes">{t('Yes')}</option><option value="no">{t('No')}</option></select></label>
    <label>{t('Water colour')}<select value={hints.water} onChange={event=>setHint('water',event.target.value as Hints['water'])}><option value="auto">{t('Auto')}</option><option value="blue">{t('Blue')}</option><option value="green">{t('Green')}</option></select></label>
    <label>{t('Approx. depth')}<input type="number" min="0" max="100" inputMode="decimal" value={hints.depth??''} placeholder={t('Unsure of depth')} onChange={event=>setHint('depth',event.target.value===''?null:Math.max(0,Math.min(100,Number(event.target.value))))}/></label>
   </details>
   <label>{t('File format')}<select value={format} onChange={event=>setFormat(event.target.value as 'jpg'|'png')}><option value="jpg">{t('JPEG · High quality')}</option><option value="png">{t('PNG · Lossless')}</option></select></label>
   <fieldset className="batch-output"><legend>{t('Output')}</legend><label><input type="radio" name="batch-destination" checked={destination==='zip'} onChange={()=>setDestination('zip')}/>{t('ZIP file')}</label>{(platform==='ios'?isIOSPhotoExportAvailable():supportsFolder())&&<label><input type="radio" name="batch-destination" checked={destination==='folder'} onChange={()=>setDestination('folder')}/>{t('Selected folder')}</label>}</fieldset>
   {destination==='zip'&&<small>{t('ZIP output is limited to 128 MB. For larger batches, split the selection or use a folder where available.')}</small>}
   <button type="button" className="button primary" disabled={!chosen.length} onClick={()=>void start()}>{destination==='folder'?t('Choose folder and process'):t('Process photos')}</button>
  </fieldset>
  {running&&<div role="status"><p>{t('Processing {0} of {1}',[progress.current,progress.total])}: {progress.name}</p><progress max={100} value={progress.percent}/><button type="button" className="button secondary" onClick={cancel}>{t('Cancel')}</button></div>}
  {!running&&done>0&&<p role="status">{t('Processed {0} photos.',[done])}</p>}
  {warning&&<p role="status">{warning}</p>}{locationNotice&&<p role="status">{t('Location metadata may be unavailable for some selected photos.')}</p>}{failures.length>0&&<div role="alert"><strong>{t('Some photos need attention')}</strong><ul>{failures.map((failure,index)=><li key={index}>{failure.name}: {message(failure.message)}</li>)}</ul></div>}
  {archive&&archiveUrl&&<div className="batch-save">{platform==='android'?<button className="button primary" disabled={saving} onClick={()=>void saveAndroidArchive()}>{t('Save ZIP')}</button>:platform==='ios'?null:<a className="button primary" href={archiveUrl} download="clearwater-batch.zip">{t('Download ZIP')}</a>}{(platform==='ios'||iosWeb)&&<button className="button secondary" disabled={saving} onClick={()=>void shareArchive()}>{t('Share ZIP')}</button>}</div>}
 </div></div>;
}
