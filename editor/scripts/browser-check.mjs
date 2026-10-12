import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.env.CLEARWATER_PROJECT_ROOT??resolve(import.meta.dirname,'../..');
await mkdir(root+'/analysis/browser-check',{recursive:true});
const browser=await chromium.launch({channel:process.env.CLEARWATER_BROWSER??'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5173/');
await page.getByRole('heading',{name:'Photo editor'}).waitFor();
const names=(await readdir(root+'/Sample photos')).filter(n=>/\.(heic|jpg)$/i.test(n));
const results=[];
for(const name of names){
  const start=Date.now();
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles(root+'/Sample photos/'+name);
  await page.getByRole('button',{name:'Export photo',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('.top-actions .primary').disabled,{timeout:120000});
  await page.waitForFunction(()=>{const c=document.querySelector('canvas[aria-label="Edited photo"]');return c&&c.width>500&&c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data[3]>0;},{timeout:30000});
  await page.waitForTimeout(250);
  const stats=await page.evaluate(()=>{
    const result={};for(const label of ['Original photo','Edited photo']){const c=document.querySelector(`canvas[aria-label="${label}"]`),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let r=0,g=0,b=0,n=0;for(let i=0;i<d.length;i+=64){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}result[label]={width:c.width,height:c.height,mean:[r/n,g/n,b/n].map(v=>Math.round(v))};}return result;
  });
  const result={name,ms:Date.now()-start,stats,suggestion:await page.locator('.suggestion').textContent()};results.push(result);console.log(JSON.stringify(result));
  if(name==='IMG_6085-blue.HEIC'){
    await page.screenshot({path:root+'/analysis/browser-check/editor-blue.png',fullPage:true});
    const downloadPromise=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'Download instead',exact:true}).click();
    const download=await downloadPromise;await download.saveAs(root+'/analysis/browser-check/export-blue.jpg');
    await page.waitForFunction(()=>!document.querySelector('.modal-shade'));
    console.log('EXPORT '+download.suggestedFilename());
    
    const warmth=page.getByRole('slider',{name:'Warmth',exact:true});await warmth.focus();await warmth.press('ArrowUp');assert.equal(await warmth.inputValue(),'1');
    await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await warmth.inputValue(),'0');
    await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await warmth.inputValue(),'1');
    await page.getByRole('button',{name:'Reset all edits',exact:true}).click();assert.equal(await warmth.inputValue(),'0');
    
    const strength=page.getByRole('slider',{name:'Restoration strength',exact:true});await strength.fill('0');await page.waitForTimeout(500);
    const diff=await page.evaluate(()=>{const a=document.querySelector('canvas[aria-label="Original photo"]'),b=document.querySelector('canvas[aria-label="Edited photo"]');const x=a.getContext('2d').getImageData(0,0,a.width,a.height).data,y=b.getContext('2d').getImageData(0,0,b.width,b.height).data;let max=0;for(let i=0;i<x.length;i+=4)max=Math.max(max,Math.abs(x[i]-y[i]),Math.abs(x[i+1]-y[i+1]),Math.abs(x[i+2]-y[i+2]));return max;});assert.ok(diff<=1,'Strength zero must match original');
    await strength.fill('80');
  }
  if(name==='IMG_6788-red filter.HEIC')await page.screenshot({path:root+'/analysis/browser-check/editor-magenta.png',fullPage:true});
}

await page.setViewportSize({width:390,height:844});await page.screenshot({path:root+'/analysis/browser-check/editor-mobile.png',fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile page should not overflow horizontally');
await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===9);console.log('PERSISTENCE 9 photos restored');
await writeFile(root+'/analysis/browser-check/results.json',JSON.stringify({results,errors},null,2));
assert.deepEqual(errors,[]);await browser.close();console.log('Browser checks passed.');
