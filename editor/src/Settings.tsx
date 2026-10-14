import {useEffect,useRef,useSyncExternalStore} from 'react';
import {ArrowLeft} from 'lucide-react';
import {LanguageSelect,t,useLanguage} from './i18n';
import {getOfflineSettings,subscribeOfflineModels,setAutomaticOfflineModels,setSelectedOfflineModels,type OfflineModel} from './offline-models';
import OfflineModels from './OfflineModels';
import {isAndroid} from './native';
import {cameraRecordingBudget,getCameraSettings,setCameraMinutes,subscribeCameraSettings,type CameraRecordingMinutes} from './core/camera-settings';

const models:[OfflineModel,string,string][]=[['wwe','WWE-UIE','3.1 MB'],['shallow','Shallow-UWnet','0.9 MB'],['funie','FUnIE-GAN','28.1 MB']];
export default function Settings({onClose,parentAbout,onRestoreCamera,restoringCamera=false}:{onClose:()=>void;parentAbout:boolean;onRestoreCamera?:()=>void;restoringCamera?:boolean}){
 useLanguage();
 const heading=useRef<HTMLHeadingElement>(null),settings=useSyncExternalStore(subscribeOfflineModels,getOfflineSettings),cameraSettings=useSyncExternalStore(subscribeCameraSettings,getCameraSettings);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;heading.current?.focus();const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}};window.addEventListener('keydown',escape);return()=>{window.removeEventListener('keydown',escape);if(previous?.isConnected)previous.focus({preventScroll:true});};},[onClose]);
 return <main className="settings-page" aria-labelledby="settings-title">
  <header className="settings-header"><h1 id="settings-title" tabIndex={-1} ref={heading}>{t('Settings')}</h1><button className="button secondary settings-close" onClick={onClose}><ArrowLeft size={16}/>{parentAbout?t('About & guide'):t('Back to editor')}</button></header>
  <section><h2>{t('Language')}</h2><LanguageSelect/></section>
  <section><h2>{t('Camera recording length')}</h2>
   <div className="camera-duration-options">{([1,3,5] as CameraRecordingMinutes[]).map(minutes=>{const budget=cameraRecordingBudget(minutes);return <label className="camera-duration-choice" key={minutes}><input type="radio" name="camera-recording-minutes" checked={cameraSettings.minutes===minutes} onChange={()=>setCameraMinutes(minutes)}/><span>{t('{0} min', [minutes])}</span><small>{t('{0} MB video · {1}–{2} MB RAM · {3} MB storage', [budget.estimatedFileMB,budget.estimatedPeakRamMB.min,budget.estimatedPeakRamMB.max,budget.estimatedStorageMB])}</small></label>;})}</div>
   <p>{t('Video size and memory use are estimates. Actual memory varies by device and browser. Storage includes the enhanced video and its private copy.')}</p>
  </section>
  <section><h2>{t('Offline models')}</h2>
   {isAndroid()?<p>{t('The Android app includes all supplied models. No model download is needed.')}</p>:<>
    <label className="settings-check"><input type="checkbox" checked={settings.automatic} onChange={event=>setAutomaticOfflineModels(event.target.checked)}/><span>{t('Auto-download when installed')}</span></label>
    <p>{t('Downloads selected models when opened from your Home Screen or installed app. Keep the app open until ready. Mobile data may be used.')}</p>
    <div className="offline-model-choices">{models.map(([id,label,size])=><label className="settings-check" key={id}><input type="checkbox" aria-label={label} checked={settings.models.includes(id)} onChange={event=>setSelectedOfflineModels(event.target.checked?[...settings.models,id]:settings.models.filter(model=>model!==id))}/><span>{label}</span><small>{size}</small></label>)}</div>
    <p>{t('Selected models share about 15 MB of processing runtimes. Unchecking removes that cached model; using it in the editor can download it again. Your photos and edits are kept.')}</p>
    <OfflineModels/>
   </>}
  </section>
  {!isAndroid()&&<section><h2>{t('Android app')}</h2><p>{t('Install the latest signed release APK on Android. Updates use the same link.')}</p><div className="settings-install"><a className="button primary" href="https://github.com/fishese/clearwater/releases/latest/download/clearwater-release.apk">{t('Install Android (APK)')}</a><a href="https://github.com/fishese/clearwater/releases/latest" target="_blank" rel="noreferrer">{t('Release notes')}</a></div></section>}
  {isAndroid()&&onRestoreCamera&&<section><h2>{t('Camera originals')}</h2><p>{t('Clear collection keeps linked camera originals and edits. Restore them here without creating another gallery image.')}</p><button className="button secondary" disabled={restoringCamera} onClick={onRestoreCamera}>{restoringCamera?t('Restoring…'):t('Restore camera collection')}</button></section>}
  <section><h2>{t('Saved edits & models')}</h2><p>{t('Each collection item keeps its own edits and engine choice. Custom ONNX files and settings are remembered on this device; use Forget saved model under Correction Engine to remove them.')}</p></section>
 </main>;
}
