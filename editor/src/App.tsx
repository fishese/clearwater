import {t,message,useLanguage} from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Trash2, Settings as SettingsIcon, Camera as CameraIcon, Plus, Download, SlidersHorizontal, Sparkles, ArrowLeftRight, Undo2, Redo2, RotateCcw, Upload, ImagePlus, Check, ChevronDown, ChevronLeft, ChevronRight, FolderOpen, LockKeyhole, X, Pipette, LoaderCircle, FileJson, ZoomIn, ZoomOut, Maximize2, Minimize2, RefreshCw, Play, Pause } from 'lucide-react';
import { isAIEngine } from './core/bundled-models';
import { clamp, makePhotoRecipe, makeVideoRecipe, parseRecipe, suggest } from './core/engine';
import { DEFAULT_MANUAL,DEFAULT_ENHANCEMENT, type Analysis, type Adjustments, type Hints, type Recipe, type CustomModel } from './core/types';
import { clearPhotos, deletePhoto, listPhotos, promoteSharedPhotos, savePhoto, listCameraOriginals, removePhotoFromCollection, type StoredPhoto } from './storage';
import {forgetCustomModel,loadRememberedCustomModel,rememberCustomModel} from './custom-model-storage';
import {supportsFolder,chooseFolder,restoredName,createUniqueFile,writeFile,type LocalDirectoryHandle} from './file-save';
import {isAndroid,saveAndroidCameraCapture,replaceAndroidCameraCapture,deleteAndroidCameraCapture,probeAndroidSources,receiveAndroidPhotos,openAndroidPhotoFolder,readAndroidFolderPhoto,cancelAndroidHdrWorkingCopy,listenForAndroidBack,exitAndroidApp,type AndroidPhotoFolder} from './native';
import {nextBackAction,type BackState} from './back-navigation';
import {convertHdrImportRequest} from './hdr-import';
import {activateWebUpdate} from './update';
import WebUpdateHint from './WebUpdateHint';
import About from './About';
import GalleryTile,{type GalleryActions} from './GalleryTile';
import Settings from './Settings';
import CaptureRemovalDialog from './CaptureRemovalDialog';
import Camera,{type CameraHandle,type CameraSaveResult,type CameraCaptureDetails} from './Camera';
import {isVideo,isRaw,supportedMedia,mediaLimit,videoTime,videoExportPlan,type VideoExportMode,type VideoInfo} from './core/media';
import {useStableTabScroll} from './use-stable-tab-scroll';
import {useLaunchMode} from './use-launch-mode';
import {newestPhotos} from './core/library-order';
import {renderCameraPhoto,cameraThumbnail,cameraFileHash} from './core/camera-photo';
import {getPlatformCapabilities} from './platform/capabilities';
import {shareIOSFile} from './platform/ios-media';
import {acknowledgeIOSCapture,deleteIOSCapture,drainIOSCaptures,getIOSCameraPreferences,isIOSCameraAvailable,listIOSCaptures,readIOSCaptureFile,saveIOSCaptureToPhotos,setIOSCaptureRecipe,setIOSCaptureVisible,shareIOSCapture,toIOSStoredPhotos} from './platform/ios-camera';
import {videoPreviewPlayhead} from './core/video-preview-playback';
import {supportsFileShare,shareExport,isIOSWebBrowser} from './export-share';
import './editor-preview.css';

import type {PhotoInfo,PhotoResolution,PhotoDevice} from './core/photo-size';

interface Photo extends StoredPhoto { url:string; past:Recipe[]; future:Recipe[] }
type FolderBrowser=AndroidPhotoFolder&{index:number;loaded:Map<number,string>};
type Sample = { name:string; label:string };
const labelFor=(name:string)=>name.replace(/^IMG_\w+-/,'').replace(/\.[^.]+$/,'');
const clone=<T,>(x:T):T=>structuredClone(x);
function Range({label,value,onChange,onStart,min=-100,max=100,step=1,unit='',hint,vertical=false,displayValue,ariaValueText}: {
  label:string;value:number;onChange:(v:number)=>void;onStart:()=>void;min?:number;max?:number;step?:number;unit?:string;hint?:string;vertical?:boolean;displayValue?:string;ariaValueText?:string
}) {
  const percent=(value-min)/(max-min)*100;
  return <label className={`range-field ${vertical?'vertical-range':''}`} title={hint}><span><span>{label}</span><output>{displayValue??`${value>0&&min<0?'+':''}${Number(value.toFixed(2))}${unit}`}</output></span>
    <input aria-label={label} aria-valuetext={ariaValueText??displayValue} aria-description={hint} aria-orientation={vertical?'vertical':'horizontal'} type="range" min={min} max={max} step={step} value={value} style={{'--fill':`${percent}%`} as React.CSSProperties}
      onPointerDown={onStart} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))onStart();}} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
