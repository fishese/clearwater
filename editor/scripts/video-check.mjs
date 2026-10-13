import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),dir=resolve(root,'analysis/video-check');await mkdir(dir,{recursive:true});
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
  assert.equal(await page.getByLabel('Correction engine',{exact:true}).locator('option[value="funie"]').isDisabled(),false);
  await page.locator('summary').filter({hasText:'Correction Engine'}).click();
  console.log('PASS edit/scrub/audio/export '+fixture);
 }
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,'h264-audio.mp4'));await ready();
 // Cancelling during asynchronous setup must leave the same clip editable.
 await page.getByRole('button',{name:'Download instead',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Cancel export',exact:true}).click();
 await ready();assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByLabel('Keep audio',{exact:true}).uncheck();
 const muted=page.waitForEvent('download');await page.getByRole('button',{name:'Download instead',exact:true}).click();
 await (await muted).saveAs(resolve(dir,'muted.mp4'));await ready();console.log('PASS cancellation and silent export');
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,'hdr.mov'));
 await page.getByRole('status').filter({hasText:'HDR/Dolby Vision'}).waitFor({timeout:30000});console.log('PASS HDR explicit rejection');
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,'hevc.mov'));
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false||/cannot decode|decoder stopped responding/.test(document.querySelector('.toast')?.textContent??''),null,{timeout:60000});
 console.log('HEVC:',await page.locator('.top-actions .primary').isEnabled()?'decoded successfully':'explicit unsupported-codec message');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(root,'Sample photos/IMG_7386-green tint.JPG'));await ready();assert.equal(await page.getByRole('button',{name:'Export photo',exact:true}).isEnabled(),true);assert.equal(await page.locator('.video-timeline').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS return to photo editing, mobile fit, and no page errors.');
}finally{await browser.close();}
