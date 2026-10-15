import {chromium} from 'playwright';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),dir=resolve(root,'analysis/video-check');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.aiSamples=0;const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='model-status'&&data.message?.includes('Estimating AI'))window.aiSamples++;});}};});
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:5173/');
 if(process.env.CHECK_OFFLINE==='1'){await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);}
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:180000});
 const load=async name=>{await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,name));await ready();};
 const engine=page.getByLabel('Correction engine',{exact:true});
 const hash=()=>page.locator('canvas[aria-label="Edited photo"]').evaluate(async c=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,c.width,c.height).data))).join(','));
 const choose=async value=>{if(!await engine.isVisible())await page.locator('summary').filter({hasText:/Correction Engine/i}).click();await engine.selectOption(value);await page.waitForTimeout(100);await ready();};
 const exportVideo=async name=>{const download=page.waitForEvent('download',{timeout:180000}),begin=Date.now();await page.getByRole('button',{name:'Download instead',exact:true}).click();await (await download).saveAs(resolve(dir,name));await ready();console.log(name+' export: '+(Date.now()-begin)+' ms');};
 await load('sampled.mp4');await page.locator('summary').filter({hasText:'Correction Engine'}).click();
 const balanced=await hash(),begin=Date.now();await choose('shallow');assert.notEqual(await hash(),balanced);console.log('Shallow initial sample: '+(Date.now()-begin)+' ms');
 assert.equal(await page.getByLabel('Video correction',{exact:true}).inputValue(),'sampled');
 await page.getByRole('slider',{name:'Video position',exact:true}).focus();await page.keyboard.press('End');await page.waitForTimeout(100);await ready();
 const cached=await page.evaluate(()=>window.aiSamples);await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);await ready();assert.equal(await page.evaluate(()=>window.aiSamples),cached,'Manual edits must reuse AI analysis');
 if(process.env.CHECK_OFFLINE==='1')await context.setOffline(true);
 await exportVideo('sampled-shallow.mp4');assert.equal(await page.evaluate(()=>window.aiSamples),3,'8-second clip at 5-second spacing uses three samples');
 await page.getByLabel('Video correction',{exact:true}).selectOption('fixed');await page.waitForTimeout(100);await ready();
 const fixedSamples=await page.evaluate(()=>window.aiSamples);await exportVideo('fixed-shallow.mp4');assert.equal(await page.evaluate(()=>window.aiSamples),fixedSamples,'Fixed export must reuse its selected frame');
 await page.getByLabel('Video correction',{exact:true}).selectOption('sampled');await page.getByLabel('AI sample interval',{exact:true}).selectOption('2');await page.waitForTimeout(100);await ready();
 await page.getByRole('button',{name:'Download instead',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Cancel export',exact:true}).click();await ready();assert.equal(await page.getByRole('dialog').count(),0);console.log('PASS cancellation during sampled analysis');
 if(process.env.CHECK_OFFLINE==='1')await context.setOffline(false);
 await choose('fivea');await exportVideo('sampled-fivea.mp4');
 // A bundled unit-range file, loaded with signed ranges, checks the generic adapter.
 await engine.selectOption('wave');await page.getByLabel('ONNX model file',{exact:true}).setInputFiles(resolve(root,'editor/public/models/shallow.onnx'));
 await page.getByLabel('Model input range',{exact:true}).selectOption('signed');await page.getByLabel('Model output range',{exact:true}).selectOption('signed');
 await page.getByRole('checkbox',{name:/I have permission/}).check();await page.getByRole('button',{name:'Load model',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden',timeout:120000});await page.waitForTimeout(100);await ready();
 await exportVideo('sampled-custom.mp4');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:900});
 await load('ten-minutes.mp4');assert.equal(await page.getByRole('slider',{name:'Video position',exact:true}).getAttribute('max'),'599.999');
 await page.getByRole('slider',{name:'Video position',exact:true}).focus();await page.keyboard.press('End');await page.waitForTimeout(100);await ready();await exportVideo('ten-minutes-edited.mp4');console.log('PASS ten-minute import, end seek and export');
 const beforeLong=await page.evaluate(()=>window.aiSamples);await choose('shallow');await exportVideo('ten-minutes-ai.mp4');assert.equal(await page.evaluate(()=>window.aiSamples)-beforeLong,121,'Ten minutes at five-second spacing requires 121 cached transforms');console.log('PASS complete ten-minute sampled AI export');
 await load('sampled.mp4');await choose('wave');await ready();console.log('PASS custom model reuse on another video');
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(root,'Sample photos/IMG_7386-green tint.JPG'));await ready();await choose('wave');await ready();console.log('PASS custom model handoff to photo worker');
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,'too-long.mp4'));await page.getByRole('status').filter({hasText:'10 minutes'}).waitFor({timeout:30000});
 assert.deepEqual(errors,[]);console.log('PASS sampled/fixed AI, cache, custom models, mobile fit, duration boundary and photo regression');
}finally{await browser.close();}
