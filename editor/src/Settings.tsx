import {useEffect,useRef,useSyncExternalStore} from 'react';
import {ArrowLeft} from 'lucide-react';
import {LanguageSelect,t,useLanguage} from './i18n';
import {BUNDLED_MODEL_IDS,BUNDLED_MODELS,type BundledModelId} from './core/bundled-models';
import {getOfflineSettings,subscribeOfflineModels,setAutomaticOfflineModels,setSelectedOfflineModels,type OfflineModel} from './offline-models';
import OfflineModels from './OfflineModels';
import {getPlatformCapabilities} from './platform/capabilities';
import {cameraQualityProfile} from './core/camera-quality';
import {cameraRecordingBudget,getCameraSettings,setCameraMinutes,setCameraQuality,subscribeCameraSettings,type CameraQuality,type CameraRecordingMinutes} from './core/camera-settings';
import {getIOSCameraPreferences,setIOSMicrophoneEnabled,setIOSSaveEnhancedPhotos,subscribeIOSCameraPreferences} from './platform/ios-camera';

const modelSizes:Record<BundledModelId,string>={wwe:'0.9 MB',fivea:'0.9 MB',shallow:'230 KB'};
const models:[OfflineModel,string,string][]=BUNDLED_MODEL_IDS.map(id=>[id,BUNDLED_MODELS[id].label,modelSizes[id]]);
export default function Settings({onClose,parentAbout,onRestoreCamera,onRestoreIOSCaptures,onDeleteIOSCaptures,restoringCamera=false}:{onClose:()=>void;parentAbout:boolean;onRestoreCamera?:()=>void;onRestoreIOSCaptures?:()=>void;onDeleteIOSCaptures?:()=>void;restoringCamera?:boolean}){
 useLanguage();
 const capabilities=getPlatformCapabilities(),heading=useRef<HTMLHeadingElement>(null),settings=useSyncExternalStore(subscribeOfflineModels,getOfflineSettings),cameraSettings=useSyncExternalStore(subscribeCameraSettings,getCameraSettings),iosCameraSettings=useSyncExternalStore(subscribeIOSCameraPreferences,getIOSCameraPreferences),cameraProfile=cameraQualityProfile(cameraSettings.quality,capabilities.platform==='android'||capabilities.nativeCamera);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;heading.current?.focus();const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}};window.addEventListener('keydown',escape);return()=>{window.removeEventListener('keydown',escape);if(previous?.isConnected)previous.focus({preventScroll:true});};},[onClose]);
 return <main className="settings-page" aria-labelledby="settings-title">
  <header className="settings-header"><h1 id="settings-title" tabIndex={-1} ref={heading}>{t('Settings')}</h1><button className="button secondary settings-close" onClick={onClose}><ArrowLeft size={16}/>{parentAbout?t('About & guide'):t('Back to editor')}</button></header>
  <section><h2>{t('Language')}</h2><LanguageSelect/></section>
  {(capabilities.webStreamCamera||capabilities.nativeCamera)&&<section><h2 id="camera-quality-heading">{t('Camera quality')}</h2>
   <div className="camera-quality-options" role="radiogroup" aria-labelledby="camera-quality-heading">{(['auto','standard','high'] as CameraQuality[]).map(quality=><label className="camera-quality-choice" key={quality}><input type="radio" name="camera-recording-quality" checked={cameraSettings.quality===quality} onChange={()=>setCameraQuality(quality)}/><span>{t(quality==='auto'?'Auto':quality==='standard'?'Standard':'High')}</span></label>)}</div>
   <p className="camera-quality-caption">{capabilities.platform==='android'?t('Target {0}p · frame rate and bitrate selected by device.',[cameraProfile.maxHeight]):t('Up to {0}p · {1} Mbps video · {2} kbps audio. Device limits may reduce quality.', [cameraProfile.maxHeight,cameraProfile.videoBitrate/1_000_000,cameraProfile.audioBitrate/1_000])}</p>
   <h3 className="camera-duration-heading" id="camera-duration-heading">{t('Camera recording length')}</h3>
   <div className="camera-duration-options" role="radiogroup" aria-labelledby="camera-duration-heading">{([1,3,5] as CameraRecordingMinutes[]).map(minutes=>{const budget=cameraRecordingBudget(minutes,cameraProfile);return <label className="camera-duration-choice" key={minutes}><input type="radio" name="camera-recording-minutes" checked={cameraSettings.minutes===minutes} onChange={()=>setCameraMinutes(minutes)}/><span>{t('{0} min', [minutes])}</span><small>{capabilities.nativeCamera?t('{0} MB video · private copy stored in app',[budget.estimatedFileMB]):t('{0} MB video · {1}–{2} MB RAM · {3} MB storage', [budget.estimatedFileMB,budget.estimatedPeakRamMB.min,budget.estimatedPeakRamMB.max,budget.estimatedStorageMB])}</small></label>;})}</div>
   {!capabilities.nativeCamera&&<p>{t('Video size and memory use are estimates. Actual memory varies by device and browser. Storage includes the enhanced video and its private copy.')}</p>}
   {capabilities.nativeCamera&&<><label className="settings-check"><input type="checkbox" checked={iosCameraSettings.microphoneEnabled} onChange={event=>setIOSMicrophoneEnabled(event.target.checked)}/><span>{t('Microphone on by default')}</span></label><label className="settings-check"><input type="checkbox" checked={iosCameraSettings.saveEnhancedPhotos} onChange={event=>setIOSSaveEnhancedPhotos(event.target.checked)}/><span>{t('Also save enhanced photos and videos to Photos')}</span></label><p>{t('The app keeps private camera originals until you remove them. Saving to Photos creates an independent copy; Clear collection hides captures and keeps private originals.')}</p></>}
  </section>}
  <section><h2>{t('Offline models')}</h2>
   {capabilities.bundledModels?<p>{t(capabilities.platform==='android'?'The Android app includes all supplied models. No model download is needed.':'The native app includes bundled models. No model download is needed.')}</p>:<>
    <label className="settings-check"><input type="checkbox" checked={settings.automatic} onChange={event=>setAutomaticOfflineModels(event.target.checked)}/><span>{t('Auto-download when installed')}</span></label>
    <p>{t('Downloads selected models when opened from your Home Screen or installed app. Keep the app open until ready. Mobile data may be used.')}</p>
    <div className="offline-model-choices">{models.map(([id,label,size])=><label className="settings-check" key={id}><input type="checkbox" aria-label={label} checked={settings.models.includes(id)} onChange={event=>setSelectedOfflineModels(event.target.checked?[...settings.models,id]:settings.models.filter(model=>model!==id))}/><span>{label}</span><small>{size}</small></label>)}</div>
    <p>{t('Selected models share about 15 MB of processing runtimes. Unchecking removes that cached model; using it in the editor can download it again. Your photos and edits are kept.')}</p>
    <OfflineModels/>
   </>}
  </section>
  {capabilities.platform==='web'&&<section><h2>{t('Android app')}</h2><p>{t('Install the latest signed release APK on Android. Updates use the same link.')}</p><div className="settings-install"><a className="button primary" href="https://github.com/fishese/clearwater/releases/latest/download/clearwater-release.apk">{t('Install Android (APK)')}</a><a href="https://github.com/fishese/clearwater/releases/latest" target="_blank" rel="noreferrer">{t('Release notes')}</a></div></section>}
  {capabilities.androidLinkedCapture&&onRestoreCamera&&<section><h2>{t('Camera originals')}</h2><p>{t('Clear collection keeps linked camera originals and edits. Restore them here without creating another gallery image.')}</p><button className="button secondary" disabled={restoringCamera} onClick={onRestoreCamera}>{restoringCamera?t('Restoring…'):t('Restore camera collection')}</button></section>}
  {capabilities.nativeCamera&&onDeleteIOSCaptures&&<section><h2>{t('Private camera captures')}</h2><p>{t('Clear collection hides captures but keeps their private source files in the app. Photos copies are independent. Restore hidden captures to show them in the collection again.')}</p>{onRestoreIOSCaptures&&<button className="button secondary" disabled={restoringCamera} onClick={onRestoreIOSCaptures}>{restoringCamera?t('Restoring…'):t('Restore hidden captures')}</button>}<p>{t('This action permanently deletes all private camera files from the app and does not change Photos.')}</p><button className="button secondary" disabled={restoringCamera} onClick={onDeleteIOSCaptures}>{restoringCamera?t('Deleting…'):t('Delete private camera captures')}</button></section>}
  <section><h2>{t('Saved edits & models')}</h2><p>{t('Each collection item keeps its own edits and engine choice. Custom ONNX files and settings are remembered on this device; use Forget saved model under Correction Engine to remove them.')}</p></section>
 </main>;
}
