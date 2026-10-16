import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
import type {Recipe} from './core/types';

/** CSS viewport coordinates; native converts these to physical view pixels. */
export interface NativeCameraBounds {x:number;y:number;width:number;height:number;pixelRatio?:number}
export interface NativeCameraLens {id:string;label:string;facing:'environment'|'user';intrinsicZoom:number}
export interface NativeCameraPhotoInfoChanged {sessionGeneration:number;photoWidth:number;photoHeight:number}
export interface NativeCameraInfo {
 width:number;height:number;photoWidth:number;photoHeight:number;sessionGeneration:number;
 lenses:NativeCameraLens[];lensId:string;zoom:number;minZoom:number;maxZoom:number;
}
export interface NativeCameraCapture {uri:string;name:string;type:'image/jpeg'|'video/mp4';width:number;height:number;iosCaptureId?:string}
export interface NativeCameraRecordingResult extends Partial<NativeCameraCapture> {error?:string;discarded?:boolean}
export interface NativeCameraPlugin {
 getLaunchMode():Promise<{mode:'camera'|'edit'|null}>;
 startSession(options:{bounds:NativeCameraBounds;facing:'environment'|'user';quality:'standard'|'high';recipe:Recipe}):Promise<NativeCameraInfo>;
 setPreviewBounds(bounds:NativeCameraBounds):Promise<void>;
 setCorrection(options:{recipe:Recipe}):Promise<void>;
 listLenses():Promise<{lenses:NativeCameraLens[]}>;
 setLens(options:{lensId:string}):Promise<NativeCameraInfo>;
 setZoom(options:{ratio:number}):Promise<{zoom:number}>;
 sampleFrame():Promise<{data:string;width:number;height:number}>;
 capturePhoto():Promise<NativeCameraCapture>;
 releaseCapture(options:{uri:string}):Promise<void>;
 startRecording(options:{maxMs:number;maxBytes:number;microphone:boolean;recipe:Recipe}):Promise<void>;
 stopRecording(options:{discard?:boolean}):Promise<void>;
 stopSession():Promise<void>;
 addListener(event:'cameraInfoChanged',listener:(result:NativeCameraPhotoInfoChanged)=>void):Promise<PluginListenerHandle>;
 addListener(event:'recordingFinished',listener:(result:NativeCameraRecordingResult)=>void):Promise<PluginListenerHandle>;
 addListener(event:'cameraError',listener:(result:{message:string;sessionClosed?:boolean;recoverable?:boolean})=>void):Promise<PluginListenerHandle>;
 addListener(event:'launchMode',listener:(result:{mode:'camera'|'edit'})=>void):Promise<PluginListenerHandle>;
}
export const nativeCamera=registerPlugin<NativeCameraPlugin>('ClearWaterCamera');
export const supportsNativeCamera=()=>['android','ios'].includes(Capacitor.getPlatform())&&Capacitor.isPluginAvailable('ClearWaterCamera');
/** Temp URI ownership stays native until the caller's durable save has finished. */
export async function readNativeCameraCapture(capture:NativeCameraCapture):Promise<File>{
 const response=await fetch(Capacitor.convertFileSrc(capture.uri));
 if(!response.ok)throw new Error('Could not read the camera capture.');
 const blob=await response.blob();
 if(!blob.size)throw new Error('The camera capture was empty.');
 return new File([blob],capture.name,{type:capture.type,lastModified:Date.now()});
}
