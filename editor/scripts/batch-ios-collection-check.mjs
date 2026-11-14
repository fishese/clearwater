import assert from 'node:assert/strict';import {chromium,webkit} from 'playwright';
const engine=process.env.CHECK_BROWSER==='webkit'?webkit:chromium;const browser=await engine.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await context.addInitScript(()=>{window.webkit={messageHandlers:{bridge:{postMessage(){}}}};window.Capacitor={getPlatform:()=> 'ios',isNativePlatform:()=>true,isPluginAvailable:()=>false};});
 const page=await context.newPage();await page.goto(process.env.CHECK_URL??'http://127.0.0.1:4198/',{waitUntil:'domcontentloaded'});
 const bytes=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=96;c.height=64;const x=c.getContext('2d');x.fillStyle='#287c9b';x.fillRect(0,0,96,64);return c.toDataURL().split(',')[1];}),'base64');
 const photo={name:'existing-photo.png',mimeType:'image/png',buffer:bytes};await page.locator('input[type=file][multiple]').first().setInputFiles(photo);
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Crop photo"]')?.disabled===false,null,{timeout:90000});
 const launch=page.getByRole('button',{name:'Batch process photos'});await launch.click();let dialog=page.getByRole('dialog',{name:'Batch process photos'});
 assert.equal(await dialog.locator('.batch-photos label').count(),0,'existing collection must not appear in batch');assert.match(await dialog.locator('.batch-selection strong').innerText(),/\(0\)/);
 await dialog.locator('input[type=file]').setInputFiles({name:'batch-photo.png',mimeType:'image/png',buffer:bytes});assert.equal(await dialog.locator('.batch-photos label').count(),1);await dialog.getByRole('button',{name:'Close'}).click();
 await launch.click();dialog=page.getByRole('dialog',{name:'Batch process photos'});assert.equal(await dialog.locator('.batch-photos label').count(),0,'reopening batch must start empty');await dialog.getByRole('button',{name:'Close'}).click();
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Crop photo"]')?.disabled===false,null,{timeout:90000});assert.match(await page.locator('.filename').innerText(),/existing-photo\.png/);console.log('PASS mocked iOS shell starts batch empty and retains editor photo');await context.close();
}finally{await browser.close();}
