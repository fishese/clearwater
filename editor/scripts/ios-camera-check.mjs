import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {changeLanguage} from './settings-helpers.mjs';

// Browser integration with a mocked Capacitor iOS camera bridge. This exercises
// the shared editor/bridge flow; it does not run Swift or validate camera hardware.
const photoId='a15a4cab-cc1e-4a10-882c-8b92a4cef501';
const videoId='b26b5dbd-dd2f-4b11-993d-9ca35bdf0602';
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(({photoId,videoId})=>{
  const listeners=new Map();
  const url=(id,part)=>`file:///mock/ClearWater/${id}/${part}`;
  const descriptor=(id,kind,name,addedAt)=>({schemaVersion:1,id,kind,name,type:kind==='photo'?'image/jpeg':'video/mp4',sourceUrl:url(id,'source'),thumbnailUrl:url(id,'thumbnail'),width:kind==='photo'?96:640,height:kind==='photo'?64:360,bytes:kind==='photo'?4096:16384,addedAt,recipeVersion:1,recipe:{version:1,engine:'balanced',strength:kind==='photo'?.8:0,hints:{scene:'auto',water:'auto',filter:'auto',depth:null},auto:{gains:[1,1,1],redMix:0,haze:0,highlights:0,mode:'gentle',explanation:'Captured Balanced correction'},manual:{warmth:0,tint:0,red:0,exposure:0,highlights:0,shadows:0,contrast:0,haze:0,vibrance:0,neutral:[1,1,1]}},visible:true,pending:false,photosSaved:true,...(kind==='video'?{duration:2,fps:30,codec:'h264'}:{})});
  const video=descriptor(videoId,'video','mock-native-video.mp4',Date.now()-1000);
  let saved;try{saved=JSON.parse(localStorage.getItem('__iosCameraMock')??'null');}catch{}
  const state=saved??{captures:[video],calls:{open:0,acknowledge:[],setVisible:[],delete:[],photosSave:0,share:[],sourceFetches:[],thumbnailFetches:[]},openResolve:null};
  const fire=(name,data)=>{for(const callback of listeners.get(name)??[])callback(data);};
  window.iosCamera={state,takePhoto(id=photoId){const item=descriptor(id,'photo','mock-native-photo.jpg',Date.now());item.pending=true;state.captures=[item,...state.captures.filter(c=>c.id!==item.id)];fire('captureCompleted',{id:item.id});},close(){state.openResolve?.();state.openResolve=null;},emit:fire};
  window.webkit={messageHandlers:{bridge:{postMessage(){}}}};
  // WebCodecs are deliberately absent to model an iOS WebView without video editing.
  Object.defineProperty(window,'VideoDecoder',{configurable:true,value:undefined});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw new Error('The browser camera must not be opened on iOS.');}}});
  window.Capacitor={PluginHeaders:[
   {name:'ClearWaterCamera',methods:[...['open','listCaptures','getCapture','drainCaptures','acknowledgeCapture','setCaptureRecipe','setCaptureVisible','deleteCapture','saveCaptureToPhotos','shareCapture'].map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]},
   {name:'ClearWaterExport',methods:['beginExport','writeExportChunk','finishExport','shareExport','discardExport'].map(name=>({name,rtype:'promise'}))},
  ],getPlatform:()=> 'ios',isNativePlatform:()=>true,isPluginAvailable:name=>name==='ClearWaterCamera'||name==='ClearWaterExport',convertFileSrc:uri=>`/__ios_mock_file__?uri=${encodeURIComponent(uri)}`,
   nativeCallback:(plugin,method,options,callback)=>{
    if(plugin!=='ClearWaterCamera')return Promise.resolve({callbackId:'unused'});
    if(method==='addListener'){const name=options.eventName;const list=listeners.get(name)??[];list.push(callback);listeners.set(name,list);return Promise.resolve({callbackId:`listener-${name}-${list.length}`});}
    if(method==='removeListener'){const list=listeners.get(options.eventName)??[];listeners.set(options.eventName,list.filter(item=>item!==callback));return Promise.resolve({});}
    throw new Error(`Unexpected native callback ${plugin}.${method}`);
   },nativePromise:async(plugin,method,options={})=>{
    if(plugin==='ClearWaterExport')throw new Error(`Unexpected export bridge call ${method}`);
    if(plugin!=='ClearWaterCamera')throw new Error(`Unexpected plugin ${plugin}`);
    switch(method){
     case 'open':if(options.schemaVersion!==1||options.settings.quality!=='high'||!options.strings['Close camera'])throw new Error('Invalid native camera launch options');state.calls.open++;return await new Promise(resolve=>{state.openResolve=resolve;});
     case 'listCaptures':{const captures=state.captures.map(item=>({...item}));if(state.holdNextList){state.holdNextList=false;return await new Promise(resolve=>{state.releaseList=()=>resolve({captures});});}return {captures};}
     case 'drainCaptures':return {captures:state.captures.filter(item=>item.pending).map(item=>({...item}))};
     case 'getCapture':{const item=state.captures.find(value=>value.id===options.id);if(!item)throw new Error('Missing mock capture');return {capture:{...item}};}
     case 'acknowledgeCapture':{state.calls.acknowledge.push(options.id);const item=state.captures.find(value=>value.id===options.id);if(item)item.pending=false;return {};}
     case 'setCaptureRecipe':{const item=state.captures.find(value=>value.id===options.id);if(item)item.recipe=options.recipe;return {};}
     case 'setCaptureVisible':{state.calls.setVisible.push({id:options.id,visible:options.visible});const item=state.captures.find(value=>value.id===options.id);if(item)item.visible=options.visible;return {};}
     case 'deleteCapture':state.calls.delete.push(options.id);state.captures=state.captures.filter(item=>item.id!==options.id);return {};
     case 'saveCaptureToPhotos':state.calls.photosSave++;return {saved:true};
     case 'shareCapture':state.calls.share.push({id:options.id,variant:options.variant});return {completed:true};
     default:throw new Error(`Unexpected camera method ${method}`);
    }
   }};
 },{photoId,videoId});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const fixture=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='#286b82';ctx.fillRect(0,0,96,64);ctx.fillStyle='#afb5a7';ctx.fillRect(24,14,32,34);return canvas.toDataURL('image/jpeg',.92).split(',')[1];});
 await page.route('**/__ios_mock_file__**',async route=>{
  const uri=new URL(route.request().url()).searchParams.get('uri')??'';
  const thumbnail=uri.endsWith('/thumbnail');
  const id=uri.split('/').at(-2);
  await page.evaluate(({id,thumbnail})=>window.iosCamera.state.calls[thumbnail?'thumbnailFetches':'sourceFetches'].push(id),{id,thumbnail});
  if(id===videoId&&!thumbnail){await route.fulfill({status:500,body:'The fake native video source must stay lazy.'});return;}
  await route.fulfill({status:200,contentType:'image/jpeg',body:Buffer.from(fixture,'base64')});
 });
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:4186/');
 await page.waitForFunction(()=>window.iosCamera.state.calls.open===0);
 assert.equal(await page.locator('.camera-launch:enabled').count(),1,'iOS native-camera plugin should enable the camera action');
 for(const language of ['zh-HK','ja','en']){
  await changeLanguage(page,language);
  await page.locator('.settings-launch:visible').first().click();
  assert.equal(await page.locator('.camera-quality-options').count(),1);
  assert.equal(await page.locator('.offline-model-choices').count(),0);
  for(const width of [320,390,650]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'native Settings overflow: '+language+' at '+width);
  }
  await page.locator('.settings-close').click();
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('.camera-launch').click();
 await page.waitForFunction(()=>window.iosCamera.state.calls.open===1);
 await page.evaluate(()=>window.iosCamera.takePhoto());
 await page.waitForFunction(()=>window.iosCamera.state.calls.acknowledge.includes('a15a4cab-cc1e-4a10-882c-8b92a4cef501'));
 await page.evaluate(()=>window.iosCamera.close());
 await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===2);
 await page.waitForFunction(()=>document.querySelector('.preview-info')?.textContent?.includes('96 × 64'),null,{timeout:90000});
 let state=await page.evaluate(()=>window.iosCamera.state);
 assert.deepEqual(state.calls.acknowledge,[photoId],'a pending native still should be acknowledged after loading its thumbnail');
 assert.deepEqual(state.calls.sourceFetches,[photoId],'opening the newly captured photo should read its source');
 assert.equal(state.calls.thumbnailFetches.includes(photoId),true,'native still should load through its thumbnail file URI');
 assert.deepEqual(errors,[],'native still capture should not produce page errors');
 assert.equal(await page.getByLabel('Correction engine',{exact:true}).inputValue(),'balanced','captured still keeps its native Balanced recipe');

 // Unsupported WebCodecs must leave an existing native video shareable as its thumbnail.
 await page.locator('.photo-select[title="mock-native-video.mp4"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===2);
 await page.locator('.top-actions .primary').click();
 await page.waitForFunction(()=>window.iosCamera.state.calls.share.some(call=>call.id==='b26b5dbd-dd2f-4b11-993d-9ca35bdf0602'));
 state=await page.evaluate(()=>window.iosCamera.state);
 assert.equal(state.calls.sourceFetches.includes(videoId),false,'uneditable native video must not be fully fetched');
 assert.equal(state.calls.share.some(call=>call.id===videoId&&call.variant==='source'),true,'video share should use the native source bridge');

 // Clearing hides private captures from the collection; it does not delete them or Photos copies.
 await page.locator('.clear-collection-button').click();
 await page.getByRole('dialog').getByRole('button',{name:'Clear collection'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===0);
 state=await page.evaluate(()=>window.iosCamera.state);
 assert.equal(state.calls.setVisible.length,2,'clear should hide each private capture');
 assert.deepEqual(state.calls.delete,[],'clear must not delete native originals');
 assert.equal(state.calls.photosSave,0,'clear must not invoke a Photos operation');
 assert.equal(state.captures.every(item=>!item.visible&&item.photosSaved),true,'native captures and their independent Photos state should remain intact');

 // Use the Settings recovery action, then cold-reload from the native manifest.
 await page.locator('.settings-launch').click();
 await page.getByRole('button',{name:'Restore hidden captures'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===2);
 await page.locator('.settings-close').click();
 await page.evaluate(()=>localStorage.setItem('__iosCameraMock',JSON.stringify(window.iosCamera.state)));
 await page.reload();
 await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===2);
 state=await page.evaluate(()=>window.iosCamera.state);
 assert.deepEqual(state.calls.delete,[],'restoring the native collection must retain private originals');
 assert.equal(state.calls.setVisible.filter(item=>item.visible).length,2,'Settings restore should unhide each retained capture');
 assert.equal(state.captures.every(item=>item.visible&&item.photosSaved),true,'reloaded collection should recover the saved native descriptors');
 assert.equal(state.calls.sourceFetches.includes(videoId),false,'cold reload should hydrate the video thumbnail without reading its full source');
 assert.deepEqual(errors,[],'camera, clear and native collection recovery should not produce page errors');
 // A second capture and Close arriving during a slow inventory read must trigger
 // a fresh native snapshot before selecting the newest source.
 await page.locator('.camera-launch').click();
 await page.waitForFunction(()=>window.iosCamera.state.calls.open===2);
 await page.evaluate(()=>{window.iosCamera.state.holdNextList=true;window.iosCamera.takePhoto('c37c6ece-ee3f-4c22-aa4e-adb46cef1703');});
 await page.waitForFunction(()=>typeof window.iosCamera.state.releaseList==='function');
 await page.evaluate(()=>{window.iosCamera.takePhoto('d48d7fdf-ff4a-4d33-bb5f-bec57def2804');window.iosCamera.close();window.iosCamera.state.releaseList();});
 await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===4);
 await page.waitForFunction(()=>window.iosCamera.state.calls.sourceFetches.includes('d48d7fdf-ff4a-4d33-bb5f-bec57def2804'),null,{timeout:90000});
 state=await page.evaluate(()=>window.iosCamera.state);
 assert.equal(state.calls.acknowledge.includes('c37c6ece-ee3f-4c22-aa4e-adb46cef1703'),true);
 assert.equal(state.calls.acknowledge.includes('d48d7fdf-ff4a-4d33-bb5f-bec57def2804'),true);
 assert.equal(state.calls.sourceFetches.includes('c37c6ece-ee3f-4c22-aa4e-adb46cef1703'),false,'capture mode should not activate earlier stills while the native view is open');
 assert.deepEqual(errors,[]);
 console.log('PASS mocked iOS native-camera bridge: three-locale Settings, Auto/High launch, pending photo capture, file-URI thumbnail/source reads, native video share without WebCodecs/full fetch, clear/recovery preserving originals and Photos copies, capture/Close during a slow native inventory read');
} finally {await browser.close();}
