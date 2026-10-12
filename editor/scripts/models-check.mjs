import {chromium} from 'playwright';
import {readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),url=process.env.CLEARWATER_URL??'http://127.0.0.1:4173';
await mkdir(root+'/analysis/browser-check',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);
await page.reload();
const names=(await readdir(root+'/Sample photos')).filter(n=>/\.(heic|jpg)$/i.test(n));
const results=[];
const ready=()=>page.waitForFunction(()=>!document.querySelector('.top-actions .primary').disabled,{timeout:180000});
const stats=()=>page.evaluate(()=>{const c=document.querySelector('canvas[aria-label="Edited photo"]'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const sums=[0,0,0];let n=0;for(let i=0;i<d.length;i+=64){n++;for(let ch=0;ch<3;ch++)sums[ch]+=d[i+ch];}return sums.map(v=>Math.round(v/n));});
for(const name of names){
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles(root+'/Sample photos/'+name);await ready();
  await page.locator('details').filter({has:page.locator('summary',{hasText:'Correction Engine'})}).evaluate(el=>el.open=true);
  for(const model of ['shallow','funie','wave']){
    const start=Date.now();await page.getByLabel('Correction engine',{exact:true}).selectOption(model);
    if(model==='wave'&&name===names[0]){
      const unlock=page.getByRole('button',{name:'Load model',exact:true});
      assert.equal(await unlock.isDisabled(),true);
      await page.getByLabel('ONNX model file',{exact:true}).setInputFiles(root+'/model-tools/weights/deep-wavenet-research.onnx');
      assert.equal(await unlock.isDisabled(),true);
      await page.getByRole('checkbox').check();await unlock.click();
      await page.getByRole('dialog').waitFor({state:'hidden',timeout:120000});
    }
    await ready();
    assert.equal(await page.getByLabel('Correction engine',{exact:true}).inputValue(),model);
    const result={name,model,ms:Date.now()-start,mean:await stats()};results.push(result);console.log(JSON.stringify(result));
    if(name===names[0])await page.screenshot({path:root+`/analysis/browser-check/model-${model}.png`});
  }
}
// Research recipes require acknowledgement and a local model again after reload.
await page.waitForTimeout(600);await page.reload();
await page.getByRole('dialog').waitFor();
await page.getByRole('button',{name:'Cancel',exact:true}).click();await ready();
await page.locator('details').filter({has:page.locator('summary',{hasText:'Correction Engine'})}).evaluate(el=>el.open=true);
// Cached inference still permits finishing; rapid changes cannot overwrite the latest result.
await page.getByLabel('Correction engine',{exact:true}).selectOption('shallow');
await page.getByLabel('Correction engine',{exact:true}).selectOption('balanced');await ready();
await page.getByLabel('Correction engine',{exact:true}).selectOption('funie');await ready();
await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('ArrowUp');await ready();
assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'1');
await page.getByRole('button',{name:'Undo',exact:true}).click();await ready();
assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'0');
// Neural export retains the dimensions of the original last sample.
const downloaded=page.waitForEvent('download',{timeout:180000});await page.getByRole('button',{name:'Download instead',exact:true}).click();
await (await downloaded).saveAs(root+'/analysis/browser-check/export-neural.jpg');
await page.waitForFunction(()=>!document.querySelector('.modal-shade'));
await page.waitForTimeout(600);await context.setOffline(true);await page.reload();await ready();
await page.locator('details').filter({has:page.locator('summary',{hasText:'Correction Engine'})}).evaluate(el=>el.open=true);
for(const model of ['shallow','funie']){await page.getByLabel('Correction engine',{exact:true}).selectOption(model);await ready();}
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
await writeFile(root+'/analysis/browser-check/model-results.json',JSON.stringify({results,errors,external,offline:true},null,2));
console.log('PASS: three models, custom model permission and reload, all samples, manual edits, export, offline.');await browser.close();
