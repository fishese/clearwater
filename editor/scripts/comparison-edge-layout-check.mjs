import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {chromium,webkit} from 'playwright';

const isWebKit=process.env.CHECK_BROWSER==='webkit';
// Playwright normally hides scrollbars. Keep them enabled to catch feedback
// between comparison overflow, classic scrollbar gutters and ResizeObserver.
const browser=await (isWebKit?webkit.launch():chromium.launch({
 ...(process.env.CHECK_BROWSER==='chromium'?{}:{channel:process.env.CHECK_BROWSER??'chrome'}),
 ignoreDefaultArgs:['--hide-scrollbars'],
}));
try{
 const page=await browser.newPage({viewport:{width:1440,height:720}});
 await page.goto(process.env.CHECK_URL??'http://127.0.0.1:4200/');
 if(process.env.CHECK_SAMPLE)await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(process.env.CHECK_SAMPLE));
 else{
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d');x.fillStyle='#438998';x.fillRect(0,0,c.width,c.height);return c.toDataURL().split(',')[1];});
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'wide-layout.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 }
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 for(const selector of ['.storage-warning button','.web-update-hint-ok'])if(await page.locator(selector).isVisible())await page.locator(selector).click();
 const slider=page.locator('.comparison-input'),value=()=>slider.getAttribute('aria-valuenow').then(Number);
 const sample=()=>page.evaluate(async()=>{
  const frames=[];
  for(let i=0;i<60;i++){
   await new Promise(requestAnimationFrame);
   const stage=document.querySelector('.stage'),frame=document.querySelector('.image-frame').getBoundingClientRect();
   frames.push({width:frame.width,height:frame.height,clientWidth:stage.clientWidth,clientHeight:stage.clientHeight,scrollWidth:stage.scrollWidth,scrollHeight:stage.scrollHeight});
  }
  return frames;
 });
 for(const expanded of [false,true]){
  if(expanded)await page.getByRole('button',{name:'Expand photo',exact:true}).click();
  await page.getByRole('button',{name:'Fit',exact:true}).click();
  // Tune the viewport near the fit boundary where the old layout oscillated.
  const delta=await page.evaluate(()=>{
   const stage=document.querySelector('.stage'),canvas=document.querySelector('.image-frame canvas');
   const aspect=canvas.width/canvas.height;
   return Math.round((stage.clientWidth-36)/aspect+4-stage.clientHeight);
  });
  const viewport=page.viewportSize();await page.setViewportSize({width:1440,height:Math.max(500,viewport.height+delta)});
  for(const edge of [100,0,100]){
   await slider.focus();await page.keyboard.press('Home');for(let i=0;i<5;i++)await page.keyboard.press('PageUp');await page.waitForTimeout(100);
   const centered=(await sample()).at(-1);
   await slider.focus();await page.keyboard.press(edge?'End':'Home');await page.waitForTimeout(100);
   assert.equal(await value(),edge);
   const frames=await sample(),sizes=new Set(frames.map(({width,height,clientWidth,clientHeight})=>JSON.stringify([width,height,clientWidth,clientHeight])));
   assert.equal(sizes.size,1,`expanded=${expanded}, edge=${edge}: preview size must settle; ${JSON.stringify([...sizes])}`);
   assert.ok(frames.every(f=>f.scrollWidth<=centered.scrollWidth+1&&f.scrollHeight<=centered.scrollHeight+1&&f.clientWidth===centered.clientWidth&&f.clientHeight===centered.clientHeight),`Edge must not add scrollbars to centered Fit: ${JSON.stringify({centered,edge:frames[0]})}`);
   const frame=await page.locator('.image-frame').boundingBox(),band=await slider.boundingBox();
   assert.ok(band.x>=frame.x-.1&&band.x+band.width<=frame.x+frame.width+.1,'full hit band stays inside image at both ends');
   const handle=await page.locator('.divider-line>span').boundingBox();
   assert.ok(handle.x>=frame.x-.1&&handle.x+handle.width<=frame.x+frame.width+.1,'visible handle stays inside image');
   assert.ok(Math.abs(handle.x+handle.width/2-band.x-band.width/2)<.1,'visible handle and hit band stay aligned');
   // Grab the full-height band away from the visible handle, and drag inward.
   const x=band.x+band.width/2,y=frame.y+20,dx=edge?-35:35;
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:5});await page.mouse.up();
   assert.ok(Math.abs(await value()-(edge+dx/frame.width*100))<.5,'edge drag keeps the grab offset');
  }
  // Zoom may intentionally add scrollbars, but divider changes cannot resize it.
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();await slider.focus();await page.keyboard.press('End');await page.waitForTimeout(100);
  const zoomed=await sample();assert.equal(new Set(zoomed.map(f=>JSON.stringify([f.width,f.height]))).size,1,'zoomed preview stays stable');
  await page.getByRole('button',{name:'Fit',exact:true}).click();
  if(expanded)await page.getByRole('button',{name:'Exit expanded view',exact:true}).click();
 }
 console.log(`PASS ${isWebKit?'WebKit':'Chromium with scrollbars enabled'} comparison edge stability, full-height edge drags, Fit/150%, normal/expanded; ${process.env.CHECK_SAMPLE?'local media':'synthetic wide photo'}`);
}finally{await browser.close();}
