import {renderPixels} from './engine';
import type {Recipe} from './types';
export async function cameraThumbnail(blob:Blob):Promise<string>{
 const bitmap=await createImageBitmap(blob);
 try{const canvas=document.createElement('canvas'),scale=Math.min(160/bitmap.width,160/bitmap.height);canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d')?.drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.75);}finally{bitmap.close();}
}
/** Produce the visible gallery JPEG; callers retain the supplied original untouched. */
export async function renderCameraPhoto(original:File,recipe:Recipe,quality=.94):Promise<File>{
 if(recipe.engine!=='balanced')throw new Error('Camera capture requires Balanced restoration.');
 const bitmap=await createImageBitmap(original),canvas=document.createElement('canvas');
 try{
  canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Photo capture failed.');
  context.drawImage(bitmap,0,0);
  const pixels=context.getImageData(0,0,canvas.width,canvas.height);
  pixels.data.set(renderPixels(pixels.data,recipe));context.putImageData(pixels,0,0);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Photo capture failed.')),'image/jpeg',Math.max(.8,Math.min(1,quality))));
  return new File([blob],original.name,{type:'image/jpeg',lastModified:original.lastModified});
 }finally{bitmap.close();canvas.width=1;canvas.height=1;}
}
export async function cameraFileHash(blob:Blob){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');}
