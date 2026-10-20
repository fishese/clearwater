import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

// No worker overrides or routed assets: exercise the same preview path as a user.
const engine=process.env.CHECK_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch(engine===webkit?{headless:true}:{headless:true,channel:process.env.CHECK_BROWSER??'msedge'});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.CHECK_URL??'http://127.0.0.1:5191/');
 const images=await page.evaluate(async()=>{
  const result=[];
  for(const [base,accent] of [['#146280','#63a981'],['#70417d','#d18b45']]){
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
   const c=canvas.getContext('2d');c.fillStyle=base;c.fillRect(0,0,640,480);c.fillStyle=accent;c.fillRect(120,90,400,300);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
   result.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
  }
  return result;
 });
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(images.map((bytes,index)=>({name:`smoke-${index+1}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from(bytes)})));
 const canvas=page.locator('canvas[aria-label="Edited photo"]');
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 const hash=()=>canvas.evaluate(c=>{let h=2166136261;for(const value of c.getContext('2d').getImageData(0,0,c.width,c.height).data)h=Math.imul(h^value,16777619);return h>>>0;});
 await ready();
 if(await page.locator('#web-update-hint-text').isVisible())await page.getByRole('button',{name:'OK',exact:true}).click();
 const request=await canvas.getAttribute('data-request');
 await page.getByRole('slider',{name:'Warmth',exact:true}).evaluate(input=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'10');
  input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.waitForFunction(prior=>document.querySelector('canvas[aria-label="Edited photo"]')?.dataset.request!==prior,request);await ready();
 const firstHash=await hash();
 for(let index=0;index<4;index++){
  const generation=await canvas.getAttribute('data-generation');
  await page.getByRole('button',{name:index%2===0?'Next photo':'Previous photo',exact:true}).click();
  await page.waitForFunction(prior=>document.querySelector('canvas[aria-label="Edited photo"]')?.dataset.generation!==prior,generation);await ready();
  const current=await hash();
  if(index%2===0)assert.notEqual(current,firstHash,'other JPG must have different pixels');
  else assert.equal(current,firstHash,'returning to the first JPG preserves its edits');
 }
 assert.deepEqual(errors,[]);
 console.log(`PASS ${process.env.CHECK_BROWSER??'Chromium'} photo editing and repeated JPG switching without worker hooks`);
}finally{await browser.close();}
