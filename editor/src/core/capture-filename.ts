export type CaptureExtension='jpg'|'mp4';

/** User-facing capture name using the device's local calendar and clock. */
export function captureFilename(date:Date,extension:CaptureExtension){
 const pad=(value:number,width=2)=>String(value).padStart(width,'0');
 return `CW_${pad(date.getFullYear(),4)}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.${extension}`;
}
