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
   if(method==='listPhotos')return {photos:[{name:'IMG20.png',uri:'https://clearwater.test/missing.png',type:'image/png',size:100},{name:'IMG10.png',uri:'https://clearwater.test/10.png',type:'image/png',size:100},{name:'IMG2.png',uri:'https://clearwater.test/2.png',type:'image/png',size:100}]};
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
 await page.route('https://clearwater.test/**',route=>{reads.push(route.request().url());return route.request().url().endsWith('/missing.png')?route.fulfill({status:404,body:''}):route.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')});});
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 const colourControls=async()=>{await page.locator('[data-control-tab="enhancement"]').click();await page.locator('[data-control-subtab="colour"]').click();};
 await page.getByRole('button',{name:'Open folder',exact:true}).click();await ready();
 assert.equal(await page.getByLabel('Photo position',{exact:true}).innerText(),'1 / 3');
 assert.equal(await page.locator('.filename').innerText(),'IMG2.png');assert.equal(reads.length,1);
 assert.deepEqual(await page.locator('.library .folder-photo-tile .photo-select').allTextContents(),['IMG2','IMG10','IMG20']);
 const frame=await page.locator('.image-frame').boundingBox();
 for(const [selector,side] of [['.image-label.before','left'],['.image-label.after','right']]){
  const tag=await page.locator(selector).boundingBox();assert.ok(Math.abs(tag.y-frame.y)<1);
  assert.ok(Math.abs(side==='left'?tag.x-frame.x:tag.x+tag.width-frame.x-frame.width)<1);assert.ok(tag.height<16);
 }
 await colourControls();await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('ArrowUp');
 await page.getByRole('button',{name:'IMG10.png',exact:true}).click();await ready();await colourControls();
 assert.equal(await page.locator('.filename').innerText(),'IMG10.png');assert.equal(reads.length,2);
 assert.equal(await page.getByLabel('Photo position',{exact:true}).innerText(),'2 / 3');
 await page.getByRole('button',{name:'Previous photo',exact:true}).click();await ready();await colourControls();
 assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'1');assert.equal(reads.length,2);
 await page.getByRole('button',{name:'IMG20.png',exact:true}).click();
 await page.getByText('Could not read this file. It may have been moved or deleted.').waitFor();
 assert.equal(await page.getByLabel('Photo position',{exact:true}).innerText(),'3 / 3');
 assert.equal(await page.getByRole('button',{name:'Next photo',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Previous photo',exact:true}).click();await ready();
 assert.equal(await page.locator('.filename').innerText(),'IMG10.png');
 await page.getByRole('button',{name:'Previous photo',exact:true}).click();await ready();
 assert.equal(await page.locator('.filename').innerText(),'IMG2.png');assert.equal(reads.length,3);
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'Export photo',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.modal-shade'));}
 assert.deepEqual(await page.evaluate(()=>window.createdPhotos),['IMG2.jpg','IMG2 (1).jpg']);
 assert.equal(await page.evaluate(()=>window.folderPicks),2);
 await page.evaluate(()=>window.cancelFolder=true);await page.getByRole('button',{name:'Open folder',exact:true}).click();await ready();
 assert.equal(await page.locator('.filename').innerText(),'IMG2.png');
 await page.evaluate(()=>window.cancelFolder=false);await page.getByRole('button',{name:'Open folder',exact:true}).click();await ready();
 assert.equal(await page.locator('.filename').innerText(),'IMG2.png');assert.equal(reads.length,3);
 assert.equal(await page.locator('.library .folder-photo-tile').count(),3);
 await page.getByRole('button',{name:'YOUR PHOTOS',exact:true}).click();await ready();await colourControls();
 assert.equal(await page.locator('.library .folder-photo-tile').count(),0);
 assert.equal(await page.locator('.library .photo-select').count(),2);
 assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'1');assert.equal(reads.length,3);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS lazy folder listing and selection, natural ordering, existing imports, read failure recovery, per-photo edits, source-folder saves, collisions, picker cancellation, and comparison corner labels. Native provider dialogs still need on-device testing.');
}finally{await browser.close();}
