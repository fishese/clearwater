import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Waves, Plus, Download, SlidersHorizontal, Sparkles, ArrowLeftRight, Undo2, Redo2, RotateCcw, Upload, ImagePlus, Check, ChevronDown, ChevronLeft, ChevronRight, FolderOpen, LockKeyhole, X, Pipette, LoaderCircle, FileJson, ZoomIn, ZoomOut, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { clamp, makeRecipe, parseRecipe, suggest } from './core/engine';
import { DEFAULT_MANUAL, type Analysis, type Adjustments, type Hints, type Recipe, type CustomModel } from './core/types';
import { deletePhoto, listPhotos, savePhoto, type StoredPhoto } from './storage';
import {supportsFolder,chooseFolder,restoredName,createUniqueFile,writeFile,type LocalDirectoryHandle} from './file-save';
import {isAndroid,receiveAndroidPhotos,openAndroidPhotoFolder,readAndroidFolderPhoto,type AndroidPhotoFolder} from './native';
import {activateWebUpdate} from './update';
import About from './About';
import {isVideo,supportedMedia,mediaLimit,videoTime,type VideoInfo} from './core/media';

interface Photo extends StoredPhoto { url:string; past:Recipe[]; future:Recipe[] }
type FolderBrowser=AndroidPhotoFolder&{index:number;loaded:Map<number,string>};
type Sample = { name:string; label:string };
const labelFor=(name:string)=>name.replace(/^IMG_\w+-/,'').replace(/\.[^.]+$/,'');
const clone=<T,>(x:T):T=>structuredClone(x);
function Range({label,value,onChange,onStart,min=-100,max=100,step=1,unit='',hint,vertical=false,displayValue}: {
  label:string;value:number;onChange:(v:number)=>void;onStart:()=>void;min?:number;max?:number;step?:number;unit?:string;hint?:string;vertical?:boolean;displayValue?:string
}) {
  const percent=(value-min)/(max-min)*100;
  return <label className={`range-field ${vertical?'vertical-range':''}`} title={hint}><span><span>{label}</span><output>{displayValue??`${value>0&&min<0?'+':''}${Number(value.toFixed(2))}${unit}`}</output></span>
    <input aria-label={label} aria-valuetext={displayValue} aria-orientation={vertical?'vertical':'horizontal'} type="range" min={min} max={max} step={step} value={value} style={{'--fill':`${percent}%`} as React.CSSProperties}
      onPointerDown={onStart} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))onStart();}} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
