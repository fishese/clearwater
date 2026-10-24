import {chromium} from 'playwright';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../..');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},hasTouch:true});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:4176/');
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve(root,'analysis/video-check/sampled.mp4'));
 await ready();
 const controlTrack=await page.locator('.compact-controls .restoration-row input[type="range"]').evaluate(el=>({height:el.getBoundingClientRect().height,gap:parseFloat(getComputedStyle(el.previousElementSibling).marginBottom)}));
 assert.ok(controlTrack.height>=44,`control slider keeps a 44px target (${controlTrack.height}px)`);assert.ok(controlTrack.gap<=4,`slider title gap stays compact (${controlTrack.gap}px)`);
 const play=()=>page.getByRole('button',{name:'Play video preview',exact:true});
 const pause=()=>page.getByRole('button',{name:'Pause video preview',exact:true});
 const position=page.getByRole('slider',{name:'Video position',exact:true});
 const time=()=>position.inputValue().then(Number);
 await play().click();
 await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Video position"]')?.value)>0.1,null,{timeout:20000});
 await pause().click();const pausedAt=await time();await page.waitForTimeout(350);assert.ok(Math.abs(await time()-pausedAt)<.05,'pause holds the playhead');
 await position.evaluate(el=>{el.value='6.8';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Video position"]')?.value)>6.7);await ready();
 await play().click();await play().waitFor({state:'visible',timeout:20000});
 await page.getByRole('button',{name:'Play video preview',exact:true}).waitFor({timeout:20000});
 assert.ok(await time()>7.8,'playback reaches the end and stops');
 await position.evaluate(el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
 await play().click();
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('button',{name:'Play video preview',exact:true}).waitFor({timeout:3000});
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 const seek=async(seconds)=>{await position.evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},seconds);await ready();};
 await seek(1);await play().click();await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Video position"]')?.value)>1.05);await page.evaluate(()=>{window.location.hash='#about';});
 await page.getByRole('button',{name:'Back to editor',exact:true}).waitFor();await page.locator('button[aria-label="Play video preview"]').waitFor({state:'attached'});
 await page.getByRole('button',{name:'Back to editor',exact:true}).click();await play().waitFor();
 await page.locator('.settings-group').filter({hasText:'Correction Engine'}).locator('summary').click();
 await page.getByLabel('Correction engine',{exact:true}).selectOption('wave');await page.getByRole('dialog',{name:'Load other ONNX model'}).waitFor();
 await page.locator('button[aria-label="Play video preview"]').waitFor({state:'attached'});await page.getByRole('button',{name:'Cancel',exact:true}).click();await play().waitFor();
 await page.evaluate(()=>{window.showDirectoryPicker=async()=>({name:'Output'});});
 await page.locator('button[data-control-tab="export"]').evaluate(el=>el.click());await ready();await play().click();
 await pause().click();await ready();await page.getByRole('button',{name:'Save as…',exact:true}).click();await page.locator('.save-dialog').waitFor({state:'visible'});
 await page.locator('button[aria-label="Play video preview"]').waitFor({state:'attached'});await page.getByRole('button',{name:'Cancel',exact:true}).click();await play().waitFor();
 console.log('PASS video play, pause, seek, end, background, About, custom-model, and Save as pause');

 // With comparison active, drags away from its 44px handle band pan at zoom in both layouts.
 const divider=page.locator('.comparison-input');
 const panMouse=async()=>{
  await page.getByRole('button',{name:'Toggle comparison',exact:true}).evaluate(el=>{if(el.classList.contains('active'))el.click();});
  await page.getByRole('button',{name:'Toggle comparison',exact:true}).evaluate(el=>{if(!el.classList.contains('active'))el.click();});
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  const before=Number(await divider.getAttribute('aria-valuenow')),state=await page.evaluate(()=>{const s=document.querySelector('.stage'),r=s.getBoundingClientRect();return {left:s.scrollLeft,top:s.scrollTop,x:r.left+r.width*.65,y:r.top+r.height*.25};});
  await page.mouse.move(state.x,state.y);await page.mouse.down();await page.mouse.move(state.x-75,state.y-60,{steps:5});await page.mouse.up();
  const after=await page.evaluate(()=>({left:document.querySelector('.stage').scrollLeft,top:document.querySelector('.stage').scrollTop}));
  assert.ok(after.left>state.left||after.top>state.top,`drag outside comparison handle band pans (${after.left},${after.top})`);
  assert.equal(Number(await divider.getAttribute('aria-valuenow')),before,'pan leaves comparison divider unchanged');
 };
 const panTouch=async()=>{
  for(let i=0;i<2;i++)await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  const before=Number(await divider.getAttribute('aria-valuenow')),state=await page.evaluate(()=>{const s=document.querySelector('.stage'),r=s.getBoundingClientRect();return {left:s.scrollLeft,top:s.scrollTop,x:r.left+r.width*.65,y:r.top+r.height*.25};});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:state.x,y:state.y,id:71,radiusX:2,radiusY:2,force:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:state.x-70,y:state.y-50,id:71,radiusX:2,radiusY:2,force:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const after=await page.evaluate(()=>({left:document.querySelector('.stage').scrollLeft,top:document.querySelector('.stage').scrollTop}));
  assert.ok(after.left>state.left||after.top>state.top,`touch drag outside comparison band pans (${after.left},${after.top})`);
  assert.equal(Number(await divider.getAttribute('aria-valuenow')),before,'touch pan leaves comparison divider unchanged');
 };
 await panMouse();
 await panTouch();
 await page.getByRole('button',{name:'Fit',exact:true}).click();await page.getByRole('button',{name:'Expand photo',exact:true}).click();
 await panMouse();await panTouch();
 await page.getByRole('button',{name:'Exit expanded view',exact:true}).click();
 console.log('PASS mouse pan in normal and expanded views with comparison active');

 // A single-finger drag with the neutral picker armed pans; a stationary tap still samples.
 const grayPng=await page.evaluate(async()=>{const c=new OffscreenCanvas(800,600),x=c.getContext('2d');x.fillStyle='#777';x.fillRect(0,0,400,600);x.fillStyle='#a54b40';x.fillRect(400,0,400,600);return new Uint8Array(await(await c.convertToBlob({type:'image/png'})).arrayBuffer());});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'preview-picker.png',mimeType:'image/png',buffer:Buffer.from(grayPng)});await ready();
 await page.getByRole('button',{name:'Expand photo',exact:true}).click();
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 await page.locator('.canvas-tools button[aria-label="Pick neutral point"]').click();
 const bounds=await page.locator('.image-frame').boundingBox(),startX=bounds.x+bounds.width*.25,startY=bounds.y+bounds.height*.3;
 const beforeUndo=await page.getByRole('button',{name:'Undo',exact:true}).isDisabled();
 await page.mouse.move(startX,startY);await page.mouse.down();await page.mouse.move(startX-65,startY-45,{steps:5});await page.mouse.up();
 assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).isDisabled(),beforeUndo,'dragging does not make a neutral-point edit');
 assert.equal(await page.locator('.canvas-tools button[aria-label="Pick neutral point"]').getAttribute('class'),'active','drag leaves picker armed');
 await page.getByRole('button',{name:'Fit',exact:true}).click();
 const fit=await page.locator('.image-frame').boundingBox();await page.mouse.click(fit.x+fit.width*.25,fit.y+fit.height*.5);
 await page.getByText('Neutral point applied. Undo if the selected area was not white or grey.',{exact:true}).waitFor({timeout:5000});
 assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).isDisabled(),false,'stationary picker tap applies the neutral point');

 // Start the clip again then switch to the photo: the old playback session must stop.
 await page.locator('.photo-select[title="sampled.mp4"]').evaluate(el=>el.click());await ready();await play().click();
 await page.locator('.photo-select[title="preview-picker.png"]').evaluate(el=>el.click());await ready();
 assert.equal(await page.getByRole('button',{name:'Play video preview',exact:true}).count(),0,'switching away stops video playback');
 assert.deepEqual(errors,[]);
 console.log('PASS picker drag/tap, playback stop on switch, no page errors');
}finally{await browser.close();}
