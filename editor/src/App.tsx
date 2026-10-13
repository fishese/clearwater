import {t,message,useLanguage,LanguageSelect} from './i18n';
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Plus, Download, SlidersHorizontal, Sparkles, ArrowLeftRight, Undo2, Redo2, RotateCcw, Upload, ImagePlus, Check, ChevronDown, ChevronLeft, ChevronRight, FolderOpen, LockKeyhole, X, Pipette, LoaderCircle, FileJson, ZoomIn, ZoomOut, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { clamp, makeRecipe, parseRecipe, suggest } from './core/engine';
import { DEFAULT_MANUAL,DEFAULT_ENHANCEMENT, type Analysis, type Adjustments, type Hints, type Recipe, type CustomModel } from './core/types';
import { deletePhoto, listPhotos, savePhoto, type StoredPhoto } from './storage';
import {forgetCustomModel,loadRememberedCustomModel,rememberCustomModel} from './custom-model-storage';
import {supportsFolder,chooseFolder,restoredName,createUniqueFile,writeFile,type LocalDirectoryHandle} from './file-save';
import {isAndroid,receiveAndroidPhotos,openAndroidPhotoFolder,readAndroidFolderPhoto,type AndroidPhotoFolder} from './native';
import {activateWebUpdate} from './update';
import About from './About';
import {isVideo,isRaw,supportedMedia,mediaLimit,videoTime,type VideoInfo} from './core/media';

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
function download(blob:Blob,name:string){if(isAndroid()){void chooseFolder().then(async folder=>{const file=await createUniqueFile(folder,name);await writeFile(file.handle,blob);}).catch(error=>{if(error?.code!=='CANCELLED')window.alert(t("Could not save this file. Please choose a writable folder."));});return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}

const closeAbout=()=>{window.location.hash='';};
export default function App() {
  useLanguage();
  const [about,setAbout]=useState(()=>window.location.hash.startsWith('#about'));
  useEffect(()=>{const change=()=>setAbout(window.location.hash.startsWith('#about'));window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  const [updating,setUpdating]=useState(false);
  const [keepMetadata,setKeepMetadata]=useState(true);
  const [photoInfo,setPhotoInfo]=useState<PhotoInfo|null>(null),[photoRetry,setPhotoRetry]=useState(false),[photoReload,setPhotoReload]=useState(0);
  const [resolutions,setResolutions]=useState<Map<string,PhotoResolution>>(()=>new Map());
  const [expanded,setExpanded]=useState(false),[adjustmentsOpen,setAdjustmentsOpen]=useState(false);
  const [controlTab,setControlTab]=useState<'correction'|'enhancement'|'export'>('correction');
  const [correctionTab,setCorrectionTab]=useState<'engine'|'dive'>('engine');
  const [enhancementTab,setEnhancementTab]=useState<'colour'|'light'|'clarity'|'effects'>('colour');
  const [narrowControls,setNarrowControls]=useState(()=>window.matchMedia('(max-width: 650px)').matches);
  useEffect(()=>{const media=window.matchMedia('(max-width: 650px)'),change=()=>setNarrowControls(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{if(!expanded)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setExpanded(false);};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[expanded]);
  const [photos,setPhotos]=useState<Photo[]>([]),[active,setActive]=useState<string|null>(null);
  const [folderBrowser,setFolderBrowser]=useState<FolderBrowser|null>(null),[folderLoading,setFolderLoading]=useState(false);
  const folderRequest=useRef(0);
  const [samples,setSamples]=useState<Sample[]>([]),[analysis,setAnalysis]=useState<Analysis|null>(null);
  const [dimensions,setDimensions]=useState<[number,number]>([1,1]);
  const [videoInfo,setVideoInfo]=useState<VideoInfo|null>(null),[previewTime,setPreviewTime]=useState(0),[keepAudio,setKeepAudio]=useState(true);
  const [modelStatus,setModelStatus]=useState('');
  const [customOpen,setCustomOpen]=useState(false),[customModel,setCustomModel]=useState<CustomModel|null>(null),[rememberedModel,setRememberedModel]=useState<CustomModel|null>(null),[customAccepted,setCustomAccepted]=useState(false),[customLoading,setCustomLoading]=useState(false),[customFile,setCustomFile]=useState<Blob|null>(null),[customCandidate,setCustomCandidate]=useState<File|null>(null);
  const [inputRange,setInputRange]=useState<'unit'|'signed'>('unit'),[outputRange,setOutputRange]=useState<'unit'|'signed'>('unit'),[customError,setCustomError]=useState('');
  const [busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[storageWarning,setStorageWarning]=useState(false);
  const [compare,setCompare]=useState(true),[divider,setDivider]=useState(50),[showOriginal,setShowOriginal]=useState(false);
  const [exporting,setExporting]=useState(false),[progress,setProgress]=useState(0),[format,setFormat]=useState<'jpg'|'png'>('jpg');
  const [outputFolder,setOutputFolder]=useState<LocalDirectoryHandle|null>(null),[saving,setSaving]=useState(false);
  const [sourceFolders,setSourceFolders]=useState<Map<string,LocalDirectoryHandle>>(()=>new Map());
  const [saveDialog,setSaveDialog]=useState(false),[saveName,setSaveName]=useState('');
  const exportTarget=useRef<{name:string;folder?:LocalDirectoryHandle}|null>(null),librarySwitchLock=useRef(false);
  const [eyedropper,setEyedropper]=useState(false),[zoom,setZoom]=useState(1);
  const [stageSize,setStageSize]=useState({width:0,height:0}),[ready,setReady]=useState(false),[sampleBusy,setSampleBusy]=useState(false),[rendering,setRendering]=useState(false);
  const originalCanvas=useRef<HTMLCanvasElement>(null),editedCanvas=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null),controlsPanel=useRef<HTMLElement>(null);
  const [zoomControlPosition,setZoomControlPosition]=useState({right:8,bottom:8});
  const expandedGesture=useRef({points:new Map<number,{x:number;y:number}>(),pinched:false,moved:false,picker:false,comparison:false,startZoom:1,startDistance:0,startDivider:50,lastPoint:null as {x:number;y:number}|null});
  const importInput=useRef<HTMLInputElement>(null),recipeInput=useRef<HTMLInputElement>(null);
  const worker=useRef<Worker|null>(null),generation=useRef(0),request=useRef(0),latest=useRef(0),exportRequest=useRef(0),pendingModelBlob=useRef<Blob|null>(null),pendingModelRestore=useRef(false),applyCustomModel=useRef(false),modelRestoreStarted=useRef(false),modelSelectionStarted=useRef(false);
  const photoProcessor=useRef<Worker|null>(null),videoProcessor=useRef<Worker|null>(null);
  const photoRef=useRef<Photo[]>([]),activeRef=useRef<string|null>(null),initialized=useRef(false),pendingBitmap=useRef<ImageBitmap|null>(null);
  photoRef.current=photos;activeRef.current=active;librarySwitchLock.current=exporting||customOpen||customLoading;
  const photo=photos.find(p=>p.id===active),recipe=photo?.recipe;
  const video=!!photo&&isVideo(photo.file),exportFormat=video?'mp4':format;
  const visibleEnhancementTab=video&&enhancementTab==='effects'?'colour':enhancementTab;
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
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  const photoResolution=active?resolutions.get(active)??'auto':'auto';
  const photoDevice:PhotoDevice={mobile:isAndroid()||matchMedia('(pointer: coarse)').matches,memory:(navigator as Navigator&{deviceMemory?:number}).deviceMemory};
  function reopenPhoto(mode:PhotoResolution){if(!active||exporting||saving)return;setResolutions(previous=>new Map(previous).set(active,mode));setPhotoReload(n=>n+1);}
  const photoIndex=folderBrowser?folderBrowser.index:photos.findIndex(p=>p.id===active);
  const photoCount=folderBrowser?folderBrowser.photos.length:photos.length;
  const sourceFolder=active?sourceFolders.get(active):undefined;
  const canEdit=!!recipe && ready && !busy && !exporting && !folderLoading && !customOpen;
  const aspect=dimensions[0]/dimensions[1];
  const fitInset=expanded?80:48;
  const fitWidth=Math.max(1,Math.min(Math.max(1,stageSize.width-48),Math.max(1,(stageSize.height-fitInset)*aspect)));
  const persist=(p:Photo)=>{const {id,file,recipe,thumbnail,addedAt}=p;savePhoto({id,file,recipe,thumbnail,addedAt}).catch(()=>setStorageWarning(true));};
  const notify=(message:string)=>setNotice(message);
  function navigatePhoto(direction:number){if(busy||exporting||customOpen||folderLoading)return;if(folderBrowser){void browseFolderPhoto(folderBrowser,photoIndex+direction);return;}const next=photos[photoIndex+direction];if(next){setReady(false);setActive(next.id);}}
  function selectPhoto(id:string){folderRequest.current++;setFolderLoading(false);const entry=folderBrowser&&[...folderBrowser.loaded].find(([,value])=>value===id);setFolderBrowser(entry&&folderBrowser?{...folderBrowser,index:entry[0]}:null);setActive(id);}
  async function browseFolderPhoto(folder:FolderBrowser,index:number){
    if(index<0||index>=folder.photos.length)return;
    const token=++folderRequest.current;setFolderLoading(true);
    try {
      let id=folder.loaded.get(index);
      if(!id||!photoRef.current.some(p=>p.id===id)){
        const file=await readAndroidFolderPhoto(folder.photos[index]);if(token!==folderRequest.current)return;
        id=addFiles([file],true)[0];if(!id)throw new Error(t("This file could not be opened."));folder.loaded.set(index,id);
      }else {setReady(false);setActive(id);}
      const photoId=id;setSourceFolders(previous=>new Map(previous).set(photoId,folder.directory));
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
  async function rememberSourceFolder(folder:LocalDirectoryHandle){
    const matches: string[]=[];
    for(const p of photos){try{const handle=await folder.getFileHandle(p.file.name);const size=handle.size??(await handle.getFile?.())?.size;if(size===undefined||size===p.file.size)matches.push(p.id);}catch{}}
    if(!active||!matches.includes(active))throw new Error(t("Choose the folder containing the original file."));
    setSourceFolders(previous=>{const next=new Map(previous);matches.forEach(id=>next.set(id,folder));return next;});
    return folder;
  }
  async function selectSourceFolder(){try{await rememberSourceFolder(await chooseFolder());}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))notify(error instanceof Error?error.message:t("Could not select the source folder."));}}
  async function finishExport(blob:Blob,metadataWarning?:string){
    const target=exportTarget.current;if(!target)return;
    setSaving(true);
    try {
      if(target.folder){const file=await createUniqueFile(target.folder,target.name);await writeFile(file.handle,blob);target.name=file.name;}
      else download(blob,target.name);
      notify((target.folder?t("Saved {0}.",[target.name]):t("Downloaded {0}.",[target.name]))+(metadataWarning?` ${message(metadataWarning)}`:''));
    }catch{if(isAndroid())notify(t("Could not save to this folder. Choose another output folder and try again."));else{download(blob,target.name);notify(t("Could not save to the chosen destination. Downloaded the restored file instead."));}}
    finally{exportTarget.current=null;setSaving(false);setExporting(false);setProgress(100);}
  }
  async function updateApp(){
    if(updating||exporting||saving)return;setUpdating(true);
    try{
      const saveCurrent=async()=>{const current=photoRef.current.find(p=>p.id===activeRef.current);if(current){const {id,file,recipe,thumbnail,addedAt}=current;await savePhoto({id,file,recipe,thumbnail,addedAt});}};await saveCurrent();
      if(import.meta.env.DEV){location.reload();return;}
      if(await activateWebUpdate(import.meta.env.BASE_URL)){await saveCurrent();location.reload();}else notify(t("You already have the latest version."));
    }catch(error){notify(error instanceof Error?error.message:t("Could not update. Your files and edits have been kept."));}
    finally{setUpdating(false);}
  }
  function update(fn:(r:Recipe)=>Recipe,record=true) {
    setPhotos(all=>all.map(p=>p.id!==activeRef.current||!p.recipe?p:{...p,recipe:fn(clone(p.recipe)),past:record?[...p.past.slice(-59),clone(p.recipe)]:p.past,future:[]}));
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
  function addFiles(files:File[],fromFolder=false) {
    const valid=files.filter(supportedMedia);
    if(valid.length!==files.length)notify(t("Choose JPEG, PNG, HEIC, HEIF, DNG, MP4 or MOV files."));
    const accepted=valid.filter(f=>f.size<=mediaLimit(f));
    if(accepted.length!==valid.length)notify(t("Files above the 512 MB safety ceiling were skipped."));
    const addedAt=Date.now();
    const items:Photo[]=accepted.map((file,i)=>({id:crypto.randomUUID(),file,addedAt:addedAt+i/1000,url:URL.createObjectURL(file),past:[],future:[]}));
    if(items.length){if(!fromFolder){folderRequest.current++;setFolderLoading(false);setFolderBrowser(null);}setPhotos(all=>[...all,...items]);if(!librarySwitchLock.current){setReady(false);setActive(items[0].id);}items.forEach(persist);}
    return items.map(item=>item.id);
  }
  useEffect(()=>{if(!isAndroid())return;let dispose:(()=>void)|undefined,cancelled=false;receiveAndroidPhotos(addFiles,notify).then(cleanup=>{if(cancelled)cleanup();else dispose=cleanup;}).catch(()=>notify(t("Could not enable Android file sharing.")));return()=>{cancelled=true;dispose?.();};},[]);
  useEffect(()=>{
    if(initialized.current)return;initialized.current=true;
    listPhotos().then(items=>{setPhotos(all=>[...items.map(p=>({...p,url:URL.createObjectURL(p.file),past:[],future:[]})),...all]);if(items.length){const shared=new URLSearchParams(location.search).get('shared');setActive(current=>current??items.find(p=>p.id===shared)?.id??items[0].id);}}).catch(()=>setStorageWarning(true));
    if(import.meta.env.DEV) fetch('/__samples').then(r=>r.json()).then((names:string[])=>setSamples(names.map(name=>({name,label:labelFor(name)})))).catch(()=>{});
    const receive=(event:MessageEvent)=>{if(event.data?.type!=='shared-photos')return;listPhotos().then(items=>{const ids=new Set(photoRef.current.map(p=>p.id)),added=items.filter(p=>!ids.has(p.id));setPhotos(all=>{const current=new Set(all.map(p=>p.id));return [...all,...added.filter(p=>!current.has(p.id)).map(p=>({...p,url:URL.createObjectURL(p.file),past:[],future:[]}))];});if(!librarySwitchLock.current&&event.data.id&&items.some(p=>p.id===event.data.id))setActive(event.data.id);}).catch(()=>setStorageWarning(true));};
    navigator.serviceWorker?.addEventListener('message',receive);
    return ()=>navigator.serviceWorker?.removeEventListener('message',receive);
  },[]);
  useEffect(()=>{
    let w=new Worker(new URL('./processor.worker.ts',import.meta.url),{type:'module'});const v=new Worker(new URL('./video.worker.ts',import.meta.url),{type:'module'});worker.current=w;photoProcessor.current=w;videoProcessor.current=v;
    const receive=({data}:MessageEvent)=>{
      if(data.type==='custom-ready') {
        const blob=pendingModelBlob.current;pendingModelBlob.current=null;pendingModelRestore.current=false;
        setCustomModel(data.config);setCustomFile(blob);setCustomCandidate(null);setCustomOpen(false);
        if(blob&&!data.restore){setCustomLoading(true);void rememberCustomModel(blob,data.config).then(()=>setRememberedModel(data.config)).catch(()=>notify(t("The model loaded, but could not be saved for the next launch."))).finally(()=>setCustomLoading(false));}
        else {setRememberedModel(data.config);setCustomLoading(false);}
        return;
      }
      if(data.type==='error'&&data.operation==='custom-model'){
        setCustomLoading(false);
        if(data.restore){pendingModelBlob.current=null;pendingModelRestore.current=false;setCustomOpen(true);setCustomError(data.message==='Saved custom model is missing or damaged.'?t("The saved model is missing or damaged. Choose it again; saved colour ranges are kept."):t("The saved model could not be restored. Try again or choose its file; the saved model and ranges are kept."));}
        else {pendingModelBlob.current=null;applyCustomModel.current=false;setCustomError(data.message);}
        return;
      }
      if(data.gen!==generation.current){data.bitmap?.close();data.original?.close();return;}
      if(data.type==='photo-info'){setPhotoInfo(data.info);}
      else if(data.type==='enhancement-ready'&&data.request===latest.current){setBusy('');setRendering(false);update(r=>({...r,enhancement:{...data.enhancement,autoApplied:true}}));}
      else if(data.type==='loaded') {
        setPhotoInfo(data.photo??null);setPhotoRetry(false);
        setAnalysis(data.analysis);setDimensions([data.width,data.height]);setVideoInfo(data.video??null);setBusy('');setReady(true);expandedGesture.current.points.clear();expandedGesture.current.pinched=false;expandedGesture.current.picker=false;setZoom(1);
        const c=originalCanvas.current;
        if(c){c.width=data.original.width;c.height=data.original.height;c.getContext('2d')!.drawImage(data.original,0,0);
          const edited=editedCanvas.current;if(edited){edited.width=c.width;edited.height=c.height;edited.getContext('2d')!.drawImage(c,0,0);}}
        else {pendingBitmap.current?.close();pendingBitmap.current=data.original;}
        if(c)data.original.close();
        const thumbnailCanvas=document.createElement('canvas');thumbnailCanvas.width=160;thumbnailCanvas.height=Math.round(160*data.height/data.width);
        if(c)thumbnailCanvas.getContext('2d')!.drawImage(c,0,0,thumbnailCanvas.width,thumbnailCanvas.height);
        const thumbnail=c?thumbnailCanvas.toDataURL('image/jpeg',.75):undefined;
        setPhotos(all=>all.map(p=>{if(p.id!==activeRef.current)return p;let next=p.recipe??makeRecipe(data.analysis);return {...p,recipe:next,thumbnail:thumbnail??p.thumbnail};}));
      } else if(data.type==='rendered') {
        if(data.request===latest.current){if(data.analysis)setAnalysis(data.analysis);const c=editedCanvas.current;if(c){c.width=data.bitmap.width;c.height=data.bitmap.height;c.getContext('2d')!.drawImage(data.bitmap,0,0);c.dataset.generation=String(data.gen);c.dataset.request=String(data.request);}if(data.original&&originalCanvas.current){const o=originalCanvas.current;o.width=data.original.width;o.height=data.original.height;o.getContext('2d')!.drawImage(data.original,0,0);}setRendering(false);setModelStatus('');}
        data.original?.close();
        data.bitmap.close();
      } else if(data.type==='model-status'&&data.request===latest.current) setModelStatus(data.message);
      else if(data.type==='progress'&&data.request===exportRequest.current) setProgress(data.progress);
      else if(data.type==='exported'&&data.request===exportRequest.current) {
        void finishExport(data.blob,data.metadataWarning);
      } else if(data.type==='error') {
        if(data.operation==='render'&&data.request!==latest.current)return;
        setModelStatus('');
        setBusy('');setExporting(false);setRendering(false);
        if(data.operation==='load')setReady(false);
        if(data.operation==='load'||data.operation==='export')setPhotoRetry(true);
        notify(data.message);
      }
    };
    w.onmessage=receive;v.onmessage=receive;
    const fail=()=>{setBusy('');setExporting(false);setReady(false);setPhotoRetry(true);notify(t("The processing worker stopped. Reopen the file, or refresh and try a smaller file."));};const recoverPhotoWorker=()=>{w.terminate();w=new Worker(new URL('./processor.worker.ts',import.meta.url),{type:'module'});w.onmessage=receive;w.onerror=recoverPhotoWorker;photoProcessor.current=w;if(worker.current!==v)worker.current=w;fail();};w.onerror=recoverPhotoWorker;v.onerror=fail;
    return ()=>{w.terminate();v.terminate();worker.current=null;photoProcessor.current=null;videoProcessor.current=null;pendingBitmap.current?.close();};
  },[]);
  useEffect(()=>{
    if(modelRestoreStarted.current)return;modelRestoreStarted.current=true;let cancelled=false;
    loadRememberedCustomModel().then(saved=>{
      if(cancelled||modelSelectionStarted.current||!saved)return;setRememberedModel(saved.config);setInputRange(saved.config.inputRange);setOutputRange(saved.config.outputRange);
      if(!saved.blob){setCustomOpen(true);setCustomError(t("The saved model is missing or damaged. Choose it again; saved colour ranges are kept."));return;}
      pendingModelBlob.current=saved.blob;pendingModelRestore.current=true;setCustomLoading(true);
      photoProcessor.current?.postMessage({type:'custom-model',gen:generation.current,permission:true,blob:saved.blob,name:saved.config.name,inputRange:saved.config.inputRange,outputRange:saved.config.outputRange,restore:true,expectedConfig:saved.config});
    }).catch(()=>{if(!cancelled){setCustomOpen(true);setCustomLoading(false);setCustomError(t("Saved custom model storage could not be read. Choose the model file again; saved colour ranges are kept."));}});
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    if(!video||!customFile||!customModel||!videoProcessor.current)return;
    videoProcessor.current.postMessage({type:'custom-model',gen:generation.current,permission:true,blob:customFile,name:customModel.name,inputRange:customModel.inputRange,outputRange:customModel.outputRange,silent:true,expectedConfig:customModel});
  },[video,customFile,customModel]);
  useEffect(()=>{
    if(!active){
      const gen=++generation.current;photoProcessor.current?.postMessage({type:'unload',gen});videoProcessor.current?.postMessage({type:'unload',gen});worker.current=null;
      pendingBitmap.current?.close();pendingBitmap.current=null;
      for(const canvas of [originalCanvas.current,editedCanvas.current])if(canvas){canvas.width=1;canvas.height=1;delete canvas.dataset.generation;delete canvas.dataset.request;}
      setPhotoInfo(null);setPhotoRetry(false);setVideoInfo(null);setPreviewTime(0);setModelStatus('');setAnalysis(null);setDimensions([1,1]);setBusy('');setReady(false);setRendering(false);setEyedropper(false);
      return;
    }
    const p=photoRef.current.find(p=>p.id===active);if(!p)return;
    const clip=isVideo(p.file);worker.current=clip?videoProcessor.current:photoProcessor.current;
    generation.current++;setPhotoInfo(null);setPhotoRetry(false);setVideoInfo(null);setPreviewTime(0);setKeepAudio(true);setModelStatus('');setReady(false);setRendering(true);setAnalysis(null);setBusy(clip?t("Opening video…"):isRaw(p.file)?t("Developing DNG locally…"):/\.hei[cf]$/i.test(p.file.name)?t("Decoding HEIC locally…"):t("Opening photo…"));setEyedropper(false);
    (clip?photoProcessor.current:videoProcessor.current)?.postMessage({type:'unload',gen:generation.current});
    if(customFile&&customModel)worker.current?.postMessage({type:'custom-model',gen:generation.current,permission:true,blob:customFile,name:customModel.name,inputRange:customModel.inputRange,outputRange:customModel.outputRange,silent:true,expectedConfig:customModel});
    worker.current?.postMessage({type:'load',gen:generation.current,blob:p.file,photoResolution,photoDevice});
    return ()=>{const previous=photoRef.current.find(item=>item.id===active);if(previous?.recipe)persist(previous);};
  },[active,photoResolution,photoReload]);
  useEffect(()=>{
    if(ready&&pendingBitmap.current&&originalCanvas.current){const b=pendingBitmap.current,c=originalCanvas.current;c.width=b.width;c.height=b.height;c.getContext('2d')!.drawImage(b,0,0);b.close();pendingBitmap.current=null;}
  },[ready]);
  useEffect(()=>{
    if(!recipe||!ready||exporting)return;
    if(recipe.engine==='wave'&&(!customModel||(recipe.customModel&&(recipe.customModel.sha256!==customModel.sha256||recipe.customModel.inputRange!==customModel.inputRange||recipe.customModel.outputRange!==customModel.outputRange)))){latest.current=++request.current;setInputRange(recipe.customModel?.inputRange??'unit');setOutputRange(recipe.customModel?.outputRange??'unit');setCustomOpen(true);setRendering(true);return;}
    const id=++request.current;latest.current=id;setRendering(true);
    const timer=setTimeout(()=>worker.current?.postMessage({type:'render',gen:generation.current,request:id,recipe,time:previewTime}),40);
    return ()=>clearTimeout(timer);
  },[recipe,ready,exporting,customModel,previewTime]);
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
  },[saveDialog,customOpen,exporting,customLoading,saving]);
  useEffect(()=>{if(!stage.current)return;const observer=new ResizeObserver(entries=>{const element=entries[0].target as HTMLDivElement;setStageSize({width:element.clientWidth,height:element.clientHeight});});observer.observe(stage.current);return ()=>observer.disconnect();},[]);
  useEffect(()=>{if(!expanded)return;const place=()=>{const bounds=stage.current?.getBoundingClientRect();if(!bounds)return;let bottomEdge=bounds.bottom;
      if(narrowControls&&adjustmentsOpen){const panel=controlsPanel.current?.getBoundingClientRect();if(panel&&panel.top>bounds.top)bottomEdge=Math.min(bottomEdge,panel.top);}
      bottomEdge=Math.max(bounds.top+56,bottomEdge);const next={right:Math.round(Math.max(8,window.innerWidth-bounds.right+8)),bottom:Math.round(Math.max(8,window.innerHeight-bottomEdge+8))};setZoomControlPosition(current=>current.right===next.right&&current.bottom===next.bottom?current:next);};
    const observer=new ResizeObserver(place);if(stage.current)observer.observe(stage.current);if(controlsPanel.current)observer.observe(controlsPanel.current);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);place();return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[expanded,narrowControls,adjustmentsOpen]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!['INPUT','SELECT','TEXTAREA'].includes((e.target as HTMLElement).tagName)){e.preventDefault();if(canEdit)history(e.shiftKey?'redo':'undo');}};window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey);},[active,canEdit]);
  async function sample(name:string){
    if(exporting||sampleBusy)return;setSampleBusy(true);
    try{const response=await fetch('/__sample/'+encodeURIComponent(name));if(!response.ok)throw new Error(t("Sample unavailable."));const blob=await response.blob();addFiles([new File([blob],name,{type:blob.type})]);}
    catch{notify(t("Could not open this local sample. Use Open files instead."));}finally{setSampleBusy(false);}
  }
  function reset(){if(analysis)update(()=>makeRecipe(analysis));setEyedropper(false);}
  function cancelCustom(){
    if(customLoading)return;pendingModelBlob.current=null;applyCustomModel.current=false;setCustomCandidate(null);setCustomOpen(false);setCustomError('');
    const matching=!!customModel&&(!recipe?.customModel||(recipe.customModel.sha256===customModel.sha256&&recipe.customModel.inputRange===customModel.inputRange&&recipe.customModel.outputRange===customModel.outputRange));
    if(recipe?.engine==='wave'&&!matching&&analysis)update(r=>({...r,engine:'balanced',auto:suggest(analysis,r.hints,'balanced')}));
  }
  async function forgetSavedModel(){if(customLoading)return;try{await forgetCustomModel();setRememberedModel(null);notify(t("Saved custom model removed from this device."));}catch{notify(t("Could not remove the saved custom model."));}}
  function autoEnhance(){if(!canEdit||video||rendering)return;const id=++request.current;latest.current=id;setBusy(t('Analysing photo enhancement…'));worker.current?.postMessage({type:'enhance',gen:generation.current,request:id,recipe});}
  function enhance(key:'contrast'|'clarity'|'sharpness'|'brightness',value:number){update(r=>{const previous={...r.enhancement??DEFAULT_ENHANCEMENT};delete previous.autoApplied;return {...r,enhancement:{...previous,[key]:value}};},false);}
  const autoEnhancementApplied=recipe?.enhancement?.autoApplied===true&&(
    recipe.enhancement.contrast!==0||recipe.enhancement.clarity!==0||recipe.enhancement.sharpness!==0||
    (recipe.enhancement.brightness??0)!==0||recipe.enhancement.black!==0||recipe.enhancement.white!==1);
  async function exportPhoto(saveAs=false,chooseNewFolder=false,downloadOnly=false){
    if(!canEdit||rendering||!photo)return;
    if(saveAs&&!saveDialog&&supportsFolder()){setSaveName(restoredName(photo.file.name,exportFormat,!outputFolder));setSaveDialog(true);return;}
    const name=saveAs&&saveDialog?restoredName(saveName,exportFormat,false):restoredName(photo.file.name,exportFormat,!outputFolder);
    setExporting(true);setProgress(0);
    try {
      let folder=downloadOnly?undefined:outputFolder??sourceFolder;
      if(!downloadOnly&&supportsFolder()&&(chooseNewFolder||!folder)) {
        const chosen=await chooseFolder();
        folder=saveAs?chosen:await rememberSourceFolder(chosen);
      }
      setSaveDialog(false);exportTarget.current={name,folder};
      exportRequest.current=++request.current;worker.current?.postMessage({type:'export',gen:generation.current,request:exportRequest.current,recipe,format:exportFormat,keepAudio,keepMetadata});
    }catch(error){setExporting(false);if(!(error instanceof DOMException&&error.name==='AbortError'))notify(error instanceof Error?error.message:t("Could not open the save folder."));}
  }
  function cancelExport(){if(saving)return;generation.current++;exportTarget.current=null;worker.current?.postMessage({type:'cancel',gen:generation.current});setExporting(false);notify(t("Export cancelled."));}
  function pickNeutralAt(clientX:number,clientY:number,frame:HTMLDivElement){
    if(!eyedropper||!canEdit||!editedCanvas.current)return;
    const c=editedCanvas.current,rect=frame.getBoundingClientRect();
    const x=clamp(Math.floor((clientX-rect.left)/rect.width*c.width),0,c.width-1),y=clamp(Math.floor((clientY-rect.top)/rect.height*c.height),0,c.height-1);
    const pixel=c.getContext('2d')!.getImageData(Math.max(0,x-1),Math.max(0,y-1),Math.min(3,c.width-x),Math.min(3,c.height-y)).data;
    const rgb=[0,0,0];for(let i=0;i<pixel.length;i+=4){rgb[0]+=pixel[i];rgb[1]+=pixel[i+1];rgb[2]+=pixel[i+2];}rgb.forEach((_,i)=>rgb[i]/=pixel.length/4);
    if(Math.min(...rgb)<12||Math.max(...rgb)>245){notify(t("Choose a midtone white or grey area, away from deep shadows and bright highlights."));return;}
    const target=(rgb[0]+rgb[1]+rgb[2])/3;
    update(r=>({...r,manual:{...r.manual,neutral:r.manual.neutral.map((v,i)=>clamp(v*target/rgb[i],.25,4)) as [number,number,number]}}));
    setEyedropper(false);notify(t("Neutral point applied. Undo if the selected area was not white or grey."));
  }
  function expandedPointerDown(e:ReactPointerEvent<HTMLDivElement>){
    const comparison=!!(e.target as HTMLElement).closest('.comparison-input');
    if(!expanded){if(eyedropper&&canEdit&&!comparison)pickNeutralAt(e.clientX,e.clientY,e.currentTarget);return;}
    if(!ready)return;
    const gesture=expandedGesture.current;
    if(comparison){e.preventDefault();if(gesture.points.size===0){gesture.startDivider=divider;const rect=e.currentTarget.getBoundingClientRect();setDivider(clamp((e.clientX-rect.left)/rect.width*100,0,100));}else if(gesture.points.size===1)setDivider(gesture.startDivider);}
    const point={x:e.clientX,y:e.clientY};gesture.points.set(e.pointerId,point);
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* Synthetic and already-cancelled pointers cannot be captured. */}
    if(gesture.points.size===1){gesture.pinched=false;gesture.moved=false;gesture.comparison=comparison;gesture.picker=eyedropper&&!comparison;gesture.startZoom=zoom;gesture.lastPoint=point;gesture.startDistance=0;}
    else if(gesture.points.size===2){gesture.pinched=true;gesture.picker=false;gesture.startZoom=zoom;const [a,b]=[...gesture.points.values()];gesture.startDistance=Math.hypot(a.x-b.x,a.y-b.y);}
    else {gesture.pinched=true;gesture.picker=false;}
  }
  function expandedPointerMove(e:ReactPointerEvent<HTMLDivElement>){
    const gesture=expandedGesture.current;if(!expanded||!gesture.points.has(e.pointerId))return;
    const next={x:e.clientX,y:e.clientY},previous=gesture.points.get(e.pointerId)!;gesture.points.set(e.pointerId,next);
    if(gesture.points.size>=2){
      gesture.pinched=true;gesture.picker=false;gesture.moved=true;const [a,b]=[...gesture.points.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);
      if(gesture.startDistance>0)setZoom(clamp(gesture.startZoom*distance/gesture.startDistance,1,4));
      return;
    }
    if(gesture.pinched){gesture.moved=true;return;}
    const dx=next.x-previous.x,dy=next.y-previous.y;if(Math.hypot(next.x-(gesture.lastPoint?.x??next.x),next.y-(gesture.lastPoint?.y??next.y))>8)gesture.moved=true;
    if(gesture.comparison){const rect=e.currentTarget.getBoundingClientRect();setDivider(clamp((next.x-rect.left)/rect.width*100,0,100));}
    else if(zoom>1&&gesture.lastPoint){stage.current!.scrollLeft-=dx;stage.current!.scrollTop-=dy;}
  }
  function expandedPointerUp(e:ReactPointerEvent<HTMLDivElement>,cancelled=false){
    const gesture=expandedGesture.current;if(!gesture.points.has(e.pointerId))return;
    const applyPicker=gesture.points.size===1&&!gesture.pinched&&!gesture.moved&&gesture.picker&&!cancelled&&!((e.target as HTMLElement).closest('.comparison-input'));
    if(applyPicker)pickNeutralAt(e.clientX,e.clientY,e.currentTarget);
    gesture.points.delete(e.pointerId);
    if(gesture.points.size===0){gesture.pinched=false;gesture.moved=false;gesture.picker=false;gesture.comparison=false;gesture.startDistance=0;gesture.lastPoint=null;}
    try{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}catch{/* Pointer capture may already be released by the browser. */}
  }
  async function readRecipe(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0],targetId=activeRef.current;e.target.value='';if(!file||!targetId)return;try{if(file.size>20000)throw new Error(t("Recipe file is too large."));const next=parseRecipe(JSON.parse(await file.text())),target=photoRef.current.find(p=>p.id===targetId);if(!target)return;const updated={...target,recipe:next,past:target.recipe?[...target.past.slice(-59),clone(target.recipe)]:target.past,future:[]};setPhotos(all=>all.map(p=>p.id===targetId?{...p,recipe:next,past:p.recipe?[...p.past.slice(-59),clone(p.recipe)]:p.past,future:[]}:p));persist(updated);notify(t("Recipe applied."));}catch(err){notify(err instanceof Error?err.message:t("Could not read the recipe."));}}
  async function removePhoto(p:Photo){if(exporting||folderLoading)return;if(folderBrowser)setFolderBrowser(null);const removingActive=p.id===active;if(removingActive){const gen=++generation.current;worker.current?.postMessage({type:'unload',gen});setBusy('');setReady(false);setRendering(false);setAnalysis(null);setPhotoInfo(null);setPhotoRetry(false);setVideoInfo(null);}URL.revokeObjectURL(p.url);setPhotos(all=>all.filter(x=>x.id!==p.id));if(removingActive)setActive(photos.find(x=>x.id!==p.id)?.id??null);await deletePhoto(p.id).catch(()=>setStorageWarning(true));}
  return <><div hidden={about} className={`app-shell ${expanded?'expanded-photo':''} ${adjustmentsOpen?'adjustments-open':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!exporting&&!folderLoading)addFiles(Array.from(e.dataTransfer.files));}}>
    <header className="topbar"><div className="brand-cluster"><a className="brand" href={import.meta.env.BASE_URL} aria-label={t("ClearWater home")}><span className="brand-icon"><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt=""/></span><span>clearwater<span className="brand-dot">.</span></span></a>{!isAndroid()&&<button className="app-update" aria-label={t("Update app")} title={t("Check for updates and reload")} disabled={updating||exporting||saving||customLoading||folderLoading} onClick={updateApp}><RefreshCw size={12} className={updating?'spin':undefined}/></button>}<LanguageSelect/></div><a className="edition about-nav" href="#about">{t("About & guide")}</a>
      <div className="top-actions"><span className="private-note"><LockKeyhole size={12}/> {t("Stays on your device")}</span><button className="button secondary" disabled={exporting||folderLoading} onClick={()=>importInput.current?.click()}><Plus size={16}/> {t("Open files")}</button>{isAndroid()&&<button className="button secondary" aria-label={t("Open folder")} title={t("Open folder")} disabled={!!busy||exporting||folderLoading||customOpen} onClick={openPhotoFolder}><FolderOpen size={16}/> {t("Open folder")}</button>}<button className="button primary" disabled={!canEdit||rendering} onClick={()=>exportPhoto()}><Download size={16}/>{video?t("Export video"):t("Export photo")}</button></div></header>
    <input ref={importInput} className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,image/dng,image/x-adobe-dng,video/mp4,video/quicktime,.heic,.heif,.dng,.mp4,.mov" aria-label={t("Choose photos")} onChange={e=>{addFiles(Array.from(e.target.files??[]));e.target.value='';}}/>
    <input ref={recipeInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label={t("Choose recipe")} onChange={readRecipe}/>
    <main className="studio">
      <aside className="library"><div className="section-title"><span>{t("YOUR PHOTOS")}</span><span className="count">{photos.length.toString().padStart(2,'0')}</span></div>
        <button className="import-tile" disabled={exporting||folderLoading} onClick={()=>importInput.current?.click()}><ImagePlus size={22}/><span>{t("Add to your collection")}</span><small>{t("Photos · DNG · MP4 · MOV")}</small></button>
        <div className="photo-grid">{photos.map(p=><div className={`photo-tile ${p.id===active?'selected':''}`} key={p.id}><button className="photo-select" disabled={exporting||folderLoading||busy!==''||customOpen||customLoading} onClick={()=>selectPhoto(p.id)} title={p.file.name}><img src={p.thumbnail??p.url} alt={p.file.name} onLoad={e=>{e.currentTarget.style.visibility='visible';}} onError={e=>{e.currentTarget.style.visibility='hidden';}}/>{p.id===active&&<span className="selected-check"><Check size={12}/></span>}<span>{p.file.name.replace(/\.[^.]+$/,'')}</span></button><button className="remove-photo" disabled={exporting||customOpen||customLoading} title={t("Remove local copy")} aria-label={t("Remove {0}",[p.file.name])} onClick={()=>removePhoto(p)}><X size={12}/></button></div>)}</div>
        {samples.length>0&&<><div className="section-title sample-heading"><span>{t("YOUR DIVE SAMPLES")}</span><span className="count">09</span></div><div className="sample-list">{samples.map((s,i)=><button key={s.name} disabled={exporting||sampleBusy||busy!==''} onClick={()=>sample(s.name)}><img src={'/__thumb/'+encodeURIComponent(s.name)} alt=""/><span><strong>{s.label}</strong><small>{t("Dive study")} {String(i+1).padStart(2,'0')}</small></span><Plus size={13}/></button>)}</div></>}
      </aside>
      <section className="workspace">
        {folderBrowser&&<div className="folder-browser"><FolderOpen size={12}/><span title={folderBrowser.name}>{folderBrowser.name}</span><button disabled={folderLoading||exporting||!!busy} aria-label={t("Close folder browser")} title={t("Return to imported photos")} onClick={()=>setFolderBrowser(null)}><X size={13}/></button></div>}
        <div className="canvas-toolbar"><div className="photo-navigation"><button aria-label={t("Previous photo")} title={t("Previous photo")} disabled={photoIndex<=0||!!busy||exporting||customOpen||folderLoading} onClick={()=>navigatePhoto(-1)}><ChevronLeft size={16}/></button><span aria-label={t("Photo position")}>{photoIndex<0?'0 / 0':`${photoIndex+1} / ${photoCount}`}</span><button aria-label={t("Next photo")} title={t("Next photo")} disabled={photoIndex<0||photoIndex>=photoCount-1||!!busy||exporting||customOpen||folderLoading} onClick={()=>navigatePhoto(1)}><ChevronRight size={16}/></button></div><div className="filename"><span className="file-dot"/>{photo?.file.name??t("No photo selected")}</div><div className="canvas-tools"><button disabled={!photo} aria-label={expanded?t("Exit expanded view"):t("Expand photo")} title={expanded?t("Exit expanded view (Esc)"):t("Expand photo")} aria-pressed={expanded} onClick={()=>{expandedGesture.current.points.clear();expandedGesture.current.pinched=false;expandedGesture.current.picker=false;setExpanded(!expanded);setZoom(1);setAdjustmentsOpen(false);}}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button><button disabled={!canEdit||!photo?.past.length} aria-label={t("Undo")} title={t("Undo (Ctrl+Z)")} onClick={()=>history('undo')}><Undo2 size={16}/></button><button disabled={!canEdit||!photo?.future.length} aria-label={t("Redo")} title={t("Redo")} onClick={()=>history('redo')}><Redo2 size={16}/></button><span className="tool-separator"/><button className={compare?'active':''} disabled={!ready} onClick={()=>{setCompare(!compare);setEyedropper(false);}} title={t("Before / after comparison")} aria-label={t("Toggle comparison")}><ArrowLeftRight size={16}/></button><button className={eyedropper?'active':''} disabled={!canEdit} onClick={()=>{setEyedropper(!eyedropper);setCompare(false);}} title={t("Pick a white or grey point")} aria-label={t("Pick neutral point")}><Pipette size={16}/></button></div></div>
        <div className={`stage ${eyedropper?'picking':''}`} ref={stage}>
          {!photo&&<div className="empty-state"><h1>{t("Photo & video editor")}</h1><p>{t("Open a photo, MP4 or MOV to start.")}</p><button className="button primary" onClick={()=>importInput.current?.click()}><Upload size={16}/> {t("Choose a photo or video")}</button><small>{t("Or drop photos anywhere in the studio")}</small></div>}
          {photo&&<div className="image-frame" onPointerDown={expandedPointerDown} onPointerMove={expandedPointerMove} onPointerUp={e=>expandedPointerUp(e)} onPointerCancel={e=>expandedPointerUp(e,true)} style={{width:fitWidth*zoom,height:fitWidth/aspect*zoom,visibility:ready?'visible':'hidden'}}>
            <canvas ref={editedCanvas} aria-label={t("Edited photo")}/><canvas ref={originalCanvas} className="original-canvas" aria-label={t("Original photo")} style={{clipPath:showOriginal?'none':compare?`inset(0 ${100-divider}% 0 0)`:'inset(0 100% 0 0)'}}/>
            {compare&&!showOriginal&&<><span className="image-label before">{t("ORIGINAL")}</span><span className="image-label after">{t("RESTORED")}</span><div className="divider-line" style={{left:`${divider}%`}}><span><ArrowLeftRight size={16}/></span></div><input className="comparison-input" aria-label={t("Before and after divider")} type="range" min="0" max="100" value={divider} onChange={e=>setDivider(Number(e.target.value))}/></>}
            {eyedropper&&<span className="picker-hint">{t("Click a white or grey area")}</span>}
          </div>}
          {expanded&&photo&&<div className="expanded-zoom-controls" style={zoomControlPosition} aria-label={t("Zoom, Fit & expand")}><button type="button" aria-label={t("Zoom out")} title={t("Zoom out")} disabled={!ready||zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z-.5))}><ZoomOut size={16}/></button><button type="button" className="zoom-fit" aria-label={t("Fit")} title={t("Fit")} disabled={!ready} onClick={()=>{setZoom(1);if(stage.current)stage.current.scrollTo({left:0,top:0});}}>{zoom===1?t("Fit"):`${Math.round(zoom*100)}%`}</button><button type="button" aria-label={t("Zoom in")} title={t("Zoom in")} disabled={!ready||zoom>=4} onClick={()=>setZoom(z=>Math.min(4,z+.5))}><ZoomIn size={16}/></button></div>}
          {(busy||folderLoading)&&<div className="processing-overlay" role="status"><LoaderCircle className="spin" size={25}/><span>{folderLoading?t("Opening folder file…"):message(busy)}</span><small>{t("Your file stays on this device.")}</small></div>}
        </div>
        {!video&&photo&&(photoInfo?.large||photoRetry||photoResolution!=='auto')&&<div className="large-photo-note" role="status"><div><strong>{photoRetry?t("Photo processing could not finish"):photoInfo?.large?t("Large photo"):t("Photo resolution")}</strong><span>{photoInfo?t("{0} MP · {1} MB. Export: {2} × {3}. ",[(photoInfo.sourceWidth*photoInfo.sourceHeight/1e6).toFixed(1),(photo.file.size/1024/1024).toFixed(0),photoInfo.exportWidth,photoInfo.exportHeight]):''}{photoRetry?t("Try reduced resolution; your original and edit settings are kept."):t("A small preview keeps editing responsive. Full resolution can use substantial memory.")}</span></div><label>{t("Resolution")}<select aria-label={t("Photo resolution")} value={photoResolution} disabled={exporting||saving} onChange={e=>reopenPhoto(e.target.value as PhotoResolution)}><option value="auto">{t("Auto")}</option><option value="full">{t("Full resolution")}</option><option value="reduced">{t("Reduced · up to 12 MP")}</option></select></label>{photoRetry&&<button className="button secondary" disabled={exporting||saving} onClick={()=>reopenPhoto('reduced')}>{t("Retry reduced")}</button>}</div>}
        {video&&videoInfo&&<div className="video-timeline"><label><span>{t("Frame preview")} <output>{videoTime(previewTime)} / {videoTime(videoInfo.duration)}</output></span><input aria-label={t("Video position")} type="range" min={0} max={Math.max(0,videoInfo.duration-.001)} step={.04} value={previewTime} disabled={!ready||exporting} onChange={e=>setPreviewTime(Number(e.target.value))}/></label><small>{videoInfo.codec.toUpperCase()} · {videoInfo.outputWidth} × {videoInfo.outputHeight} {t("MP4 export · up to")} {Math.round(videoInfo.frameRate)} fps</small></div>}
        <div className="workspace-bottom"><span>{ready?`${dimensions[0]} × ${dimensions[1]} · ${(dimensions[0]*dimensions[1]/1e6).toFixed(1)} MP`:t("No photo selected")}</span><div><button disabled={!ready} onPointerDown={()=>setShowOriginal(true)} onPointerUp={()=>setShowOriginal(false)} onPointerLeave={()=>setShowOriginal(false)} onKeyDown={e=>{if(e.key===' ')setShowOriginal(true);}} onKeyUp={()=>setShowOriginal(false)}>{t("Hold for original")}</button>{!expanded&&<><span className="tool-separator"/><button disabled={!ready||zoom<=1} aria-label={t("Zoom out")} onClick={()=>setZoom(z=>Math.max(1,z-.5))}><ZoomOut size={15}/></button><button disabled={!ready} aria-label={t("Fit")} onClick={()=>{setZoom(1);if(stage.current)stage.current.scrollTo({left:0,top:0});}}>{zoom===1?t("Fit"):`${Math.round(zoom*100)}%`}</button><button disabled={!ready||zoom>=4} aria-label={t("Zoom in")} onClick={()=>setZoom(z=>Math.min(4,z+.5))}><ZoomIn size={15}/></button></>}</div></div>
      </section>
      <aside ref={controlsPanel} className="controls compact-controls"><div className="controls-top"><SlidersHorizontal size={16}/><span className="adjustments-label">{t("Adjustments")}</span><button className="adjustments-toggle" aria-label={t("Toggle adjustments")} aria-expanded={adjustmentsOpen} aria-controls="adjustment-settings" onClick={()=>setAdjustmentsOpen(!adjustmentsOpen)}><SlidersHorizontal size={15}/> {t("Adjustments")} <ChevronDown size={14}/></button><button disabled={!canEdit} onClick={reset} title={t("Reset all edits")} aria-label={t("Reset all edits")}><RotateCcw size={15}/></button></div>
        <nav className="control-tabs main-control-tabs" role="tablist" aria-label={t("Adjustments")}>
          {(['correction','enhancement','export'] as const).map(tab=><button key={tab} id={`control-tab-${tab}`} type="button" role="tab" data-control-tab={tab} data-tab-value={tab} aria-selected={controlTab===tab} aria-controls={`control-panel-${tab}`} tabIndex={controlTab===tab?0:-1} onClick={()=>setControlTab(tab)} onKeyDown={e=>tabKeyDown(e,['correction','enhancement','export'],setControlTab)}>{t(({correction:'Correction',enhancement:'Enhancement',export:'Export'} as const)[tab])}</button>)}
        </nav>
        <nav className={`control-tabs correction-subtabs ${controlTab==='correction'?'is-visible':''}`} role="tablist" aria-label={t("Correction")}>
          {(['engine','dive'] as const).map(tab=><button key={tab} id={`control-subtab-${tab}`} type="button" role="tab" data-control-subtab={tab} data-tab-value={tab} aria-selected={correctionTab===tab} aria-controls={`control-subpanel-${tab}`} tabIndex={correctionTab===tab?0:-1} onClick={()=>setCorrectionTab(tab)} onKeyDown={e=>tabKeyDown(e,['engine','dive'],setCorrectionTab)}>{t(tab==='engine'?'Engine':'Dive conditions')}</button>)}
        </nav>
        <nav className={`control-tabs enhancement-subtabs ${controlTab==='enhancement'?'is-visible':''}`} role="tablist" aria-label={t("Enhancement")}>
          {(['colour','light','clarity','effects'] as const).filter(tab=>!(video&&tab==='effects')).map(tab=><button key={tab} id={`control-subtab-${tab}`} type="button" role="tab" data-control-subtab={tab} data-tab-value={tab} aria-selected={visibleEnhancementTab===tab} aria-controls={`control-subpanel-${tab}`} tabIndex={visibleEnhancementTab===tab?0:-1} disabled={video&&tab==='effects'} onClick={()=>setEnhancementTab(tab)} onKeyDown={e=>tabKeyDown(e,(video?['colour','light','clarity']:['colour','light','clarity','effects']),setEnhancementTab)}>{t(({colour:'Colour',light:'Light',clarity:'Clarity',effects:'Effects'} as const)[tab])}</button>)}
        </nav>
        <fieldset id="adjustment-settings" className="control-body" disabled={!canEdit}>
          <section id="control-panel-correction" role="tabpanel" aria-labelledby="control-tab-correction" className={`mobile-panel correction-panel ${controlTab==='correction'?'is-active':''}`}>
          <div id="control-subpanel-engine" role="tabpanel" aria-labelledby="control-subtab-engine" className={`mobile-subpanel engine-subpanel ${correctionTab==='engine'?'is-active':''}`}>
          <details className="settings-group" open={narrowControls||undefined}><summary>{t("Correction Engine")} <ChevronDown size={14}/></summary><div className="group-content engine-details"><select aria-label={t("Correction engine")} value={recipe?.engine??'balanced'} onChange={e=>{if(e.target.value==='wave'&&!customModel){setCustomCandidate(null);setCustomError('');setCustomOpen(true);return;}if(analysis)update(r=>({...r,engine:e.target.value as Recipe['engine'],...(e.target.value==='wave'&&customModel?{customModel}:{}),auto:suggest(analysis,r.hints,e.target.value as Recipe['engine'])}));}}><option value="balanced">{t("Balanced restoration")}</option><option value="baseline">{t("Original RGB heuristic")}</option><option value="shallow">{t("Shallow-UWnet · AI")}</option><option value="funie">{t("FUnIE-GAN · AI")}</option><option value="wave">{customModel?customModel.name:t("Load other ONNX model…")}</option></select>{video&&recipe&&['shallow','funie','wave'].includes(recipe.engine)&&<div className="video-ai-options"><label>{t("Video correction")}<select aria-label={t("Video correction")} value={recipe.videoCorrection?.mode??'sampled'} onChange={e=>update(r=>({...r,videoCorrection:{mode:e.target.value as 'sampled'|'fixed',interval:r.videoCorrection?.interval??5,referenceTime:previewTime}}))}><option value="sampled">{t("Sampled AI colour")}</option><option value="fixed">{t("Fixed selected frame")}</option></select></label>{(recipe.videoCorrection?.mode??'sampled')==='sampled'?<label>{t("Sample every")}<select aria-label={t("AI sample interval")} value={recipe.videoCorrection?.interval??5} onChange={e=>update(r=>({...r,videoCorrection:{mode:'sampled',interval:Number(e.target.value) as 2|5|10,referenceTime:r.videoCorrection?.referenceTime??0}}))}><option value="2">{t("2 seconds · more analysis")}</option><option value="5">{t("5 seconds")}</option><option value="10">{t("10 seconds · less analysis")}</option></select></label>:<button className="text-button" onClick={()=>update(r=>({...r,videoCorrection:{mode:'fixed',interval:r.videoCorrection?.interval??5,referenceTime:previewTime}}))}>{t("Use current frame ({0})",[videoTime(previewTime)])}</button>}<small>{(recipe.videoCorrection?.mode??'sampled')==='fixed'?t("One AI colour correction from {0} for the entire clip.",[videoTime(recipe.videoCorrection?.referenceTime??0)]):t("Colour blends between samples; checks at sample points help avoid blending different scenes. Export analyses the remaining samples first.")} {t("This approximates AI colour, not local dehazing or denoising.")}</small></div>}{customModel&&<button className="text-button" disabled={customLoading} onClick={()=>{setCustomCandidate(null);setCustomError('');setCustomOpen(true);}}>{t("Load another ONNX model")}</button>}{rememberedModel&&<button className="text-button" disabled={customLoading} onClick={()=>void forgetSavedModel()}>{t("Forget saved model")}</button>}{modelStatus&&<p role="status"><LoaderCircle className="spin" size={12}/> {message(modelStatus)}</p>}<p>{video?t("AI estimates global colour from sampled frames. Balanced and RGB use one edit across the clip."):t("AI colour correction runs locally. Strength and manual edits still apply; dive hints affect Balanced restoration.")}</p></div></details>
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
          </div>{recipe&&recipe.engine!=='balanced'&&<p className="balanced-only-note">{t("Only works for Balanced restoration.")}</p>}</details>
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

          <details className="settings-group" open><summary>{t("Export")} <span className="summary-meta">{video?t("MP4 · up to 1080p"):photoInfo&&(photoInfo.exportWidth!==photoInfo.sourceWidth||photoInfo.exportHeight!==photoInfo.sourceHeight)?t("Reduced resolution"):t("Full resolution")}</span><ChevronDown size={14}/></summary><div className="group-content export-section"><div className="export-options">{video?<div className="video-export-options"><span>MP4 · H.264 · SDR</span><label><input type="checkbox" aria-label={t("Keep audio")} checked={keepAudio} disabled={!videoInfo?.hasAudio} onChange={e=>setKeepAudio(e.target.checked)}/> {t("Keep audio")}{videoInfo&&!videoInfo.hasAudio?t(" (no audio track)"):''}</label><small>{t("Up to 10 minutes / 512 MB input. Export up to 1080p and 30 fps. Audio is kept when supported. Longer clips use a lower bitrate.")}</small>{videoInfo&&(videoInfo.duration>=120||(photo?.file.size??0)>=100*1024*1024)&&<small className="video-cost-note">{t("Large/long clip: processing can take several minutes.")} {recipe&&['shallow','funie','wave'].includes(recipe.engine)&&(recipe.videoCorrection?.mode??'sampled')==='sampled'?t("About {0} AI samples. A 10-second interval or Fixed selected frame reduces analysis.",[Math.ceil(videoInfo.duration/(recipe.videoCorrection?.interval??5))+1]):t("Keep the app open during export.")}</small>}<a href={import.meta.env.BASE_URL+'licenses/README.txt'} target="_blank" rel="noreferrer">{t("Video toolkit licence")}</a></div>:<label>{t("File format")}<select aria-label={t("File format")} value={format} onChange={e=>setFormat(e.target.value as 'jpg'|'png')}><option value="jpg">{t("JPEG · High quality")}</option><option value="png">{t("PNG · Lossless")}</option></select></label>}<button className="icon-button" title={t("Save edit recipe")} aria-label={t("Save recipe")} onClick={()=>recipe&&download(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}),'clearwater-recipe.json')}><FileJson size={17}/></button><button className="icon-button" title={t("Load edit recipe")} aria-label={t("Load recipe")} onClick={()=>recipeInput.current?.click()}><Upload size={16}/></button></div>{!video&&<label className="metadata-option" title={t("Includes location when present in the imported file")}><input type="checkbox" checked={keepMetadata} onChange={e=>setKeepMetadata(e.target.checked)}/> {t("Keep EXIF/GPS metadata")}</label>}<div className="save-destination"><span title={outputFolder?.name??sourceFolder?.name}>{outputFolder?t("Output: {0}",[outputFolder.name]):sourceFolder?t("Source folder: {0}",[sourceFolder.name]):supportsFolder()?t("Output: source folder (choose on save)"):t("Output: Downloads")}</span>{supportsFolder()&&<><button className="text-button" onClick={selectOutputFolder}><FolderOpen size={12}/>{outputFolder?t("Change output folder"):t("Choose output folder")}</button>{outputFolder?<button className="text-button" onClick={()=>setOutputFolder(null)}>{t("Use source folder")}</button>:<button className="text-button" onClick={selectSourceFolder}>{sourceFolder?t("Change source folder"):t("Choose source folder")}</button>}</>}<button className="button secondary save-as" disabled={rendering} onClick={()=>exportPhoto(true)}><Download size={13}/>{supportsFolder()?t("Save as…"):video?t("Download restored video"):t("Download restored photo")}</button>{supportsFolder()&&!isAndroid()&&!outputFolder&&<button className="text-button" disabled={rendering} onClick={()=>exportPhoto(false,false,true)}>{t("Download instead")}</button>}<small>{photo?restoredName(photo.file.name,exportFormat,!outputFolder):'original-filename-restore.jpg'}</small>{!supportsFolder()&&<small>{t("Your browser chooses the download location and handles existing filenames.")}</small>}</div></div></details>
          </section>
        </fieldset>
        <a className="about-footer" href="#about">{t("About & guide")}</a>
      </aside>
    </main>
    {saveDialog&&<div className="modal-shade"><div className="export-dialog save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-title"><h2 id="save-title">{t("Save as")}</h2><label>{t("Filename")}<input aria-label={t("Export filename")} value={saveName} onChange={e=>setSaveName(e.target.value)}/></label><p>{outputFolder?t("Folder: {0}",[outputFolder.name]):sourceFolder?t("Source folder: {0}",[sourceFolder.name]):t("Choose a folder to save your restored file.")} {t("Existing names get a number.")}</p><button className="button primary" disabled={!saveName.trim()||exporting} onClick={()=>exportPhoto(true)}>{outputFolder||sourceFolder?t("Save copy"):t("Choose folder and save")}</button>{(outputFolder||sourceFolder)&&<button className="button secondary" disabled={exporting} onClick={()=>exportPhoto(true,true)}>{t("Choose another folder…")}</button>}<button className="button secondary" disabled={exporting} onClick={()=>setSaveDialog(false)}>{t("Cancel")}</button></div></div>}
    {customOpen&&<div className="modal-shade"><div className="export-dialog research-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-title"><h2 id="custom-title">{t("Load other ONNX model")}</h2><p>{t("Choose a self-contained RGB image-to-image model (up to 64 MB). This adapter supports one float32 NCHW input and output at 256 × 256. Other layouts, sizes, extra inputs and super-resolution models need a different adapter.")}</p><p>{t("Use the model’s documented colour ranges below. After validation, the model and ranges are kept on this device for later launches.")}</p>{recipe?.customModel&&<p>{t("Recipe model:")} {recipe.customModel.name}</p>}<label>{t("ONNX file")}<input aria-label={t("ONNX model file")} type="file" accept=".onnx" disabled={customLoading} onChange={e=>{const file=e.target.files?.[0]??null;if(file)modelSelectionStarted.current=true;setCustomCandidate(file);setCustomError('');}}/></label><div className="context-grid"><label>{t("Input range")}<select aria-label={t("Model input range")} value={inputRange} disabled={customLoading} onChange={e=>setInputRange(e.target.value as 'unit'|'signed')}><option value="unit">{t("0 to 1")}</option><option value="signed">{t("−1 to 1")}</option></select></label><label>{t("Output range")}<select aria-label={t("Model output range")} value={outputRange} disabled={customLoading} onChange={e=>setOutputRange(e.target.value as 'unit'|'signed')}><option value="unit">{t("0 to 1")}</option><option value="signed">{t("−1 to 1")}</option></select></label></div><label className="research-consent"><input type="checkbox" checked={customAccepted} disabled={customLoading} onChange={e=>setCustomAccepted(e.target.checked)}/> {t("I have permission to use this model and will follow its licence.")}</label>{customError&&<p className="model-error" role="alert">{message(customError)}</p>}<button className="button primary" disabled={!customAccepted||!customCandidate||customLoading} onClick={()=>{if(!customCandidate)return;setCustomError('');setCustomLoading(true);pendingModelBlob.current=customCandidate;pendingModelRestore.current=false;applyCustomModel.current=true;worker.current?.postMessage({type:'custom-model',gen:generation.current,permission:true,blob:customCandidate,name:customCandidate.name,inputRange,outputRange});}}>{customLoading?t("Validating model…"):t("Load model")}</button><button className="button secondary" disabled={customLoading} onClick={cancelCustom}>{t("Cancel")}</button></div></div>}
    {storageWarning&&<div className="storage-warning" role="status">{t("Local storage is unavailable or full. Export your edits before closing.")}<button aria-label={t("Dismiss storage warning")} onClick={()=>setStorageWarning(false)}><X size={14}/></button></div>}
    {notice&&<div className="toast" role="status"><span>{message(notice)}</span><button aria-label={t("Dismiss message")} onClick={()=>setNotice('')}><X size={15}/></button></div>}
    {exporting&&<div className="modal-shade"><div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title"><span className="brand-icon"><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt=""/></span><h2 id="export-title">{t("Exporting")} {video?t("video"):t("photo")}</h2><p>{saving?t("Saving your restored file…"):video?t("Processing video frames locally. Keep this app open."):t("Rendering your photo at the selected resolution.")}</p><progress max="100" value={progress}/><span>{progress}%</span><button className="button secondary" disabled={saving} onClick={cancelExport}>{t("Cancel export")}</button></div></div>}
  </div>{about&&<About onClose={closeAbout} customModel={customModel}/>}</>;
}


