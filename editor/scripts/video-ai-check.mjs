import {chromium} from 'playwright';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),dir=resolve(root,'analysis/video-check');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.aiSamplesByEngine={};const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);this.currentEngine='unknown';const post=this.postMessage.bind(this);this.postMessage=(data,...transfer)=>{if(data?.recipe?.engine)this.currentEngine=data.recipe.engine;return post(data,...transfer);};this.addEventListener('message',({data})=>{if(data.type==='model-status'&&data.message?.includes('Estimating AI')){const engine=this.currentEngine;window.aiSamplesByEngine[engine]=(window.aiSamplesByEngine[engine]??0)+1;}});}};});
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:5173/');
 if(process.env.CHECK_OFFLINE==='1'){await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);}
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:180000});
 const load=async name=>{await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,name));await ready();};
 const engine=page.getByLabel('Correction engine',{exact:true});
 const samples=engineName=>page.evaluate(name=>window.aiSamplesByEngine[name]??0,engineName);
 const hash=()=>page.locator('canvas[aria-label="Edited photo"]').evaluate(async c=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,c.width,c.height).data))).join(','));
 const choose=async value=>{if(!await engine.isVisible())await page.locator('summary').filter({hasText:/Correction Engine/i}).click();await engine.selectOption(value);await page.waitForTimeout(100);await ready();};
 const exportVideo=async(name,timeout=180000)=>{const download=page.waitForEvent('download',{timeout}),begin=Date.now();try{await page.getByRole('button',{name:'Download instead',exact:true}).click();await (await download).saveAs(resolve(dir,name));await ready();console.log(name+' export: '+(Date.now()-begin)+' ms');}catch(error){const diagnostic={name,elapsedMs:Date.now()-begin,modelSamples:await page.evaluate(()=>window.aiSamplesByEngine),status:await page.getByRole('status').allTextContents(),dialog:await page.locator('.export-dialog').allInnerTexts(),toast:await page.locator('.toast').allTextContents()};console.error('VIDEO EXPORT DIAGNOSTIC '+JSON.stringify(diagnostic));await page.screenshot({path:resolve(dir,'video-ai-timeout.png')}).catch(()=>{});throw error;}};
 await load('sampled.mp4');await page.locator('summary').filter({hasText:'Correction Engine'}).click();
 const balanced=await hash(),begin=Date.now();await choose('shallow');assert.notEqual(await hash(),balanced);console.log('Shallow initial sample: '+(Date.now()-begin)+' ms');
 assert.equal(await page.getByLabel('Video correction',{exact:true}).inputValue(),'sampled');
 await page.getByRole('slider',{name:'Video position',exact:true}).focus();await page.keyboard.press('End');await page.waitForTimeout(100);await ready();
 const cached=await samples('shallow');await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);await ready();assert.equal(await samples('shallow'),cached,'Manual edits must reuse AI analysis');
 if(process.env.CHECK_OFFLINE==='1')await context.setOffline(true);
 await exportVideo('sampled-shallow.mp4');assert.equal(await samples('shallow'),3,'8-second clip at 5-second spacing uses three Shallow samples');
 await page.getByLabel('Video correction',{exact:true}).selectOption('fixed');await page.waitForTimeout(100);await ready();
 const fixedSamples=await samples('shallow');await exportVideo('fixed-shallow.mp4');assert.equal(await samples('shallow'),fixedSamples,'Fixed export must reuse its selected frame');
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
 const beforeLong=await samples('shallow');await choose('shallow');await exportVideo('ten-minutes-ai.mp4',600000);assert.equal(await samples('shallow')-beforeLong,121,'Ten minutes at five-second spacing requires 121 cached transforms');console.log('PASS complete ten-minute sampled AI export');
 await load('sampled.mp4');await choose('wave');await ready();console.log('PASS custom model reuse on another video');
 const photoPng=await page.evaluate(async()=>{const canvas=new OffscreenCanvas(96,72),context=canvas.getContext('2d');context.fillStyle='#176c91';context.fillRect(0,0,96,72);context.fillStyle='#ed9b53';context.fillRect(24,18,48,36);return Array.from(new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()));});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'photo-handoff.png',mimeType:'image/png',buffer:Buffer.from(photoPng)});await ready();await choose('wave');await ready();console.log('PASS custom model handoff to photo worker');
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(dir,'too-long.mp4'));await page.getByRole('status').filter({hasText:'Trim it into shorter clips'}).waitFor({timeout:30000});
 assert.deepEqual(errors,[]);console.log('PASS sampled/fixed AI, cache, custom models, mobile fit, duration boundary and photo regression');
}finally{await browser.close();}
