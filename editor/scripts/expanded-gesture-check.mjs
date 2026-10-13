import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const url=process.env.CHECK_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true});
 await page.goto(url);
 const makePng=(width,height,colour='#b8a99a')=>page.evaluate(({width,height,colour})=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle=colour;ctx.fillRect(0,0,width,height);return canvas.toDataURL('image/png').split(',')[1];},{width,height,colour});
 const landscape=await makePng(960,540);
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'landscape.png',mimeType:'image/png',buffer:Buffer.from(landscape,'base64')});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 await page.getByRole('button',{name:'Expand photo',exact:true}).click();
 const assertFits=async()=>{
  await page.waitForFunction(()=>{const s=document.querySelector('.stage'),f=document.querySelector('.image-frame');return s&&f&&s.clientWidth>100&&s.clientHeight>100&&f.clientWidth>1&&f.getBoundingClientRect().width<=s.clientWidth-20&&f.getBoundingClientRect().height<=s.clientHeight-20;},null,{timeout:5000});
  const {stage,frame}=await page.evaluate(()=>({stage:{width:document.querySelector('.stage').clientWidth,height:document.querySelector('.stage').clientHeight},frame:{width:document.querySelector('.image-frame').getBoundingClientRect().width,height:document.querySelector('.image-frame').getBoundingClientRect().height}}));
  assert.ok(frame.width<=stage.width-20,`frame width ${frame.width} must fit stage width ${stage.width}`);
  assert.ok(frame.height<=stage.height-20,`frame height ${frame.height} must fit stage height ${stage.height}`);
 };
 await assertFits();
 const overlay=page.locator('.expanded-zoom-controls');assert.equal(await overlay.isVisible(),true);
 await page.getByRole('button',{name:'Zoom in'}).click();
 assert.match(await overlay.innerText(),/150%/);
 await page.getByRole('button',{name:'Fit',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await assertFits();
 await page.getByRole('button',{name:'Toggle adjustments'}).click();
 const mobileBounds=await page.evaluate(()=>({zoom:document.querySelector('.expanded-zoom-controls').getBoundingClientRect().toJSON(),panel:document.querySelector('.controls').getBoundingClientRect().toJSON(),stage:document.querySelector('.stage').getBoundingClientRect().toJSON()}));
 assert.ok(mobileBounds.zoom.bottom<=mobileBounds.panel.top+1,'zoom controls stay above the mobile adjustment sheet');
 assert.ok(mobileBounds.zoom.left>=mobileBounds.stage.left-1&&mobileBounds.zoom.right<=mobileBounds.stage.right+1,'zoom controls stay inside the stage width');

 // A two-pointer gesture over the comparison range zooms the image without moving its divider.
 await page.getByRole('button',{name:'Toggle adjustments'}).click();
 const comparison=page.locator('.comparison-input');
 const beforeDivider=Number(await comparison.inputValue());
 const cdp=await page.context().newCDPSession(page),cmpBox=await comparison.boundingBox(),cmpX=cmpBox.x+cmpBox.width/2,cmpY=cmpBox.y+cmpBox.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cmpX-50,y:cmpY,id:1,radiusX:2,radiusY:2,force:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cmpX-50,y:cmpY,id:1,radiusX:2,radiusY:2,force:1},{x:cmpX+50,y:cmpY,id:2,radiusX:2,radiusY:2,force:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cmpX-50,y:cmpY,id:1,radiusX:2,radiusY:2,force:1},{x:cmpX+70,y:cmpY,id:2,radiusX:2,radiusY:2,force:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.notEqual(await overlay.innerText(),'Fit','pinch changes zoom with comparison enabled');
 const pinchDivider=Number(await comparison.inputValue());assert.ok(Math.abs(pinchDivider-beforeDivider)<2,`pinch leaves the comparison divider in place (${beforeDivider} -> ${pinchDivider})`);
 const afterPinchScroll=await page.evaluate(()=>({left:document.querySelector('.stage').scrollLeft,top:document.querySelector('.stage').scrollTop}));
 assert.ok(afterPinchScroll.left>=0&&afterPinchScroll.top>=0);
 await page.getByRole('button',{name:'Fit',exact:true}).click();

 // With comparison off, a real single-finger drag pans both scroll axes at increased zoom.
 for(let i=0;i<6;i++)await page.getByRole('button',{name:'Zoom in'}).click();
 await page.getByRole('button',{name:'Toggle comparison'}).click();
 const stageBox=await page.locator('.stage').boundingBox(),panX=stageBox.x+stageBox.width/2,panY=stageBox.y+stageBox.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:panX,y:panY,id:3,radiusX:2,radiusY:2,force:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:panX-40,y:panY-40,id:3,radiusX:2,radiusY:2,force:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const panned=await page.evaluate(()=>({left:document.querySelector('.stage').scrollLeft,top:document.querySelector('.stage').scrollTop}));
 assert.ok(panned.left>0&&panned.top>0,`zoomed image pans on both axes (${panned.left}, ${panned.top})`);
 await page.getByRole('button',{name:'Fit',exact:true}).click();await page.getByRole('button',{name:'Toggle comparison'}).click();

 // A drag on the comparison slider changes only the divider and cannot arm WB history.
 const undo=page.getByRole('button',{name:'Undo',exact:true});assert.equal(await undo.isDisabled(),true);
 await comparison.evaluate(el=>{
  const r=el.getBoundingClientRect(),y=r.top+r.height/2;
  const send=(type,x)=>el.dispatchEvent(new PointerEvent(type,{pointerId:3,pointerType:'mouse',isPrimary:true,bubbles:true,cancelable:true,clientX:x,clientY:y}));
  send('pointerdown',r.left+r.width*.25);send('pointermove',r.left+r.width*.75);send('pointerup',r.left+r.width*.75);
 });
 assert.ok(Number(await comparison.inputValue())>65,'comparison drag moves the divider');
 assert.equal(await undo.isDisabled(),true,'comparison drag does not create a white-balance edit');

 // With the picker armed, a pinch (including pointercancel) is consumed until every finger lifts.
 await page.getByRole('button',{name:'Pick neutral point'}).click();
 await page.locator('.image-frame').evaluate(el=>{
  const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  const send=(type,id,px)=>el.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',isPrimary:id===11,bubbles:true,cancelable:true,clientX:px,clientY:y}));
  send('pointerdown',11,x-50);send('pointerdown',12,x+50);send('pointermove',12,x+65);send('pointercancel',11,x-50);send('pointermove',12,x+75);send('pointerup',12,x+75);
 });
 assert.equal(await undo.isDisabled(),true,'pinch and pointercancel create no WB history');
 assert.equal(await page.locator('.canvas-tools button').last().getAttribute('class'),'active','pinch leaves the neutral picker armed');
 await page.getByRole('button',{name:'Fit',exact:true}).click();
 await page.locator('.image-frame').evaluate(el=>{
  const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  const send=type=>el.dispatchEvent(new PointerEvent(type,{pointerId:21,pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true,clientX:x,clientY:y}));
  send('pointerdown');send('pointerup');
 });
 await page.waitForFunction(()=>!document.querySelector('.canvas-tools button:last-child')?.classList.contains('active'));
 assert.equal(await undo.isDisabled(),false,'a stationary tap applies the neutral point and creates undo history');

 // Verify portrait fit after changing the active photo and after resizing to a small viewport.
 const portrait=await makePng(480,720);
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:Buffer.from(portrait,'base64')});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 await page.getByRole('button',{name:'Exit expanded view'}).click();
 await page.locator('.photo-select[title="portrait.png"]').click();
 await page.waitForTimeout(250);
 await page.getByRole('button',{name:'Expand photo',exact:true}).click();
 await page.setViewportSize({width:320,height:568});await assertFits();
 assert.equal(await overlay.isVisible(),true);
 console.log('Expanded landscape/portrait fit, mobile overlay, comparison gestures, pinch cancellation, picker tap, and WB history passed.');
} finally {await browser.close();}
