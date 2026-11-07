import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const engine=process.env.CHECK_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
const url=process.env.CHECK_URL??'http://127.0.0.1:4173/';
try{
 for(const name of ['Safari','CriOS']){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true,serviceWorkers:'block'}),page=await context.newPage();
  await page.addInitScript(browserName=>{
   delete window.showDirectoryPicker;
   const agent=browserName==='Safari'?'Version/18.6 Mobile/15E148 Safari/604.1':'CriOS/140.0.7339.82 Mobile/15E148 Safari/604.1';
   Object.defineProperty(navigator,'userAgent',{configurable:true,value:`Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${agent}`});
   Object.defineProperty(navigator,'platform',{configurable:true,value:'iPhone'});Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:5});
   window.batchShareCalls=[];window.allowBatchShare=true;
   Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>window.allowBatchShare});
   Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{window.batchShareCalls.push({name:files[0].name,type:files[0].type,size:files[0].size,activation:navigator.userActivation?.isActive??null});}});
  },name);
  await page.goto(url,{waitUntil:'domcontentloaded'});const hint=page.locator('.web-update-hint-ok');if(await hint.isVisible().catch(()=>false))await hint.click();
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=96;c.height=64;const x=c.getContext('2d');x.fillStyle='#287c9b';x.fillRect(0,0,96,64);return c.toDataURL().split(',')[1];}),'base64');
  await page.getByRole('button',{name:'Batch process photos'}).click();const dialog=page.getByRole('dialog',{name:'Batch process photos'});await dialog.locator('input[type=file]').setInputFiles([{name:'one.png',mimeType:'image/png',buffer:png},{name:'two.png',mimeType:'image/png',buffer:png}]);await dialog.getByLabel('Correction engine').selectOption('balanced');
  assert.equal(await dialog.getByLabel('Selected folder').count(),0,'iPhone browser should not assume a folder picker');
  await dialog.getByRole('button',{name:'Process photos'}).click();await dialog.getByText('Processed 2 photos.').waitFor({timeout:90000});
  await dialog.getByRole('button',{name:'Share ZIP'}).click();await page.waitForFunction(()=>window.batchShareCalls.length===1);
  const call=await page.evaluate(()=>window.batchShareCalls[0]);assert.equal(call.name,'clearwater-batch.zip');assert.equal(call.type,'application/zip');assert.ok(call.size>0);if(call.activation!==null)assert.equal(call.activation,true,'sharing must begin on a fresh user action');
  await page.evaluate(()=>{window.allowBatchShare=false;});await dialog.getByRole('button',{name:'Share ZIP'}).click();await dialog.getByText('Could not share the ZIP. Try downloading it instead.').waitFor();assert.equal(await dialog.getByRole('link',{name:'Download ZIP'}).count(),1,'download remains available when sharing is rejected');
  console.log(`PASS iPhone ${name} batch ZIP share and download fallback (mocked share APIs)`);await context.close();
 }
}finally{await browser.close();}
