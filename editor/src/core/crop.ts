import type {PhotoCrop} from './types';

export const FULL_CROP:PhotoCrop={x:0,y:0,width:1,height:1};
export function validCrop(value:unknown):value is PhotoCrop {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const r=value as PhotoCrop;
 return [r.x,r.y,r.width,r.height].every(n=>typeof n==='number'&&Number.isFinite(n))&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1+1e-9&&r.y+r.height<=1+1e-9;
}
export function cropBounds(crop:PhotoCrop|undefined,width:number,height:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('Invalid photo dimensions.');
 const r=crop??FULL_CROP;if(!validCrop(r))throw new Error('Invalid crop settings.');
 const x=Math.min(width-1,Math.max(0,Math.round(r.x*width))),y=Math.min(height-1,Math.max(0,Math.round(r.y*height)));
 const right=Math.min(width,Math.max(x+1,Math.round((r.x+r.width)*width))),bottom=Math.min(height,Math.max(y+1,Math.round((r.y+r.height)*height)));
 return {x,y,width:right-x,height:bottom-y};
}
