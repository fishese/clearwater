import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {translateMessage} from '../src/i18n-core';
import {
 MEDIA_PLATFORMS,PLATFORM_LIMITS,PlatformLimitError,assertPhotoLimits,assertVideoBytes,assertVideoDuration,assertVideoFrame,
 classifyMediaFailure,detectMediaPlatform,displayFrameSize,formatBytes,formatDuration,formatResolution,limitsFor,parseLimitToken,renderLimitMessage,videoDurationExceeds,
} from '../src/core/platform-limits';

const facts=(capacitorPlatform:string,userAgent:string,navigatorPlatform='',maxTouchPoints=0)=>({capacitorPlatform,userAgent,navigatorPlatform,maxTouchPoints});

describe('platform limit table',()=>{
 it('keeps an independent row for each runtime',()=>{
  expect(Object.keys(PLATFORM_LIMITS).sort()).toEqual([...MEDIA_PLATFORMS].sort());
  const saved={...PLATFORM_LIMITS['ios-safari']};
  PLATFORM_LIMITS['ios-safari']={...saved,videoBytes:128*1024*1024};
  try{
   expect(limitsFor('ios-safari').videoBytes).toBe(128*1024*1024);
   expect(limitsFor('android-apk').videoBytes).toBe(512*1024*1024);
   const safari=new PlatformLimitError('too-large','ios-safari',{unit:'bytes',actual:200*1024*1024,limit:limitsFor('ios-safari').videoBytes});
   const android=new PlatformLimitError('too-large','android-apk',{unit:'bytes',actual:600*1024*1024,limit:limitsFor('android-apk').videoBytes});
   expect(safari).toMatchObject({code:'too-large',actual:'200 MB',limit:'128 MB',platform:'ios-safari'});
   expect(android.limit).toBe('512 MB');
   expect(android.message).toContain('512 MB');
   expect(android.message).not.toContain('128 MB');
  }finally{PLATFORM_LIMITS['ios-safari']=saved;}
 });
 it('matches the ceilings enforced by the JS and native checks',()=>{
  const row=limitsFor('desktop');
  expect(limitsFor('android-apk')).toEqual(row);
  expect(limitsFor('android-chrome')).toEqual(row);
  expect(limitsFor('ios-app')).toEqual(limitsFor('ios-safari'));
  expect(limitsFor('ios-app').videoBytes).toBe(256*1024*1024);
  expect(limitsFor('ios-safari').sourceExportBytes).toBe(256*1024*1024);
  expect(limitsFor('ios-app').photoAutoPixels).toBe(24_000_000);
  expect(row.videoBytes).toBe(512*1024*1024);
  expect(row.sourceExportBytes).toBe(512*1024*1024);
  expect(row.photoAutoPixels).toBe(200_000_000);
  const root=new URL('../',import.meta.url);
  const java=readFileSync(new URL('android/app/src/main/java/com/fishese/clearwater/ClearWaterHdrPlugin.java',root),'utf8');
  const share=readFileSync(new URL('android/app/src/main/java/com/fishese/clearwater/ClearWaterSharePlugin.java',root),'utf8');
  const files=readFileSync(new URL('android/app/src/main/java/com/fishese/clearwater/ClearWaterFilesPlugin.java',root),'utf8');
  const swift=readFileSync(new URL('ios/App/App/ClearWaterExportPlugin.swift',root),'utf8');
  expect(java).toContain('MAX_INPUT_BYTES = 512L * 1024 * 1024');
  expect(java).toContain('MAX_OUTPUT_BYTES = 256L * 1024 * 1024');
  expect(java).toContain('MAX_DURATION_US = 600_000_000L');
  expect(java).toContain('DURATION_TOLERANCE_US = 1_000L');
  expect(java).toContain('displayWidth * displayHeight > MAX_FRAME_PIXELS');
  expect(java).toContain('MAX_FRAME_PIXELS = 34_000_000L');
  expect(share).toContain('MAX_BYTES = 512L * 1024L * 1024L');
  expect(files).toContain('512L*1024*1024');
  expect(swift).toContain('maximumBytes = 512 * 1024 * 1024');
  expect(row).toMatchObject({videoBytes:512*1024*1024,videoSeconds:600,videoFramePixels:34_000_000,photoBytes:512*1024*1024,photoPixels:200_000_000,photoDimension:32768,exportBytes:512*1024*1024,compactExportBytes:256*1024*1024,sourceExportBytes:512*1024*1024});
 });
});