function RadioGroup<T extends string>({label,name,value,options,onChange}:{label:string;name:string;value:T;options:[T,string][];onChange:(value:T)=>void}) {
  return <fieldset className="radio-group"><legend>{label}</legend><div>{options.map(([key,text])=><label key={key}><input type="radio" name={name} value={key} checked={value===key} onChange={()=>onChange(key)}/><span>{text}</span></label>)}</div></fieldset>;
}
function download(blob:Blob,name:string){if(isAndroid()){void chooseFolder().then(async folder=>{const file=await createUniqueFile(folder,name);await writeFile(file.handle,blob);}).catch(error=>{if(error?.code!=='CANCELLED')window.alert('Could not save this file. Please choose a writable folder.');});return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}

const closeAbout=()=>{window.location.hash='';};
export default function App() {
  const [about,setAbout]=useState(()=>window.location.hash.startsWith('#about'));
  useEffect(()=>{const change=()=>setAbout(window.location.hash.startsWith('#about'));window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  const [updating,setUpdating]=useState(false);
  const [expanded,setExpanded]=useState(false),[adjustmentsOpen,setAdjustmentsOpen]=useState(false);
  useEffect(()=>{if(!expanded)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setExpanded(false);};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[expanded]);
  const [photos,setPhotos]=useState<Photo[]>([]),[active,setActive]=useState<string|null>(null);
  const [folderBrowser,setFolderBrowser]=useState<FolderBrowser|null>(null),[folderLoading,setFolderLoading]=useState(false);
  const folderRequest=useRef(0);
  const [samples,setSamples]=useState<Sample[]>([]),[analysis,setAnalysis]=useState<Analysis|null>(null);
  const [dimensions,setDimensions]=useState<[number,number]>([1,1]);
  const [videoInfo,setVideoInfo]=useState<VideoInfo|null>(null),[previewTime,setPreviewTime]=useState(0),[keepAudio,setKeepAudio]=useState(true);
  const [modelStatus,setModelStatus]=useState('');
  const [customOpen,setCustomOpen]=useState(false),[customModel,setCustomModel]=useState<CustomModel|null>(null),[customAccepted,setCustomAccepted]=useState(false),[customLoading,setCustomLoading]=useState(false),[customFile,setCustomFile]=useState<File|null>(null);
  const [inputRange,setInputRange]=useState<'unit'|'signed'>('unit'),[outputRange,setOutputRange]=useState<'unit'|'signed'>('unit'),[customError,setCustomError]=useState('');
  const [busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[storageWarning,setStorageWarning]=useState(false);
  const [compare,setCompare]=useState(true),[divider,setDivider]=useState(50),[showOriginal,setShowOriginal]=useState(false);
  const [exporting,setExporting]=useState(false),[progress,setProgress]=useState(0),[format,setFormat]=useState<'jpg'|'png'>('jpg');
  const [outputFolder,setOutputFolder]=useState<LocalDirectoryHandle|null>(null),[saving,setSaving]=useState(false);
  const [sourceFolders,setSourceFolders]=useState<Map<string,LocalDirectoryHandle>>(()=>new Map());
  const [saveDialog,setSaveDialog]=useState(false),[saveName,setSaveName]=useState('');
  const exportTarget=useRef<{name:string;folder?:LocalDirectoryHandle}|null>(null);
  const [eyedropper,setEyedropper]=useState(false),[zoom,setZoom]=useState(1);
  const [stageSize,setStageSize]=useState({width:700,height:600}),[ready,setReady]=useState(false),[sampleBusy,setSampleBusy]=useState(false),[rendering,setRendering]=useState(false);
  const originalCanvas=useRef<HTMLCanvasElement>(null),editedCanvas=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null);
  const importInput=useRef<HTMLInputElement>(null),recipeInput=useRef<HTMLInputElement>(null);
  const worker=useRef<Worker|null>(null),generation=useRef(0),request=useRef(0),latest=useRef(0),exportRequest=useRef(0);
  const photoProcessor=useRef<Worker|null>(null),videoProcessor=useRef<Worker|null>(null);
  const photoRef=useRef<Photo[]>([]),activeRef=useRef<string|null>(null),initialized=useRef(false),pendingBitmap=useRef<ImageBitmap|null>(null);
  photoRef.current=photos;activeRef.current=active;
  const photo=photos.find(p=>p.id===active),recipe=photo?.recipe;
  const video=!!photo&&isVideo(photo.file),exportFormat=video?'mp4':format;
  const photoIndex=folderBrowser?folderBrowser.index:photos.findIndex(p=>p.id===active);
  const photoCount=folderBrowser?folderBrowser.photos.length:photos.length;
  const sourceFolder=active?sourceFolders.get(active):undefined;
  const canEdit=!!recipe && ready && !busy && !exporting && !folderLoading;
  const aspect=dimensions[0]/dimensions[1];
  const fitWidth=Math.min(stageSize.width-48,(stageSize.height-48)*aspect);
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
        id=addFiles([file],true)[0];if(!id)throw new Error('This file could not be opened.');folder.loaded.set(index,id);
      }else {setReady(false);setActive(id);}
      const photoId=id;setSourceFolders(previous=>new Map(previous).set(photoId,folder.directory));
      setFolderBrowser({...folder,index});
    }catch(error){if(token===folderRequest.current){setFolderBrowser({...folder,index});setReady(false);setActive(null);notify(error instanceof Error?error.message:'Could not open this file. Use Next or Previous to continue.');}}
    finally{if(token===folderRequest.current)setFolderLoading(false);}
  }
  async function openPhotoFolder(){
    if(folderLoading||busy||exporting||customOpen)return;
    const token=++folderRequest.current;setFolderLoading(true);
    try{const folder=await openAndroidPhotoFolder();if(token!==folderRequest.current)return;if(!folder.photos.length){notify('No supported files were found. Photo limit: 60 MB; MP4/MOV limit: 512 MB.');return;}await browseFolderPhoto({...folder,index:0,loaded:new Map()},0);}
    catch(error){if(token===folderRequest.current&&!(error instanceof DOMException&&error.name==='AbortError'))notify(error instanceof Error?error.message:'Could not open this folder.');}
    finally{if(token===folderRequest.current)setFolderLoading(false);}
  }
  async function selectOutputFolder(){try{setOutputFolder(await chooseFolder());}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))notify('Could not open the output folder. You can still download or use Save as.');}}
  async function rememberSourceFolder(folder:LocalDirectoryHandle){
    const matches: string[]=[];
    for(const p of photos){try{const handle=await folder.getFileHandle(p.file.name);const size=handle.size??(await handle.getFile?.())?.size;if(size===undefined||size===p.file.size)matches.push(p.id);}catch{}}
    if(!active||!matches.includes(active))throw new Error('Choose the folder containing the original file.');
    setSourceFolders(previous=>{const next=new Map(previous);matches.forEach(id=>next.set(id,folder));return next;});
    return folder;
  }
  async function selectSourceFolder(){try{await rememberSourceFolder(await chooseFolder());}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))notify(error instanceof Error?error.message:'Could not select the source folder.');}}
  async function finishExport(blob:Blob){
    const target=exportTarget.current;if(!target)return;
    setSaving(true);
    try {
      if(target.folder){const file=await createUniqueFile(target.folder,target.name);await writeFile(file.handle,blob);target.name=file.name;}
      else download(blob,target.name);
      notify(target.folder?`Saved ${target.name}.`:`Downloaded ${target.name}.`);
    }catch{if(isAndroid())notify('Could not save to this folder. Choose another output folder and try again.');else{download(blob,target.name);notify('Could not save to the chosen destination. Downloaded the restored file instead.');}}
    finally{exportTarget.current=null;setSaving(false);setExporting(false);setProgress(100);}
  }
  async function updateApp(){
    if(updating||exporting||saving)return;setUpdating(true);
    try{
      const saveCurrent=async()=>{const current=photoRef.current.find(p=>p.id===activeRef.current);if(current){const {id,file,recipe,thumbnail,addedAt}=current;await savePhoto({id,file,recipe,thumbnail,addedAt});}};await saveCurrent();
      if(import.meta.env.DEV){location.reload();return;}
      if(await activateWebUpdate(import.meta.env.BASE_URL)){await saveCurrent();location.reload();}else notify('You already have the latest version.');
    }catch(error){notify(error instanceof Error?error.message:'Could not update. Your files and edits have been kept.');}
    finally{setUpdating(false);}
  }
  function update(fn:(r:Recipe)=>Recipe,record=true) {
    setPhotos(all=>all.map(p=>p.id!==active||!p.recipe?p:{...p,recipe:fn(clone(p.recipe)),past:record?[...p.past.slice(-59),clone(p.recipe)]:p.past,future:[]}));
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
    if(valid.length!==files.length)notify('Choose JPEG, PNG, HEIC, HEIF, MP4 or MOV files.');
    const accepted=valid.filter(f=>f.size<=mediaLimit(f));
    if(accepted.length!==valid.length)notify('Files over the size limit were skipped: 60 MB for photos, 512 MB for videos.');
    const addedAt=Date.now();
    const items:Photo[]=accepted.map((file,i)=>({id:crypto.randomUUID(),file,addedAt:addedAt+i/1000,url:URL.createObjectURL(file),past:[],future:[]}));
    if(items.length){if(!fromFolder){folderRequest.current++;setFolderLoading(false);setFolderBrowser(null);}setReady(false);setPhotos(all=>[...all,...items]);setActive(items[0].id);items.forEach(persist);}
    return items.map(item=>item.id);
  }
  useEffect(()=>{if(!isAndroid())return;let dispose:(()=>void)|undefined,cancelled=false;receiveAndroidPhotos(addFiles,notify).then(cleanup=>{if(cancelled)cleanup();else dispose=cleanup;}).catch(()=>notify('Could not enable Android file sharing.'));return()=>{cancelled=true;dispose?.();};},[]);
  useEffect(()=>{
    if(initialized.current)return;initialized.current=true;
    listPhotos().then(items=>{setPhotos(all=>[...items.map(p=>({...p,url:URL.createObjectURL(p.file),past:[],future:[]})),...all]);if(items.length){const shared=new URLSearchParams(location.search).get('shared');setActive(current=>current??items.find(p=>p.id===shared)?.id??items[0].id);}}).catch(()=>setStorageWarning(true));
    if(import.meta.env.DEV) fetch('/__samples').then(r=>r.json()).then((names:string[])=>setSamples(names.map(name=>({name,label:labelFor(name)})))).catch(()=>{});
    const receive=(event:MessageEvent)=>{if(event.data?.type!=='shared-photos')return;listPhotos().then(items=>{const ids=new Set(photoRef.current.map(p=>p.id)),added=items.filter(p=>!ids.has(p.id));setPhotos(all=>[...all,...added.map(p=>({...p,url:URL.createObjectURL(p.file),past:[],future:[]}))]);if(event.data.id&&items.some(p=>p.id===event.data.id))setActive(event.data.id);}).catch(()=>setStorageWarning(true));};
    navigator.serviceWorker?.addEventListener('message',receive);
    return ()=>navigator.serviceWorker?.removeEventListener('message',receive);
  },[]);
  useEffect(()=>{
    const w=new Worker(new URL('./processor.worker.ts',import.meta.url),{type:'module'}),v=new Worker(new URL('./video.worker.ts',import.meta.url),{type:'module'});worker.current=w;photoProcessor.current=w;videoProcessor.current=v;
    const receive=({data}:MessageEvent)=>{
      if(data.gen!==generation.current){data.bitmap?.close();data.original?.close();return;}
      if(data.type==='loaded') {
        setAnalysis(data.analysis);setDimensions([data.width,data.height]);setVideoInfo(data.video??null);setBusy('');setReady(true);setZoom(1);
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
        if(data.request===latest.current){if(data.analysis)setAnalysis(data.analysis);const c=editedCanvas.current;if(c){c.width=data.bitmap.width;c.height=data.bitmap.height;c.getContext('2d')!.drawImage(data.bitmap,0,0);c.dataset.generation=String(data.gen);}if(data.original&&originalCanvas.current){const o=originalCanvas.current;o.width=data.original.width;o.height=data.original.height;o.getContext('2d')!.drawImage(data.original,0,0);}setRendering(false);setModelStatus('');}
        data.original?.close();
        data.bitmap.close();
      } else if(data.type==='custom-ready') {setCustomModel(data.config);setCustomLoading(false);setCustomOpen(false);}
      else if(data.type==='model-status'&&data.request===latest.current) setModelStatus(data.message);
      else if(data.type==='progress'&&data.request===exportRequest.current) setProgress(data.progress);
      else if(data.type==='exported'&&data.request===exportRequest.current) {
        void finishExport(data.blob);
      } else if(data.type==='error') {
        if(data.operation==='custom-model'){setCustomLoading(false);setCustomError(data.message);return;}
        if(data.operation==='render'&&data.request!==latest.current)return;
        setModelStatus('');
        setBusy('');setExporting(false);setRendering(false);
        if(data.operation==='load')setReady(false);
        notify(data.message);
      }
    };
    w.onmessage=receive;v.onmessage=receive;
    const fail=()=>{setBusy('');setExporting(false);setReady(false);notify('The processing worker stopped. Reopen the file, or refresh and try a smaller file.');};w.onerror=fail;v.onerror=fail;
    return ()=>{w.terminate();v.terminate();worker.current=null;photoProcessor.current=null;videoProcessor.current=null;pendingBitmap.current?.close();};
  },[]);
  useEffect(()=>{
    if(!active)return;
    const p=photoRef.current.find(p=>p.id===active);if(!p)return;
    const clip=isVideo(p.file);worker.current=clip?videoProcessor.current:photoProcessor.current;
    generation.current++;setVideoInfo(null);setPreviewTime(0);setKeepAudio(true);setModelStatus('');setReady(false);setRendering(true);setAnalysis(null);setBusy(clip?'Opening video…':/\.hei[cf]$/i.test(p.file.name)?'Decoding HEIC locally…':'Opening photo…');setEyedropper(false);
    (clip?photoProcessor.current:videoProcessor.current)?.postMessage({type:'unload',gen:generation.current});
    if(customFile&&customModel)worker.current?.postMessage({type:'custom-model',gen:generation.current,permission:true,blob:customFile,inputRange:customModel.inputRange,outputRange:customModel.outputRange,silent:true});
    worker.current?.postMessage({type:'load',gen:generation.current,blob:p.file});
    return ()=>{const previous=photoRef.current.find(item=>item.id===active);if(previous?.recipe)persist(previous);};
  },[active]);
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
    if(customModel&&analysis){update(r=>({...r,engine:'wave',customModel,auto:suggest(analysis,r.hints,'wave')}));setCustomOpen(false);}
  },[customModel]);
  useEffect(()=>{if(!photo?.recipe)return;const timer=setTimeout(()=>persist(photo),400);return ()=>clearTimeout(timer);},[photo?.recipe,photo?.thumbnail]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6500);return ()=>clearTimeout(timer);},[notice]);
  useEffect(()=>{if(!stage.current)return;const observer=new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;setStageSize({width,height});});observer.observe(stage.current);return ()=>observer.disconnect();},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!['INPUT','SELECT','TEXTAREA'].includes((e.target as HTMLElement).tagName)){e.preventDefault();if(canEdit)history(e.shiftKey?'redo':'undo');}};window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey);},[active,canEdit]);
  async function sample(name:string){
    if(exporting||sampleBusy)return;setSampleBusy(true);
    try{const response=await fetch('/__sample/'+encodeURIComponent(name));if(!response.ok)throw new Error('Sample unavailable.');const blob=await response.blob();addFiles([new File([blob],name,{type:blob.type})]);}
    catch{notify('Could not open this local sample. Use Open files instead.');}finally{setSampleBusy(false);}
  }
  function reset(){if(analysis)update(()=>makeRecipe(analysis));setEyedropper(false);}
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
      exportRequest.current=++request.current;worker.current?.postMessage({type:'export',gen:generation.current,request:exportRequest.current,recipe,format:exportFormat,keepAudio});
    }catch(error){setExporting(false);if(!(error instanceof DOMException&&error.name==='AbortError'))notify(error instanceof Error?error.message:'Could not open the save folder.');}
  }
  function cancelExport(){if(saving)return;generation.current++;exportTarget.current=null;worker.current?.postMessage({type:'cancel',gen:generation.current});setExporting(false);notify('Export cancelled.');}
  function pickNeutral(e:ReactPointerEvent<HTMLDivElement>){
    if(!eyedropper||!canEdit||!editedCanvas.current)return;
    const c=editedCanvas.current,rect=e.currentTarget.getBoundingClientRect();
    const x=clamp(Math.floor((e.clientX-rect.left)/rect.width*c.width),0,c.width-1),y=clamp(Math.floor((e.clientY-rect.top)/rect.height*c.height),0,c.height-1);
    const pixel=c.getContext('2d')!.getImageData(Math.max(0,x-1),Math.max(0,y-1),Math.min(3,c.width-x),Math.min(3,c.height-y)).data;
    const rgb=[0,0,0];for(let i=0;i<pixel.length;i+=4){rgb[0]+=pixel[i];rgb[1]+=pixel[i+1];rgb[2]+=pixel[i+2];}rgb.forEach((_,i)=>rgb[i]/=pixel.length/4);
    if(Math.min(...rgb)<12||Math.max(...rgb)>245){notify('Choose a midtone white or grey area, away from deep shadows and bright highlights.');return;}
    const target=(rgb[0]+rgb[1]+rgb[2])/3;
    update(r=>({...r,manual:{...r.manual,neutral:r.manual.neutral.map((v,i)=>clamp(v*target/rgb[i],.25,4)) as [number,number,number]}}));
    setEyedropper(false);notify('Neutral point applied. Undo if the selected area was not white or grey.');
  }
  async function readRecipe(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];e.target.value='';if(!file)return;try{if(file.size>20000)throw new Error('Recipe file is too large.');const next=parseRecipe(JSON.parse(await file.text()));update(()=>next);notify('Recipe applied.');}catch(err){notify(err instanceof Error?err.message:'Could not read the recipe.');}}
  async function removePhoto(p:Photo){if(exporting||folderLoading)return;if(folderBrowser)setFolderBrowser(null);await deletePhoto(p.id).catch(()=>setStorageWarning(true));URL.revokeObjectURL(p.url);setPhotos(all=>all.filter(x=>x.id!==p.id));if(p.id===active){setActive(photos.find(x=>x.id!==p.id)?.id??null);setReady(false);}}
  return <><div hidden={about} className={`app-shell ${expanded?'expanded-photo':''} ${adjustmentsOpen?'adjustments-open':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!exporting&&!folderLoading)addFiles(Array.from(e.dataTransfer.files));}}>
    <header className="topbar"><div className="brand-cluster"><a className="brand" href={import.meta.env.BASE_URL} aria-label="ClearWater home"><span className="brand-icon"><Waves size={23}/></span><span>clearwater<span className="brand-dot">.</span></span></a>{!isAndroid()&&<button className="app-update" aria-label="Update app" title="Check for updates and reload" disabled={updating||exporting||saving||customLoading||folderLoading} onClick={updateApp}><RefreshCw size={12} className={updating?'spin':undefined}/></button>}</div><a className="edition about-nav" href="#about">About &amp; guide</a>
      <div className="top-actions"><span className="private-note"><LockKeyhole size={12}/> Stays on your device</span><button className="button secondary" disabled={exporting||folderLoading} onClick={()=>importInput.current?.click()}><Plus size={16}/> Open files</button>{isAndroid()&&<button className="button secondary" aria-label="Open folder" title="Open folder" disabled={!!busy||exporting||folderLoading||customOpen} onClick={openPhotoFolder}><FolderOpen size={16}/> Open folder</button>}<button className="button primary" disabled={!canEdit||rendering} onClick={()=>exportPhoto()}><Download size={16}/>{video?'Export video':'Export photo'}</button></div></header>
    <input ref={importInput} className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,video/mp4,video/quicktime,.heic,.heif,.mp4,.mov" aria-label="Choose photos" onChange={e=>{addFiles(Array.from(e.target.files??[]));e.target.value='';}}/>
    <input ref={recipeInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Choose recipe" onChange={readRecipe}/>
    <main className="studio">
      <aside className="library"><div className="section-title"><span>YOUR PHOTOS</span><span className="count">{photos.length.toString().padStart(2,'0')}</span></div>
        <button className="import-tile" disabled={exporting||folderLoading} onClick={()=>importInput.current?.click()}><ImagePlus size={22}/><span>Add to your collection</span><small>Photos · MP4 · MOV</small></button>
        <div className="photo-grid">{photos.map(p=><div className={`photo-tile ${p.id===active?'selected':''}`} key={p.id}><button className="photo-select" disabled={exporting||folderLoading||busy!==''} onClick={()=>selectPhoto(p.id)} title={p.file.name}><img src={p.thumbnail??p.url} alt={p.file.name} onLoad={e=>{e.currentTarget.style.visibility='visible';}} onError={e=>{e.currentTarget.style.visibility='hidden';}}/>{p.id===active&&<span className="selected-check"><Check size={12}/></span>}<span>{p.file.name.replace(/\.[^.]+$/,'')}</span></button><button className="remove-photo" disabled={exporting} title="Remove local copy" aria-label={`Remove ${p.file.name}`} onClick={()=>removePhoto(p)}><X size={12}/></button></div>)}</div>
        {samples.length>0&&<><div className="section-title sample-heading"><span>YOUR DIVE SAMPLES</span><span className="count">09</span></div><div className="sample-list">{samples.map((s,i)=><button key={s.name} disabled={exporting||sampleBusy||busy!==''} onClick={()=>sample(s.name)}><img src={'/__thumb/'+encodeURIComponent(s.name)} alt=""/><span><strong>{s.label}</strong><small>Dive study {String(i+1).padStart(2,'0')}</small></span><Plus size={13}/></button>)}</div></>}
      </aside>
      <section className="workspace">
        {folderBrowser&&<div className="folder-browser"><FolderOpen size={12}/><span title={folderBrowser.name}>{folderBrowser.name}</span><button disabled={folderLoading||exporting||!!busy} aria-label="Close folder browser" title="Return to imported photos" onClick={()=>setFolderBrowser(null)}><X size={13}/></button></div>}
        <div className="canvas-toolbar"><div className="photo-navigation"><button aria-label="Previous photo" title="Previous photo" disabled={photoIndex<=0||!!busy||exporting||customOpen||folderLoading} onClick={()=>navigatePhoto(-1)}><ChevronLeft size={16}/></button><span aria-label="Photo position">{photoIndex<0?'0 / 0':`${photoIndex+1} / ${photoCount}`}</span><button aria-label="Next photo" title="Next photo" disabled={photoIndex<0||photoIndex>=photoCount-1||!!busy||exporting||customOpen||folderLoading} onClick={()=>navigatePhoto(1)}><ChevronRight size={16}/></button></div><div className="filename"><span className="file-dot"/>{photo?.file.name??'No photo selected'}</div><div className="canvas-tools"><button disabled={!photo} aria-label={expanded?"Exit expanded view":"Expand photo"} title={expanded?"Exit expanded view (Esc)":"Expand photo"} aria-pressed={expanded} onClick={()=>{setExpanded(!expanded);setAdjustmentsOpen(false);}}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button><button disabled={!canEdit||!photo?.past.length} aria-label="Undo" title="Undo (Ctrl+Z)" onClick={()=>history('undo')}><Undo2 size={16}/></button><button disabled={!canEdit||!photo?.future.length} aria-label="Redo" title="Redo" onClick={()=>history('redo')}><Redo2 size={16}/></button><span className="tool-separator"/><button className={compare?'active':''} disabled={!ready} onClick={()=>{setCompare(!compare);setEyedropper(false);}} title="Before / after comparison" aria-label="Toggle comparison"><ArrowLeftRight size={16}/></button><button className={eyedropper?'active':''} disabled={!canEdit} onClick={()=>{setEyedropper(!eyedropper);setCompare(false);}} title="Pick a white or grey point" aria-label="Pick neutral point"><Pipette size={16}/></button></div></div>
        <div className={`stage ${eyedropper?'picking':''}`} ref={stage}>
          {!photo&&<div className="empty-state"><h1>Photo & video editor</h1><p>Open a photo, MP4 or MOV to start.</p><button className="button primary" onClick={()=>importInput.current?.click()}><Upload size={16}/> Choose a photo or video</button><small>Or drop photos anywhere in the studio</small></div>}
          {photo&&<div className="image-frame" onPointerDown={pickNeutral} style={{width:Math.max(1,fitWidth)*zoom,height:Math.max(1,fitWidth)/aspect*zoom,visibility:ready?'visible':'hidden'}}>
            <canvas ref={editedCanvas} aria-label="Edited photo"/><canvas ref={originalCanvas} className="original-canvas" aria-label="Original photo" style={{clipPath:showOriginal?'none':compare?`inset(0 ${100-divider}% 0 0)`:'inset(0 100% 0 0)'}}/>
            {compare&&!showOriginal&&<><span className="image-label before">ORIGINAL</span><span className="image-label after">RESTORED</span><div className="divider-line" style={{left:`${divider}%`}}><span><ArrowLeftRight size={16}/></span></div><input className="comparison-input" aria-label="Before and after divider" type="range" min="0" max="100" value={divider} onChange={e=>setDivider(Number(e.target.value))}/></>}
            {eyedropper&&<span className="picker-hint">Click a white or grey area</span>}
          </div>}
          {(busy||folderLoading)&&<div className="processing-overlay" role="status"><LoaderCircle className="spin" size={25}/><span>{folderLoading?'Opening folder file…':busy}</span><small>Your file stays on this device.</small></div>}
        </div>
        {video&&videoInfo&&<div className="video-timeline"><label><span>Frame preview <output>{videoTime(previewTime)} / {videoTime(videoInfo.duration)}</output></span><input aria-label="Video position" type="range" min={0} max={Math.max(0,videoInfo.duration-.001)} step={.04} value={previewTime} disabled={!ready||exporting} onChange={e=>setPreviewTime(Number(e.target.value))}/></label><small>{videoInfo.codec.toUpperCase()} · {videoInfo.outputWidth} × {videoInfo.outputHeight} MP4 export · up to {Math.round(videoInfo.frameRate)} fps</small></div>}
        <div className="workspace-bottom"><span>{ready?`${dimensions[0]} × ${dimensions[1]} · ${(dimensions[0]*dimensions[1]/1e6).toFixed(1)} MP`:'No photo selected'}</span><div><button disabled={!ready} onPointerDown={()=>setShowOriginal(true)} onPointerUp={()=>setShowOriginal(false)} onPointerLeave={()=>setShowOriginal(false)} onKeyDown={e=>{if(e.key===' ')setShowOriginal(true);}} onKeyUp={()=>setShowOriginal(false)}>Hold for original</button><span className="tool-separator"/><button disabled={!ready} aria-label="Zoom out" onClick={()=>setZoom(z=>Math.max(1,z-.5))}><ZoomOut size={15}/></button><button disabled={!ready} onClick={()=>setZoom(1)}>{zoom===1?'Fit':`${Math.round(zoom*100)}%`}</button><button disabled={!ready} aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(3,z+.5))}><ZoomIn size={15}/></button></div></div>
      </section>
      <aside className="controls compact-controls"><div className="controls-top"><SlidersHorizontal size={16}/><span className="adjustments-label">Adjustments</span><button className="adjustments-toggle" aria-label="Toggle adjustments" aria-expanded={adjustmentsOpen} aria-controls="adjustment-settings" onClick={()=>setAdjustmentsOpen(!adjustmentsOpen)}><SlidersHorizontal size={15}/> Adjustments <ChevronDown size={14}/></button><button disabled={!canEdit} onClick={reset} title="Reset all edits" aria-label="Reset all edits"><RotateCcw size={15}/></button></div>
        <fieldset id="adjustment-settings" className="control-body" disabled={!canEdit}>
          <details className="settings-group"><summary>Correction Engine <ChevronDown size={14}/></summary><div className="group-content engine-details"><select aria-label="Correction engine" value={recipe?.engine??'balanced'} onChange={e=>{if(e.target.value==='wave'&&!customModel){setCustomError('');setCustomOpen(true);return;}if(analysis)update(r=>({...r,engine:e.target.value as Recipe['engine'],...(e.target.value==='wave'&&customModel?{customModel}:{}),auto:suggest(analysis,r.hints,e.target.value as Recipe['engine'])}));}}><option value="balanced">Balanced restoration</option><option value="baseline">Original RGB heuristic</option><option value="shallow">Shallow-UWnet · AI</option><option value="funie">FUnIE-GAN · AI</option><option value="wave">{customModel?customModel.name:'Load other ONNX model…'}</option></select>{video&&recipe&&['shallow','funie','wave'].includes(recipe.engine)&&<div className="video-ai-options"><label>Video correction<select aria-label="Video correction" value={recipe.videoCorrection?.mode??'sampled'} onChange={e=>update(r=>({...r,videoCorrection:{mode:e.target.value as 'sampled'|'fixed',interval:r.videoCorrection?.interval??5,referenceTime:previewTime}}))}><option value="sampled">Sampled AI colour</option><option value="fixed">Fixed selected frame</option></select></label>{(recipe.videoCorrection?.mode??'sampled')==='sampled'?<label>Sample every<select aria-label="AI sample interval" value={recipe.videoCorrection?.interval??5} onChange={e=>update(r=>({...r,videoCorrection:{mode:'sampled',interval:Number(e.target.value) as 2|5|10,referenceTime:r.videoCorrection?.referenceTime??0}}))}><option value="2">2 seconds · more analysis</option><option value="5">5 seconds</option><option value="10">10 seconds · less analysis</option></select></label>:<button className="text-button" onClick={()=>update(r=>({...r,videoCorrection:{mode:'fixed',interval:r.videoCorrection?.interval??5,referenceTime:previewTime}}))}>Use current frame ({videoTime(previewTime)})</button>}<small>{(recipe.videoCorrection?.mode??'sampled')==='fixed'?`One AI colour correction from ${videoTime(recipe.videoCorrection?.referenceTime??0)} for the entire clip.`:'Colour blends between samples; checks at sample points help avoid blending different scenes. Export analyses the remaining samples first.'} This approximates AI colour, not local dehazing or denoising.</small></div>}{customModel&&<button className="text-button" onClick={()=>{setCustomError('');setCustomOpen(true);}}>Load another ONNX model</button>}{modelStatus&&<p role="status"><LoaderCircle className="spin" size={12}/> {modelStatus}</p>}<p>{video?'AI estimates global colour from sampled frames. Balanced and RGB use one edit across the clip.':'AI colour correction runs locally. Strength and manual edits still apply; dive hints affect Balanced restoration.'}</p></div></details>
          <details className="settings-group" open><summary>Restoration <ChevronDown size={14}/></summary><div className="group-content">
            <div className="restoration-row"><Range label="Restoration strength" value={Math.round((recipe?.strength??.8)*100)} min={0} max={100} unit="%" onStart={checkpoint} onChange={v=>update(r=>({...r,strength:v/100}),false)}/><button className="button primary auto-button" onClick={()=>{if(analysis)update(r=>({...r,auto:suggest(analysis,r.hints,r.engine),strength:.8,manual:clone(DEFAULT_MANUAL),...(video?{videoCorrection:{...(r.videoCorrection??{mode:'sampled' as const,interval:5 as const}),referenceTime:previewTime}}:{})}));}}><Sparkles size={12}/> Auto restore</button></div>
            {recipe&&<details className="analysis-note"><summary>Analysis <ChevronDown size={12}/></summary><p className="suggestion">{recipe.auto.explanation}</p></details>}
          </div></details>
          <details className="settings-group"><summary>Dive conditions <ChevronDown size={14}/></summary><div className="group-content dive-options">
            <RadioGroup label="Environment" name="environment" value={recipe?.hints.scene??'auto'} options={[['auto','Auto'],['underwater','Diving'],['surface','Surface']]} onChange={scene=>hints({scene})}/>
            <RadioGroup label="Red filter" name="red-filter" value={recipe?.hints.filter??'auto'} options={[['auto','Auto'],['yes','Yes'],['no','No']]} onChange={filter=>hints({filter})}/>
            <RadioGroup label="Water colour" name="water-colour" value={recipe?.hints.water??'auto'} options={[['auto','Auto'],['blue','Blue'],['green','Green']]} onChange={water=>hints({water})}/>
            <div className="depth-control"><Range label="Approx. depth" value={recipe?.hints.depth??0} min={0} max={100} unit=" m" displayValue={recipe?.hints.depth==null?'Not sure':`${recipe.hints.depth} m`} onStart={checkpoint} onChange={depth=>hints({depth},false)}/><button className="text-button" disabled={recipe?.hints.depth==null} onClick={()=>hints({depth:null})}>Not sure</button></div>
          </div></details>
          <details className="settings-group" open><summary>Colour <ChevronDown size={14}/></summary><div className="group-content">
            <div className="fader-grid">{(['warmth','tint','red','vibrance'] as const).map(k=><Range vertical key={k} label={{warmth:'Warmth',tint:'Green / magenta',red:'Red correction',vibrance:'Vibrance'}[k]} value={recipe?.manual[k]??0} onStart={checkpoint} onChange={v=>manual(k,v)}/>)}</div>
            <button className={`neutral-button ${eyedropper?'active':''}`} onClick={()=>{setEyedropper(!eyedropper);setCompare(false);}}><Pipette size={13}/>{eyedropper?'Cancel picker':'Pick neutral point'}</button>
          </div></details>
          <details className="settings-group" open><summary>Light <ChevronDown size={14}/></summary><div className="group-content"><div className="fader-grid">
            <Range vertical label="Exposure" value={recipe?.manual.exposure??0} min={-2} max={2} step={.05} unit=" EV" onStart={checkpoint} onChange={v=>manual('exposure',v)}/>
            {(['highlights','shadows'] as const).map(k=><Range vertical key={k} label={{highlights:'Highlights',shadows:'Shadows'}[k]} value={recipe?.manual[k]??0} onStart={checkpoint} onChange={v=>manual(k,v)}/>)}</div>
          </div></details>
          <details className="settings-group"><summary>Clarity <ChevronDown size={14}/></summary><div className="group-content"><div className="fader-grid">
            {(['contrast','haze'] as const).map(k=><Range vertical key={k} label={{contrast:'Contrast',haze:'Haze reduction'}[k]} value={recipe?.manual[k]??0} onStart={checkpoint} onChange={v=>manual(k,v)}/>)}</div>
          </div></details>
          <div className="manual-actions"><button className="text-button" onClick={()=>update(r=>({...r,manual:clone(DEFAULT_MANUAL)}))}><RotateCcw size={12}/> Reset manual edits</button></div>

          <details className="settings-group" open><summary>Export <span className="summary-meta">{video?'MP4 · up to 1080p':'Full resolution'}</span><ChevronDown size={14}/></summary><div className="group-content export-section"><div className="export-options">{video?<div className="video-export-options"><span>MP4 · H.264 · SDR</span><label><input type="checkbox" aria-label="Keep audio" checked={keepAudio} disabled={!videoInfo?.hasAudio} onChange={e=>setKeepAudio(e.target.checked)}/> Keep audio{videoInfo&&!videoInfo.hasAudio?' (no audio track)':''}</label><small>Up to 10 minutes / 512 MB input. Export up to 1080p and 30 fps. Audio is kept when supported. Longer clips use a lower bitrate.</small>{videoInfo&&(videoInfo.duration>=120||(photo?.file.size??0)>=100*1024*1024)&&<small className="video-cost-note">Large/long clip: processing can take several minutes. {recipe&&['shallow','funie','wave'].includes(recipe.engine)&&(recipe.videoCorrection?.mode??'sampled')==='sampled'?`About ${Math.ceil(videoInfo.duration/(recipe.videoCorrection?.interval??5))+1} AI samples. A 10-second interval or Fixed selected frame reduces analysis.`:'Keep the app open during export.'}</small>}<a href={import.meta.env.BASE_URL+'licenses/README.txt'} target="_blank" rel="noreferrer">Video toolkit licence</a></div>:<label>File format<select aria-label="File format" value={format} onChange={e=>setFormat(e.target.value as 'jpg'|'png')}><option value="jpg">JPEG · High quality</option><option value="png">PNG · Lossless</option></select></label>}<button className="icon-button" title="Save edit recipe" aria-label="Save recipe" onClick={()=>recipe&&download(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}),'clearwater-recipe.json')}><FileJson size={17}/></button><button className="icon-button" title="Load edit recipe" aria-label="Load recipe" onClick={()=>recipeInput.current?.click()}><Upload size={16}/></button></div><div className="save-destination"><span title={outputFolder?.name??sourceFolder?.name}>{outputFolder?`Output: ${outputFolder.name}`:sourceFolder?`Source folder: ${sourceFolder.name}`:supportsFolder()?'Output: source folder (choose on save)':'Output: Downloads'}</span>{supportsFolder()&&<><button className="text-button" onClick={selectOutputFolder}><FolderOpen size={12}/>{outputFolder?'Change output folder':'Choose output folder'}</button>{outputFolder?<button className="text-button" onClick={()=>setOutputFolder(null)}>Use source folder</button>:<button className="text-button" onClick={selectSourceFolder}>{sourceFolder?'Change source folder':'Choose source folder'}</button>}</>}<button className="button secondary save-as" disabled={rendering} onClick={()=>exportPhoto(true)}><Download size={13}/>{supportsFolder()?'Save as…':video?'Download restored video':'Download restored photo'}</button>{supportsFolder()&&!isAndroid()&&!outputFolder&&<button className="text-button" disabled={rendering} onClick={()=>exportPhoto(false,false,true)}>Download instead</button>}<small>{photo?restoredName(photo.file.name,exportFormat,!outputFolder):'original-filename-restore.jpg'}</small>{!supportsFolder()&&<small>Your browser chooses the download location and handles existing filenames.</small>}</div></div></details>
        </fieldset>
        <a className="about-footer" href="#about">About &amp; guide</a>
      </aside>
    </main>
    {saveDialog&&<div className="modal-shade"><div className="export-dialog save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-title"><h2 id="save-title">Save as</h2><label>Filename<input autoFocus aria-label="Export filename" value={saveName} onChange={e=>setSaveName(e.target.value)}/></label><p>{outputFolder?`Folder: ${outputFolder.name}`:sourceFolder?`Source folder: ${sourceFolder.name}`:'Choose a folder to save your restored file.'} Existing names get a number.</p><button className="button primary" disabled={!saveName.trim()||exporting} onClick={()=>exportPhoto(true)}>{outputFolder||sourceFolder?'Save copy':'Choose folder and save'}</button>{(outputFolder||sourceFolder)&&<button className="button secondary" disabled={exporting} onClick={()=>exportPhoto(true,true)}>Choose another folder…</button>}<button className="button secondary" disabled={exporting} onClick={()=>setSaveDialog(false)}>Cancel</button></div></div>}
    {customOpen&&<div className="modal-shade"><div className="export-dialog research-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-title"><h2 id="custom-title">Load other ONNX model</h2><p>Choose a self-contained RGB image-to-image model (up to 64 MB). This adapter supports one float32 NCHW input and output at 256 × 256. Other layouts, sizes, extra inputs and super-resolution models need a different adapter.</p><p>Use the model’s documented colour ranges below. Your file stays on this device and must be loaded again after a reload.</p>{recipe?.customModel&&<p>Recipe model: {recipe.customModel.name}</p>}<label>ONNX file<input aria-label="ONNX model file" type="file" accept=".onnx" disabled={customLoading} onChange={e=>{setCustomFile(e.target.files?.[0]??null);setCustomError('');}}/></label><div className="context-grid"><label>Input range<select aria-label="Model input range" value={inputRange} disabled={customLoading} onChange={e=>setInputRange(e.target.value as 'unit'|'signed')}><option value="unit">0 to 1</option><option value="signed">−1 to 1</option></select></label><label>Output range<select aria-label="Model output range" value={outputRange} disabled={customLoading} onChange={e=>setOutputRange(e.target.value as 'unit'|'signed')}><option value="unit">0 to 1</option><option value="signed">−1 to 1</option></select></label></div><label className="research-consent"><input type="checkbox" checked={customAccepted} disabled={customLoading} onChange={e=>setCustomAccepted(e.target.checked)}/> I have permission to use this model and will follow its licence.</label>{customError&&<p className="model-error" role="alert">{customError}</p>}<button className="button primary" disabled={!customAccepted||!customFile||customLoading} onClick={()=>{if(!customFile)return;setCustomError('');setCustomLoading(true);worker.current?.postMessage({type:'custom-model',gen:generation.current,permission:true,blob:customFile,inputRange,outputRange});}}>{customLoading?'Validating model…':'Load model'}</button><button className="button secondary" disabled={customLoading} onClick={()=>{setCustomOpen(false);setCustomError('');if(recipe?.engine==='wave'&&analysis)update(r=>({...r,engine:'balanced',auto:suggest(analysis,r.hints,'balanced')}));}}>Cancel</button></div></div>}
    {storageWarning&&<div className="storage-warning" role="status">Local storage is unavailable or full. Export your edits before closing.<button aria-label="Dismiss storage warning" onClick={()=>setStorageWarning(false)}><X size={14}/></button></div>}
    {notice&&<div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={15}/></button></div>}
    {exporting&&<div className="modal-shade"><div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title"><span className="brand-icon"><Waves size={25}/></span><h2 id="export-title">Exporting {video?'video':'photo'}</h2><p>{saving?'Saving your restored file…':video?'Processing video frames locally. Keep this app open.':'Rendering your full-resolution photo.'}</p><progress max="100" value={progress}/><span>{progress}%</span><button className="button secondary" disabled={saving} onClick={cancelExport}>Cancel export</button></div></div>}
  </div>{about&&<About onClose={closeAbout} customModel={customModel}/>}</>;
}


