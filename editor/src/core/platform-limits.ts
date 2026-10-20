import {catalogs,type Language} from '../i18n-core';

/** Runtimes whose import and export ceilings can differ. Messages read only their own row. */
export const MEDIA_PLATFORMS=['android-apk','ios-app','ios-safari','android-chrome','desktop'] as const;
export type MediaPlatform=(typeof MEDIA_PLATFORMS)[number];
export const LIMIT_CODES=['too-large','too-long','resolution','photo-too-large','out-of-memory','hdr-unsupported','unreadable'] as const;
export type LimitCode=(typeof LIMIT_CODES)[number];

export interface PlatformLimits {
 videoBytes:number;
 videoSeconds:number;
 videoFramePixels:number;
 photoBytes:number;
 photoPixels:number;
 photoDimension:number;
 exportBytes:number;
 compactExportBytes:number;
 sourceExportBytes:number;
}

function limits():PlatformLimits {
 return {
  videoBytes:512*1024*1024,
  videoSeconds:600,
  videoFramePixels:34_000_000,
  photoBytes:512*1024*1024,
  photoPixels:200_000_000,
  photoDimension:32_768,
  exportBytes:512*1024*1024,
  compactExportBytes:256*1024*1024,
  sourceExportBytes:512*1024*1024,
 };
}

/** One row per runtime. Values match the ceilings enforced today; rows are independent so one platform cannot leak into another message. */
export const PLATFORM_LIMITS:Record<MediaPlatform,PlatformLimits>={
 'android-apk':limits(),
 'ios-app':limits(),
 'ios-safari':limits(),
 'android-chrome':limits(),
 desktop:limits(),
};
export function limitsFor(platform:MediaPlatform):PlatformLimits {return PLATFORM_LIMITS[platform];}
export function isMediaPlatform(value:unknown):value is MediaPlatform {return typeof value==='string'&&(MEDIA_PLATFORMS as readonly string[]).includes(value);}
export function isLimitCode(value:unknown):value is LimitCode {return typeof value==='string'&&(LIMIT_CODES as readonly string[]).includes(value);}

export interface MediaRuntimeFacts {capacitorPlatform:string;userAgent:string;navigatorPlatform?:string;maxTouchPoints?:number}

function isIosWeb(facts:MediaRuntimeFacts):boolean {
 if(facts.capacitorPlatform!=='web')return false;
 const userAgent=facts.userAgent;
 if(/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(userAgent))return false;
 if(/iPad|iPhone|iPod/.test(userAgent))return true;
 const navigatorPlatform=facts.navigatorPlatform??'',maxTouchPoints=facts.maxTouchPoints??0;
 return navigatorPlatform==='MacIntel'&&maxTouchPoints>1&&/Safari\//.test(userAgent)&&!/Android|Windows NT|CrOS|X11/.test(userAgent);
}

/** Android APK and the iOS app come from the native shell. iOS browsers (including CriOS, which is WebKit) share the iOS Safari row. Other Android browsers use the Android Chrome row. */
export function detectMediaPlatform(facts:MediaRuntimeFacts):MediaPlatform {
 if(facts.capacitorPlatform==='android')return 'android-apk';
 if(facts.capacitorPlatform==='ios')return 'ios-app';
 if(isIosWeb(facts))return 'ios-safari';
 if(/Android/i.test(facts.userAgent))return 'android-chrome';
 return 'desktop';
}

/** Worker-safe detection. The native shell is visible here only after the main thread has published `globalThis.Capacitor`. */
export function currentMediaPlatform():MediaPlatform {
 const nav=typeof navigator==='undefined'?undefined:navigator;
 const host=globalThis as {Capacitor?:{getPlatform?:()=>string}};
 let capacitorPlatform='web';
 try{capacitorPlatform=host.Capacitor?.getPlatform?.()??'web';}catch{capacitorPlatform='web';}
 return detectMediaPlatform({capacitorPlatform,userAgent:nav?.userAgent??'',navigatorPlatform:nav?.platform??'',maxTouchPoints:nav?.maxTouchPoints??0});
}

export type LimitMeasure=
 |{unit:'bytes';actual:number;limit:number}
 |{unit:'seconds';actual:number;limit:number}
 |{unit:'resolution';width:number;height:number;limitPixels:number}
 |{unit:'dimension';width:number;height:number;limit:number};