describe('runtime detection',()=>{
 const safari='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/605.1.15';
 const crios='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
 const androidChrome='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
 const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
 it('prefers the native shell over the WebView user agent',()=>{
  expect(detectMediaPlatform(facts('android',androidChrome))).toBe('android-apk');
  expect(detectMediaPlatform(facts('ios',safari))).toBe('ios-app');
  expect(detectMediaPlatform(facts('web',safari,'iPhone',5))).toBe('ios-safari');
  expect(detectMediaPlatform(facts('web',crios,'iPhone',5))).toBe('ios-safari');
  expect(detectMediaPlatform(facts('web',androidChrome,'Linux aarch64',5))).toBe('android-chrome');
  expect(detectMediaPlatform(facts('web',desktop,'Win32',0))).toBe('desktop');
 });
});

describe('limit formatting',()=>{
 it('formats bytes, duration and resolution without hiding an over-limit value',()=>{
  expect(formatBytes(512*1024*1024,'limit')).toBe('512 MB');
  expect(formatBytes(512*1024*1024+1,'actual')).toBe('512.1 MB');
  expect(formatBytes(1024*1024*1024,'limit')).toBe('1 GB');
  expect(formatBytes(1.5*1024*1024*1024,'actual')).toBe('1.5 GB');
  expect(formatDuration(600,'limit')).toBe('10:00');
  expect(formatDuration(600.02,'actual')).toBe('10:01');
  expect(formatDuration(90,'actual')).toBe('1:30');
  expect(formatResolution(8000,4500,'actual')).toBe('8000×4500 (36 MP)');
 });
});

