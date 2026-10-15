import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Input,BlobSource,MP4,QTFF} from 'mediabunny';
const root=resolve(import.meta.dirname,'../..'),dir=resolve(root,'analysis/video-check');await mkdir(dir,{recursive:true});
function mp4CreationDate(buffer){
 const bytes=new Uint8Array(buffer),view=new DataView(buffer);let offset=0;
 while(offset+8<=bytes.length){let size=view.getUint32(offset,false),type=String.fromCharCode(...bytes.subarray(offset+4,offset+8)),header=8;if(size===1){if(offset+16>bytes.length)return null;const big=view.getBigUint64(offset+8,false);if(big>BigInt(Number.MAX_SAFE_INTEGER))return null;size=Number(big);header=16;}else if(size===0)size=bytes.length-offset;if(size<header||offset+size>bytes.length)return null;
  if(type==='moov'){let child=offset+header;while(child+8<=offset+size){let childSize=view.getUint32(child,false),childType=String.fromCharCode(...bytes.subarray(child+4,child+8)),childHeader=8;if(childSize===1){if(child+16>offset+size)return null;childSize=Number(view.getBigUint64(child+8,false));childHeader=16;}else if(childSize===0)childSize=offset+size-child;if(childSize<childHeader||child+childSize>offset+size)return null;if(childType==='mvhd'){const version=view.getUint8(child+childHeader),seconds=version===1?Number(view.getBigUint64(child+childHeader+4,false)):view.getUint32(child+childHeader+4,false);return new Date((seconds-2082844800)*1000);}child+=childSize;}return null;}
  offset+=size;
 }
 return null;
}
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:5173/');
 if(process.env.CHECK_OFFLINE==='1'){await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();console.log('Checking cached production build offline');}
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 const hash=()=>page.locator('canvas[aria-label="Edited photo"]').evaluate(async c=>{const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).join(',');});
 for(const [fixture,portrait] of [['h264-audio.mp4',false],['rotated.mov',true],['hevc.mov',false]]){
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,fixture));
  if(fixture==='hevc.mov'){
   await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false||/cannot decode|decoder stopped responding/.test(document.querySelector('.toast')?.textContent??''),null,{timeout:60000});
   if(!(await page.locator('.top-actions .primary').isEnabled())){console.log('PASS HEVC explicit unsupported-device message');continue;}
  }
  await ready();
  assert.equal(await page.getByRole('button',{name:'Export video',exact:true}).isEnabled(),true);
  assert.equal(await page.getByLabel('Keep audio',{exact:true}).isChecked(),true);
  const first=await hash();await page.getByRole('slider',{name:'Video position',exact:true}).focus();await page.keyboard.press('End');await page.waitForTimeout(100);await ready();assert.notEqual(await hash(),first);
  const bounds=await page.locator('.image-frame').boundingBox();assert.equal(bounds.height>bounds.width,portrait);
  await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('End');await page.waitForTimeout(100);await ready();
  const saved=page.waitForEvent('download');await page.getByRole('button',{name:'Download instead',exact:true}).click();const file=await saved;
  assert.ok(file.suggestedFilename().endsWith('-restore.mp4'));await file.saveAs(resolve(dir,fixture+'-edited.mp4'));await ready();
  await page.locator('summary').filter({hasText:'Correction Engine'}).click();
  assert.equal(await page.getByLabel('Correction engine',{exact:true}).locator('option[value="fivea"]').isDisabled(),false);
  await page.locator('summary').filter({hasText:'Correction Engine'}).click();
  console.log('PASS edit/scrub/audio/export '+fixture);
 }
 // Source mode must retain the source's 1440p60 timing and supported audio while
 // carrying descriptive tags and the MP4 movie creation timestamp through export.
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,'source-60fps.mp4'));await ready();
 await page.getByLabel('Video quality',{exact:true}).selectOption('source');
 assert.equal(await page.getByLabel('Keep audio',{exact:true}).isChecked(),true);
 assert.equal(await page.getByLabel('Keep video metadata',{exact:true}).isChecked(),true);
 const sourceDownload=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'Download instead',exact:true}).click();
 const sourceFile=await sourceDownload,sourceOutput=resolve(dir,'source-60fps-edited.mp4');await sourceFile.saveAs(sourceOutput);await ready();
 const edited=new Blob([await readFile(sourceOutput)]),outputInput=new Input({source:new BlobSource(edited),formats:[MP4,QTFF]});
 try{
  const outputVideo=await outputInput.getPrimaryVideoTrack(),outputAudio=await outputInput.getPrimaryAudioTrack(),outputTags=await outputInput.getMetadataTags(),outputStats=await outputVideo.computePacketStats(200);
  assert.equal(await outputVideo.getDisplayWidth(),2560);assert.equal(await outputVideo.getDisplayHeight(),1440);
  assert.ok(Math.abs(outputStats.averagePacketRate-60)<1,`expected source timing near 60 fps, got ${outputStats.averagePacketRate}`);
  assert.ok(outputAudio,'expected retained AAC audio track');
  assert.equal(outputTags.title,'ClearWater source-mode fixture');assert.equal(outputTags.comment,'Metadata round-trip check');
  assert.equal(mp4CreationDate(await edited.arrayBuffer())?.toISOString(),'2024-03-04T05:06:07.000Z');
  console.log('PASS source 1440p60 dimensions/timing, audio, title/comment and movie creation date');
 }finally{outputInput.dispose();}
 await page.getByLabel('Video quality',{exact:true}).selectOption('compatible');await page.getByLabel('Keep video metadata',{exact:true}).uncheck();
 const strippedDownload=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'Download instead',exact:true}).click();
 const strippedFile=await strippedDownload,strippedOutput=resolve(dir,'source-60fps-metadata-off.mp4');await strippedFile.saveAs(strippedOutput);await ready();
 const strippedBytes=await readFile(strippedOutput),strippedBuffer=new Uint8Array(strippedBytes).buffer;
 const strippedInput=new Input({source:new BlobSource(new Blob([strippedBytes])),formats:[MP4,QTFF]});
 try{const tags=await strippedInput.getMetadataTags(),creation=mp4CreationDate(strippedBuffer);assert.notEqual(tags.title,'ClearWater source-mode fixture');assert.notEqual(tags.comment,'Metadata round-trip check');assert.notEqual(creation?.toISOString(),'2024-03-04T05:06:07.000Z');console.log('PASS metadata opt-out removes source tags and creation date');}finally{strippedInput.dispose();}
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,'h264-audio.mp4'));await ready();
 // Cancelling during asynchronous setup must leave the same clip editable.
 await page.getByRole('button',{name:'Download instead',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Cancel export',exact:true}).click();
 await ready();assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByLabel('Keep audio',{exact:true}).uncheck();
 const muted=page.waitForEvent('download');await page.getByRole('button',{name:'Download instead',exact:true}).click();
 await (await muted).saveAs(resolve(dir,'muted.mp4'));await ready();console.log('PASS cancellation and silent export');
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,'hdr.mov'));
 await page.getByRole('status').filter({hasText:'HDR video needs an SDR copy'}).waitFor({timeout:30000});
 assert.equal(await page.getByRole('button',{name:'Export video',exact:true}).isEnabled(),false);console.log('PASS HDR explicit rejection');
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,'hevc.mov'));
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false||/cannot decode|decoder stopped responding/.test(document.querySelector('.toast')?.textContent??''),null,{timeout:60000});
 console.log('HEVC:',await page.locator('.top-actions .primary').isEnabled()?'decoded successfully':'explicit unsupported-codec message');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const returnImage=Buffer.from(await page.evaluate(async()=>{const canvas=new OffscreenCanvas(64,64),context=canvas.getContext('2d');context.fillStyle='#0b7285';context.fillRect(0,0,64,64);context.fillStyle='#e7f5ff';context.fillRect(12,12,40,40);return Array.from(new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer()));}));
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'return.png',mimeType:'image/png',buffer:returnImage});await ready();assert.equal(await page.getByRole('button',{name:'Export photo',exact:true}).isEnabled(),true);assert.equal(await page.locator('.video-timeline').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS return to photo editing, mobile fit, and no page errors.');
}finally{await browser.close();}
