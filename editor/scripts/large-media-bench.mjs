import {chromium} from 'playwright';
import {build} from 'esbuild';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import assert from 'node:assert/strict';
import {Input,BlobSource,MP4,QTFF} from 'mediabunny';

const root=resolve(import.meta.dirname,'../..');
const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
const outputDir=resolve(root,'analysis/adaptive-finish',`fresh-review-bench-${timestamp}`);
const appUrl=process.env.CHECK_URL??'http://127.0.0.1:4186';
const browserTimeout=Number(process.env.BENCH_TIMEOUT_MS??120_000);
const largeVideoOnly=process.env.BENCH_LARGE_VIDEO_ONLY==='1';
const execFileAsync=promisify(execFile);
await mkdir(outputDir,{recursive:false});

const report={
 startedAt:new Date().toISOString(),appUrl,
 host:{platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0]?.model??'unknown',reportedMemoryGiB:+(os.totalmem()/1024**3).toFixed(1)},
 evidence:'Synthetic browser-generated media only. Sequential fresh browser contexts. Latencies are desktop browser measurements, not peak-memory or phone performance evidence.',
 photos:[],videos:[],
};

const mediabunnyBundle=await build({
 stdin:{contents:"import * as MediaBunny from 'mediabunny'; window.MediaBunny=MediaBunny;",resolveDir:resolve(root,'editor'),sourcefile:'large-media-bench.js',loader:'js'},
 bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,legalComments:'none',
});
const mediabunnyScript=mediabunnyBundle.outputFiles[0].text;
const browser=await chromium.launch({channel:'msedge',headless:true});

function jpegDimensions(bytes){
 if(bytes[0]!==0xff||bytes[1]!==0xd8)throw new Error('Synthetic photo export is not JPEG.');
 let at=2;
 while(at+4<bytes.length){
  if(bytes[at]!==0xff){at++;continue;}
  while(bytes[at]===0xff)at++;
  const marker=bytes[at++];
  if(marker===0xd8||marker===0xd9||marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
  const length=(bytes[at]<<8)|bytes[at+1];
  if(length<2||at+length>bytes.length)break;
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {width:(bytes[at+5]<<8)|bytes[at+6],height:(bytes[at+3]<<8)|bytes[at+4]};
  at+=length;
 }
 throw new Error('Could not read JPEG dimensions.');
}

async function makePhoto(width,height,name){
 const context=await browser.newContext();
 try{
  const page=await context.newPage();
  const bytes=await page.evaluate(async({width,height})=>{
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const c=canvas.getContext('2d',{alpha:false});
   const gradient=c.createLinearGradient(0,0,width,height);gradient.addColorStop(0,'#062f43');gradient.addColorStop(.35,'#087f8c');gradient.addColorStop(.7,'#35b7a0');gradient.addColorStop(1,'#efc27b');
   c.fillStyle=gradient;c.fillRect(0,0,width,height);
   c.fillStyle='rgba(245,250,235,.42)';
   for(let x=0;x<width;x+=320){const y=(x*37)%height;c.fillRect(x,y,Math.min(140,width-x),Math.min(92,height-y));}
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Synthetic JPEG encoding failed.')),'image/jpeg',.9));
   return Array.from(new Uint8Array(await blob.arrayBuffer()));
  },{width,height});
  const buffer=Buffer.from(bytes);await writeFile(resolve(outputDir,name),buffer);
  return buffer;
 }finally{await context.close();}
}

async function benchPhoto(width,height){
 const megapixels=+(width*height/1e6).toFixed(1),name=`synthetic-${width}x${height}.jpg`,source=await makePhoto(width,height,name);
 const result={name,source:{width,height,megapixels,bytes:source.length},status:'failed'};
 let context;
 try{
  context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(appUrl,{waitUntil:'domcontentloaded',timeout:30_000});
  const started=performance.now();
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name,mimeType:'image/jpeg',buffer:source});
  await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:browserTimeout});
  result.readyMs=Math.round(performance.now()-started);
  result.appSourceDimensions=await page.locator('.preview-info').innerText().catch(()=>null);
  result.selectedEngine=await page.getByLabel('Correction engine',{exact:true}).inputValue().catch(()=>null);
  if(result.selectedEngine&&result.selectedEngine!=='wwe')throw new Error(`Expected default WWE engine, got ${result.selectedEngine}.`);
  const downloadStarted=performance.now(),downloadPromise=page.waitForEvent('download',{timeout:browserTimeout});
  await page.getByRole('button',{name:'Download instead',exact:true}).click();
  const download=await downloadPromise,savePath=resolve(outputDir,`${name.replace(/\.jpg$/,'')}-restored.jpg`);
  await download.saveAs(savePath);
  const exported=await readFile(savePath),dimensions=jpegDimensions(exported);
  result.exportMs=Math.round(performance.now()-downloadStarted);
  result.export={...dimensions,megapixels:+(dimensions.width*dimensions.height/1e6).toFixed(1),bytes:exported.length,path:savePath};
  if(largeVideoOnly)assert.deepEqual({width:dimensions.width,height:dimensions.height},{width,height},'Source-mode export changed the frame dimensions.');
  result.errors=errors;
  assert.deepEqual(errors,[],'Unexpected app page errors.');
  result.status='completed';
 }catch(error){result.error=error instanceof Error?error.message:String(error);}
 finally{await context?.close();}
 report.photos.push(result);await saveReport();
 console.log(`photo ${megapixels} MP: ${result.status}${result.readyMs===undefined?'':`, ready ${result.readyMs} ms, export ${result.exportMs} ms`}${result.error?`, ${result.error}`:''}`);
}