describe('limit error messages',()=>{
 const samples:[PlatformLimitError['code'],string,string,string,string,string][]=[
  ['too-large','600 MB','512 MB','Video is 600 MB. Max on this device: 512 MB. Try exporting smaller or trimming it.','影片大小為 600 MB，此裝置上限為 512 MB。請先降低畫質或剪短後再匯入。','動画サイズは 600 MB、この端末の上限は 512 MB です。画質を下げるかトリミングしてください。'],
  ['too-long','10:01','10:00','Video is 10:01 long. Max: 10:00. Trim it into shorter clips.','影片長度為 10:01，上限為 10:00。請先剪成較短片段。','動画の長さは 10:01、上限は 10:00 です。短く分割してください。'],
  ['resolution','8000×4500 (36 MP)','34 MP','Video is 8000×4500 (36 MP). Max: 34 MP. Export at 4K or lower.','影片解像度為 8000×4500 (36 MP)，上限為 34 MP。請以 4K 或以下匯出。','動画の解像度は 8000×4500 (36 MP)、上限は 34 MP です。4K以下で書き出してください。'],
  ['photo-too-large','40000×1','32768 px','Photo is 40000×1. Max on this device: 32768 px.','相片為 40000×1，此裝置上限為 32768 px。','写真は 40000×1、この端末の上限は 32768 px です。'],
  ['out-of-memory','','','Ran out of memory. Try Reduced quality or a shorter clip.','記憶體不足。請改用「精簡」畫質或較短片段。','メモリが不足しました。「軽量」画質か短いクリップでお試しください。'],
  ['hdr-unsupported','','',"HDR video isn't supported here yet. Export an SDR copy first.",'此平台暫不支援 HDR 影片，請先匯出 SDR 版本。','この環境ではHDR動画に未対応です。SDR版を書き出してからお試しください。'],
  ['unreadable','','',"Couldn't read this file. Re-export it as a standard MP4.",'無法讀取此檔案。請重新匯出為標準 MP4。','このファイルを読み込めません。標準のMP4で書き出し直してください。'],
 ];
 it('maps each code to the EN, 繁中 and 日本語 copy',()=>{
  for(const [code,actual,limit,en,zh,ja] of samples){
   expect(renderLimitMessage('en',code,actual,limit)).toBe(en);
   expect(renderLimitMessage('zh-HK',code,actual,limit)).toBe(zh);
   expect(renderLimitMessage('ja',code,actual,limit)).toBe(ja);
   expect(translateMessage('zh-HK',en)).toBe(zh);
   expect(translateMessage('ja',en)).toBe(ja);
   expect(zh.length).toBeLessThan(90);
   expect(ja.length).toBeLessThan(90);
   expect(en.length).toBeLessThan(120);
  }
 });
 it('fills actual and limit from the check that failed',()=>{
  expect(()=>assertVideoBytes(600*1024*1024,'android-chrome')).toThrow(PlatformLimitError);
  try{assertVideoBytes(600*1024*1024,'android-chrome');}catch(error){
   expect(error).toMatchObject({code:'too-large',actual:'600 MB',limit:'512 MB',platform:'android-chrome'});
  }
  try{assertVideoDuration(601,'ios-safari');}catch(error){expect(error).toMatchObject({code:'too-long',actual:'10:01',limit:'10:00',platform:'ios-safari'});}
  expect(()=>assertVideoDuration(600,'desktop')).not.toThrow();
  expect(videoDurationExceeds(600.001,'android-apk')).toBe(false);
  expect(videoDurationExceeds(600.001+0.0006,'ios-app')).toBe(true);
  expect(()=>assertVideoBytes(300*1024*1024,'ios-safari')).toThrow(/256 MB/);
  expect(()=>assertVideoBytes(300*1024*1024,'android-apk')).not.toThrow();
  expect(displayFrameSize(2160,3840,90)).toEqual({width:3840,height:2160});
  expect(displayFrameSize(3840,2160,180)).toEqual({width:3840,height:2160});
  expect(displayFrameSize(1920,1080,270)).toEqual({width:1080,height:1920});
  try{assertVideoFrame(8000,4500,'ios-app');}catch(error){expect(error).toMatchObject({code:'resolution',actual:'8000×4500 (36 MP)',limit:'34 MP',platform:'ios-app'});}
  try{assertPhotoLimits(40000,10,1,'desktop');}catch(error){expect(error).toMatchObject({code:'photo-too-large',actual:'40000×10',limit:'32768 px'});}
  try{assertPhotoLimits(10000,20001,1,'desktop');}catch(error){expect(error).toMatchObject({code:'photo-too-large',limit:'200 MP'});}
  try{assertPhotoLimits(100,100,600*1024*1024,'desktop');}catch(error){expect(error).toMatchObject({code:'photo-too-large',actual:'600 MB',limit:'512 MB'});}
 });
 it('parses native limit tokens into the same typed error',()=>{
  expect(parseLimitToken('cw-limit/too-long/seconds/601/600','android-apk')).toMatchObject({code:'too-long',actual:'10:01',limit:'10:00',platform:'android-apk'});
  expect(parseLimitToken('cw-limit/resolution/frame/8000/4500/34000000','android-apk')?.message).toContain('34 MP');
  expect(parseLimitToken('cw-limit/out-of-memory','ios-app')?.code).toBe('out-of-memory');
  expect(parseLimitToken('not-a-limit','desktop')).toBeUndefined();
 });
 it('logs decode and encoder failures and replaces only the generic ones',()=>{
  const errorLog=vi.spyOn(console,'error').mockImplementation(()=>{});
  const oom=classifyMediaFailure(new DOMException('Encoder failed','EncodingError'),'desktop','export');
  expect(oom).toMatchObject({code:'out-of-memory',platform:'desktop'});
  expect(errorLog).toHaveBeenCalled();
  const unread=classifyMediaFailure(new Error('Could not decode the first video frame.'),'ios-safari','load');
  expect(unread).toMatchObject({code:'unreadable',platform:'ios-safari'});
  const codec=classifyMediaFailure(new Error('This device cannot decode hevc. iPhone HEVC/MOV support depends on the device. Try an H.264 SDR copy.'),'desktop','load');
  expect(codec).toBeInstanceOf(Error);
  expect(codec).not.toBeInstanceOf(PlatformLimitError);
  errorLog.mockRestore();
 });
 it('keeps photo decode and processing errors out of the video-specific MP4 message',()=>{
  const errorLog=vi.spyOn(console,'error').mockImplementation(()=>{});
  const load=classifyMediaFailure(new Error('Could not decode the photo.'),'android-apk','photo-load');
  expect(load.message).toBe("Couldn't read this photo. Try exporting a fresh copy.");
  expect(translateMessage('zh-HK',load.message)).toBe('未能讀取此相片。請輸出一份新的副本。');
  expect(translateMessage('ja',load.message)).toBe('写真を読み込めません。新しいコピーを書き出してお試しください。');
  expect(classifyMediaFailure(new Error('The photo could not be processed.'),'android-apk','photo-process').message).toBe('The photo could not be processed.');
  expect(classifyMediaFailure(new Error('RAW decoder stopped. Try Reduced resolution.'),'android-apk','photo-load').message).toBe('RAW decoder stopped. Try Reduced resolution.');
  expect(classifyMediaFailure(new Error('Could not decode the first video frame.'),'android-apk','load').message).toBe("Couldn't read this file. Re-export it as a standard MP4.");
  expect(classifyMediaFailure(new Error('Out of memory while rendering.'),'android-apk','photo-process')).toMatchObject({code:'out-of-memory',platform:'android-apk'});
  errorLog.mockRestore();
 });
});
