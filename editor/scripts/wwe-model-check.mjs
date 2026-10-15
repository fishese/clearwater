import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const expectedPath=resolve(root,'model-tools/weights/wwe_gradient_expected.bin');
const expectedBytes=await readFile(expectedPath);
assert.equal(expectedBytes.length,256*256*3*4,'Run model-tools/export_models.py to create the browser parity fixture.');
const expectedBase64=expectedBytes.toString('base64');
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
 await context.addInitScript(()=>{
  window.wweModelStatuses=[];
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='model-status')window.wweModelStatuses.push(data.message);});}
  };
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.CLEARWATER_URL??'http://127.0.0.1:5173/');
 console.log('App loaded.');

 // Compare the app's actual ONNX Runtime Web WASM residual with the published checkpoint's PyTorch output.
 const wasm=await page.evaluate(async expectedEncoded=>{
  const {inferField}=await import('/src/models.ts');
  const canvas=new OffscreenCanvas(256,256),ctx=canvas.getContext('2d'),image=ctx.createImageData(256,256);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4;image.data[i]=x;image.data[i+1]=y;image.data[i+2]=(x+y)>>1;image.data[i+3]=255;}
  ctx.putImageData(image,0,0);
  const field=await inferField('wwe',canvas),binary=atob(expectedEncoded),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const expected=new Float32Array(bytes.buffer),maxError=field.reduce((max,value,i)=>Math.max(max,Math.abs(value-expected[i])),0);
  return {length:field.length,maxError,finite:field.every(Number.isFinite)};
 },expectedBase64);
 const manifestPath=resolve(root,'editor/public/models/manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 const tolerance=manifest.wwe.parity_tolerance;
 assert.equal(wasm.length,256*256*3);assert.equal(wasm.finite,true);assert.ok(wasm.maxError<=tolerance,`Browser WASM parity error ${wasm.maxError} exceeds ${tolerance}`);
 console.log(`WWE WASM gradient parity max error: ${wasm.maxError}`);

 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:60000});
 const engine=page.getByLabel('Correction engine',{exact:true});
 const openEngine=()=>page.locator('details').filter({has:page.locator('summary',{hasText:'Correction Engine'})}).evaluate(element=>{element.open=true;});
 const hash=()=>page.locator('canvas[aria-label="Edited photo"]').evaluate(async canvas=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data))).join(','));

 // Generate a synthetic image in the browser and exercise photo preview plus export.
 const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d'),image=ctx.createImageData(256,256);for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4;image.data[i]=x;image.data[i+1]=y;image.data[i+2]=(x+y)>>1;image.data[i+3]=255;}ctx.putImageData(image,0,0);return canvas.toDataURL('image/png').split(',')[1];});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'wwe-synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 console.log('Synthetic photo selected.');await ready();console.log('Photo ready.');await openEngine();
 const balanced=await hash();await engine.selectOption('wwe');await ready();
 console.log('WWE photo preview ready.');
 assert.notEqual(await hash(),balanced,'WWE-UIE should change the synthetic photo preview.');
 assert.match(await page.getByLabel('Correction engine').locator('option:checked').innerText(),/WWE-UIE/);
 const warmth=page.getByRole('slider',{name:'Warmth',exact:true});await warmth.focus();await page.keyboard.press('ArrowRight');await ready();assert.equal(await warmth.inputValue(),'1','Manual settings remain available with WWE.');
 await page.locator('details').filter({has:page.locator('summary',{hasText:'Export'})}).evaluate(element=>{element.open=true;});
 const download=page.waitForEvent('download',{timeout:180000});
 const directDownload=page.getByRole('button',{name:'Download instead',exact:true});
 if(await directDownload.count())await directDownload.click();else await page.getByRole('button',{name:'Export photo',exact:true}).click();
 const photo=await download;assert.match(photo.suggestedFilename(),/wwe-synthetic-restore\.jpg$/i);
 assert.ok((await readFile(await photo.path())).length>1000);
 console.log('WWE photo preview and export passed.');

 // Existing fixture is generated from FFmpeg testsrc2/sine, not user media.
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(root,'analysis/video-check/sampled.mp4'));
 console.log('Synthetic video selected.');await ready();console.log('Video ready.');await openEngine();await engine.selectOption('wwe');await ready();
 assert.equal(await page.getByLabel('Video correction',{exact:true}).inputValue(),'sampled');
 await page.waitForFunction(()=>window.wweModelStatuses.some(value=>value==='Estimating AI colour from sampled frames…'),null,{timeout:120000});
 assert.notEqual(await hash(),balanced,'WWE-UIE video analysis should produce a corrected frame.');
 assert.deepEqual(errors,[]);

 manifest.wwe.wasm_gradient_max_abs_parity_error=wasm.maxError;
 await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 console.log('WWE video AI preview passed.');
}finally{await browser.close();}
