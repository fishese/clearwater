import {chromium} from 'playwright';
import {mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const url=process.env.CHECK_URL??'http://127.0.0.1:5173/';
await mkdir('../analysis/enhancement-check',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1360,height:950}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 const action=async name=>{const prior=await page.locator('canvas[aria-label="Edited photo"]').getAttribute('data-request');await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(prior=>document.querySelector('canvas[aria-label="Edited photo"]')?.dataset.request!==prior,prior);await ready();};
 const hash=()=>page.locator('canvas[aria-label="Edited photo"]').evaluate(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=0;for(const v of p)hash=(hash*31+v)|0;return hash;});
 const data=await page.evaluate(async()=>{const c=new OffscreenCanvas(300,600),ctx=c.getContext('2d'),g=ctx.createLinearGradient(0,0,300,600);g.addColorStop(0,'#417781');g.addColorStop(1,'#aabbb1');ctx.fillStyle=g;ctx.fillRect(0,0,300,600);ctx.strokeStyle='#6d9696';for(let y=0;y<600;y+=9){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(300,y);ctx.stroke();}return Array.from(new Uint8Array(await (await c.convertToBlob()).arrayBuffer()));});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'enhancement-test.png',mimeType:'image/png',buffer:Buffer.from(data)});await ready();const before=await hash();
 await action('Auto enhance');const after=await hash();assert.notEqual(after,before);assert.equal(await page.getByRole('slider',{name:'Auto contrast',exact:true}).inputValue(),'80');
 await action('Undo');assert.equal(await hash(),before);await action('Redo');assert.equal(await hash(),after);
 const brightness=page.getByRole('slider',{name:'Brightness',exact:true});await brightness.focus();await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('input[aria-label="Brightness"]')?.value==='100');await ready();
 const brightAfter=await hash();assert.notEqual(brightAfter,after);await action('Undo');assert.equal(await hash(),after);await action('Redo');assert.equal(await hash(),brightAfter);
 // PNG export should match a same-size preview, including rows at strip boundaries and the brightness adjustment.
 await page.getByRole('combobox',{name:'File format'}).selectOption('png');const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download instead',exact:true}).click();const d=await wait,bytes=await readFile(await d.path());
 const diff=await page.evaluate(async bytes=>{const b=await createImageBitmap(new Blob([new Uint8Array(bytes)])),canvas=new OffscreenCanvas(b.width,b.height),ctx=canvas.getContext('2d');ctx.drawImage(b,0,0);const output=ctx.getImageData(0,0,b.width,b.height).data,preview=document.querySelector('canvas[aria-label="Edited photo"]').getContext('2d').getImageData(0,0,b.width,b.height).data;let max=0;for(let i=0;i<output.length;i++)max=Math.max(max,Math.abs(output[i]-preview[i]));return max;},Array.from(bytes));assert.equal(diff,0);
 await action('Clear enhancement');assert.equal(await hash(),before);
 for(const locale of ['zh-HK','ja','en']){await page.locator('.brand-cluster .language-select').selectOption(locale);await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 if(process.env.CHECK_SAMPLES==='1'){
  const names=await page.evaluate(()=>fetch('/__samples').then(r=>r.json()));
  for(let index=0;index<Math.min(names.length,Number(process.env.CHECK_SAMPLE_LIMIT??names.length));index++){
   const name=names[index];await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name,mimeType:/\.hei[cf]$/i.test(name)?'image/heic':'image/jpeg',buffer:Buffer.from(await page.evaluate(async name=>Array.from(new Uint8Array(await (await fetch('/__sample/'+encodeURIComponent(name))).arrayBuffer())),name))});await ready();
   const save=async suffix=>{await page.locator('canvas[aria-label="Edited photo"]').screenshot({path:`../analysis/enhancement-check/${index}-${suffix}.png`});};
   await save('before');const original=await hash();await action('Auto enhance');assert.notEqual(await hash(),original);await save('after');
   if(index===0){await page.locator('.settings-group').filter({has:page.getByLabel('Correction engine',{exact:true})}).locator('summary').click();await page.getByLabel('Correction engine',{exact:true}).selectOption('shallow');await ready();await save('shallow');await action('Auto enhance');await save('shallow-enhanced');
    if(process.env.CHECK_FULL_EXPORT==='1'){await page.getByRole('combobox',{name:'File format'}).selectOption('jpg');const started=Date.now(),wait=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'Download instead',exact:true}).click();const d=await wait,bytes=await readFile(await d.path());const pixels=await page.evaluate(async bytes=>{const b=await createImageBitmap(new Blob([new Uint8Array(bytes)]));const area=b.width*b.height;b.close();return area;},Array.from(bytes));assert.ok(pixels>10_000_000);console.log('PASS full-resolution enhanced neural export: '+(pixels/1e6).toFixed(1)+' MP, '+((Date.now()-started)/1000).toFixed(1)+' s on this desktop');}
   }
  }
  console.log('PASS local comparison previews generated');
 }
 assert.deepEqual(errors,[]);console.log('PASS enhancement changes, undo/redo/clear, PNG preview/export parity and three-language mobile layout');
}finally{await browser.close();}
