export interface LocalFileHandle {name?:string;size?:number;getFile?():Promise<File>;createWritable():Promise<{write(data:Blob):Promise<void>;close():Promise<void>;abort():Promise<void>}>}
export interface LocalDirectoryHandle {name:string;getFileHandle(name:string,options?:{create?:boolean}):Promise<LocalFileHandle>}
type PickerWindow=Window&{
  showDirectoryPicker?:(options:{mode:'readwrite'})=>Promise<LocalDirectoryHandle>;
};
import {isAndroid,chooseAndroidFolder} from './native';
import {getPlatformCapabilities} from './platform/capabilities';
export const supportsFolder=()=>isAndroid()||(getPlatformCapabilities().platform==='web'&&typeof (window as PickerWindow).showDirectoryPicker==='function');
export const chooseFolder=()=>isAndroid()?chooseAndroidFolder():(window as PickerWindow).showDirectoryPicker!({mode:'readwrite'});
export function restoredName(original:string,format:'jpg'|'png'|'mp4',addRestore=true) {
  const stem=original.replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,180)||'photo';
  return `${stem}${addRestore?'-restore':''}.${format}`;
}
export async function createUniqueFile(folder:LocalDirectoryHandle,name:string) {
  const dot=name.lastIndexOf('.'),stem=name.slice(0,dot),ext=name.slice(dot);
  for(let i=0;i<10000;i++) {
    const candidate=i===0?name:`${stem} (${i})${ext}`;
    try{await folder.getFileHandle(candidate);}
    catch(error){if(error instanceof DOMException&&error.name==='NotFoundError')return {handle:await folder.getFileHandle(candidate,{create:true}),name:candidate};if(error instanceof DOMException&&error.name==='TypeMismatchError')continue;throw error;}
  }
  throw new Error('Too many files with this name. Choose another output folder.');
}
export async function writeFile(handle:LocalFileHandle,blob:Blob) {
  const writable=await handle.createWritable();
  try{await writable.write(blob);await writable.close();}catch(error){await writable.abort().catch(()=>{});throw error;}
}