async function makeVideo(width,height,name){
 const path=resolve(outputDir,name);
 if(process.env.FFMPEG_PATH){
  await execFileAsync(process.env.FFMPEG_PATH,['-hide_banner','-loglevel','error','-f','lavfi','-i',`testsrc2=size=${width}x${height}:rate=12`,'-t','2','-c:v','libx264','-pix_fmt','yuv420p','-y',path],{windowsHide:true,maxBuffer:1024*1024});
  return await readFile(path);
 }
 const context=await browser.newContext();
 try{
  const page=await context.newPage();await page.addScriptTag({content:mediabunnyScript});
  const response=await page.evaluate(async({width,height})=>{
   const {Output,Mp4OutputFormat,BufferTarget,CanvasSource,Quality}=window.MediaBunny;
   if(typeof VideoEncoder==='undefined')throw new Error('WebCodecs VideoEncoder is unavailable in the fixture browser.');
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const c=canvas.getContext('2d');
   const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target});
   const source=new CanvasSource(canvas,{codec:'avc',bitrate:new Quality({bitrate:width>=1920?4_000_000:2_000_000})});
   output.addVideoTrack(source,{frameRate:12});await output.start();
   for(let frame=0;frame<24;frame++){
    c.fillStyle=`hsl(${190+frame*2} 58% ${18+(frame%8)*3}%)`;c.fillRect(0,0,width,height);
    c.fillStyle='#b8e9dd';c.beginPath();c.arc(width*(.2+.6*frame/23),height*.5,Math.min(width,height)*.13,0,Math.PI*2);c.fill();
    c.fillStyle='rgba(255,255,255,.7)';c.fillRect(0,Math.floor(height*.72),width,Math.max(1,Math.floor(height*.008)));
    await source.add(frame/12,1/12);
   }
   await output.finalize();source.close();
   if(!target.buffer)throw new Error('Mediabunny produced no MP4 buffer.');
   return Array.from(new Uint8Array(target.buffer));
  },{width,height});
  const bytes=Buffer.from(response);await writeFile(path,bytes);return bytes;
 }finally{await context.close();}
}

async function probeVideo(bytes){
 const input=new Input({source:new BlobSource(new Blob([bytes],{type:'video/mp4'})),formats:[MP4,QTFF]});
 try{const track=await input.getPrimaryVideoTrack();if(!track)throw new Error('Synthetic MP4 has no video track.');return {width:await track.getDisplayWidth(),height:await track.getDisplayHeight(),duration:await input.computeDuration()};}
 finally{input.dispose();}
}

async function benchVideo(width,height){
 const name=`synthetic-${width}x${height}-2s.mp4`,result={name,status:'failed'};
 let context;
 try{
  const source=await makeVideo(width,height,name),sourceInfo=await probeVideo(source);
  result.source={...sourceInfo,bytes:source.length};
  context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(appUrl,{waitUntil:'domcontentloaded',timeout:30_000});
  const started=performance.now();
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name,mimeType:'video/mp4',buffer:source});
  await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:browserTimeout});
  result.readyMs=Math.round(performance.now()-started);
  result.appInfo=await page.locator('.video-timeline').innerText();
  result.selectedEngine=await page.getByLabel('Correction engine',{exact:true}).inputValue().catch(()=>null);
  if(largeVideoOnly){await page.getByLabel('Video quality',{exact:true}).selectOption('source');result.exportMode='source';}
  const downloadStarted=performance.now(),downloadPromise=page.waitForEvent('download',{timeout:browserTimeout});
  await page.getByRole('button',{name:'Download instead',exact:true}).click();
  const download=await downloadPromise,savePath=resolve(outputDir,`${name.replace(/\.mp4$/,'')}-restored.mp4`);
  await download.saveAs(savePath);
  const exported=await readFile(savePath),dimensions=await probeVideo(exported);
  result.exportMs=Math.round(performance.now()-downloadStarted);
  result.export={...dimensions,bytes:exported.length,path:savePath};
  if(largeVideoOnly)assert.deepEqual({width:dimensions.width,height:dimensions.height},{width,height},'Source-mode export changed the frame dimensions.');
  result.errors=errors;
  assert.deepEqual(errors,[],'Unexpected app page errors.');result.status='completed';
 }catch(error){result.error=error instanceof Error?error.message:String(error);}
 finally{await context?.close();}
 report.videos.push(result);await saveReport();
 console.log(`video ${width}x${height}: ${result.status}${result.readyMs===undefined?'':`, ready ${result.readyMs} ms, export ${result.exportMs} ms`}${result.error?`, ${result.error}`:''}`);
}

async function saveReport(){report.updatedAt=new Date().toISOString();await writeFile(resolve(outputDir,'report.json'),JSON.stringify(report,null,2)+'\n');}

try{
 await saveReport();
 if(!largeVideoOnly)for(const [width,height] of [[4000,3000],[6000,4000],[8000,6000]])await benchPhoto(width,height);
 for(const [width,height] of (largeVideoOnly?[[3840,2160]]:[[1280,720],[1920,1080]]))await benchVideo(width,height);
 report.finishedAt=new Date().toISOString();await saveReport();
 console.log(`report: ${resolve(outputDir,'report.json')}`);
}finally{await browser.close();}
