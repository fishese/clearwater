import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(()=>{
  window.androidBridge={};window.folderPicks=0;window.cancelFolder=false;window.createdPhotos=[];window.nativeWrites=[];
  const methods=['chooseFolder','listPhotos','drainShares','releaseShare','stat','create','beginWrite','writeChunk','finishWrite','getRememberedModel','beginModelWrite','writeModelChunk','finishModelWrite','readModelChunk','clearRememberedModelFile','forgetRememberedModel','removeListener'];
  window.Capacitor={PluginHeaders:[{name:'ClearWaterFiles',methods:[...methods.map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'}]}],nativeCallback:()=>Promise.resolve('listener-1'),async nativePromise(plugin,method,options){
   if(method==='chooseFolder'){window.folderPicks++;if(window.cancelFolder)throw Object.assign(new Error('Cancelled'),{code:'CANCELLED'});return {uri:'content://folder',name:'Dive photos'};}
   if(method==='listPhotos')return {photos:[{name:'IMG10.png',uri:'https://clearwater.test/10.png',type:'image/png',size:100},{name:'IMG2.png',uri:'https://clearwater.test/2.png',type:'image/png',size:100}]};
   if(method==='drainShares')return {photos:[]};
   if(method==='getRememberedModel')return {present:false,hasFile:false};
   if(method==='stat')return {exists:window.createdPhotos.includes(options.name)};
   if(method==='create'){window.createdPhotos.push(options.name);return {name:options.name,uri:'content://new/'+options.name};}
   if(method==='beginWrite')return {id:options.uri};
   if(method==='writeChunk'){window.nativeWrites.push(options);return {};}
   return {};
  }};
 });
 const page=await context.newPage(),reads=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5173/');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d');x.fillStyle='#28778c';x.fillRect(0,0,640,480);return c.toDataURL().split(',')[1];});
 await page.route('https://clearwater.test/**',route=>{reads.push(route.request().url());return route.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')});});
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 await page.getByRole('button',{name:'Open folder',exact:true}).click();await ready();
 assert.equal(await page.getByLabel('Photo position',{exact:true}).innerText(),'1 / 2');
 assert.equal(await page.locator('.filename').innerText(),'IMG2.png');assert.equal(reads.length,1);
 const frame=await page.locator('.image-frame').boundingBox();
 for(const [selector,side] of [['.image-label.before','left'],['.image-label.after','right']]){
  const tag=await page.locator(selector).boundingBox();assert.ok(Math.abs(tag.y-frame.y)<1);
  assert.ok(Math.abs(side==='left'?tag.x-frame.x:tag.x+tag.width-frame.x-frame.width)<1);assert.ok(tag.height<16);
 }
 await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('ArrowUp');
 await page.getByRole('button',{name:'Next photo',exact:true}).click();await ready();
 assert.equal(await page.locator('.filename').innerText(),'IMG10.png');assert.equal(reads.length,2);
 assert.equal(await page.getByRole('button',{name:'Next photo',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Previous photo',exact:true}).click();await ready();
 assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'1');assert.equal(reads.length,2);
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'Export photo',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.modal-shade'));}
 assert.deepEqual(await page.evaluate(()=>window.createdPhotos),['IMG2-restore.jpg','IMG2-restore (1).jpg']);
 assert.equal(await page.evaluate(()=>window.folderPicks),1);
 await page.evaluate(()=>window.cancelFolder=true);await page.getByRole('button',{name:'Open folder',exact:true}).click();await ready();
 assert.equal(await page.locator('.filename').innerText(),'IMG2.png');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS lazy folder navigation, natural ordering, per-photo edits, source-folder saves, collisions, picker cancellation, and comparison corner labels. Native provider dialogs still need on-device testing.');
}finally{await browser.close();}
