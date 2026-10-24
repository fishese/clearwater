import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

// CDP delivers browser-native touch gestures, including default control behavior.
// WebKit has no CDP touch-move API: use a real tap plus Pointer Events there.
const useWebKit=process.env.CHECK_BROWSER==='webkit';
const device=process.env.CHECK_DEVICE_CDP;
const browser=await (device?chromium.connectOverCDP(device):useWebKit?webkit.launch():chromium.launch(process.env.CHECK_BROWSER==='chromium'?{}:{channel:'msedge'}));
let page;
try{
 page=device?browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()===(process.env.CHECK_URL??'http://127.0.0.1:4198/')):await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 await page.goto(process.env.CHECK_URL??'http://127.0.0.1:4198/');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=960;c.height=640;const x=c.getContext('2d');x.fillStyle='#438998';x.fillRect(0,0,960,640);return c.toDataURL().split(',')[1];});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'touch-check.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 for(const selector of ['.storage-warning button','.web-update-hint-ok'])if(await page.locator(selector).isVisible())await page.locator(selector).click();
 const slider=page.locator('.comparison-input');
 const value=()=>slider.evaluate(el=>Number(el.getAttribute('aria-valuenow')??el.value));
 const cdp=useWebKit?null:await page.context().newCDPSession(page);
 for(const width of device?[await page.evaluate(()=>innerWidth)]:[390,320,1440]){
  if(!device)await page.setViewportSize({width,height:844});
  for(const expanded of [false,true]){
   if(expanded)await page.getByRole('button',{name:'Expand photo',exact:true}).click();
   for(const zoom of [1,1.5]){
    await page.getByRole('button',{name:'Fit',exact:true}).click();
    if(zoom>1)await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    for(const direction of [1,-1]){
     await slider.focus();await page.keyboard.press('Home');for(let i=0;i<50;i++)await page.keyboard.press('ArrowRight');
     const start=await value();assert.equal(start,50);
     const frame=await page.locator('.image-frame').boundingBox(),stage=await page.locator('.stage').boundingBox(),band=await slider.boundingBox();
     const x=band.x+band.width/2,y=Math.max(frame.y,stage.y)+Math.min(30,Math.min(frame.height,stage.height)/2);
     const samples=[];
     if(cdp){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
      for(let step=1;step<=10;step++){
       await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+direction*step*3,y,id:1}]});
       await page.waitForTimeout(25);samples.push(await value());
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     }else{
      await page.touchscreen.tap(x,y);assert.equal(await value(),start,'touch tap does not jump');
      await slider.evaluate((el,{x,y,direction})=>{
       const send=(type,dx)=>el.dispatchEvent(new PointerEvent(type,{pointerId:81,pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true,clientX:x+dx,clientY:y}));
       send('pointerdown',0);for(let step=1;step<=10;step++)send('pointermove',direction*step*3);send('pointerup',direction*30);
      },{x,y,direction});samples.push(await value());
     }
     const expected=start+direction*30/frame.width*100;
     assert.ok(Math.abs(await value()-expected)<1.5,`${width} expanded=${expanded} zoom=${zoom}: expected ${expected}, got ${await value()}, samples ${samples}`);
     assert.ok(samples.every(v=>v>5&&v<95),'a short drag never jumps to an extreme');
     assert.ok(samples.every((v,i)=>i===0||(v-samples[i-1])*direction>=-.1),'touch movement stays monotonic');
    }
   }
   await slider.focus();await page.keyboard.press('End');assert.equal(await value(),100);await page.keyboard.press('Home');assert.equal(await value(),0);await page.keyboard.press('PageUp');assert.equal(await value(),10);await page.keyboard.press('PageDown');assert.equal(await value(),0);
   if(expanded)await page.getByRole('button',{name:'Exit expanded view',exact:true}).click();
  }
 }
 console.log(`PASS ${useWebKit?'WebKit real taps + synthetic touch pointers':'Chromium trusted touch moves'}: short left/right drags, intermediate values, Fit/150%, normal/expanded, ${device?'physical Android viewport':'320/390/1440px'}, keyboard boundaries`);
}catch(error){process.exitCode=1;throw error;}finally{if(device){await page?.close();await browser.close();}else await browser.close();}