function RadioGroup<T extends string>({label,name,value,options,onChange}:{label:string;name:string;value:T;options:[T,string][];onChange:(value:T)=>void}) {
  return <fieldset className="radio-group"><legend>{label}</legend><div>{options.map(([key,text])=><label key={key}><input type="radio" name={name} value={key} checked={value===key} onChange={()=>onChange(key)}/><span>{text}</span></label>)}</div></fieldset>;
}
function download(blob:Blob,name:string){if(isAndroid()){void chooseFolder().then(async folder=>{const file=await createUniqueFile(folder,name);await writeFile(file.handle,blob);}).catch(error=>{if(error?.code!=='CANCELLED')window.alert(t("Could not save this file. Please choose a writable folder."));});return;}if(getPlatformCapabilities().platform==='ios'){if(!getPlatformCapabilities().nativeMediaSave){window.alert(t('Photo export is unavailable in this iOS build.'));return;}void shareIOSFile(blob,name).then(result=>{if(result.completed)window.alert(t('Saved {0}.',[name]));}).catch(error=>window.alert(error instanceof Error?error.message:t('Photo export is unavailable in this iOS build.')));return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}

export default function App() {
  useLanguage();
  const capabilities=getPlatformCapabilities();
  const iosWeb=isIOSWebBrowser(capabilities.platform,navigator.userAgent,navigator.platform,navigator.maxTouchPoints);
  const [about,setAbout]=useState(()=>window.location.hash.startsWith('#about'));
  useEffect(()=>{const change=()=>setAbout(window.location.hash.startsWith('#about'));window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  function closeAbout(){window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);setAbout(false);}
  const [settingsOpen,setSettingsOpen]=useState(false);
  const closeSettings=useCallback(()=>setSettingsOpen(false),[]);
  const [cameraOpen,setCameraOpen]=useState(false),cameraRef=useRef<CameraHandle>(null),cameraLastCapture=useRef<string|null>(null),cameraSession=useRef(0);
  const [updating,setUpdating]=useState(false);
  const [keepMetadata,setKeepMetadata]=useState(true);
  const [photoInfo,setPhotoInfo]=useState<PhotoInfo|null>(null),[photoRetry,setPhotoRetry]=useState(false),[photoReload,setPhotoReload]=useState(0),[processorEpoch,setProcessorEpoch]=useState(0);
  const [resolutions,setResolutions]=useState<Map<string,PhotoResolution>>(()=>new Map());
  const [expanded,setExpanded]=useState(false),[adjustmentsOpen,setAdjustmentsOpen]=useState(false);
  const [controlTab,setControlTab]=useState<'correction'|'enhancement'|'export'>('correction');
  const [correctionTab,setCorrectionTab]=useState<'engine'|'dive'>('engine');
  const [enhancementTab,setEnhancementTab]=useState<'colour'|'light'|'clarity'|'effects'>('colour');
  const [narrowControls,setNarrowControls]=useState(()=>window.matchMedia('(max-width: 650px)').matches);
  useEffect(()=>{const media=window.matchMedia('(max-width: 650px)'),change=()=>setNarrowControls(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{if(!expanded||cameraOpen||settingsOpen)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setExpanded(false);};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[expanded,cameraOpen,settingsOpen]);
  const [photos,setPhotos]=useState<Photo[]>([]),[active,setActive]=useState<string|null>(null);
  const galleryActions=useRef<GalleryActions>({select:()=>{},remove:()=>{}});
  const [pendingCaptureRemoval,setPendingCaptureRemoval]=useState<Photo|null>(null),[captureRemovalError,setCaptureRemovalError]=useState('');
  const [clearCollectionOpen,setClearCollectionOpen]=useState(false),[clearingCollection,setClearingCollection]=useState(false);
  const collectionEpoch=useRef(0),clearingCollectionRef=useRef(false),pendingPhotoWrites=useRef<Set<string>>(new Set()),removedPhotoIds=useRef<Set<string>>(new Set()),clearDialogRef=useRef<HTMLDivElement>(null),clearCancelRef=useRef<HTMLButtonElement>(null),clearOpenerRef=useRef<HTMLButtonElement>(null),deferredShareIds=useRef<Set<string>>(new Set()),deferredFiles=useRef<File[][]>([]);
  useEffect(()=>{if(!clearCollectionOpen)return;clearCancelRef.current?.focus();const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();closeClearCollection();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[clearCollectionOpen]);
  const [folderBrowser,setFolderBrowser]=useState<FolderBrowser|null>(null),[folderLoading,setFolderLoading]=useState(false);
  const folderRequest=useRef(0);
  const [samples,setSamples]=useState<Sample[]>([]),[analysis,setAnalysis]=useState<Analysis|null>(null);
  const [dimensions,setDimensions]=useState<[number,number]>([1,1]);
  const [videoInfo,setVideoInfo]=useState<VideoInfo|null>(null),[previewTime,setPreviewTime]=useState(0),[previewPlaying,setPreviewPlaying]=useState(false),[keepAudio,setKeepAudio]=useState(true);
  const [exportMode,setExportMode]=useState<VideoExportMode>('compatible');
  const videoPlan=videoInfo?videoExportPlan({...videoInfo,hasAudio:videoInfo.hasAudio&&keepAudio},exportMode):null;
  const [hdrConverting,setHdrConverting]=useState(false),[hdrProgress,setHdrProgress]=useState(0);
  const [modelStatus,setModelStatus]=useState('');
  const [customOpen,setCustomOpen]=useState(false),[customModel,setCustomModel]=useState<CustomModel|null>(null),[rememberedModel,setRememberedModel]=useState<CustomModel|null>(null),[customAccepted,setCustomAccepted]=useState(false),[customLoading,setCustomLoading]=useState(false),[customFile,setCustomFile]=useState<Blob|null>(null),[customCandidate,setCustomCandidate]=useState<File|null>(null);
  const [inputRange,setInputRange]=useState<'unit'|'signed'>('unit'),[outputRange,setOutputRange]=useState<'unit'|'signed'>('unit'),[customError,setCustomError]=useState('');
  const [busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[storageWarning,setStorageWarning]=useState(false);
  const [compare,setCompare]=useState(true),[divider,setDivider]=useState(50),[showOriginal,setShowOriginal]=useState(false);
  const [exporting,setExporting]=useState(false),[progress,setProgress]=useState(0),[format,setFormat]=useState<'jpg'|'png'>('jpg');
  const [jpegQuality,setJpegQuality]=useState<.95|.99>(.95);
  const [outputFolder,setOutputFolder]=useState<LocalDirectoryHandle|null>(null),[saving,setSaving]=useState(false);
  const [saveDialog,setSaveDialog]=useState(false),[saveName,setSaveName]=useState('');
  const exportTarget=useRef<{name:string;folder?:LocalDirectoryHandle;cameraId?:string;cameraUri?:string;share?:boolean}|null>(null),librarySwitchLock=useRef(false);
  const [shareReady,setShareReady]=useState<{blob:Blob;name:string}|null>(null);
  const [iosWebSave,setIosWebSave]=useState<{blob:Blob;name:string}|null>(null);
  const iosWebShareLock=useRef(false);
  const [eyedropper,setEyedropper]=useState(false),[zoom,setZoom]=useState(1);
  const previewTimeRef=useRef(previewTime),videoDurationRef=useRef(videoInfo?.duration??0);
  const previewPlayback=useRef({playing:false,startedAt:0,startTime:0});
  previewTimeRef.current=previewTime;videoDurationRef.current=videoInfo?.duration??0;
  const [stageSize,setStageSize]=useState({width:0,height:0}),[ready,setReady]=useState(false),[sampleBusy,setSampleBusy]=useState(false),[rendering,setRendering]=useState(false);
  const [previewRenderNonce,setPreviewRenderNonce]=useState(0),deferredPreviewRender=useRef(false);
  const originalCanvas=useRef<HTMLCanvasElement>(null),editedCanvas=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null),controlsPanel=useRef<HTMLElement>(null),controlBody=useRef<HTMLFieldSetElement>(null);
  const [zoomControlPosition,setZoomControlPosition]=useState({right:8,bottom:8});
  const lastBackAt=useRef(0),exitPromptTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const expandedGesture=useRef({points:new Map<number,{x:number;y:number}>(),pinched:false,moved:false,picker:false,comparison:false,startZoom:1,startDistance:0,startDivider:50,lastPoint:null as {x:number;y:number}|null});
  const importInput=useRef<HTMLInputElement>(null),recipeInput=useRef<HTMLInputElement>(null);
  const worker=useRef<Worker|null>(null),generation=useRef(0),request=useRef(0),latest=useRef(0),exportRequest=useRef(0),neutralRequest=useRef(0),autoEnhancementRequest=useRef<number|null>(null),pendingModelBlob=useRef<Blob|null>(null),pendingModelRestore=useRef(false),pendingCustomCommand=useRef<Record<string,unknown>|null>(null),applyCustomModel=useRef(false),modelRestoreStarted=useRef(false),modelSelectionStarted=useRef(false);
  const workerRecovery=useRef<{photoId:string|null;attempts:number}>({photoId:null,attempts:0});
  const deferredWorkerFailure=useRef(false);
  const previewRenderQueue=useRef<{inFlight:number|null;pending:{type:'render';gen:number;request:number;recipe:Recipe;time:number}|null}>({inFlight:null,pending:null});
  const hdrWorkingCopies=useRef(new Map<string,{id:string;file:File}>()),hdrJobId=useRef<string|null>(null),hdrActive=useRef<{generation:number;photoId:string}|null>(null);
  const photoProcessor=useRef<Worker|null>(null),videoProcessor=useRef<Worker|null>(null);
  const photoRef=useRef<Photo[]>([]),activeRef=useRef<string|null>(null),initialized=useRef(false),pendingBitmap=useRef<ImageBitmap|null>(null);
  const iosSyncPromise=useRef<Promise<void>|null>(null),iosSyncSelectLatest=useRef(false),iosSyncAgain=useRef(false);
  const iosPhotosSaveAttempts=useRef(new Map<string,Promise<boolean>>());
  photoRef.current=photos;activeRef.current=active;librarySwitchLock.current=exporting||saving||!!pendingCaptureRemoval||customOpen||customLoading||hdrConverting;
  const exportingRef=useRef(exporting);exportingRef.current=exporting;
  const photo=photos.find(p=>p.id===active),recipe=photo?.recipe;
  const photosById=useMemo(()=>new Map(photos.map(p=>[p.id,p])),[photos]);
  const video=!!photo&&isVideo(photo.file),exportFormat=video?'mp4':format;
  const pauseVideoPreview=useCallback(()=>{
    previewPlayback.current.playing=false;
    setPreviewPlaying(false);
  },[]);
  const startVideoPreview=useCallback(()=>{
    const duration=videoDurationRef.current;
    if(!video||!ready||exporting||rendering||duration<=0)return;
    const start=previewTimeRef.current>=duration-.04?0:previewTimeRef.current;
    previewPlayback.current={playing:true,startedAt:performance.now(),startTime:start};
    setPreviewPlaying(true);
    setPreviewTime(Math.min(start+1/30,Math.max(0,duration-.001)));
  },[video,ready,exporting,rendering]);
  const visibleEnhancementTab=video&&enhancementTab==='effects'?'colour':enhancementTab;
  const selectControlTab=useStableTabScroll({resetKey:`${photo?.id??'empty'}:${expanded}:${narrowControls}`,enabled:narrowControls,expanded,controlsRef:controlsPanel,bodyRef:controlBody});
  useEffect(()=>{if(video&&enhancementTab==='effects')setEnhancementTab('colour');},[video,enhancementTab]);
  function tabKeyDown<T extends string>(event:React.KeyboardEvent<HTMLButtonElement>,items:T[],select:(value:T)=>void){
    const index=items.indexOf(event.currentTarget.dataset.tabValue as T);
    let next=index;
    if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%items.length;
    else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index-1+items.length)%items.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=items.length-1;
    else return;
    event.preventDefault();const value=items[next];select(value);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({preventScroll:true});
  }
  const photoResolution=active?resolutions.get(active)??'auto':'auto';
  const photoDevice:PhotoDevice={mobile:isAndroid()||matchMedia('(pointer: coarse)').matches,memory:(navigator as Navigator&{deviceMemory?:number}).deviceMemory};
  function reopenPhoto(mode:PhotoResolution){if(!active||exporting||saving)return;setResolutions(previous=>new Map(previous).set(active,mode));setPhotoReload(n=>n+1);}
  const photoIndex=folderBrowser?folderBrowser.index:photos.findIndex(p=>p.id===active);
  const photoCount=folderBrowser?folderBrowser.photos.length:photos.length;
  const canEdit=!!recipe && ready && !busy && !exporting && !saving && !folderLoading && !customOpen && !iosWebSave;
  const canExport=canEdit&&!rendering&&(!video||capabilities.videoExport)&&(capabilities.platform!=='ios'||capabilities.nativeMediaSave);
  const canSaveRecipe=canEdit&&!rendering&&(capabilities.platform!=='ios'||capabilities.nativeMediaSave);
  const aspect=dimensions[0]/dimensions[1];
  const fitInset=4;
  const fitWidth=Math.max(1,Math.min(Math.max(1,stageSize.width-fitInset),Math.max(1,(stageSize.height-fitInset)*aspect)));
  const persist=(p:Photo)=>{if(removedPhotoIds.current.has(p.id)||clearingCollectionRef.current||(!photoRef.current.some(item=>item.id===p.id)&&!pendingPhotoWrites.current.has(p.id)))return;if(p.nativeCapture){if(p.recipe)void setIOSCaptureRecipe(p.id,p.recipe as unknown as Record<string,unknown>).catch(()=>setStorageWarning(true));return;}const {id,file,recipe,thumbnail,addedAt,cameraCapture,sourceUri}=p;savePhoto({id,file,recipe,thumbnail,addedAt,cameraCapture,sourceUri}).catch(()=>setStorageWarning(true)).finally(()=>{if(!photoRef.current.some(item=>item.id===id))pendingPhotoWrites.current.delete(id);});};
  function disposeHdrWorkingCopy(id:string){hdrWorkingCopies.current.delete(id);}
  function disposeHdrWorkingCopies(){hdrWorkingCopies.current.clear();}
  async function cancelHdrWorkingCopy(){const id=hdrJobId.current;if(id)await cancelAndroidHdrWorkingCopy(id);}
  const notify=(message:string)=>setNotice(message);
  async function syncIOSCaptureRecords(selectLatest=false):Promise<void>{
    if(!capabilities.nativeCamera)return;
    if(selectLatest)iosSyncSelectLatest.current=true;
    iosSyncAgain.current=true;
    if(iosSyncPromise.current)return iosSyncPromise.current;
    const epoch=collectionEpoch.current;
    const task=(async()=>{
      do{
      iosSyncAgain.current=false;
      const [descriptors,pending]=await Promise.all([listIOSCaptures(),drainIOSCaptures()]);
      if(epoch!==collectionEpoch.current)return;
      if(clearingCollectionRef.current){for(const item of pending)await setIOSCaptureVisible(item.id,false).catch(()=>{});return;}
      const visible=descriptors.filter(item=>item.visible&&!removedPhotoIds.current.has(item.id)),loaded=await toIOSStoredPhotos(visible);
      if(epoch!==collectionEpoch.current||clearingCollectionRef.current)return;
      const currentById=new Map(photoRef.current.filter(item=>item.nativeCapture).map(item=>[item.id,item]));
      const entries=loaded.filter(item=>!removedPhotoIds.current.has(item.id)).map(item=>{
        const current=currentById.get(item.id);if(!current)return {...item,url:URL.createObjectURL(item.previewFile!),past:[],future:[]} as Photo;
        return {...item,file:current.file,previewFile:current.previewFile,url:current.url,recipe:current.recipe??item.recipe,past:current.past,future:current.future,nativeCapture:{descriptor:item.nativeCapture!.descriptor,loaded:current.nativeCapture!.loaded}} as Photo;
      });
      const stale=currentById;
      for(const item of entries)stale.delete(item.id);
      for(const item of stale.values())URL.revokeObjectURL(item.url);
      setPhotos(current=>newestPhotos([...current.filter(item=>!item.nativeCapture),...entries]));
      for(const item of pending)if(visible.some(entry=>entry.id===item.id))await acknowledgeIOSCapture(item.id).catch(()=>setStorageWarning(true));
      if(iosSyncSelectLatest.current&&!iosSyncAgain.current){iosSyncSelectLatest.current=false;if(entries.length){setReady(false);setActive(entries[0].id);cameraLastCapture.current=entries[0].id;}}
      }while(iosSyncAgain.current);
    })();
    iosSyncPromise.current=task;
    try{await task;}finally{if(iosSyncPromise.current===task)iosSyncPromise.current=null;}
  }
  function saveIOSPhotosCopyOnce(id:string):Promise<boolean>{
    const attempted=iosPhotosSaveAttempts.current.get(id);if(attempted)return attempted;
    const task=(async()=>{
      const existing=(await listIOSCaptures()).find(capture=>capture.id===id);
      if(existing?.photosSaved)return true;
      const result=await saveIOSCaptureToPhotos(id);
      if(result.saved)await syncIOSCaptureRecords(false).catch(()=>setStorageWarning(true));
      return result.saved;
    })();
    iosPhotosSaveAttempts.current.set(id,task);return task;
  }
  function launchIOSCamera(){
    if(!isIOSCameraAvailable()||cameraOpen||exporting||saving||busy||customLoading||clearingCollectionRef.current)return;
    cameraSession.current++;cameraLastCapture.current=null;setReady(false);setCameraOpen(true);
  }
  function clearPreviewRenderQueue(){
    const queue=previewRenderQueue.current;
    queue.inFlight=null;queue.pending=null;
  }
  async function shareReadyFile(){
    const readyFile=shareReady;if(!readyFile||saving||exporting||!supportsFileShare())return;
    try{await shareExport(readyFile.blob,readyFile.name);if(isAndroid())setShareReady(null);}
    catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))notify(t('Could not share the restored file. Try Share now again.'));}
  }
  async function confirmIOSWebSave(){
    const ready=iosWebSave;if(!ready||saving||exporting||iosWebShareLock.current)return;
    iosWebShareLock.current=true;setSaving(true);
    try{await shareExport(ready.blob,ready.name);setIosWebSave(null);}
    catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))notify(t('Could not share the restored file. Try Share now again.'));}
    finally{iosWebShareLock.current=false;setSaving(false);}
  }
  function drainPreviewRenderQueue(){
    const queue=previewRenderQueue.current;
    if(queue.inFlight!==null)return;
    const job=queue.pending;queue.pending=null;
    if(!job||job.gen!==generation.current)return;
    const target=worker.current;if(!target)return;
    queue.inFlight=job.request;target.postMessage(job);
  }
  function finishPreviewRender(requestId:number){
    const queue=previewRenderQueue.current;
    if(queue.inFlight===requestId){queue.inFlight=null;drainPreviewRenderQueue();}
  }
  function navigatePhoto(direction:number){if(busy||exporting||saving||customOpen||folderLoading)return;if(folderBrowser){void browseFolderPhoto(folderBrowser,photoIndex+direction);return;}const next=photos[photoIndex+direction];if(next){setReady(false);setActive(next.id);}}
  function selectPhoto(id:string){if(id===activeRef.current&&photoRetry&&!exporting&&!saving){workerRecovery.current={photoId:id,attempts:0};setPhotoRetry(false);setPhotoReload(value=>value+1);return;}folderRequest.current++;setFolderLoading(false);const entry=folderBrowser&&[...folderBrowser.loaded].find(([,value])=>value===id);setFolderBrowser(entry&&folderBrowser?{...folderBrowser,index:entry[0]}:null);setActive(id);}
  async function browseFolderPhoto(folder:FolderBrowser,index:number){
    if(index<0||index>=folder.photos.length)return;
    const token=++folderRequest.current;setFolderLoading(true);
    try {
      let id=folder.loaded.get(index);
      if(!id||!photoRef.current.some(p=>p.id===id)){
        id=photoRef.current.find(p=>p.sourceUri===folder.photos[index].uri)?.id;
      }
      if(!id){
        const file=await readAndroidFolderPhoto(folder.photos[index]);if(token!==folderRequest.current)return;
        id=addFiles([file],true,undefined,folder.photos[index].uri)[0];if(!id)throw new Error(t("This file could not be opened."));folder.loaded.set(index,id);
      }else {folder.loaded.set(index,id);if(id!==activeRef.current){setReady(false);setActive(id);}}
      setFolderBrowser({...folder,index});
    }catch(error){if(token===folderRequest.current){setFolderBrowser({...folder,index});setReady(false);setActive(null);notify(error instanceof Error?error.message:t("Could not open this file. Use Next or Previous to continue."));}}
    finally{if(token===folderRequest.current)setFolderLoading(false);}
  }
  async function openPhotoFolder(){
    if(folderLoading||busy||exporting||customOpen)return;
    const token=++folderRequest.current;setFolderLoading(true);
    try{const folder=await openAndroidPhotoFolder();if(token!==folderRequest.current)return;if(!folder.photos.length){notify(t("No supported files were found. JPEG, PNG, HEIC/HEIF and DNG photos, MP4/MOV videos; maximum 512 MB per file."));return;}await browseFolderPhoto({...folder,index:0,loaded:new Map()},0);}
    catch(error){if(token===folderRequest.current&&!(error instanceof DOMException&&error.name==='AbortError'))notify(error instanceof Error?error.message:t("Could not open this folder."));}
    finally{if(token===folderRequest.current)setFolderLoading(false);}
  }
  async function selectOutputFolder(){try{setOutputFolder(await chooseFolder());}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))notify(t("Could not open the output folder. You can still download or use Save as."));}}
  async function finishExport(blob:Blob,metadataWarning?:string){
    const target=exportTarget.current;if(!target)return;
    setSaving(true);
    try {
      if(isIOSWebBrowser(capabilities.platform,navigator.userAgent,navigator.platform,navigator.maxTouchPoints)){setIosWebSave({blob,name:target.name});if(metadataWarning)notify(message(metadataWarning));return;}
      if(target.share){
        setShareReady({blob,name:target.name});
        if(isAndroid()){await shareExport(blob,target.name);setShareReady(null);notify(t('Ready to share {0}.',[target.name]));}
        else notify(t('File ready to share. Tap Share now to choose an app.'));
        return;
      }
      if(target.cameraUri&&target.cameraId){
        const current=photoRef.current.find(p=>p.id===target.cameraId);if(!current?.cameraCapture)throw new Error('Camera photo is unavailable.');
        const renderedSha256=video?undefined:await cameraFileHash(blob),thumbnail=video?current.thumbnail:await cameraThumbnail(blob);
        await replaceAndroidCameraCapture(target.cameraUri,blob);
        const updated={...current,thumbnail,cameraCapture:{...current.cameraCapture,renderedSha256}};
        await savePhoto(updated);setPhotos(all=>all.map(p=>p.id===updated.id?updated:p));notify(t('Gallery photo updated.'));
        return;
      }
      if(target.folder){const file=await createUniqueFile(target.folder,target.name);await writeFile(file.handle,blob);target.name=file.name;}
      else if(capabilities.platform==='ios'){
        if(!capabilities.nativeMediaSave)throw new Error(t('Photo export is unavailable in this iOS build.'));
        const shared=await shareIOSFile(blob,target.name);
        if(!shared.completed)return;
      }else download(blob,target.name);
      notify((target.folder||capabilities.platform==='ios'?t("Saved {0}.",[target.name]):t("Downloaded {0}.",[target.name]))+(metadataWarning?` ${message(metadataWarning)}`:''));
    }catch(error){if(target.cameraUri)notify(t("Could not update the gallery image. Your original and edits are kept."));else if(isAndroid())notify(t("Could not save to this folder. Choose another output folder and try again."));else if(capabilities.platform==='ios')notify(error instanceof Error?error.message:t('Photo export is unavailable in this iOS build.'));else if(isIOSWebBrowser(capabilities.platform,navigator.userAgent,navigator.platform,navigator.maxTouchPoints))notify(t('Could not share the restored file. Try Share now again.'));else{download(blob,target.name);notify(t("Could not save to the chosen destination. Downloaded the restored file instead."));}}
    finally{exportTarget.current=null;setSaving(false);setExporting(false);setProgress(100);}
  }
  async function updateApp(){
    if(updating||exporting||saving)return;setUpdating(true);
    try{
      const saveCurrent=async()=>{const current=photoRef.current.find(p=>p.id===activeRef.current);if(current){const {id,file,recipe,thumbnail,addedAt,cameraCapture,sourceUri}=current;await savePhoto({id,file,recipe,thumbnail,addedAt,cameraCapture,sourceUri});}};await saveCurrent();
      if(import.meta.env.DEV){location.reload();return;}
      if(!capabilities.webServiceWorkerUpdates)return;
      if(await activateWebUpdate(import.meta.env.BASE_URL)){await saveCurrent();location.reload();}else notify(t("You already have the latest version."));
    }catch(error){notify(error instanceof Error?error.message:t("Could not update. Your files and edits have been kept."));}
    finally{setUpdating(false);}
  }
  function update(fn:(r:Recipe)=>Recipe,record=true) {
    setPhotos(all=>all.map(p=>{
      if(p.id!==activeRef.current||!p.recipe)return p;
      const next=fn(clone(p.recipe));
      if(next.engine!==p.recipe.engine)delete next.cameraColour;
      return {...p,recipe:next,past:record?[...p.past.slice(-59),clone(p.recipe)]:p.past,future:[]};
    }));
  }
  function checkpoint(){if(canEdit)setPhotos(all=>all.map(p=>p.id===active&&p.recipe?{...p,past:[...p.past.slice(-59),clone(p.recipe)],future:[]}:p));}
  function manual(key:keyof Omit<Adjustments,'neutral'>,value:number){update(r=>({...r,manual:{...r.manual,[key]:value}}),false);}
  function hints(change:Partial<Hints>,record=true){if(!analysis)return;update(r=>{const next={...r.hints,...change};return {...r,hints:next,auto:suggest(analysis,next,r.engine)};},record);}
  function history(direction:'undo'|'redo') {
    setPhotos(all=>all.map(p=>{
      if(p.id!==active||!p.recipe)return p;
      if(direction==='undo'&&p.past.length)return {...p,recipe:p.past.at(-1),past:p.past.slice(0,-1),future:[clone(p.recipe),...p.future]};
      if(direction==='redo'&&p.future.length)return {...p,recipe:p.future[0],past:[...p.past,clone(p.recipe)],future:p.future.slice(1)};
      return p;
    }));
  }
  function addFiles(files:File[],fromFolder=false,initialRecipe?:Recipe,sourceUri?:string) {
    if(clearingCollectionRef.current){if(!fromFolder)deferredFiles.current.push(files);return [];}
    const valid=files.filter(supportedMedia);
    if(valid.length!==files.length)notify(t("Choose JPEG, PNG, HEIC, HEIF, DNG, MP4 or MOV files."));
    const accepted=valid.filter(f=>f.size<=mediaLimit(f));
    if(accepted.length!==valid.length)notify(t("Files above the 512 MB safety ceiling were skipped."));
    const addedAt=Date.now();
    const items:Photo[]=accepted.map((file,i)=>({id:crypto.randomUUID(),file,sourceUri,addedAt:addedAt-i/1000,url:URL.createObjectURL(file),past:[],future:[],...(initialRecipe?{recipe:clone(initialRecipe)}:{})}));
    if(items.length){if(!fromFolder){folderRequest.current++;setFolderLoading(false);setFolderBrowser(null);}items.forEach(item=>pendingPhotoWrites.current.add(item.id));setPhotos(all=>newestPhotos([...all,...items]));if(!librarySwitchLock.current){setReady(false);setActive(items[0].id);}items.forEach(persist);}
    return items.map(item=>item.id);
  }
  async function saveCameraCapture(file:File,recipe:Recipe,details?:CameraCaptureDetails):Promise<CameraSaveResult> {
    // Corrected video is the editable source; do not apply its capture correction twice.
    if(details?.enhancedVideo)recipe={...recipe,strength:0,manual:clone(DEFAULT_MANUAL),enhancement:undefined,balancedAfterAI:undefined,cameraColour:undefined};
    const session=cameraSession.current;
    if(details?.iosCaptureId){
      const id=details.iosCaptureId;
      try{await setIOSCaptureRecipe(id,recipe as unknown as Record<string,unknown>);await syncIOSCaptureRecords(true);}
      catch{setStorageWarning(true);notify(t('Could not load the new camera capture. It remains saved on this device.'));}
      if(cameraSession.current===session)cameraLastCapture.current=id;
      const deviceExpected=getIOSCameraPreferences().saveEnhancedPhotos;
      let device=false;
      if(deviceExpected)try{device=await saveIOSPhotosCopyOnce(id);}catch{device=false;}
      return {collection:true,device,deviceExpected};
    }
    const id=crypto.randomUUID();
    if(isAndroid()&&file.type==='image/jpeg')file=new File([file],`clearwater-camera-${id}.jpg`,{type:file.type,lastModified:file.lastModified});
    const stored:StoredPhoto={id,file,recipe:clone(recipe),addedAt:Date.now(),...(isAndroid()?{cameraCapture:{...(details?.enhancedVideo?{enhancedVideo:true}:{})}}:{})};
    let collection=false;
    try{await savePhoto(stored);collection=true;}catch{setStorageWarning(true);}
    let rendered:File=file;
    try{
      if(file.type.startsWith('image/')){rendered=await renderCameraPhoto(file,recipe,details?.jpegQuality);stored.thumbnail=await cameraThumbnail(rendered);}
      try{await savePhoto(stored);collection=true;}catch{setStorageWarning(true);}
    }catch{
      setStorageWarning(true);notify(t('The original camera photo and edit are saved, but the enhanced image could not be rendered.'));
      setPhotos(all=>newestPhotos([...all.filter(item=>item.id!==stored.id),{...stored,url:URL.createObjectURL(stored.file),past:[],future:[]}]));
      if(cameraSession.current===session)cameraLastCapture.current=stored.id;
      return {collection,device:false,deviceExpected:isAndroid()};
    }
    let device=false;
    if(isAndroid()&&collection){
      let saved:{uri:string;name:string}|undefined;
      try{
        saved=await saveAndroidCameraCapture(rendered,details?.nativeCaptureUri);
        stored.cameraCapture={...stored.cameraCapture,uri:saved.uri,name:saved.name,...(rendered.type.startsWith('image/')?{renderedSha256:await cameraFileHash(rendered)}:{})};
        stored.file=new File([file],saved.name,{type:file.type,lastModified:file.lastModified});
        await savePhoto(stored);device=true;
      }catch{
        if(saved)await deleteAndroidCameraCapture(saved.uri).catch(()=>{});
        stored.cameraCapture={...(details?.enhancedVideo?{enhancedVideo:true}:{})};stored.file=file;
        try{await savePhoto(stored);}catch{setStorageWarning(true);}
      }
    }
    setPhotos(all=>newestPhotos([...all,{...stored,url:URL.createObjectURL(stored.file),past:[],future:[]}]));
    if(cameraSession.current===session)cameraLastCapture.current=stored.id;
    return {collection,device,deviceExpected:isAndroid()};
  }
  useEffect(()=>{if(!isAndroid())return;let dispose:(()=>void)|undefined,cancelled=false;receiveAndroidPhotos(addFiles,notify).then(cleanup=>{if(cancelled)cleanup();else dispose=cleanup;}).catch(()=>notify(t("Could not enable Android file sharing.")));return()=>{cancelled=true;dispose?.();};},[]);
  useEffect(()=>{
    if(initialized.current)return;initialized.current=true;
    const loadEpoch=collectionEpoch.current;
    promoteSharedPhotos().then(()=>listPhotos()).then(items=>{if(loadEpoch!==collectionEpoch.current)return;setPhotos(all=>newestPhotos([...items.filter(p=>!photoRef.current.some(existing=>existing.id===p.id)).map(p=>({...p,url:URL.createObjectURL(p.file),past:[],future:[]})),...all]));if(items.length){const shared=new URLSearchParams(location.search).get('shared');setActive(current=>current??items.find(p=>p.id===shared)?.id??items[0].id);}}).catch(()=>setStorageWarning(true));
    if(isIOSCameraAvailable())void syncIOSCaptureRecords(false).catch(()=>setStorageWarning(true));
    if(import.meta.env.DEV) fetch('/__samples').then(r=>r.json()).then((names:string[])=>setSamples(names.map(name=>({name,label:labelFor(name)})))).catch(()=>{});
    const receive=(event:MessageEvent)=>{if(event.data?.type!=='shared-photos')return;const epoch=collectionEpoch.current;if(clearingCollectionRef.current){if(event.data.id)deferredShareIds.current.add(event.data.id);return;}promoteSharedPhotos(event.data.id?[event.data.id]:undefined).then(()=>listPhotos()).then(items=>{if(epoch!==collectionEpoch.current)return;const ids=new Set(photoRef.current.map(p=>p.id)),added=items.filter(p=>!ids.has(p.id));setPhotos(all=>{const current=new Set(all.map(p=>p.id));return newestPhotos([...all,...added.filter(p=>!current.has(p.id)).map(p=>({...p,url:URL.createObjectURL(p.file),past:[],future:[]}))]);});if(!librarySwitchLock.current&&event.data.id&&items.some(p=>p.id===event.data.id))setActive(event.data.id);}).catch(()=>setStorageWarning(true));};
    navigator.serviceWorker?.addEventListener('message',receive);
    return ()=>navigator.serviceWorker?.removeEventListener('message',receive);
  },[]);
  const suspendWorkers=capabilities.nativeCamera&&cameraOpen;
  useEffect(()=>{
    if(suspendWorkers){worker.current=null;photoProcessor.current=null;videoProcessor.current=null;return;}
    let w=new Worker(new URL('./processor.worker.ts',import.meta.url),{type:'module'});const v=new Worker(new URL('./video.worker.ts',import.meta.url),{type:'module'});worker.current=w;photoProcessor.current=w;videoProcessor.current=v;
    if(pendingCustomCommand.current)w.postMessage({...pendingCustomCommand.current,gen:generation.current});
    let disposed=false;
    const receive=({data}:MessageEvent)=>{
      if(disposed){data.bitmap?.close();data.original?.close();return;}
      if(data.type==='custom-ready') {
        pendingCustomCommand.current=null;
        const blob=pendingModelBlob.current;pendingModelBlob.current=null;pendingModelRestore.current=false;
        setCustomModel(data.config);setCustomFile(blob);setCustomCandidate(null);setCustomOpen(false);
        if(blob&&!data.restore){setCustomLoading(true);void rememberCustomModel(blob,data.config).then(()=>setRememberedModel(data.config)).catch(()=>notify(t("The model loaded, but could not be saved for the next launch."))).finally(()=>setCustomLoading(false));}
        else {setRememberedModel(data.config);setCustomLoading(false);}
        return;
      }
      if(data.type==='error'&&data.operation==='custom-model'){
        pendingCustomCommand.current=null;
        setCustomLoading(false);
        if(data.restore){pendingModelBlob.current=null;pendingModelRestore.current=false;setCustomOpen(true);setCustomError(data.message==='Saved custom model is missing or damaged.'?t("The saved model is missing or damaged. Choose it again; saved colour ranges are kept."):t("The saved model could not be restored. Try again or choose its file; the saved model and ranges are kept."));}
        else {pendingModelBlob.current=null;applyCustomModel.current=false;setCustomError(data.message);}
        return;
      }
      if(data.type==='hdr-needed'){
        if(data.gen!==generation.current)return;
        const current=photoRef.current.find(item=>item.id===activeRef.current);
        if(!current){setBusy('');setRendering(false);return;}
        if(!isAndroid()){
          setBusy('');setRendering(false);setReady(false);
          notify(t("HDR video needs an SDR copy. Open it in the Android app on a supported device to make a working copy."));
          return;
        }
        const token=data.gen,photoId=current.id;
        hdrActive.current={generation:token,photoId};hdrJobId.current=null;setHdrProgress(0);setHdrConverting(true);setBusy(t("Preparing HDR video…"));
        void convertHdrImportRequest(current.file,()=>token===generation.current&&activeRef.current===photoId,progress=>{if(token===generation.current)setHdrProgress(progress);},id=>{hdrJobId.current=id;if(hdrActive.current?.generation!==token)void cancelAndroidHdrWorkingCopy(id);})
          .then(copy=>{
            if(!copy)return;
            for(const id of hdrWorkingCopies.current.keys())if(id!==photoId)disposeHdrWorkingCopy(id);
            hdrWorkingCopies.current.set(photoId,copy);hdrJobId.current=null;hdrActive.current=null;setHdrConverting(false);setBusy(t("Opening video…"));
            videoProcessor.current?.postMessage({type:'load',gen:token,blob:copy.file,photoResolution,photoDevice});
          })
          .catch(error=>{
            if(token!==generation.current)return;
            hdrJobId.current=null;hdrActive.current=null;setHdrConverting(false);setBusy('');setRendering(false);setReady(false);
            if(error instanceof DOMException&&error.name==='AbortError')notify(t("HDR conversion cancelled."));
            else notify(error instanceof Error?error.message:t("This HDR video could not be converted on this device."));
          });
        return;
      }
      if(data.type==='rendered'||(data.type==='error'&&data.operation==='render'))finishPreviewRender(data.request);
      if(data.gen!==generation.current){data.bitmap?.close();data.original?.close();return;}
      if(data.type==='photo-info'){setPhotoInfo(data.info);}
      else if(data.type==='enhancement-ready'&&data.request===latest.current){autoEnhancementRequest.current=null;setBusy('');setRendering(false);update(r=>({...r,enhancement:{...data.enhancement,autoApplied:true}}));}
      else if(data.type==='loaded') {
        setPhotoInfo(data.photo??null);setPhotoRetry(false);
        setAnalysis(data.analysis);setDimensions([data.width,data.height]);setVideoInfo(data.video?{...data.video,hdrToneMapped:hdrWorkingCopies.current.has(activeRef.current??'')}:null);setBusy('');setReady(true);expandedGesture.current.points.clear();expandedGesture.current.pinched=false;expandedGesture.current.picker=false;setZoom(1);
        const c=originalCanvas.current;
        if(c){c.width=data.original.width;c.height=data.original.height;c.getContext('2d')!.drawImage(data.original,0,0);
          const edited=editedCanvas.current;if(edited){edited.width=c.width;edited.height=c.height;edited.getContext('2d')!.drawImage(c,0,0);}}
        else {pendingBitmap.current?.close();pendingBitmap.current=data.original;}
        if(c)data.original.close();
        const thumbnailCanvas=document.createElement('canvas');thumbnailCanvas.width=160;thumbnailCanvas.height=Math.round(160*data.height/data.width);
        if(c)thumbnailCanvas.getContext('2d')!.drawImage(c,0,0,thumbnailCanvas.width,thumbnailCanvas.height);
        const thumbnail=c?thumbnailCanvas.toDataURL('image/jpeg',.75):undefined;
        setPhotos(all=>all.map(p=>{if(p.id!==activeRef.current)return p;let next=p.recipe??(data.video?makeVideoRecipe(data.analysis):makePhotoRecipe(data.analysis));return {...p,recipe:next,thumbnail:p.cameraCapture||p.nativeCapture?(p.thumbnail??thumbnail):(thumbnail??p.thumbnail)};}));
      } else if(data.type==='neutral-picked'&&data.request===neutralRequest.current) {
        if(!data.neutral){notify(t("Choose a midtone white or grey area, away from deep shadows and bright highlights."));}
        else {update(r=>({...r,manual:{...r.manual,neutral:data.neutral}}));notify(t("Neutral point applied. Undo if the selected area was not white or grey."));}
      } else if(data.type==='rendered') {
        if(data.request===latest.current){workerRecovery.current={photoId:activeRef.current,attempts:0};if(data.analysis&&!previewPlayback.current.playing)setAnalysis(data.analysis);const c=editedCanvas.current;if(c){c.width=data.bitmap.width;c.height=data.bitmap.height;c.getContext('2d')!.drawImage(data.bitmap,0,0);c.dataset.generation=String(data.gen);c.dataset.request=String(data.request);}if(data.original&&originalCanvas.current){const o=originalCanvas.current;o.width=data.original.width;o.height=data.original.height;o.getContext('2d')!.drawImage(data.original,0,0);}setRendering(false);setModelStatus('');
          if(previewPlayback.current.playing){const next=videoPreviewPlayhead(previewPlayback.current.startTime,previewPlayback.current.startedAt,performance.now(),videoDurationRef.current);if(next.ended){pauseVideoPreview();setPreviewTime(next.time);}else if(next.time>previewTimeRef.current+.001)setPreviewTime(next.time);}}
        data.original?.close();
        data.bitmap.close();
      } else if(data.type==='model-status'&&data.request===latest.current) setModelStatus(data.message);
      else if(data.type==='progress'&&data.request===exportRequest.current) setProgress(data.progress);
      else if(data.type==='exported'&&data.request===exportRequest.current) {
        void finishExport(data.blob,data.metadataWarning);
      } else if(data.type==='error') {
        if(data.operation==='enhance'){
          if(data.request!==autoEnhancementRequest.current)return;
          autoEnhancementRequest.current=null;
        }
        if(data.operation==='render'&&data.request!==latest.current)return;
        if(data.operation==='load'||data.operation==='render'){
          const id=activeRef.current;
          if(workerRecovery.current.photoId!==id)workerRecovery.current={photoId:id,attempts:0};
          const current=photoRef.current.find(item=>item.id===id),retryable=current&&isVideo(current.file)?data.retryable===true:data.retryable!==false;
          if(id&&retryable&&workerRecovery.current.attempts<1){workerRecovery.current.attempts++;clearPreviewRenderQueue();pauseVideoPreview();setBusy(current&&isVideo(current.file)?t("Opening video…"):t("Opening photo…"));setReady(false);setRendering(true);setPhotoRetry(false);setProcessorEpoch(epoch=>epoch+1);return;}
        }
        setModelStatus('');
        setBusy('');setExporting(false);setRendering(false);
        if(data.operation==='load')setReady(false);
        if(data.operation==='load'||data.operation==='render'||data.operation==='export')setPhotoRetry(true);
        notify(data.message);
      }
    };
    w.onmessage=receive;v.onmessage=receive;
    const fail=()=>{clearPreviewRenderQueue();pauseVideoPreview();setBusy('');setExporting(false);setReady(false);setPhotoRetry(true);notify(t("The processing worker stopped. Reopen the file, or refresh and try a smaller file."));};
    const recover=(failed:Worker)=>{
      if(failed!==photoProcessor.current&&failed!==videoProcessor.current)return;
      if(document.visibilityState==='hidden'){deferredWorkerFailure.current=true;return;}
      const id=activeRef.current;
      if(workerRecovery.current.photoId!==id)workerRecovery.current={photoId:id,attempts:0};
      if(workerRecovery.current.attempts<1&&id){workerRecovery.current.attempts++;clearPreviewRenderQueue();pauseVideoPreview();if(exportingRef.current){exportTarget.current=null;setExporting(false);notify(t("Export cancelled."));}const current=photoRef.current.find(item=>item.id===id);setBusy(current&&isVideo(current.file)?t("Opening video…"):t("Opening photo…"));setReady(false);setRendering(true);setPhotoRetry(false);setProcessorEpoch(epoch=>epoch+1);return;}
      fail();
    };
    w.onerror=()=>recover(w);v.onerror=()=>recover(v);w.onmessageerror=()=>recover(w);v.onmessageerror=()=>recover(v);
    return ()=>{disposed=true;clearPreviewRenderQueue();w.terminate();v.terminate();if(worker.current===w||worker.current===v)worker.current=null;if(photoProcessor.current===w)photoProcessor.current=null;if(videoProcessor.current===v)videoProcessor.current=null;pendingBitmap.current?.close();};
  },[processorEpoch,suspendWorkers]);
  useEffect(()=>{
    const recoverOnForeground=()=>{
      if(document.visibilityState!=='visible'||!deferredWorkerFailure.current||cameraOpen||saving||hdrConverting)return;
      deferredWorkerFailure.current=false;const id=activeRef.current;if(!id)return;
      if(exporting){exportTarget.current=null;setExporting(false);notify(t("Export cancelled."));}
      if(customLoading){pendingModelBlob.current=null;pendingModelRestore.current=false;pendingCustomCommand.current=null;applyCustomModel.current=false;setCustomLoading(false);setCustomError(t("The processing worker stopped. Reopen the file, or refresh and try a smaller file."));}
      if(workerRecovery.current.photoId!==id)workerRecovery.current={photoId:id,attempts:0};
      if(workerRecovery.current.attempts<1){workerRecovery.current.attempts++;clearPreviewRenderQueue();pauseVideoPreview();const current=photoRef.current.find(item=>item.id===id);setBusy(current&&isVideo(current.file)?t("Opening video…"):t("Opening photo…"));setReady(false);setRendering(true);setPhotoRetry(false);setProcessorEpoch(epoch=>epoch+1);}
      else{setBusy('');setReady(false);setRendering(false);setPhotoRetry(true);notify(t("The processing worker stopped. Reopen the file, or refresh and try a smaller file."));}
    };
    document.addEventListener('visibilitychange',recoverOnForeground);window.addEventListener('pageshow',recoverOnForeground);window.addEventListener('focus',recoverOnForeground);recoverOnForeground();
    return()=>{document.removeEventListener('visibilitychange',recoverOnForeground);window.removeEventListener('pageshow',recoverOnForeground);window.removeEventListener('focus',recoverOnForeground);};
  },[cameraOpen,exporting,saving,customLoading,hdrConverting]);
  useEffect(()=>{
    if(modelRestoreStarted.current)return;modelRestoreStarted.current=true;let cancelled=false;
    loadRememberedCustomModel().then(saved=>{
      if(cancelled||modelSelectionStarted.current||!saved)return;setRememberedModel(saved.config);setInputRange(saved.config.inputRange);setOutputRange(saved.config.outputRange);
      if(!saved.blob){setCustomOpen(true);setCustomError(t("The saved model is missing or damaged. Choose it again; saved colour ranges are kept."));return;}
      pendingModelBlob.current=saved.blob;pendingModelRestore.current=true;setCustomLoading(true);
      pendingCustomCommand.current={type:'custom-model',permission:true,blob:saved.blob,name:saved.config.name,inputRange:saved.config.inputRange,outputRange:saved.config.outputRange,restore:true,expectedConfig:saved.config};
      if(photoProcessor.current)photoProcessor.current.postMessage({...pendingCustomCommand.current,gen:generation.current});
    }).catch(()=>{if(!cancelled){setCustomOpen(true);setCustomLoading(false);setCustomError(t("Saved custom model storage could not be read. Choose the model file again; saved colour ranges are kept."));}});
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    if(!video||!customFile||!customModel||!videoProcessor.current)return;
    videoProcessor.current.postMessage({type:'custom-model',gen:generation.current,permission:true,blob:customFile,name:customModel.name,inputRange:customModel.inputRange,outputRange:customModel.outputRange,silent:true,expectedConfig:customModel});
  },[video,customFile,customModel]);
  useEffect(()=>{
    if(capabilities.nativeCamera&&cameraOpen){
      pauseVideoPreview();clearPreviewRenderQueue();pendingBitmap.current?.close();pendingBitmap.current=null;
      for(const canvas of [originalCanvas.current,editedCanvas.current])if(canvas){canvas.width=1;canvas.height=1;delete canvas.dataset.generation;delete canvas.dataset.request;}
      setReady(false);setRendering(false);setBusy('');setPhotoInfo(null);setPhotoRetry(false);setVideoInfo(null);setModelStatus('');setAnalysis(null);setDimensions([1,1]);
      return;
    }
    pauseVideoPreview();
    clearPreviewRenderQueue();    if(!active){
      const converting=hdrActive.current;if(converting){hdrActive.current=null;void cancelHdrWorkingCopy();}disposeHdrWorkingCopies();setHdrConverting(false);hdrJobId.current=null;
      const gen=++generation.current;photoProcessor.current?.postMessage({type:'unload',gen});videoProcessor.current?.postMessage({type:'unload',gen});worker.current=null;
      pendingBitmap.current?.close();pendingBitmap.current=null;
      for(const canvas of [originalCanvas.current,editedCanvas.current])if(canvas){canvas.width=1;canvas.height=1;delete canvas.dataset.generation;delete canvas.dataset.request;}
      setPhotoInfo(null);setPhotoRetry(false);setVideoInfo(null);setPreviewTime(0);setModelStatus('');setAnalysis(null);setDimensions([1,1]);setBusy('');setReady(false);setRendering(false);setEyedropper(false);setShareReady(null);setIosWebSave(null);
      return;
    }
    const p=photoRef.current.find(p=>p.id===active);if(!p)return;
    if(workerRecovery.current.photoId!==p.id)workerRecovery.current={photoId:p.id,attempts:0};
    if(p.nativeCapture&&!p.nativeCapture.loaded){
      const token=++generation.current,epoch=collectionEpoch.current,controller=new AbortController();
      const clip=p.nativeCapture.descriptor.kind==='video';
      if(clip&&!capabilities.videoEditing){setBusy('');setRendering(false);setReady(false);notify(t('Video editing and export are unavailable on this device.'));return()=>controller.abort();}
      setBusy(clip?t('Opening video…'):t('Opening photo…'));setReady(false);setRendering(true);
      void readIOSCaptureFile(p.nativeCapture.descriptor,'source',controller.signal).then(file=>{
        if(controller.signal.aborted||token!==generation.current||epoch!==collectionEpoch.current||activeRef.current!==p.id)return;
        setPhotos(all=>all.map(item=>item.id===p.id?{...item,file,nativeCapture:{...item.nativeCapture!,loaded:true}}:item));
        setPhotoReload(n=>n+1);
      }).catch(error=>{
        if(controller.signal.aborted||token!==generation.current)return;
        setBusy('');setRendering(false);setReady(false);notify(error instanceof Error?error.message:t('Could not open this file.'));
      });
      return()=>controller.abort();
    }
    if(p.nativeCapture?.descriptor.kind==='video'&&!capabilities.videoEditing){setBusy('');setRendering(false);setReady(false);return;}
    for(const id of hdrWorkingCopies.current.keys())if(id!==p.id)disposeHdrWorkingCopy(id);
    const clip=isVideo(p.file);worker.current=clip?videoProcessor.current:photoProcessor.current;
    const loadGeneration=++generation.current;autoEnhancementRequest.current=null;setShareReady(null);setIosWebSave(null);setPhotoInfo(null);setPhotoRetry(false);setVideoInfo(null);setPreviewTime(0);setKeepAudio(true);setModelStatus('');setReady(false);setRendering(true);setAnalysis(null);setBusy(clip?t("Opening video…"):isRaw(p.file)?t("Developing DNG locally…"):/\.hei[cf]$/i.test(p.file.name)?t("Decoding HEIC locally…"):t("Opening photo…"));setEyedropper(false);
    (clip?photoProcessor.current:videoProcessor.current)?.postMessage({type:'unload',gen:generation.current});
    if(customFile&&customModel)worker.current?.postMessage({type:'custom-model',gen:generation.current,permission:true,blob:customFile,name:customModel.name,inputRange:customModel.inputRange,outputRange:customModel.outputRange,silent:true,expectedConfig:customModel});
    const hdrCopy=hdrWorkingCopies.current.get(p.id);
    worker.current?.postMessage({type:'load',gen:loadGeneration,blob:hdrCopy?.file??p.file,photoResolution,photoDevice});
    return ()=>{const conversion=hdrActive.current;if(conversion?.generation===loadGeneration){hdrActive.current=null;void cancelHdrWorkingCopy();}const previous=photoRef.current.find(item=>item.id===active);if(previous?.recipe)persist(previous);if(previous?.nativeCapture?.loaded&&previous.previewFile&&!clearingCollectionRef.current)setPhotos(all=>all.map(item=>item.id===previous.id?{...item,file:previous.previewFile!,nativeCapture:{...item.nativeCapture!,loaded:false}}:item));};
  },[active,photoResolution,photoReload,cameraOpen,processorEpoch]);
  useEffect(()=>{
    if(ready&&pendingBitmap.current&&originalCanvas.current){const b=pendingBitmap.current,c=originalCanvas.current;c.width=b.width;c.height=b.height;c.getContext('2d')!.drawImage(b,0,0);b.close();pendingBitmap.current=null;}
  },[ready]);
  useEffect(()=>{
    if(!recipe||!ready||cameraOpen||(photo?.nativeCapture&&(!photo.nativeCapture.loaded||(video&&!capabilities.videoEditing))))return;
    if(exporting){deferredPreviewRender.current=true;return;}
    if(autoEnhancementRequest.current!==null){autoEnhancementRequest.current=null;setBusy('');}
    if(recipe.engine==='wave'&&(!customModel||(recipe.customModel&&(recipe.customModel.sha256!==customModel.sha256||recipe.customModel.inputRange!==customModel.inputRange||recipe.customModel.outputRange!==customModel.outputRange)))){latest.current=++request.current;setInputRange(recipe.customModel?.inputRange??'unit');setOutputRange(recipe.customModel?.outputRange??'unit');setCustomOpen(true);setRendering(true);return;}
    const id=++request.current;latest.current=id;setRendering(true);
    const timer=setTimeout(()=>{previewRenderQueue.current.pending={type:'render',gen:generation.current,request:id,recipe,time:previewTime};drainPreviewRenderQueue();},40);
    return ()=>clearTimeout(timer);
  },[recipe,ready,customModel,previewTime,photo?.id,photo?.nativeCapture?.loaded,cameraOpen,previewRenderNonce]);
  useEffect(()=>{if(!exporting&&deferredPreviewRender.current){deferredPreviewRender.current=false;setPreviewRenderNonce(value=>value+1);}},[exporting]);
  useEffect(()=>{if(!video||!ready||exporting||cameraOpen||settingsOpen||about||customOpen||saveDialog)pauseVideoPreview();},[video,ready,exporting,cameraOpen,settingsOpen,about,customOpen,saveDialog,pauseVideoPreview]);
  useEffect(()=>{setShareReady(null);},[recipe,format,jpegQuality,keepMetadata,keepAudio,exportMode]);
  useEffect(()=>{const pauseWhenHidden=()=>{if(document.visibilityState!=='visible')pauseVideoPreview();};document.addEventListener('visibilitychange',pauseWhenHidden);window.addEventListener('pagehide',pauseVideoPreview);return()=>{document.removeEventListener('visibilitychange',pauseWhenHidden);window.removeEventListener('pagehide',pauseVideoPreview);};},[pauseVideoPreview]);
  useEffect(()=>()=>{previewPlayback.current.playing=false;},[]);
  useEffect(()=>{if(!recipe||!ready||exporting)return;previewRenderQueue.current.pending=null;},[recipe,ready,exporting]);
  useEffect(()=>{
    if(customModel&&analysis&&applyCustomModel.current){applyCustomModel.current=false;update(r=>({...r,engine:'wave',customModel,auto:suggest(analysis,r.hints,'wave')}));setCustomOpen(false);}
  },[customModel,analysis]);
  useEffect(()=>{if(!photo?.recipe)return;const timer=setTimeout(()=>persist(photo),400);return ()=>clearTimeout(timer);},[photo?.recipe,photo?.thumbnail]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6500);return ()=>clearTimeout(timer);},[notice]);
  useEffect(()=>{
    const dialog=Array.from(document.querySelectorAll<HTMLElement>('.modal-shade [role="dialog"]')).at(-1);if(!dialog)return;dialog.tabIndex=-1;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
    const first=focusable()[0]??dialog;first.focus();
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        if(exporting){event.preventDefault();event.stopPropagation();if(!saving)cancelExport();}
        else if(customOpen){event.preventDefault();event.stopPropagation();if(!customLoading)cancelCustom();}
        else if(saveDialog){event.preventDefault();event.stopPropagation();setSaveDialog(false);}
        else if(iosWebSave){event.preventDefault();event.stopPropagation();setIosWebSave(null);}
        return;
      }
      if(event.key!=='Tab')return;
      const items=focusable();if(!items.length){event.preventDefault();dialog.focus();return;}
      const start=items[0],end=items[items.length-1];
      if(event.shiftKey&&(document.activeElement===start||!dialog.contains(document.activeElement))){event.preventDefault();end.focus();}
      else if(!event.shiftKey&&(document.activeElement===end||!dialog.contains(document.activeElement))){event.preventDefault();start.focus();}
    };
    document.addEventListener('keydown',onKey,true);
    return ()=>{document.removeEventListener('keydown',onKey,true);if(previous?.isConnected)previous.focus();};
  },[saveDialog,customOpen,exporting,customLoading,saving,iosWebSave]);
  useEffect(()=>{if(!stage.current)return;const observer=new ResizeObserver(entries=>{const element=entries[0].target as HTMLDivElement;setStageSize({width:element.clientWidth,height:element.clientHeight});});observer.observe(stage.current);return ()=>observer.disconnect();},[]);
  useEffect(()=>{if(!expanded)return;const place=()=>{const bounds=stage.current?.getBoundingClientRect();if(!bounds)return;let bottomEdge=bounds.bottom;
      if(narrowControls&&adjustmentsOpen){const panel=controlsPanel.current?.getBoundingClientRect();if(panel&&panel.top>bounds.top)bottomEdge=Math.min(bottomEdge,panel.top);}
      bottomEdge=Math.max(bounds.top+56,bottomEdge);const next={right:Math.round(Math.max(8,window.innerWidth-bounds.right+8)),bottom:Math.round(Math.max(8,window.innerHeight-bottomEdge+8))};setZoomControlPosition(current=>current.right===next.right&&current.bottom===next.bottom?current:next);};
    const observer=new ResizeObserver(place);if(stage.current)observer.observe(stage.current);if(controlsPanel.current)observer.observe(controlsPanel.current);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);place();return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[expanded,narrowControls,adjustmentsOpen]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(!settingsOpen&&!cameraOpen&&(e.ctrlKey||e.metaKey)&&e.key==='z'&&!['INPUT','SELECT','TEXTAREA'].includes((e.target as HTMLElement).tagName)){e.preventDefault();if(canEdit)history(e.shiftKey?'redo':'undo');}};window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey);},[active,canEdit,cameraOpen,settingsOpen]);
  async function sample(name:string){
    if(exporting||sampleBusy)return;setSampleBusy(true);
    try{const response=await fetch('/__sample/'+encodeURIComponent(name));if(!response.ok)throw new Error(t("Sample unavailable."));const blob=await response.blob();addFiles([new File([blob],name,{type:blob.type})]);}
    catch{notify(t("Could not open this local sample. Use Open files instead."));}finally{setSampleBusy(false);}
  }
  function reset(){if(analysis)update(()=>video?makeVideoRecipe(analysis):makePhotoRecipe(analysis));setEyedropper(false);}
  function cancelCustom(){
    if(customLoading)return;pendingModelBlob.current=null;pendingCustomCommand.current=null;applyCustomModel.current=false;setCustomCandidate(null);setCustomOpen(false);setCustomError('');
    const matching=!!customModel&&(!recipe?.customModel||(recipe.customModel.sha256===customModel.sha256&&recipe.customModel.inputRange===customModel.inputRange&&recipe.customModel.outputRange===customModel.outputRange));
    if(recipe?.engine==='wave'&&!matching&&analysis)update(r=>({...r,engine:'balanced',auto:suggest(analysis,r.hints,'balanced')}));
  }
  async function forgetSavedModel(){if(customLoading)return;try{await forgetCustomModel();setRememberedModel(null);notify(t("Saved custom model removed from this device."));}catch{notify(t("Could not remove the saved custom model."));}}
  function autoEnhance(){if(!canEdit||video||rendering)return;const id=++request.current;latest.current=id;autoEnhancementRequest.current=id;setBusy(t('Analysing photo enhancement…'));worker.current?.postMessage({type:'enhance',gen:generation.current,request:id,recipe});}
  function enhance(key:'contrast'|'clarity'|'sharpness'|'brightness',value:number){update(r=>{const previous={...r.enhancement??DEFAULT_ENHANCEMENT};delete previous.autoApplied;return {...r,enhancement:{...previous,[key]:value}};},false);}
  const autoEnhancementApplied=recipe?.enhancement?.autoApplied===true&&(
    recipe.enhancement.contrast!==0||recipe.enhancement.clarity!==0||recipe.enhancement.sharpness!==0||
    (recipe.enhancement.brightness??0)!==0||recipe.enhancement.black!==0||recipe.enhancement.white!==1);
  async function exportPhoto(saveAs=false,chooseNewFolder=false,downloadOnly=false,saveGallery=false,shareOnly=false){
    if(!canEdit||rendering||saving||exporting||!photo)return;
    if(video&&!capabilities.videoExport){notify(t('Video editing and export are unavailable on this device.'));return;}
    if(capabilities.platform==='ios'&&!capabilities.nativeMediaSave){notify(t('Photo export is unavailable in this iOS build.'));return;}
    if(video&&videoPlan&&!videoPlan.supported){notify(message(videoPlan.reason??''));return;}
    if(saveAs&&!saveDialog&&supportsFolder()){setSaveName(restoredName(photo.file.name,exportFormat,!outputFolder));setSaveDialog(true);return;}
    pauseVideoPreview();
    setShareReady(null);setIosWebSave(null);
    setExporting(true);setProgress(0);
    try {
      if(saveGallery&&isAndroid()&&photo.cameraCapture?.uri){
        exportTarget.current={name:photo.cameraCapture.name??photo.file.name,cameraId:photo.id,cameraUri:photo.cameraCapture.uri};
        exportRequest.current=++request.current;worker.current?.postMessage({type:'export',gen:generation.current,request:exportRequest.current,recipe,format:video?'mp4':'jpg',keepAudio,keepMetadata,exportMode,jpegQuality});return;
      }
      let folder=downloadOnly||shareOnly?undefined:outputFolder??undefined;
      if(!downloadOnly&&!shareOnly&&supportsFolder()&&(chooseNewFolder||!folder)) {
        const chosen=await chooseFolder();
        folder=chosen;setOutputFolder(chosen);
      }
      const name=saveAs&&saveDialog?restoredName(saveName,exportFormat,false):restoredName(photo.file.name,exportFormat,!folder);
      setSaveDialog(false);exportTarget.current={name,folder,share:shareOnly};
      exportRequest.current=++request.current;worker.current?.postMessage({type:'export',gen:generation.current,request:exportRequest.current,recipe,format:exportFormat,keepAudio,keepMetadata,exportMode,jpegQuality});
    }catch(error){setExporting(false);if(!(error instanceof DOMException&&error.name==='AbortError'))notify(error instanceof Error?error.message:t("Could not open the save folder."));}
  }
  async function exportCameraOriginal(){
    if(photo?.nativeCapture){if(saving||exporting)return;setSaving(true);try{const result=await shareIOSCapture(photo.id,'source');if(result.completed)notify(t('Saved {0}.',[photo.file.name]));}catch{notify(t('Could not export the camera original.'));}finally{setSaving(false);}return;}
    if(!photo?.cameraCapture||saving||exporting)return;setSaving(true);
    const stem=photo.file.name.replace(/\.[^.]+$/,''),extension=photo.file.name.match(/\.[^.]+$/)?.[0]??(video?'.mp4':'.jpg'),name=stem+'-original'+extension;
    try{if(isAndroid()){const folder=outputFolder??await chooseFolder(),target=await createUniqueFile(folder,name);await writeFile(target.handle,photo.file);notify(t('Saved {0}.',[target.name]));}else if(capabilities.platform==='ios'){if(!capabilities.nativeMediaSave)throw new Error(t('Photo export is unavailable in this iOS build.'));const shared=await shareIOSFile(photo.file,name);if(shared.completed)notify(t('Saved {0}.',[name]));}else if(iosWeb)setIosWebSave({blob:photo.file,name});else download(photo.file,name);}
    catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))notify(t('Could not export the camera original.'));}finally{setSaving(false);}
  }
  async function shareNativeVideo(){
    if(!photo?.nativeCapture||photo.nativeCapture.descriptor.kind!=='video'||saving||exporting)return;
    setSaving(true);try{const result=await shareIOSCapture(photo.id,'source');if(result.completed)notify(t('Saved {0}.',[photo.nativeCapture.descriptor.name]));}catch(error){notify(error instanceof Error?error.message:t('Could not export the camera original.'));}finally{setSaving(false);}
  }
  async function saveNativeEnhancedPhoto(){
    if(!photo?.nativeCapture||photo.nativeCapture.descriptor.kind!=='photo'||saving||exporting)return;
    setSaving(true);try{const result=await saveIOSCaptureToPhotos(photo.id);if(result.saved){notify(t('Saved captured copy to Photos.'));return;}const shared=await shareIOSCapture(photo.id,'enhanced');if(shared.completed)notify(t('Shared captured copy.'));else notify(t('Could not save the captured copy to Photos. You can share it from the editor.'));}
    catch{notify(t('Could not save the captured copy to Photos. You can share it from the editor.'));}
    finally{setSaving(false);}
  }
  async function saveRecipeFile(){
    if(!canSaveRecipe||saving||exporting||!recipe)return;const blob=new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}),name='clearwater-recipe.json';
    if(iosWeb){setIosWebSave({blob,name});return;}
    if(capabilities.platform==='ios'){
      if(!capabilities.nativeMediaSave){notify(t('Photo export is unavailable in this iOS build.'));return;}
      try{const shared=await shareIOSFile(blob,name);if(shared.completed)notify(t('Saved {0}.',[name]));}catch(error){notify(error instanceof Error?error.message:t('Photo export is unavailable in this iOS build.'));}
    }else download(blob,name);
  }
  function cancelExport(){if(saving)return;pauseVideoPreview();clearPreviewRenderQueue();generation.current++;exportTarget.current=null;worker.current?.postMessage({type:'cancel',gen:generation.current});setExporting(false);notify(t("Export cancelled."));}
  function pickNeutralAt(clientX:number,clientY:number,frame:HTMLDivElement){
    if(!eyedropper||!canEdit||!originalCanvas.current||!recipe)return;
    const c=originalCanvas.current,rect=frame.getBoundingClientRect();
    const x=clamp(Math.floor((clientX-rect.left)/rect.width*c.width),0,c.width-1),y=clamp(Math.floor((clientY-rect.top)/rect.height*c.height),0,c.height-1);
    const id=++request.current;neutralRequest.current=id;
    worker.current?.postMessage({type:'sample-neutral',gen:generation.current,request:id,x,y,recipe,time:previewTime});
    setEyedropper(false);
  }
  function expandedPointerDown(e:ReactPointerEvent<HTMLDivElement>){
    const comparison=!!(e.target as HTMLElement).closest('.comparison-input');
    if(!ready)return;
    if(!expanded&&zoom<=1&&!eyedropper&&!comparison)return;
    const gesture=expandedGesture.current;
    if(comparison){e.preventDefault();if(gesture.points.size===0){gesture.startDivider=divider;const rect=e.currentTarget.getBoundingClientRect();setDivider(clamp((e.clientX-rect.left)/rect.width*100,0,100));}else if(gesture.points.size===1)setDivider(gesture.startDivider);}
    const point={x:e.clientX,y:e.clientY};gesture.points.set(e.pointerId,point);
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* Synthetic and already-cancelled pointers cannot be captured. */}
    if(gesture.points.size===1){gesture.pinched=false;gesture.moved=false;gesture.comparison=comparison;gesture.picker=eyedropper&&!comparison;gesture.startZoom=zoom;gesture.lastPoint=point;gesture.startDistance=0;}
    else if(gesture.points.size===2){gesture.pinched=true;gesture.picker=false;gesture.startZoom=zoom;const [a,b]=[...gesture.points.values()];gesture.startDistance=Math.hypot(a.x-b.x,a.y-b.y);}
    else {gesture.pinched=true;gesture.picker=false;}
  }
  function expandedPointerMove(e:ReactPointerEvent<HTMLDivElement>){
    const gesture=expandedGesture.current;if(!gesture.points.has(e.pointerId))return;
    const next={x:e.clientX,y:e.clientY},previous=gesture.points.get(e.pointerId)!;gesture.points.set(e.pointerId,next);
    if(gesture.points.size>=2){
      gesture.pinched=true;gesture.picker=false;gesture.moved=true;const [a,b]=[...gesture.points.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);
      if(gesture.startDistance>0)setZoom(clamp(gesture.startZoom*distance/gesture.startDistance,1,4));
      return;
    }
    if(gesture.pinched){gesture.moved=true;return;}
    const dx=next.x-previous.x,dy=next.y-previous.y;if(Math.hypot(next.x-(gesture.lastPoint?.x??next.x),next.y-(gesture.lastPoint?.y??next.y))>8)gesture.moved=true;
    if(gesture.comparison){const rect=e.currentTarget.getBoundingClientRect();setDivider(clamp((next.x-rect.left)/rect.width*100,0,100));}
    else if(zoom>1&&gesture.lastPoint&&stage.current){stage.current.scrollLeft-=dx;stage.current.scrollTop-=dy;}
  }
  function expandedPointerUp(e:ReactPointerEvent<HTMLDivElement>,cancelled=false){
    const gesture=expandedGesture.current;if(!gesture.points.has(e.pointerId))return;
    const applyPicker=gesture.points.size===1&&!gesture.pinched&&!gesture.moved&&gesture.picker&&!cancelled&&!((e.target as HTMLElement).closest('.comparison-input'));
    if(applyPicker)pickNeutralAt(e.clientX,e.clientY,e.currentTarget);
    gesture.points.delete(e.pointerId);
    if(gesture.points.size===0){gesture.pinched=false;gesture.moved=false;gesture.picker=false;gesture.comparison=false;gesture.startDistance=0;gesture.lastPoint=null;}
    try{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}catch{/* Pointer capture may already be released by the browser. */}
  }
  async function readRecipe(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0],targetId=activeRef.current;e.target.value='';if(!file||!targetId)return;try{if(file.size>20000)throw new Error(t("Recipe file is too large."));const next=parseRecipe(JSON.parse(await file.text())),target=photoRef.current.find(p=>p.id===targetId);if(!target)return;if(video&&next.balancedAfterAI)throw new Error(t("Balanced after AI is available for photos only."));const updated={...target,recipe:next,past:target.recipe?[...target.past.slice(-59),clone(target.recipe)]:target.past,future:[]};setPhotos(all=>all.map(p=>p.id===targetId?{...p,recipe:next,past:p.recipe?[...p.past.slice(-59),clone(p.recipe)]:p.past,future:[]}:p));persist(updated);notify(t("Recipe applied."));}catch(err){notify(err instanceof Error?message(err.message):t("Could not read the recipe."));}}
  const [cameraArchiveBusy,setCameraArchiveBusy]=useState(false);
  const sourceCheckBusy=useRef(false),sourceCleanup=useRef<()=>Promise<void>>(async()=>{});
  function detachPhotos(ids:Set<string>){
    if(!ids.size)return;
    const current=photoRef.current,remaining=current.filter(p=>!ids.has(p.id));
    for(const p of current)if(ids.has(p.id)){disposeHdrWorkingCopy(p.id);URL.revokeObjectURL(p.url);pendingPhotoWrites.current.delete(p.id);}
    if(activeRef.current&&ids.has(activeRef.current)){
      clearPreviewRenderQueue();const gen=++generation.current;worker.current?.postMessage({type:'unload',gen});setBusy('');setReady(false);setRendering(false);setAnalysis(null);setPhotoInfo(null);setPhotoRetry(false);setVideoInfo(null);setActive(remaining[0]?.id??null);
    }
    photoRef.current=remaining;setPhotos(remaining);if(folderBrowser)setFolderBrowser(null);
  }
  async function removePhoto(p:Photo){
    if(exporting||saving||folderLoading||clearingCollectionRef.current)return;
    if(p.nativeCapture){setCaptureRemovalError('');setPendingCaptureRemoval(p);return;}
    if(p.cameraCapture&&!window.confirm(t(p.cameraCapture.uri?'Delete this camera photo from the gallery and ClearWater? Its original and edits will also be deleted.':'Delete this camera original and its edits?')))return;
    setSaving(true);
    try{if(p.nativeCapture){await setIOSCaptureVisible(p.id,false);removedPhotoIds.current.add(p.id);detachPhotos(new Set([p.id]));}else{if(p.cameraCapture?.uri)await deleteAndroidCameraCapture(p.cameraCapture.uri);removedPhotoIds.current.add(p.id);await deletePhoto(p.id);detachPhotos(new Set([p.id]));}}
    catch{removedPhotoIds.current.delete(p.id);notify(t(p.nativeCapture?'Could not remove this camera item. Its private source is kept.':p.cameraCapture?'Could not delete the camera photo. Your original and edits are kept.':'Could not remove this collection item.'));}
    finally{setSaving(false);}
  }
  async function finishCaptureRemoval(permanent:boolean){
    const target=pendingCaptureRemoval;
    if(!target||saving||exporting)return;
    setSaving(true);setCaptureRemovalError('');
    // Block queued inventory reads and metadata writes from resurrecting this item.
    removedPhotoIds.current.add(target.id);
    try{
      const current=photoRef.current.find(item=>item.id===target.id)??target;
      if(permanent)await deleteIOSCapture(target.id);
      else{
        if(current.recipe)await setIOSCaptureRecipe(target.id,current.recipe as unknown as Record<string,unknown>);
        await setIOSCaptureVisible(target.id,false);
      }
      detachPhotos(new Set([target.id]));setPendingCaptureRemoval(null);
    }catch{
      removedPhotoIds.current.delete(target.id);
      setCaptureRemovalError(t('Could not remove this camera item. Its private source is kept.'));
      await syncIOSCaptureRecords(false).catch(()=>{});
    }finally{setSaving(false);}
  }
  sourceCleanup.current=async()=>{
    if(!isAndroid()||sourceCheckBusy.current||cameraOpen||cameraArchiveBusy||exporting||saving||busy||folderLoading||clearingCollectionRef.current)return;
    sourceCheckBusy.current=true;
    try{
      const epoch=collectionEpoch.current,archives=await listCameraOriginals(),records=[...new Map([...archives,...photoRef.current].map(p=>[p.id,p])).values()];
      const uris=records.map(p=>p.cameraCapture?.uri??p.sourceUri).filter((uri):uri is string=>!!uri);if(!uris.length)return;
      const states=await probeAndroidSources(uris);if(epoch!==collectionEpoch.current||exportTarget.current||backStateRef.current.activeWork)return;
      const removed=new Set<string>();
      for(const p of records){const uri=p.cameraCapture?.uri??p.sourceUri;if(!uri)continue;const state=states[uri];
        if(state==='missing'){removedPhotoIds.current.add(p.id);try{await deletePhoto(p.id);removed.add(p.id);}catch(error){removedPhotoIds.current.delete(p.id);throw error;}}
        else if(state==='trashed'&&photoRef.current.some(item=>item.id===p.id)){if(p.cameraCapture)await savePhoto(p);removedPhotoIds.current.add(p.id);try{await removePhotoFromCollection(p.id);removed.add(p.id);}catch(error){removedPhotoIds.current.delete(p.id);throw error;}}
      }
      detachPhotos(removed);
    }catch{/* Permission loss and unavailable providers must never remove originals. */}
    finally{sourceCheckBusy.current=false;}
  };
  useEffect(()=>{const timer=setTimeout(()=>void sourceCleanup.current(),500);return()=>clearTimeout(timer);},[photos.length,cameraOpen,busy,exporting,saving,cameraArchiveBusy]);
  useEffect(()=>{const check=()=>{if(document.visibilityState==='visible')void sourceCleanup.current();};document.addEventListener('visibilitychange',check);window.addEventListener('focus',check);return()=>{document.removeEventListener('visibilitychange',check);window.removeEventListener('focus',check);};},[]);
  async function restoreCameraCollection(){
    if(cameraArchiveBusy||exporting||saving||busy||clearingCollectionRef.current)return;setCameraArchiveBusy(true);
    try{
      const archived=await listCameraOriginals(),states=await probeAndroidSources(archived.map(p=>p.cameraCapture?.uri).filter((uri):uri is string=>!!uri)),existing=new Set(photoRef.current.map(p=>p.id));
      const added:Photo[]=[],addedAt=Date.now();
      for(const record of archived){const state=record.cameraCapture?.uri?states[record.cameraCapture.uri]:undefined;if(state==='missing'){await deletePhoto(record.id);continue;}if(state==='trashed'||existing.has(record.id))continue;
        const restored={...record,addedAt:addedAt-added.length/1000};await savePhoto(restored);removedPhotoIds.current.delete(restored.id);added.push({...restored,url:URL.createObjectURL(restored.file),past:[],future:[]});
      }
      if(added.length){setPhotos(all=>newestPhotos([...all,...added]));if(!activeRef.current)setActive(added[0].id);}
      notify(t('Restored {0} camera items to the collection.',[added.length]));
    }catch{notify(t('Could not restore camera items. Your saved originals are kept.'));}finally{setCameraArchiveBusy(false);}
  }
  async function restoreIOSPrivateCaptures(){
    if(!isIOSCameraAvailable()||cameraArchiveBusy||cameraOpen||saving||exporting||busy||clearingCollectionRef.current)return;
    setCameraArchiveBusy(true);
    try{
      const hidden=(await listIOSCaptures()).filter(capture=>!capture.visible);
      for(const capture of hidden){await setIOSCaptureVisible(capture.id,true);removedPhotoIds.current.delete(capture.id);}
      await syncIOSCaptureRecords(false);
      notify(t('Restored {0} private camera captures to the collection.',[hidden.length]));
    }catch{
      await syncIOSCaptureRecords(false).catch(()=>{});
      notify(t('Could not restore all private camera captures. Already restored captures remain in the collection.'));
    }finally{setCameraArchiveBusy(false);}
  }
  async function deleteIOSPrivateCaptures(){
    if(!isIOSCameraAvailable()||cameraArchiveBusy||cameraOpen||saving||exporting||clearingCollectionRef.current)return;
    if(!window.confirm(t('Delete all private camera captures from this app? Independent copies already saved to Photos are not affected.')))return;
    setCameraArchiveBusy(true);
    const guarded=new Set<string>(),deleted=new Set<string>();
    try{
      const captures=await listIOSCaptures();
      for(const capture of captures){guarded.add(capture.id);removedPhotoIds.current.add(capture.id);}
      for(const capture of captures){await deleteIOSCapture(capture.id);deleted.add(capture.id);}
      detachPhotos(deleted);notify(t('Private camera captures deleted. Photos copies are unchanged.'));
    }catch{
      for(const id of guarded)if(!deleted.has(id))removedPhotoIds.current.delete(id);
      detachPhotos(deleted);await syncIOSCaptureRecords(false).catch(()=>{});
      notify(t('Could not delete all private camera captures. Remaining captures are kept.'));
    }finally{setCameraArchiveBusy(false);}
  }
  const clearBlocked=cameraArchiveBusy||exporting||saving||!!busy||folderLoading||customOpen||customLoading||sampleBusy||rendering||updating||saveDialog||hdrConverting;
  function openClearCollection(event:React.MouseEvent<HTMLButtonElement>){if(clearBlocked||clearingCollectionRef.current)return;clearOpenerRef.current=event.currentTarget;setClearError('');setClearCollectionOpen(true);}
  function closeClearCollection(){if(clearingCollectionRef.current)return;setClearCollectionOpen(false);setClearError('');requestAnimationFrame(()=>clearOpenerRef.current?.focus());}
  const [clearError,setClearError]=useState('');
  const handleLaunchMode=useCallback((mode:'camera'|'edit')=>{
    if(exporting||saving||busy||folderLoading||clearingCollectionRef.current||customOpen||customLoading||hdrConverting||cameraArchiveBusy||saveDialog)return false;
    closeAbout();setSettingsOpen(false);setExpanded(false);
    if(mode==='camera'){if(!cameraOpen){cameraSession.current++;cameraLastCapture.current=null;setCameraOpen(true);}}
    else if(cameraOpen)cameraRef.current?.requestClose();
    return true;
  },[exporting,saving,busy,folderLoading,customOpen,customLoading,hdrConverting,cameraArchiveBusy,saveDialog,cameraOpen,closeAbout]);
  useLaunchMode(handleLaunchMode);
  async function clearCollection(){
    if(clearBlocked||clearingCollectionRef.current)return;
    clearingCollectionRef.current=true;setClearingCollection(true);setClearError('');collectionEpoch.current++;
    clearPreviewRenderQueue();const gen=++generation.current;photoProcessor.current?.postMessage({type:'unload',gen});videoProcessor.current?.postMessage({type:'unload',gen});
    folderRequest.current++;setFolderLoading(false);
    try{
      for(const p of photoRef.current)if(p.nativeCapture)await setIOSCaptureVisible(p.id,false);
      const current=photoRef.current.find(p=>p.id===activeRef.current);if(current?.cameraCapture){const {id,file,recipe,thumbnail,addedAt,cameraCapture,sourceUri}=current;await savePhoto({id,file,recipe,thumbnail,addedAt,cameraCapture,sourceUri});}
      await clearPhotos();
      for(const p of photoRef.current){disposeHdrWorkingCopy(p.id);URL.revokeObjectURL(p.url);}
      disposeHdrWorkingCopies();pendingBitmap.current?.close();pendingBitmap.current=null;
      for(const canvas of [originalCanvas.current,editedCanvas.current])if(canvas){canvas.width=1;canvas.height=1;delete canvas.dataset.generation;delete canvas.dataset.request;}
      pendingPhotoWrites.current.clear();removedPhotoIds.current.clear();setPhotos([]);setActive(null);setFolderBrowser(null);setResolutions(new Map());setReady(false);setRendering(false);setAnalysis(null);setPhotoInfo(null);setPhotoRetry(false);setVideoInfo(null);setPreviewTime(0);setBusy('');setModelStatus('');setHdrConverting(false);setHdrProgress(0);setEyedropper(false);setZoom(1);setCompare(true);setDivider(50);setShowOriginal(false);setExpanded(false);setSaveDialog(false);setShareReady(null);setIosWebSave(null);
      setClearCollectionOpen(false);notify(t("Collection cleared."));requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.top-actions button.secondary')?.focus());
    }catch{
      setPhotoReload(n=>n+1);
      setClearError(capabilities.nativeCamera?t("Could not clear collection completely. Some private camera captures may be hidden; restore them in Settings."):t("Could not clear collection. Your photos and edits are still here."));
    }finally{
      clearingCollectionRef.current=false;setClearingCollection(false);
      if(capabilities.nativeCamera)void syncIOSCaptureRecords(false).catch(()=>setStorageWarning(true));
      const files=deferredFiles.current.splice(0);for(const batch of files)addFiles(batch);
      const shareIds=[...deferredShareIds.current];deferredShareIds.current.clear();
      if(shareIds.length){const epoch=collectionEpoch.current;promoteSharedPhotos(shareIds).then(()=>listPhotos()).then(items=>{if(epoch!==collectionEpoch.current)return;const added=items.filter(p=>shareIds.includes(p.id)&&!photoRef.current.some(existing=>existing.id===p.id)).map(p=>({...p,url:URL.createObjectURL(p.file),past:[],future:[]}));if(added.length)setPhotos(all=>newestPhotos([...all,...added]));}).catch(()=>setStorageWarning(true));}
    }
  }
  const backStateRef=useRef<BackState>({activeWork:false,clearDialog:false,customDialog:false,saveDialog:false,folderBrowser:false,neutralPicker:false,about:false,camera:false,settings:false,adjustmentsOpen:false,expanded:false,narrowControls:false,controlTab:'correction',correctionTab:'engine',lastBackAt:0,now:0});
  backStateRef.current={activeWork:!!(cameraArchiveBusy||busy||exporting||saving||hdrConverting||customLoading||clearingCollection||sampleBusy||rendering||updating||folderLoading),clearDialog:clearCollectionOpen,customDialog:customOpen,saveDialog,folderBrowser:!!folderBrowser,neutralPicker:eyedropper,about,camera:cameraOpen,settings:settingsOpen,adjustmentsOpen,expanded,narrowControls,controlTab,correctionTab,lastBackAt:lastBackAt.current,now:Date.now()};
  useEffect(()=>{lastBackAt.current=0;if(exitPromptTimer.current)clearTimeout(exitPromptTimer.current);exitPromptTimer.current=null;setNotice(current=>current===t('Back again to exit app')?'':current);},[settingsOpen,cameraOpen,about,clearCollectionOpen,customOpen,saveDialog,eyedropper,expanded,adjustmentsOpen,controlTab,correctionTab,folderBrowser,busy,exporting,saving,hdrConverting,customLoading,clearingCollection,sampleBusy,rendering,updating,folderLoading]);
  useEffect(()=>{
    const dispose=listenForAndroidBack(()=>{
      const now=Date.now(),state={...backStateRef.current,lastBackAt:lastBackAt.current,now};
      const action=nextBackAction(state);
      if(action==='confirm-exit'){
        lastBackAt.current=now;notify(t('Back again to exit app'));
        if(exitPromptTimer.current)clearTimeout(exitPromptTimer.current);
        exitPromptTimer.current=setTimeout(()=>{lastBackAt.current=0;exitPromptTimer.current=null;setNotice(current=>current===t('Back again to exit app')?'':current);},2000);
        return;
      }
      if(action==='exit'){
        lastBackAt.current=0;if(exitPromptTimer.current)clearTimeout(exitPromptTimer.current);exitPromptTimer.current=null;
        void exitAndroidApp().catch(()=>notify(t('Could not exit the app.')));return;
      }
      lastBackAt.current=0;if(exitPromptTimer.current)clearTimeout(exitPromptTimer.current);exitPromptTimer.current=null;
      setNotice(current=>current===t('Back again to exit app')?'':current);
      switch(action){
        case 'busy':notify(t('Keep the app open while work is active.'));break;
        case 'camera':cameraRef.current?.requestClose();break;
        case 'settings':setSettingsOpen(false);break;
        case 'about':closeAbout();break;
        case 'clear-dialog':closeClearCollection();break;
        case 'custom-dialog':cancelCustom();break;
        case 'save-dialog':setSaveDialog(false);break;
        case 'folder-browser':folderRequest.current++;setFolderLoading(false);setFolderBrowser(null);break;
        case 'neutral-picker':setEyedropper(false);break;
        case 'adjustments':setAdjustmentsOpen(false);break;
        case 'expanded':expandedGesture.current.points.clear();setExpanded(false);setZoom(1);break;
        case 'correction-tab':setControlTab('correction');break;
        case 'engine-tab':setCorrectionTab('engine');break;
      }
    });
    return ()=>{dispose();if(exitPromptTimer.current)clearTimeout(exitPromptTimer.current);exitPromptTimer.current=null;lastBackAt.current=0;};
  },[]);
  const expandButton=<button className="expand-view-button" disabled={!photo} aria-label={expanded?t("Exit expanded view"):t("Expand photo")} title={expanded?t("Exit expanded view (Esc)"):t("Expand photo")} aria-pressed={expanded} onClick={()=>{expandedGesture.current.points.clear();expandedGesture.current.pinched=false;expandedGesture.current.picker=false;setExpanded(!expanded);setZoom(1);setAdjustmentsOpen(false);}}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>;
  galleryActions.current={select:selectPhoto,remove:id=>{const item=photoRef.current.find(p=>p.id===id);if(item)void removePhoto(item);}};
  return <><div hidden={about||cameraOpen||settingsOpen} className={`app-shell editor-preview ${expanded?'expanded-photo':''} ${adjustmentsOpen?'adjustments-open':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!exporting&&!folderLoading)addFiles(Array.from(e.dataTransfer.files));}}>
    <header className="topbar"><div className="brand-cluster"><a className="brand" href={import.meta.env.BASE_URL} aria-label={t("ClearWater home")}><span className="brand-icon"><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt=""/></span><span>clearwater<span className="brand-dot">.</span></span></a>{capabilities.webServiceWorkerUpdates&&<WebUpdateHint disabled={updating||exporting||saving||customLoading||folderLoading} updating={updating} onUpdate={updateApp}/>}<button className="settings-launch" aria-label={t("Settings")} title={t("Settings")} onClick={()=>setSettingsOpen(true)}><SettingsIcon size={17}/></button></div><a className="edition about-nav" href="#about">{t("About & guide")}</a>
      <div className="top-actions"><span className="private-note"><LockKeyhole size={12}/> {t("Stays on your device")}</span>{capabilities.webStreamCamera?<button className="button secondary camera-launch" title={t("Camera")} aria-label={t("Camera")} disabled={exporting||saving||!!busy||folderLoading||customOpen||customLoading||hdrConverting||clearingCollection} onClick={()=>{cameraSession.current++;cameraLastCapture.current=null;setCameraOpen(true);}}><CameraIcon size={16}/></button>:capabilities.nativeCamera?<button className="button secondary camera-launch" title={t("Camera")} aria-label={t("Camera")} disabled={exporting||saving||!!busy||folderLoading||customOpen||customLoading||hdrConverting||clearingCollection} onClick={()=>void launchIOSCamera()}><CameraIcon size={16}/></button>:<button className="button secondary camera-launch" title={t("Native camera is unavailable in this iOS build.")} aria-label={t("Native camera is unavailable in this iOS build.")} disabled><CameraIcon size={16}/></button>}<button className="button secondary" disabled={exporting||folderLoading} onClick={()=>importInput.current?.click()}><Plus size={16}/> {t("Open files")}</button>{capabilities.platform==='android'&&<button className="button secondary" aria-label={t("Open folder")} title={t("Open folder")} disabled={!!busy||exporting||folderLoading||customOpen} onClick={openPhotoFolder}><FolderOpen size={16}/> {t("Open folder")}</button>}{photo?.nativeCapture&&video&&(!capabilities.videoExport||!canEdit)?<button className="button primary" aria-label={t('Share or save…')} disabled={saving||exporting} onClick={()=>void shareNativeVideo()}><Download size={16}/><span className="export-action-label">{t('Share or save…')}</span></button>:<button className="button primary" aria-label={photo?.cameraCapture?.uri?t("Save to gallery"):capabilities.platform==='ios'||iosWeb?t("Share or save…"):video?t("Export video"):t("Export photo")} disabled={!canEdit||rendering||(video&&!capabilities.videoExport)||(!video&&capabilities.platform==='ios'&&!capabilities.nativeMediaSave)} onClick={()=>exportPhoto(false,false,false,!!photo?.cameraCapture?.uri)}><Download size={16}/><span className="export-action-label">{photo?.cameraCapture?.uri?t("Save to gallery"):capabilities.platform==='ios'||iosWeb?t("Share or save…"):video?t("Export video"):t("Export photo")}</span></button>}{supportsFileShare()&&<button className="button secondary" aria-label={shareReady?t("Share now"):t("Share file")} disabled={!canEdit||rendering||exporting||saving} onClick={()=>shareReady?void shareReadyFile():void exportPhoto(false,false,false,false,true)}><Upload size={16}/><span className="export-action-label">{shareReady?t("Share now"):t("Share file")}</span></button>}</div></header>
    <input ref={importInput} className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,image/dng,image/x-adobe-dng,video/mp4,video/quicktime,.heic,.heif,.dng,.mp4,.mov" aria-label={t("Choose photos")} onChange={e=>{addFiles(Array.from(e.target.files??[]));e.target.value='';}}/>
    <input ref={recipeInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label={t("Choose recipe")} onChange={readRecipe}/>
    <main className="studio">
      <aside className="library"><div className={`section-title collection-heading ${folderBrowser?'folder-collection-heading':''}`}>{folderBrowser?<><button className="folder-collection-back" type="button" disabled={folderLoading||exporting||!!busy} title={t("YOUR PHOTOS")} onClick={()=>setFolderBrowser(null)}><ChevronLeft size={14}/>{t("YOUR PHOTOS")}</button><span className="count">{folderBrowser.photos.length.toString().padStart(2,'0')}</span><span className="folder-collection-name" title={folderBrowser.name}>{folderBrowser.name}</span></>:<><span>{t("YOUR PHOTOS")}</span><span className="count">{photos.length.toString().padStart(2,'0')}</span><button className={`clear-collection-button ${photos.length>=100?'large-collection':''}`} type="button" disabled={clearBlocked||photos.length===0} title={photos.length>=100?t("Large collection"):undefined} aria-describedby={photos.length>=100?'large-collection-hint':undefined} onClick={openClearCollection}>{t("Clear collection")}</button>{photos.length>=100&&<span id="large-collection-hint" className="visually-hidden">{t("Large collection")}</span>}</>}</div>
        <button className="import-tile" disabled={exporting||folderLoading} onClick={()=>importInput.current?.click()}><ImagePlus size={22}/><span>{t("Add to your collection")}</span><small>{t("Photos · DNG · MP4 · MOV")}</small></button>
        <div className="photo-grid">{folderBrowser?folderBrowser.photos.map((entry,index)=>{const loaded=photosById.get(folderBrowser.loaded.get(index)??'');return <div className={`photo-tile folder-photo-tile ${index===folderBrowser.index?'selected':''}`} key={entry.uri}><button className="photo-select" title={entry.name} aria-label={entry.name} disabled={exporting||folderLoading||busy!==''||customOpen||customLoading} onClick={()=>void browseFolderPhoto(folderBrowser,index)}>{loaded?.thumbnail?<img src={loaded.thumbnail} alt="" loading="lazy" decoding="async"/>:<ImagePlus className="gallery-placeholder" size={22} aria-hidden="true"/>}{index===folderBrowser.index&&<span className="selected-check"><Check size={12}/></span>}<span>{entry.name.replace(/\.[^.]+$/,'')}</span></button></div>;}):photos.map(p=><GalleryTile key={p.id} photo={p} selected={p.id===active} selectionDisabled={exporting||folderLoading||busy!==''||customOpen||customLoading} removalDisabled={exporting||customOpen||customLoading} actions={galleryActions}/>)}</div>
        {samples.length>0&&<><div className="section-title sample-heading"><span>{t("YOUR DIVE SAMPLES")}</span><span className="count">09</span></div><div className="sample-list">{samples.map((s,i)=><button key={s.name} disabled={exporting||sampleBusy||busy!==''} onClick={()=>sample(s.name)}><img src={'/__thumb/'+encodeURIComponent(s.name)} alt=""/><span><strong>{s.label}</strong><small>{t("Dive study")} {String(i+1).padStart(2,'0')}</small></span><Plus size={13}/></button>)}</div></>}
      </aside>
      <section className="workspace">
        {folderBrowser&&<div className="folder-browser"><FolderOpen size={12}/><span title={folderBrowser.name}>{folderBrowser.name}</span><button disabled={folderLoading||exporting||!!busy} aria-label={t("Close folder browser")} title={t("Return to imported photos")} onClick={()=>setFolderBrowser(null)}><X size={13}/></button></div>}
        <div className="canvas-toolbar"><div className="photo-navigation"><button aria-label={t("Previous photo")} title={t("Previous photo")} disabled={photoIndex<=0||!!busy||exporting||customOpen||folderLoading} onClick={()=>navigatePhoto(-1)}><ChevronLeft size={16}/></button><span aria-label={t("Photo position")}>{photoIndex<0?'0 / 0':`${photoIndex+1} / ${photoCount}`}</span><button aria-label={t("Next photo")} title={t("Next photo")} disabled={photoIndex<0||photoIndex>=photoCount-1||!!busy||exporting||customOpen||folderLoading} onClick={()=>navigatePhoto(1)}><ChevronRight size={16}/></button></div><div className="filename"><span className="file-dot"/>{photo?.file.name??t("No photo selected")}</div><div className="canvas-tools"><button disabled={!canEdit||!photo?.past.length} aria-label={t("Undo")} title={t("Undo (Ctrl+Z)")} onClick={()=>history('undo')}><Undo2 size={16}/></button><button disabled={!canEdit||!photo?.future.length} aria-label={t("Redo")} title={t("Redo")} onClick={()=>history('redo')}><Redo2 size={16}/></button><span className="tool-separator"/><button className={compare?'active':''} disabled={!ready} onClick={()=>{setCompare(!compare);setEyedropper(false);}} title={t("Before / after comparison")} aria-label={t("Toggle comparison")}><ArrowLeftRight size={16}/></button><button className={eyedropper?'active':''} disabled={!canEdit} onClick={()=>{setEyedropper(!eyedropper);setCompare(false);}} title={t("Pick a white or grey point")} aria-label={t("Pick neutral point")}><Pipette size={16}/></button></div></div>
        <div className="preview-viewport" onContextMenu={event=>event.preventDefault()}>
        <div className={`stage ${eyedropper?'picking':''} ${zoom>1?'pan-enabled':''}`} ref={stage}>
          {!photo&&<div className="empty-state"><h1>{t("Photo & video editor")}</h1><p>{t("Open a photo, MP4 or MOV to start.")}</p><button className="button primary" onClick={()=>importInput.current?.click()}><Upload size={16}/> {t("Choose a photo or video")}</button><small>{t("Or drop photos anywhere in the studio")}</small></div>}
          {photo&&<div className="image-frame" onPointerDown={expandedPointerDown} onPointerMove={expandedPointerMove} onPointerUp={e=>expandedPointerUp(e)} onPointerCancel={e=>expandedPointerUp(e,true)} style={{width:fitWidth*zoom,height:fitWidth/aspect*zoom,visibility:ready?'visible':'hidden'}}>
            <canvas ref={editedCanvas} aria-label={t("Edited photo")}/><canvas ref={originalCanvas} className="original-canvas" aria-label={t("Original photo")} style={{clipPath:showOriginal?'none':compare?`inset(0 ${100-divider}% 0 0)`:'inset(0 100% 0 0)'}}/>
            {compare&&!showOriginal&&<><span className="image-label before">{t("ORIGINAL")}</span><span className="image-label after">{t("RESTORED")}</span><div className="divider-line" style={{left:`${divider}%`}}><span><ArrowLeftRight size={16}/></span></div><input className="comparison-input" aria-label={t("Before and after divider")} type="range" min="0" max="100" value={divider} onChange={e=>setDivider(Number(e.target.value))}/></>}
            {eyedropper&&<span className="picker-hint">{t("Click a white or grey area")}</span>}
          </div>}
          {expanded&&photo&&<div className="expanded-zoom-controls" style={zoomControlPosition} aria-label={t("Zoom, Fit & expand")}><button type="button" aria-label={t("Zoom out")} title={t("Zoom out")} disabled={!ready||zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z-.5))}><ZoomOut size={16}/></button><button type="button" className="zoom-fit" aria-label={t("Fit")} title={t("Fit")} disabled={!ready} onClick={()=>{setZoom(1);if(stage.current)stage.current.scrollTo({left:0,top:0});}}>{zoom===1?t("Fit"):`${Math.round(zoom*100)}%`}</button><button type="button" aria-label={t("Zoom in")} title={t("Zoom in")} disabled={!ready||zoom>=4} onClick={()=>setZoom(z=>Math.min(4,z+.5))}><ZoomIn size={16}/></button>{expandButton}</div>}
          {(busy||folderLoading)&&<div className="processing-overlay" role="status"><LoaderCircle className="spin" size={25}/><span>{folderLoading?t("Opening folder file…"):message(busy)}</span><small>{t("Your file stays on this device.")}</small></div>}
        </div>
          {ready&&photo&&!expanded&&<span className="preview-info">{`${dimensions[0]} × ${dimensions[1]} · ${(dimensions[0]*dimensions[1]/1e6).toFixed(1)} MP`}</span>}
        </div>
        {!video&&photo&&(photoInfo?.large||photoRetry||photoResolution!=='auto')&&<div className="large-photo-note" role="status"><div><strong>{photoRetry?t("Photo processing could not finish"):photoInfo?.large?t("Large photo"):t("Photo resolution")}</strong><span>{photoInfo?t("{0} MP · {1} MB. Export: {2} × {3}. ",[(photoInfo.sourceWidth*photoInfo.sourceHeight/1e6).toFixed(1),(photo.file.size/1024/1024).toFixed(0),photoInfo.exportWidth,photoInfo.exportHeight]):''}{photoRetry?t("Try reduced resolution; your original and edit settings are kept."):t("A small preview keeps editing responsive. Full resolution can use substantial memory.")}</span></div><label>{t("Resolution")}<select aria-label={t("Photo resolution")} value={photoResolution} disabled={exporting||saving} onChange={e=>reopenPhoto(e.target.value as PhotoResolution)}><option value="auto">{t("Auto")}</option><option value="full">{t("Full resolution")}</option><option value="reduced">{t("Reduced · up to 12 MP")}</option></select></label>{photoRetry&&<button className="button secondary" disabled={exporting||saving} onClick={()=>reopenPhoto('reduced')}>{t("Retry reduced")}</button>}</div>}
        {video&&videoInfo&&<div className="video-timeline"><div className="video-timeline-controls"><button type="button" aria-label={t(previewPlaying?"Pause video preview":"Play video preview")} title={t(previewPlaying?"Pause video preview":"Play video preview")} disabled={!ready||exporting||rendering&&!previewPlaying} onClick={()=>previewPlaying?pauseVideoPreview():startVideoPreview()}>{previewPlaying?<Pause size={16}/>:<Play size={16}/>}</button><label><span>{t("Frame preview")} <output>{videoTime(previewTime)} / {videoTime(videoInfo.duration)}</output></span><input aria-label={t("Video position")} type="range" min={0} max={Math.max(0,videoInfo.duration-.001)} step={.04} value={previewTime} disabled={!ready||exporting} onPointerDown={pauseVideoPreview} onKeyDown={pauseVideoPreview} onChange={e=>{pauseVideoPreview();setPreviewTime(Number(e.target.value));}}/></label></div><small>{videoInfo.codec.toUpperCase()} · {videoPlan?.width??videoInfo.outputWidth} × {videoPlan?.height??videoInfo.outputHeight} {t("MP4 export · up to")} {Math.round(exportMode==='source'?(videoInfo.sourceFrameRate??videoInfo.frameRate):videoInfo.frameRate)} fps</small>{videoInfo.hdrToneMapped&&<small className="hdr-note">{t("HDR → SDR working copy. The original file is kept.")}</small>}</div>}
        <div className="workspace-bottom" onContextMenu={event=>event.preventDefault()}><div><button disabled={!ready} onPointerDown={()=>setShowOriginal(true)} onPointerUp={()=>setShowOriginal(false)} onPointerCancel={()=>setShowOriginal(false)} onBlur={()=>setShowOriginal(false)} onPointerLeave={()=>setShowOriginal(false)} onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();setShowOriginal(true);}}} onKeyUp={()=>setShowOriginal(false)}>{t("Hold for original")}</button>{!expanded&&<><span className="tool-separator"/><button disabled={!ready||zoom<=1} aria-label={t("Zoom out")} onClick={()=>setZoom(z=>Math.max(1,z-.5))}><ZoomOut size={15}/></button><button disabled={!ready} aria-label={t("Fit")} onClick={()=>{setZoom(1);if(stage.current)stage.current.scrollTo({left:0,top:0});}}>{zoom===1?t("Fit"):`${Math.round(zoom*100)}%`}</button><button disabled={!ready||zoom>=4} aria-label={t("Zoom in")} onClick={()=>setZoom(z=>Math.min(4,z+.5))}><ZoomIn size={15}/></button>{expandButton}</>}</div></div>
      </section>
      <aside ref={controlsPanel} className="controls compact-controls"><div className="controls-top"><SlidersHorizontal size={16}/><span className="adjustments-label">{t("Adjustments")}</span><button className="adjustments-toggle" aria-label={t("Toggle adjustments")} aria-expanded={adjustmentsOpen} aria-controls="adjustment-settings" onClick={()=>setAdjustmentsOpen(!adjustmentsOpen)}><SlidersHorizontal size={15}/> {t("Adjustments")} <ChevronDown size={14}/></button><button disabled={!canEdit} onClick={reset} title={t("Reset all edits")} aria-label={t("Reset all edits")}><RotateCcw size={15}/></button></div>
        <nav className="control-tabs main-control-tabs" role="tablist" aria-label={t("Adjustments")}>
          {(['correction','enhancement','export'] as const).map(tab=><button key={tab} id={`control-tab-${tab}`} type="button" role="tab" data-control-tab={tab} data-tab-value={tab} aria-selected={controlTab===tab} aria-controls={`control-panel-${tab}`} tabIndex={controlTab===tab?0:-1} onClick={()=>selectControlTab(setControlTab,tab)} onKeyDown={e=>tabKeyDown(e,['correction','enhancement','export'],value=>selectControlTab(setControlTab,value))}>{t(({correction:'Correction',enhancement:'Enhancement',export:'Export'} as const)[tab])}</button>)}
        </nav>
        <nav className={`control-tabs correction-subtabs ${controlTab==='correction'?'is-visible':''}`} role="tablist" aria-label={t("Correction")}>
          {(['engine','dive'] as const).map(tab=><button key={tab} id={`control-subtab-${tab}`} type="button" role="tab" data-control-subtab={tab} data-tab-value={tab} aria-selected={correctionTab===tab} aria-controls={`control-subpanel-${tab}`} tabIndex={correctionTab===tab?0:-1} onClick={()=>selectControlTab(setCorrectionTab,tab)} onKeyDown={e=>tabKeyDown(e,['engine','dive'],value=>selectControlTab(setCorrectionTab,value))}>{t(tab==='engine'?'Engine':'Dive conditions')}</button>)}
        </nav>
        <nav className={`control-tabs enhancement-subtabs ${controlTab==='enhancement'?'is-visible':''}`} role="tablist" aria-label={t("Enhancement")}>
          {(['colour','light','clarity','effects'] as const).filter(tab=>!(video&&tab==='effects')).map(tab=><button key={tab} id={`control-subtab-${tab}`} type="button" role="tab" data-control-subtab={tab} data-tab-value={tab} aria-selected={visibleEnhancementTab===tab} aria-controls={`control-subpanel-${tab}`} tabIndex={visibleEnhancementTab===tab?0:-1} disabled={video&&tab==='effects'} onClick={()=>selectControlTab(setEnhancementTab,tab)} onKeyDown={e=>tabKeyDown(e,(video?['colour','light','clarity']:['colour','light','clarity','effects']),value=>selectControlTab(setEnhancementTab,value))}>{t(({colour:'Colour',light:'Light',clarity:'Clarity',effects:'Effects'} as const)[tab])}</button>)}
        </nav>
        <fieldset ref={controlBody} id="adjustment-settings" className="control-body" disabled={!canEdit}>
          <section id="control-panel-correction" role="tabpanel" aria-labelledby="control-tab-correction" className={`mobile-panel correction-panel ${controlTab==='correction'?'is-active':''}`}>
          <div id="control-subpanel-engine" role="tabpanel" aria-labelledby="control-subtab-engine" className={`mobile-subpanel engine-subpanel ${correctionTab==='engine'?'is-active':''}`}>
          <details className="settings-group" open={narrowControls||undefined}><summary>{t("Correction Engine")} <ChevronDown size={14}/></summary><div className="group-content engine-details"><select aria-label={t("Correction engine")} value={recipe?.engine??'balanced'} onChange={e=>{const engine=e.target.value as Recipe['engine'];if(engine==='wave'&&!customModel){setCustomCandidate(null);setCustomError('');setCustomOpen(true);return;}if(analysis)update(r=>({...r,engine,...(isAIEngine(engine)?{}:{balancedAfterAI:undefined}),...(engine==='wave'&&customModel?{customModel}:{}),auto:suggest(analysis,r.hints,engine)}));}}><option value="balanced">{t("Balanced restoration")}</option><option value="baseline">{t("Original RGB heuristic")}</option><option value="wwe">{t("WWE-UIE · AI")}</option><option value="fivea">{t("Five A+ · AI")}</option><option value="shallow">{t("Shallow-UWnet · AI")}</option><option value="wave">{customModel?customModel.name:t("Load other ONNX model…")}</option></select>{recipe?.cameraColour&&<div className="balanced-followup"><small>{t("Saved camera AI colour. No new inference is needed.")}</small><button className="text-button" onClick={()=>analysis&&update(r=>{const next={...r,auto:suggest(analysis,r.hints,r.engine)};delete next.cameraColour;return next;})}>{t("Use Balanced only")}</button></div>}{recipe&&isAIEngine(recipe.engine)&&<div className="balanced-followup"><label className="metadata-option"><input type="checkbox" aria-label={t("Balanced after AI")} checked={!!recipe.balancedAfterAI} disabled={video} onChange={e=>update(r=>({...r,...(e.target.checked?{balancedAfterAI:{strength:.3}}:{balancedAfterAI:undefined})}))}/>{t("Balanced after AI")}</label>{video?<small>{t("Available for photos only.")}</small>:<><small>{t("Balanced restoration follows the AI colour result at a modest blend.")}</small>{recipe.balancedAfterAI&&<Range label={t("Balanced after AI strength")} value={Math.round(recipe.balancedAfterAI.strength*100)} min={0} max={100} unit="%" onStart={checkpoint} onChange={v=>update(r=>r.balancedAfterAI?({...r,balancedAfterAI:{strength:v/100}}):r,false)}/>}</>}</div>}{video&&recipe&&isAIEngine(recipe.engine)&&<div className="video-ai-options"><label>{t("Video correction")}<select aria-label={t("Video correction")} value={recipe.videoCorrection?.mode??'sampled'} onChange={e=>update(r=>({...r,videoCorrection:{mode:e.target.value as 'sampled'|'fixed',interval:r.videoCorrection?.interval??5,referenceTime:previewTime}}))}><option value="sampled">{t("Sampled AI colour")}</option><option value="fixed">{t("Fixed selected frame")}</option></select></label>{(recipe.videoCorrection?.mode??'sampled')==='sampled'?<label>{t("Sample every")}<select aria-label={t("AI sample interval")} value={recipe.videoCorrection?.interval??5} onChange={e=>update(r=>({...r,videoCorrection:{mode:'sampled',interval:Number(e.target.value) as 2|5|10,referenceTime:r.videoCorrection?.referenceTime??0}}))}><option value="2">{t("2 seconds · more analysis")}</option><option value="5">{t("5 seconds")}</option><option value="10">{t("10 seconds · less analysis")}</option></select></label>:<button className="text-button" onClick={()=>update(r=>({...r,videoCorrection:{mode:'fixed',interval:r.videoCorrection?.interval??5,referenceTime:previewTime}}))}>{t("Use current frame ({0})",[videoTime(previewTime)])}</button>}<small>{(recipe.videoCorrection?.mode??'sampled')==='fixed'?t("One AI colour correction from {0} for the entire clip.",[videoTime(recipe.videoCorrection?.referenceTime??0)]):t("Colour blends between samples; checks at sample points help avoid blending different scenes. Export analyses the remaining samples first.")} {t("This approximates AI colour, not local dehazing or denoising.")}</small></div>}{(customModel||rememberedModel)&&<div className="model-actions">{customModel&&<button className="text-button" disabled={customLoading} onClick={()=>{setCustomCandidate(null);setCustomError('');setCustomOpen(true);}}>{t("Load another ONNX model")}</button>}{rememberedModel&&<button className="text-button" disabled={customLoading} onClick={()=>void forgetSavedModel()}>{t("Forget saved model")}</button>}</div>}{modelStatus&&<p role="status"><LoaderCircle className="spin" size={12}/> {message(modelStatus)}</p>}<p>{video?t("AI estimates global colour from sampled frames. Balanced and RGB use one edit across the clip."):recipe?.balancedAfterAI&&isAIEngine(recipe.engine)?t("AI colour correction runs locally. Strength and manual edits still apply; Balanced after AI also uses dive hints."):t("AI colour correction runs locally. Strength and manual edits still apply; dive hints affect Balanced restoration.")}</p></div></details>
          <details className="settings-group" open><summary>{t("Restoration")} <ChevronDown size={14}/></summary><div className="group-content">
            <div className="restoration-row"><Range label={t("Restoration strength")} value={Math.round((recipe?.strength??.8)*100)} min={0} max={100} unit="%" onStart={checkpoint} onChange={v=>update(r=>({...r,strength:v/100}),false)}/><button className="button primary auto-button" onClick={()=>{if(analysis)update(r=>({...r,auto:suggest(analysis,r.hints,r.engine),strength:.8,manual:clone(DEFAULT_MANUAL),enhancement:undefined,...(video?{videoCorrection:{...(r.videoCorrection??{mode:'sampled' as const,interval:5 as const}),referenceTime:previewTime}}:{})}));}}><Sparkles size={12}/> {t("Auto restore")}</button></div>
            {recipe&&<div className="analysis-note"><span>{t("Analysis")}</span><p className="suggestion">{message(recipe.auto.explanation)}</p></div>}
          </div></details>
          </div>
          <div id="control-subpanel-dive" role="tabpanel" aria-labelledby="control-subtab-dive" className={`mobile-subpanel dive-subpanel ${correctionTab==='dive'?'is-active':''}`}>
          <details className="settings-group" open={narrowControls||undefined}><summary>{t("Dive conditions")} <ChevronDown size={14}/></summary><div className="group-content dive-options">
            <RadioGroup label={t("Environment")} name="environment" value={recipe?.hints.scene??'auto'} options={[['auto',t("Auto")],['underwater',t("Diving")],['surface',t("Surface")]]} onChange={scene=>hints({scene})}/>
            <RadioGroup label={t("Red filter")} name="red-filter" value={recipe?.hints.filter??'auto'} options={[['auto',t("Auto")],['yes',t("Yes")],['no',t("No")]]} onChange={filter=>hints({filter})}/>
            <RadioGroup label={t("Water colour")} name="water-colour" value={recipe?.hints.water??'auto'} options={[['auto',t("Auto")],['blue',t("Blue")],['green',t("Green")]]} onChange={water=>hints({water})}/>
            <div className="depth-control"><Range label={t("Approx. depth")} value={recipe?.hints.depth??0} min={0} max={100} unit=" m" displayValue={recipe?.hints.depth==null?'—':`${recipe.hints.depth} m`} ariaValueText={recipe?.hints.depth==null?t("Unsure of depth"):`${recipe.hints.depth} m`} hint={recipe?.hints.depth==null?t("Unsure of depth"):undefined} onStart={checkpoint} onChange={depth=>hints({depth},false)}/><label className="depth-unsure"><input type="checkbox" checked={recipe?.hints.depth==null} onChange={e=>hints({depth:e.target.checked?null:0})}/>{t("Unsure of depth")}</label></div>
          </div>{recipe&&recipe.engine!=='balanced'&&!(recipe.balancedAfterAI&&!video&&isAIEngine(recipe.engine))&&<p className="balanced-only-note">{t("Only works for Balanced restoration.")}</p>}</details>
          </div>
          </section>
          <section id="control-panel-enhancement" role="tabpanel" aria-labelledby="control-tab-enhancement" className={`mobile-panel enhancement-panel ${controlTab==='enhancement'?'is-active':''}`} data-enhancement-tab={visibleEnhancementTab}>
          <div id="control-subpanel-colour" role="tabpanel" aria-labelledby="control-subtab-colour" className={`mobile-subpanel enhancement-subpanel colour-subpanel ${visibleEnhancementTab==='colour'?'is-active':''}`}>
          <details className="settings-group" open><summary>{t("Colour")} <ChevronDown size={14}/></summary><div className="group-content">
            <div className="fader-grid">{(['warmth','tint','red','vibrance'] as const).map(k=><Range vertical key={k} label={{warmth:t("Warmth"),tint:t("Green / magenta"),red:t("Red correction"),vibrance:t("Vibrance")}[k]} value={recipe?.manual[k]??0} onStart={checkpoint} onChange={v=>manual(k,v)}/>)}</div>
            <button className={`neutral-button ${eyedropper?'active':''}`} onClick={()=>{setEyedropper(!eyedropper);setCompare(false);}}><Pipette size={13}/>{eyedropper?t("Cancel picker"):t("Pick neutral point")}</button>
          </div></details>
          </div>
          <details className="settings-group light-clarity-group" open><summary>{t("Light & clarity")} <ChevronDown size={14}/></summary><div className="group-content">
            <div id="control-subpanel-light" role="tabpanel" aria-labelledby="control-subtab-light" className={`mobile-subpanel enhancement-subpanel light-subpanel ${visibleEnhancementTab==='light'?'is-active':''}`}><div className="fader-grid light-clarity-grid">
              <Range vertical label={t("Exposure")} value={recipe?.manual.exposure??0} min={-2} max={2} step={.05} unit=" EV" onStart={checkpoint} onChange={v=>manual('exposure',v)}/>
              {(['highlights','shadows'] as const).map(k=><Range vertical key={k} label={{highlights:t("Highlights"),shadows:t("Shadows")}[k]} value={recipe?.manual[k]??0} onStart={checkpoint} onChange={v=>manual(k,v)}/>)}</div>
            </div>
            <div id="control-subpanel-clarity" role="tabpanel" aria-labelledby="control-subtab-clarity" className={`mobile-subpanel enhancement-subpanel clarity-subpanel ${visibleEnhancementTab==='clarity'?'is-active':''}`}><div className="fader-grid light-clarity-grid">
              {(['contrast','haze'] as const).map(k=><Range vertical key={k} label={{contrast:t("Contrast"),haze:t("Haze reduction")}[k]} value={recipe?.manual[k]??0} onStart={checkpoint} onChange={v=>manual(k,v)}/>)}</div>
            </div>
          </div></details>
          <div id="control-subpanel-effects" role="tabpanel" aria-labelledby="control-subtab-effects" className={`mobile-subpanel enhancement-subpanel effects-subpanel ${visibleEnhancementTab==='effects'?'is-active':''}`}>
          {!video&&<details className="settings-group photo-enhancement enhancement-group" open><summary>{t('Effects')} <ChevronDown size={14}/></summary><div className="group-content"><div className="enhancement-actions"><button className={`button auto-enhance-button${autoEnhancementApplied?' is-applied':''}`} disabled={rendering} aria-pressed={autoEnhancementApplied} onClick={autoEnhance}>{autoEnhancementApplied?<Check size={14}/>:<Sparkles size={14}/>} {t('Auto enhance')}</button><button className="text-button" onClick={()=>update(r=>({...r,enhancement:undefined}))}>{t('Clear enhancement')}</button></div><div className="fader-grid">{(['brightness','contrast','clarity','sharpness'] as const).map(key=><Range vertical key={key} label={t({brightness:'Brightness',contrast:'Auto contrast',clarity:'Local contrast',sharpness:'Sharpness'}[key])} value={recipe?.enhancement?.[key]??0} min={key==='brightness'?-100:0} max={100} onStart={checkpoint} onChange={value=>enhance(key,value)}/>)}</div></div></details>}
          </div>
          <div className="manual-actions"><button className="text-button" onClick={()=>update(r=>({...r,manual:clone(DEFAULT_MANUAL),enhancement:undefined}))}><RotateCcw size={12}/> {t("Reset manual edits")}</button></div>
          </section>
          <section id="control-panel-export" role="tabpanel" aria-labelledby="control-tab-export" className={`mobile-panel export-panel ${controlTab==='export'?'is-active':''}`}>

          <details className="settings-group" open><summary>{t("Export")} <span className="summary-meta">{video?(exportMode==='source'?t("MP4 · Source size"):t("MP4 · up to 1080p")):photoInfo&&(photoInfo.exportWidth!==photoInfo.sourceWidth||photoInfo.exportHeight!==photoInfo.sourceHeight)?t("Reduced resolution"):t("Full resolution")}</span><ChevronDown size={14}/></summary><div className="group-content export-section"><div className="export-options">{video?<div className="video-export-options"><span>MP4 · H.264 · SDR</span><label className="video-quality-choice">{t("Video quality")}<select aria-label={t("Video quality")} value={exportMode} disabled={exporting} onChange={e=>setExportMode(e.target.value as VideoExportMode)}><option value="compatible">{t("Compact · 1080p / 30 fps")}</option><option value="source">{t("Source · Resolution & frame rate")}</option></select></label>{videoPlan&&<small>{t("{0} × {1} · {2} Mbps · about {3} MB",[videoPlan.width,videoPlan.height,(videoPlan.bitrate/1e6).toFixed(1),Math.ceil(videoPlan.estimatedBytes/1e6)])}</small>}{exportMode==='source'&&<small>{t("Source export uses more memory and can take longer.")}</small>}{videoPlan&&!videoPlan.supported&&<small role="alert">{message(videoPlan.reason??'')}</small>}<label><input type="checkbox" aria-label={t("Keep audio")} checked={keepAudio} disabled={!videoInfo?.hasAudio} onChange={e=>setKeepAudio(e.target.checked)}/> {t("Keep audio")}{videoInfo&&!videoInfo.hasAudio?t(" (no audio track)"):''}</label><small>{t("Source keeps frame timing and requests a higher bitrate; device encoding support is required. Compact reduces size. Both export 8-bit SDR.")}</small>{videoInfo&&(videoInfo.duration>=120||(photo?.file.size??0)>=100*1024*1024)&&<small className="video-cost-note">{t("Large/long clip: processing can take several minutes.")} {recipe&&isAIEngine(recipe.engine)&&(recipe.videoCorrection?.mode??'sampled')==='sampled'?t("About {0} AI samples. A 10-second interval or Fixed selected frame reduces analysis.",[Math.ceil(videoInfo.duration/(recipe.videoCorrection?.interval??5))+1]):t("Keep the app open during export.")}</small>}<a href={import.meta.env.BASE_URL+'licenses/README.txt'} target="_blank" rel="noreferrer">{t("Video toolkit licence")}</a></div>:<label>{t("File format")}<select aria-label={t("File format")} value={format==='png'?'png':jpegQuality===.99?'jpg-max':'jpg'} onChange={e=>{setFormat(e.target.value==='png'?'png':'jpg');setJpegQuality(e.target.value==='jpg-max'?.99:.95);}}><option value="jpg">{t("JPEG · High quality")}</option><option value="jpg-max">{t("JPEG · Maximum quality")}</option><option value="png">{t("PNG · Lossless")}</option></select></label>}<button className="icon-button" title={t("Save edit recipe")} aria-label={t("Save recipe")} disabled={!canSaveRecipe} onClick={()=>void saveRecipeFile()}><FileJson size={17}/></button><button className="icon-button" title={t("Load edit recipe")} aria-label={t("Load recipe")} onClick={()=>recipeInput.current?.click()}><Upload size={16}/></button></div>{video&&<label className="metadata-option"><input type="checkbox" checked={keepMetadata} onChange={e=>setKeepMetadata(e.target.checked)}/> {t("Keep video metadata")}</label>}{!video&&<label className="metadata-option" title={t("Includes location when present in the imported file")}><input type="checkbox" checked={keepMetadata} onChange={e=>setKeepMetadata(e.target.checked)}/> {t("Keep EXIF/GPS metadata")}</label>}<div className="save-destination"><span title={outputFolder?.name}>{outputFolder?t("Output: {0}",[outputFolder.name]):supportsFolder()?t("Choose output folder"):capabilities.platform==='ios'||iosWeb?t("Output: Share or save"):t("Output: Downloads")}</span>{supportsFolder()&&<><button className="text-button" onClick={selectOutputFolder}><FolderOpen size={12}/>{outputFolder?t("Change output folder"):t("Choose output folder")}</button>{outputFolder&&<button className="text-button" onClick={()=>setOutputFolder(null)}>{t("Use default destination")}</button>}</>}<button className="button secondary save-as" disabled={!canExport} onClick={()=>exportPhoto(true)}><Download size={13}/>{supportsFolder()?t("Save as…"):capabilities.platform==='ios'||iosWeb?t("Share or save…"):video?t("Download restored video"):t("Download restored photo")}</button>{supportsFolder()&&!isAndroid()&&!outputFolder&&<button className="text-button" disabled={!canExport} onClick={()=>exportPhoto(false,false,true)}>{t("Download instead")}</button>}<>{(photo?.cameraCapture||photo?.nativeCapture)&&<button className="button secondary" disabled={saving||exporting} onClick={exportCameraOriginal}>{t(photo?.nativeCapture?.descriptor.kind==="video"||photo?.cameraCapture?.enhancedVideo?"Export captured video":"Export original")}</button>}{photo?.nativeCapture?.descriptor.kind==="photo"&&!photo.nativeCapture.descriptor.photosSaved&&<button className="button secondary" disabled={saving||exporting} onClick={()=>void saveNativeEnhancedPhoto()}>{t("Save captured copy to Photos")}</button>}</><small>{photo?restoredName(photo.file.name,exportFormat,!outputFolder):'original-filename-restore.jpg'}</small>{!supportsFolder()&&<small>{capabilities.platform==='ios'||iosWeb?t("Choose a destination from the iOS share sheet."):t("Your browser chooses the download location and handles existing filenames.")}</small>}</div></div></details>
          <details className="settings-group preset-group"><summary>{t("Save edit presets")} <ChevronDown size={14}/></summary><div className="group-content preset-actions"><button className="button secondary" disabled={!canSaveRecipe} onClick={()=>void saveRecipeFile()}><FileJson size={15}/>{t("Save preset")}</button><button className="button secondary" disabled={!photo} onClick={()=>recipeInput.current?.click()}><Upload size={15}/>{t("Load preset")}</button></div></details>
          </section>
        </fieldset>
        <a className="about-footer" href="#about">{t("About & guide")}</a>
      </aside>
    </main>
    {pendingCaptureRemoval&&<CaptureRemovalDialog filename={pendingCaptureRemoval.file.name} busy={saving} error={captureRemovalError} onCancel={()=>{if(!saving)setPendingCaptureRemoval(null);}} onHide={()=>void finishCaptureRemoval(false)} onDelete={()=>void finishCaptureRemoval(true)}/>}
    {clearCollectionOpen&&<div className="modal-shade"><div ref={clearDialogRef} className="export-dialog clear-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-collection-title" aria-describedby="clear-collection-description" onKeyDown={e=>{if(e.key!=='Tab')return;const items=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]'));if(!items.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}><h2 id="clear-collection-title">{t("Clear collection?")}</h2><p id="clear-collection-description">{capabilities.nativeCamera?t("On iOS, clearing hides camera captures and removes imported app copies and edits. Private camera originals stay in the app; exported files and Photos copies stay untouched. Restore hidden captures in Settings."):t("Removes thumbnails, app copies and saved edits. Original and exported files stay untouched.")}</p>{clearError&&<p className="clear-error" role="alert">{message(clearError)}</p>}<div className="clear-actions"><button ref={clearCancelRef} className="button secondary" disabled={clearingCollection} onClick={closeClearCollection}>{t("Cancel")}</button><button className="button primary" disabled={clearBlocked||clearingCollection} onClick={()=>void clearCollection()}>{clearingCollection?t("Clearing…"):t("Clear collection")}</button></div></div></div>}
    {saveDialog&&<div className="modal-shade"><div className="export-dialog save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-title"><h2 id="save-title">{t("Save as")}</h2><label>{t("Filename")}<input aria-label={t("Export filename")} value={saveName} onChange={e=>setSaveName(e.target.value)}/></label><p>{outputFolder?t("Folder: {0}",[outputFolder.name]):t("Choose a folder to save your restored file.")} {t("Existing names get a number.")}</p><button className="button primary" disabled={!saveName.trim()||exporting} onClick={()=>exportPhoto(true)}>{outputFolder?t("Save copy"):t("Choose folder and save")}</button>{outputFolder&&<button className="button secondary" disabled={exporting} onClick={()=>exportPhoto(true,true)}>{t("Choose another folder…")}</button>}<button className="button secondary" disabled={exporting} onClick={()=>setSaveDialog(false)}>{t("Cancel")}</button></div></div>}
    {iosWebSave&&<div className="modal-shade"><div className="export-dialog save-dialog" role="dialog" aria-modal="true" aria-labelledby="ios-save-title"><h2 id="ios-save-title">{t("Share or save…")}</h2><p>{iosWebSave.name}</p><p>{t("Choose a destination from the iOS share sheet.")}</p><button className="button primary" type="button" disabled={saving||exporting} onClick={()=>void confirmIOSWebSave()}>{t("Share now")}</button><button className="button secondary" type="button" disabled={saving||exporting} onClick={()=>setIosWebSave(null)}>{t("Cancel")}</button></div></div>}
    {customOpen&&<div className="modal-shade"><div className="export-dialog research-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-title"><h2 id="custom-title">{t("Load other ONNX model")}</h2><p>{t("Choose a self-contained RGB image-to-image model (up to 64 MB). This adapter supports one float32 NCHW input and output at 256 × 256. Other layouts, sizes, extra inputs and super-resolution models need a different adapter.")}</p><p>{t("Use the model’s documented colour ranges below. After validation, the model and ranges are kept on this device for later launches.")}</p>{recipe?.customModel&&<p>{t("Recipe model:")} {recipe.customModel.name}</p>}<label>{t("ONNX file")}<input aria-label={t("ONNX model file")} type="file" accept=".onnx" disabled={customLoading} onChange={e=>{const file=e.target.files?.[0]??null;if(file)modelSelectionStarted.current=true;setCustomCandidate(file);setCustomError('');}}/></label><div className="context-grid"><label>{t("Input range")}<select aria-label={t("Model input range")} value={inputRange} disabled={customLoading} onChange={e=>setInputRange(e.target.value as 'unit'|'signed')}><option value="unit">{t("0 to 1")}</option><option value="signed">{t("−1 to 1")}</option></select></label><label>{t("Output range")}<select aria-label={t("Model output range")} value={outputRange} disabled={customLoading} onChange={e=>setOutputRange(e.target.value as 'unit'|'signed')}><option value="unit">{t("0 to 1")}</option><option value="signed">{t("−1 to 1")}</option></select></label></div><label className="research-consent"><input type="checkbox" checked={customAccepted} disabled={customLoading} onChange={e=>setCustomAccepted(e.target.checked)}/> {t("I have permission to use this model and will follow its licence.")}</label>{customError&&<p className="model-error" role="alert">{message(customError)}</p>}<button className="button primary" disabled={!customAccepted||!customCandidate||customLoading} onClick={()=>{if(!customCandidate)return;setCustomError('');setCustomLoading(true);pendingModelBlob.current=customCandidate;pendingModelRestore.current=false;applyCustomModel.current=true;pendingCustomCommand.current={type:'custom-model',permission:true,blob:customCandidate,name:customCandidate.name,inputRange,outputRange};if(worker.current)worker.current.postMessage({...pendingCustomCommand.current,gen:generation.current});}}>{customLoading?t("Validating model…"):t("Load model")}</button><button className="button secondary" disabled={customLoading} onClick={cancelCustom}>{t("Cancel")}</button></div></div>}
    {storageWarning&&<div className="storage-warning" role="status">{t("Local storage is unavailable or full. Export your edits before closing.")}<button aria-label={t("Dismiss storage warning")} onClick={()=>setStorageWarning(false)}><X size={14}/></button></div>}
    {notice&&<div className="toast" role="status"><span>{message(notice)}</span><button aria-label={t("Dismiss message")} onClick={()=>setNotice('')}><X size={15}/></button></div>}
    {hdrConverting&&<div className="modal-shade"><div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="hdr-conversion-title"><span className="brand-icon"><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt=""/></span><h2 id="hdr-conversion-title">{t("Converting HDR video to SDR")}</h2><p>{t("Preparing HDR video…")}</p><progress max="100" value={hdrProgress}/><span>{hdrProgress}%</span><button className="button secondary" onClick={()=>void cancelHdrWorkingCopy()}>{t("Cancel conversion")}</button></div></div>}
    {exporting&&<div className="modal-shade"><div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title"><span className="brand-icon"><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt=""/></span><h2 id="export-title">{t("Exporting")} {video?t("video"):t("photo")}</h2><p>{saving?(exportTarget.current?.share?t("Preparing file to share…"):t("Saving your restored file…")):video?t("Processing video frames locally. Keep this app open."):t("Rendering your photo at the selected resolution.")}</p><progress max="100" value={progress}/><span>{progress}%</span><button className="button secondary" disabled={saving} onClick={cancelExport}>{t("Cancel export")}</button></div></div>}
  </div>{about&&!settingsOpen&&<About onClose={closeAbout} customModel={customModel} onOpenSettings={()=>setSettingsOpen(true)}/>}
  {settingsOpen&&<Settings parentAbout={about} onClose={closeSettings} onRestoreCamera={restoreCameraCollection} onRestoreIOSCaptures={restoreIOSPrivateCaptures} onDeleteIOSCaptures={deleteIOSPrivateCaptures} restoringCamera={cameraArchiveBusy}/>}{cameraOpen&&<Camera ref={cameraRef} onClose={()=>{if(cameraLastCapture.current)setActive(cameraLastCapture.current);setCameraOpen(false);}} onCapture={saveCameraCapture}/>}</>;
}


