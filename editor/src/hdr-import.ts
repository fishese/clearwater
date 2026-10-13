import {createAndroidHdrWorkingCopy} from './native';

/** Convert only while the originating photo is still the active, current load. */
export async function convertHdrImportRequest(
 source:File,
 isCurrent:()=>boolean,
 onProgress:(progress:number)=>void,
 onJob:(id:string)=>void,
):Promise<{id:string;file:File}|null>{
 if(!isCurrent())return null;
 const copy=await createAndroidHdrWorkingCopy(source,onProgress,onJob);
 return isCurrent()?copy:null;
}
