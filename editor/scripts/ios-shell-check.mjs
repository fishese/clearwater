import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {changeLanguage} from './settings-helpers.mjs';

// Browser integration only: this does not execute Swift or validate WKWebView.
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(()=>{
  window.webkit={messageHandlers:{bridge:{postMessage(){}}}};
  window.iosExports={};window.iosShared=[];window.iosSWRegistrations=0;
  navigator.serviceWorker.register=async()=>{window.iosSWRegistrations++;throw new Error('Native shell registered a worker');};
  const methods=['beginExport','writeExportChunk','finishExport','shareExport','discardExport'];
  window.Capacitor={PluginHeaders:[{name:'ClearWaterExport',methods:methods.map(name=>({name,rtype:'promise'}))}],nativePromise:async(plugin,method,o)=>{
   if(plugin!=='ClearWaterExport')throw new Error('Unexpected native plugin '+plugin);
   if(method==='beginExport'){const id=crypto.randomUUID();window.iosExports[id]={...o,chunks:[]};return {id};}
   const item=window.iosExports[o.id];
   if(method==='writeExportChunk'){item.chunks.push(o.data);return {};}
   if(method==='finishExport'){if(o.abort)delete window.iosExports[o.id];else item.finished=true;return {};}
   if(method==='shareExport'){if(!item.finished)throw new Error('Uncommitted share');window.iosShared.push({name:item.name,type:item.type,size:item.size,bytes:item.chunks.reduce((n,s)=>n+atob(s).length,0)});return {completed:true};}
   if(method==='discardExport'){delete window.iosExports[o.id];return {};}
   throw new Error('Unexpected method '+method);
  }};
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:4176/');
 for(const language of ['en','zh-HK','ja']){
  await changeLanguage(page,language);
  assert.equal(await page.locator('.camera-launch:enabled').count(),0,'iOS must not offer stream camera');
  await page.locator('.settings-launch:visible').first().click();
  assert.equal(await page.locator('.offline-model-choices').count(),0);
  assert.equal(await page.locator('.camera-quality-options').count(),0);
  assert.equal(await page.locator('a[href$="clearwater-release.apk"]').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('.settings-close').click();
 }
 await changeLanguage(page,'en');
 const fixture=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=96;c.height=64;const x=c.getContext('2d');x.fillStyle='#286b82';x.fillRect(0,0,96,64);x.fillStyle='#afb5a7';x.fillRect(25,15,30,30);return c.toDataURL('image/png').split(',')[1];});
 await page.locator('input[type=file]').first().setInputFiles({name:'ios-fixture.png',mimeType:'image/png',buffer:Buffer.from(fixture,'base64')});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:90000});
 await page.locator('.top-actions .primary').click();
 await page.waitForFunction(()=>window.iosShared.length===1,null,{timeout:30000}).catch(async error=>{console.log(await page.locator('body').innerText());console.log(await page.evaluate(()=>({temporary:window.iosExports,headers:window.Capacitor.PluginHeaders})));throw error;});
 const result=await page.evaluate(()=>({shares:window.iosShared,temporary:Object.keys(window.iosExports),workers:window.iosSWRegistrations}));
 assert.equal(result.shares[0].size,result.shares[0].bytes);
 assert.equal(result.shares[0].type,'image/jpeg');
 assert.deepEqual(result.temporary,[]);
 assert.equal(result.workers,0);
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:90000});
 assert.equal(await page.locator('.photo-tile').count(),1);
 assert.deepEqual(errors,[]);
 console.log('PASS mocked iOS shell: three locales, native-only camera gate, no SW/cache/APK controls, import/inference, chunked export, cleanup and reload');
} finally {await browser.close();}