function trimTenths(value:number,bound:'actual'|'limit'):string {
 const tenths=bound==='actual'?Math.ceil(value*10-1e-9)/10:Math.floor(value*10+1e-9)/10;
 return Number.isInteger(tenths)?String(tenths):tenths.toFixed(1);
}
export function formatBytes(bytes:number,bound:'actual'|'limit'='actual'):string {
 const gibibyte=1024*1024*1024,mebibyte=1024*1024,useGb=bytes>=gibibyte;
 const scaled=bytes/(useGb?gibibyte:mebibyte);
 return `${trimTenths(scaled,bound)} ${useGb?'GB':'MB'}`;
}
export function formatDuration(seconds:number,bound:'actual'|'limit'='actual'):string {
 const whole=bound==='actual'?Math.ceil(seconds-1e-6):Math.floor(seconds+1e-6);
 const safe=Math.max(0,whole);
 return `${Math.floor(safe/60)}:${String(safe%60).padStart(2,'0')}`;
}
export function formatMegapixels(pixels:number,bound:'actual'|'limit'='actual'):string {
 return `${trimTenths(pixels/1_000_000,bound)} MP`;
}
export function formatResolution(width:number,height:number,bound:'actual'|'limit'='actual'):string {
 return `${width}×${height} (${formatMegapixels(width*height,bound)})`;
}
export function formatActual(measure?:LimitMeasure):string {
 if(!measure)return '';
 if(measure.unit==='bytes')return formatBytes(measure.actual,'actual');
 if(measure.unit==='seconds')return formatDuration(measure.actual,'actual');
 if(measure.unit==='resolution')return formatResolution(measure.width,measure.height,'actual');
 return `${measure.width}×${measure.height}`;
}
export function formatLimit(measure?:LimitMeasure):string {
 if(!measure)return '';
 if(measure.unit==='bytes')return formatBytes(measure.limit,'limit');
 if(measure.unit==='seconds')return formatDuration(measure.limit,'limit');
 if(measure.unit==='resolution')return formatMegapixels(measure.limitPixels,'limit');
 return `${measure.limit} px`;
}

export const LIMIT_MESSAGE_KEYS:Record<LimitCode,string>={
 'too-large':'Video is {actual}. Max on this device: {limit}. Try exporting smaller or trimming it.',
 'too-long':'Video is {actual} long. Max: {limit}. Trim it into shorter clips.',
 resolution:'Video is {actual}. Max: {limit}. Export at 4K or lower.',
 'photo-too-large':'Photo is {actual}. Max on this device: {limit}.',
 'out-of-memory':'Ran out of memory. Try Reduced quality or a shorter clip.',
 'hdr-unsupported':"HDR video isn't supported here yet. Export an SDR copy first.",
 unreadable:"Couldn't read this file. Re-export it as a standard MP4.",
};

export function renderLimitMessage(language:Language,code:LimitCode,actual='',limit=''):string {
 const key=LIMIT_MESSAGE_KEYS[code];
 const text=catalogs[language][key]??catalogs.en[key]??key;
 return text.replaceAll('{actual}',actual).replaceAll('{limit}',limit);
}

export class PlatformLimitError extends Error {
 readonly code:LimitCode;
 readonly actual:string;
 readonly limit:string;
 readonly platform:MediaPlatform;
 readonly measure?:LimitMeasure;
 constructor(code:LimitCode,platform:MediaPlatform,measure?:LimitMeasure,cause?:unknown){
  const actual=formatActual(measure),limit=formatLimit(measure);
  super(renderLimitMessage('en',code,actual,limit),cause===undefined?undefined:{cause});
  this.name='PlatformLimitError';
  this.code=code;this.actual=actual;this.limit=limit;this.platform=platform;this.measure=measure;
 }
}

export function assertVideoBytes(bytes:number,platform:MediaPlatform):void {
 const limit=limitsFor(platform).videoBytes;
 if(bytes>limit)throw new PlatformLimitError('too-large',platform,{unit:'bytes',actual:bytes,limit});
}
/** Allows the historical 10 ms float slack (`duration > limit + 0.01`). The displayed limit stays the table value. */
export function assertVideoDuration(duration:number,platform:MediaPlatform):void {
 const limit=limitsFor(platform).videoSeconds;
 if(!Number.isFinite(duration)||duration<=0)throw new PlatformLimitError('unreadable',platform);
 if(duration>limit+.01)throw new PlatformLimitError('too-long',platform,{unit:'seconds',actual:duration,limit});
}
export function assertVideoFrame(width:number,height:number,platform:MediaPlatform):void {
 const limit=limitsFor(platform).videoFramePixels;
 if(width*height>limit)throw new PlatformLimitError('resolution',platform,{unit:'resolution',width,height,limitPixels:limit});
}
export function assertPhotoLimits(width:number,height:number,bytes:number|undefined,platform:MediaPlatform):void {
 const row=limitsFor(platform);
 if(bytes!==undefined&&bytes>row.photoBytes)throw new PlatformLimitError('photo-too-large',platform,{unit:'bytes',actual:bytes,limit:row.photoBytes});
 if(width>row.photoDimension||height>row.photoDimension)throw new PlatformLimitError('photo-too-large',platform,{unit:'dimension',width,height,limit:row.photoDimension});
 if(width*height>row.photoPixels)throw new PlatformLimitError('photo-too-large',platform,{unit:'resolution',width,height,limitPixels:row.photoPixels});
}
export function assertExportBytes(bytes:number,kind:'video'|'photo',platform:MediaPlatform):void {
 const limit=limitsFor(platform).exportBytes;
 if(bytes>limit)throw new PlatformLimitError(kind==='video'?'too-large':'photo-too-large',platform,{unit:'bytes',actual:bytes,limit});
}

