import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
const url=process.env.CHECK_URL??'http://127.0.0.1:4173/';
try{
 for(const {width,sourceWidth,sourceHeight} of [{width:390,sourceWidth:128,sourceHeight:96},{width:1280,sourceWidth:128,sourceHeight:96},{width:390,sourceWidth:480,sourceHeight:620}]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<650,hasTouch:width<650,acceptDownloads:true,serviceWorkers:'block'}),page=await context.newPage();
  await page.addInitScript(()=>Object.defineProperty(window,'showDirectoryPicker',{value:undefined}));await page.goto(url,{waitUntil:'domcontentloaded'});
  const hint=page.locator('.web-update-hint-ok');if(await hint.isVisible().catch(()=>false))await hint.click();
  const data=await page.evaluate(({sourceWidth,sourceHeight})=>{const c=document.createElement('canvas');c.width=sourceWidth;c.height=sourceHeight;const x=c.getContext('2d');for(let y=0;y<sourceHeight;y+=8)for(let i=0;i<sourceWidth;i+=8){x.fillStyle=`rgb(${i%256},${y%256},${(i+y)%255})`;x.fillRect(i,y,8,8);}return c.toDataURL('image/png').split(',')[1];},{sourceWidth,sourceHeight});
  await page.locator('input[type=file][multiple]').first().setInputFiles({name:'synthetic-crop.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
  await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:90000});
  if(width<650){await page.locator('[data-control-tab="enhancement"]').click();await page.locator('[data-control-subtab="effects"]').click();}
  await page.locator('.auto-enhance-button').click();await page.waitForFunction(()=>document.querySelector('.auto-enhance-button')?.getAttribute('aria-pressed')==='true'&&document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:90000});
  await page.getByRole('button',{name:'Crop photo'}).click();const dialog=page.getByRole('dialog',{name:'Crop photo'});await dialog.waitFor();
  await dialog.getByRole('button',{name:'Top left crop handle'}).focus();for(let i=0;i<12;i++)await page.keyboard.press('ArrowRight');for(let i=0;i<10;i++)await page.keyboard.press('ArrowDown');
  await dialog.getByRole('button',{name:'Bottom right crop handle'}).focus();for(let i=0;i<20;i++)await page.keyboard.press('ArrowLeft');for(let i=0;i<10;i++)await page.keyboard.press('ArrowUp');
  await dialog.getByRole('button',{name:'Apply crop'}).click();await dialog.waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:90000});
  const left=Math.round(sourceWidth*.12),top=Math.round(sourceHeight*.1),outWidth=Math.round(sourceWidth*.8)-left,outHeight=Math.round(sourceHeight*.9)-top;
  const info=await page.locator('.preview-info').innerText();assert.ok(info.startsWith(`${outWidth} × ${outHeight}`),info);
  const frame=await page.locator('.image-frame').boundingBox();assert.ok(frame);assert.ok(Math.abs(frame.width/frame.height-outWidth/outHeight)<.02);
  const expected=await page.locator('canvas[aria-label="Edited photo"]').evaluate((c,{left,top,outWidth,outHeight})=>Array.from(c.getContext('2d').getImageData(left,top,outWidth,outHeight).data),{left,top,outWidth,outHeight});
  if(width<650)await page.locator('[data-control-tab="export"]').click();await page.getByLabel('File format').selectOption('png');
  const pending=page.waitForEvent('download',{timeout:90000});await page.getByRole('button',{name:'Export photo'}).click();const download=await pending;
  const bytes=await readFile(await download.path());
  const actual=await page.evaluate(async data=>{const image=await createImageBitmap(new Blob([new Uint8Array(data)],{type:'image/png'}));const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);image.close();return {width:c.width,height:c.height,pixels:Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data)};},[...bytes]);
  assert.equal(actual.width,outWidth);assert.equal(actual.height,outHeight);let max=0;for(let i=0;i<expected.length;i++)max=Math.max(max,Math.abs(expected[i]-actual.pixels[i]));assert.ok(max<=1,`preview/export max pixel difference ${max}`);
  await page.getByRole('button',{name:'Undo'}).click();await page.waitForFunction(text=>document.querySelector('.preview-info')?.textContent?.startsWith(text),`${sourceWidth} × ${sourceHeight}`);await page.getByRole('button',{name:'Redo'}).click();await page.waitForFunction(text=>document.querySelector('.preview-info')?.textContent?.startsWith(text),`${outWidth} × ${outHeight}`);
  await page.getByRole('button',{name:'Crop photo'}).click();const again=page.getByRole('dialog',{name:'Crop photo'});await again.getByRole('button',{name:'Reset crop'}).click();await again.getByRole('button',{name:'Cancel'}).click();assert.ok((await page.locator('.preview-info').innerText()).startsWith(`${outWidth} × ${outHeight}`),'cancel keeps previous crop');
  if(width<650){
   await page.getByRole('button',{name:'Crop photo'}).click();const touchDialog=page.getByRole('dialog',{name:'Crop photo'});await touchDialog.getByRole('button',{name:'Reset crop'}).click();
   const handle=await touchDialog.getByRole('button',{name:'Bottom right crop handle'}).boundingBox();assert.ok(handle);const x=handle.x+handle.width/2,y=handle.y+handle.height/2,session=await context.newCDPSession(page);
   try{await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,force:1}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-45,y:y-30,id:1,force:1}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}finally{await session.detach();}
   await touchDialog.getByRole('button',{name:'Apply crop'}).click();const dimensions=await page.locator('.preview-info').innerText();assert.notEqual(dimensions,info,'trusted touch drag must change the crop');
  }
  console.log(`PASS ${width}px crop on ${sourceWidth}×${sourceHeight}: PNG pixel parity, undo/redo and cancellation`);await context.close();
 }
}finally{await browser.close();}