export function isMemoryFailure(error:unknown):boolean {
 let current:unknown=error;
 const seen=new Set<unknown>();
 while(current&&typeof current==='object'&&!seen.has(current)){
  seen.add(current);
  const name=current instanceof Error?current.name:'';
  const message=current instanceof Error?current.message:String(current);
  if(/out of memory|allocation failed|array buffer allocation|failed to allocate|not enough memory|memory pressure|outofmemory/i.test(`${name} ${message}`))return true;
  current=(current as {cause?:unknown}).cause;
 }
 return false;
}
export function isEncoderFailure(error:unknown):boolean {
 if(!(error instanceof Error))return false;
 if(error.message.startsWith('This device cannot encode')||error.message.startsWith('H.264 video encoding is unavailable'))return false;
 if(error instanceof DOMException&&(error.name==='EncodingError'||error.name==='QuotaExceededError'))return true;
 return /EncodingError|encoder init|encoder failed|failed to encode|VideoEncoder/i.test(`${error.name} ${error.message}`);
}
function isGenericDecodeMessage(message:string):boolean {
 if(message.startsWith('This device cannot decode '))return false;
 if(/^Could not decode\b/.test(message))return true;
 return message==='This video could not be processed.'||message==='The photo could not be processed.';
}
/** Log the underlying failure, then return the specific limit error or the original diagnostic. */
export function classifyMediaFailure(error:unknown,platform:MediaPlatform,operation:'load'|'export'|'decode'):Error {
 console.error(error instanceof PlatformLimitError?error.cause??error:error);
 if(error instanceof PlatformLimitError)return error;
 if(error instanceof Error&&error.name==='VideoTransientError')return error;
 if(isMemoryFailure(error)||(operation==='export'&&isEncoderFailure(error)))return new PlatformLimitError('out-of-memory',platform,undefined,error);
 const message=error instanceof Error?error.message:'';
 if(/unsupported configuration/i.test(message))return new Error('This device cannot decode or encode this video configuration. HEVC support varies by device. Try an H.264 SDR copy.');
 if(isGenericDecodeMessage(message)||operation==='decode')return new PlatformLimitError('unreadable',platform,undefined,error);
 return error instanceof Error?error:new Error(message||'This video could not be processed.');
}

/** Native plugins report `cw-limit/<code>/<unit>/<numbers>` so the JS layer can fill the typed error from the ceiling that plugin enforced. */
export function parseLimitToken(token:string,platform:MediaPlatform):PlatformLimitError|undefined {
 const parts=token.trim().split('/');
 if(parts[0]!=='cw-limit'||!isLimitCode(parts[1]))return undefined;
 const code=parts[1];
 if(code==='out-of-memory'||code==='hdr-unsupported'||code==='unreadable')return new PlatformLimitError(code,platform);
 const unit=parts[2];
 const nums=parts.slice(3).map(Number);
 if(nums.some(value=>!Number.isFinite(value)))return undefined;
 if((code==='too-large'||code==='photo-too-large')&&unit==='bytes'&&nums.length>=2)return new PlatformLimitError(code,platform,{unit:'bytes',actual:nums[0],limit:nums[1]});
 if(code==='too-long'&&unit==='seconds'&&nums.length>=2)return new PlatformLimitError(code,platform,{unit:'seconds',actual:nums[0],limit:nums[1]});
 if(code==='resolution'&&unit==='frame'&&nums.length>=3)return new PlatformLimitError(code,platform,{unit:'resolution',width:nums[0],height:nums[1],limitPixels:nums[2]});
 if(code==='photo-too-large'&&unit==='megapixels'&&nums.length>=3)return new PlatformLimitError(code,platform,{unit:'resolution',width:nums[0],height:nums[1],limitPixels:nums[2]});
 if(code==='photo-too-large'&&unit==='dimension'&&nums.length>=3)return new PlatformLimitError(code,platform,{unit:'dimension',width:nums[0],height:nums[1],limit:nums[2]});
 return undefined;
}
export function normalizeMediaError(error:unknown,platform:MediaPlatform):Error {
 if(error instanceof PlatformLimitError)return error;
 const text=error instanceof Error?error.message:typeof error==='string'?error:'';
 const tokenAt=text.indexOf('cw-limit/');
 const parsed=tokenAt>=0?parseLimitToken(text.slice(tokenAt).split(/\s/)[0],platform):undefined;
 if(parsed){console.error(error);return parsed;}
 if(isMemoryFailure(error)){console.error(error);return new PlatformLimitError('out-of-memory',platform,undefined,error);}
 return error instanceof Error?error:new Error(text||'This file could not be processed.');
}
export function presentMediaError(error:unknown,platform:MediaPlatform=currentMediaPlatform()):string {
 console.error(error);
 return (error instanceof PlatformLimitError?error:normalizeMediaError(error,platform)).message;
}
