import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {changeLanguage} from './settings-helpers.mjs';

// Exercise the React iOS camera view against a mocked native bridge. Swift and device hardware are not run here.
const photoId='a15a4cab-cc1e-4a10-882c-8b92a4cef501';
const videoId='b26b5dbd-dd2f-4b11-993d-9ca35bdf0602';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(({photoId,videoId})=>{
  const events=new Map(),fileUrl=id=>`file:///mock/ClearWater/${id}/source`;
  const recipe=(video=false)=>({version:1,engine:'balanced',strength:video?0:.8,hints:{scene:'auto',water:'auto',filter:'auto',depth:null},auto:{gains:[1,1,1],redMix:0,haze:0,highlights:0,mode:'gentle',explanation:'Captured Balanced correction'},manual:{warmth:0,tint:0,red:0,exposure:0,highlights:0,shadows:0,contrast:0,haze:0,vibrance:0,neutral:[1,1,1]}});
  const descriptor=(id,kind,name,addedAt=Date.now())=>({schemaVersion:1,id,kind,name,type:kind==='photo'?'image/jpeg':'video/mp4',sourceUrl:fileUrl(id),thumbnailUrl:`file:///mock/ClearWater/${id}/thumbnail`,width:kind==='photo'?96:640,height:kind==='photo'?64:360,bytes:kind==='photo'?4096:16384,addedAt,recipeVersion:1,recipe:recipe(kind==='video'),visible:true,pending:true,photosSaved:false,...(kind==='video'?{duration:2,fps:30,codec:'h264'}:{})});
  const rear={id:'rear-wide',label:'Rear wide',facing:'environment',intrinsicZoom:1};
  window.iosBridge={captures:[],calls:{start:0,photo:0,record:0,photosSave:[],sourceFetches:[],thumbnailFetches:[],ack:[],stop:0},mode:'camera'};
  const state=window.iosBridge;
  const fire=(name,data)=>{for(const fn of events.get(name)??[])fn(data);};
  window.Capacitor={PluginHeaders:[{name:'ClearWaterCamera',methods:[...['getLaunchMode','startSession','setPreviewBounds','setCorrection','listLenses','setLens','setZoom','sampleFrame','capturePhoto','releaseCapture','startRecording','stopRecording','stopSession','listCaptures','getCapture','drainCaptures','acknowledgeCapture','setCaptureRecipe','setCaptureVisible','deleteCapture','saveCaptureToPhotos','shareCapture'].map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]},{name:'ClearWaterExport',methods:['beginExport','writeExportChunk','finishExport','shareExport','discardExport'].map(name=>({name,rtype:'promise'}))}],getPlatform:()=> 'ios',isNativePlatform:()=>true,isPluginAvailable:name=>name==='ClearWaterCamera'||name==='ClearWaterExport',convertFileSrc:uri=>`/__ios_mock_file__?uri=${encodeURIComponent(uri)}`,
   nativeCallback:async(plugin,method,options,callback)=>{if(plugin!=='ClearWaterCamera')throw Error('Unexpected callback plugin '+plugin);if(method==='addListener'){const key=options.eventName,list=events.get(key)??[];list.push(callback);events.set(key,list);return {callbackId:key+'-'+list.length};}if(method==='removeListener'){events.set(options.eventName,(events.get(options.eventName)??[]).filter(fn=>fn!==callback));return {};}throw Error('Unexpected callback '+method);},
   nativePromise:async(plugin,method,options={})=>{if(plugin==='ClearWaterExport')throw Error('Unexpected export call');if(plugin!=='ClearWaterCamera')throw Error('Unexpected plugin '+plugin);switch(method){
    case 'getLaunchMode':return {mode:null};
    case 'startSession':state.calls.start++;return {width:390,height:844,photoWidth:1600,photoHeight:1200,lenses:[rear],lensId:rear.id,zoom:1,minZoom:1,maxZoom:4};
    case 'setPreviewBounds':case 'setCorrection':case 'releaseCapture':case 'stopSession':state.calls.stop++;return {};
    case 'listLenses':return {lenses:[rear]};case 'setLens':return {width:390,height:844,photoWidth:1600,photoHeight:1200,lenses:[rear],lensId:rear.id,zoom:1,minZoom:1,maxZoom:4};
    case 'setZoom':return {zoom:options.ratio};case 'sampleFrame':return {data:btoa(String.fromCharCode(...new Uint8Array(32*24*4))),width:32,height:24};
    case 'capturePhoto':{state.calls.photo++;const item=descriptor(photoId,'photo','mock-native-photo.jpg');state.captures=[item,...state.captures.filter(row=>row.id!==photoId)];return {uri:item.sourceUrl,name:item.name,type:item.type,width:item.width,height:item.height,iosCaptureId:item.id};}
    case 'startRecording':state.calls.record++;return {};
    case 'stopRecording':{const item=descriptor(videoId,'video','mock-native-video.mp4');state.captures=[item,...state.captures.filter(row=>row.id!==videoId)];fire('recordingFinished',{uri:item.sourceUrl,name:item.name,type:item.type,width:item.width,height:item.height,iosCaptureId:item.id});return {};}
    case 'listCaptures':return {captures:state.captures.map(item=>({...item}))};case 'drainCaptures':return {captures:state.captures.filter(item=>item.pending).map(item=>({...item}))};
    case 'getCapture':{const item=state.captures.find(row=>row.id===options.id);if(!item)throw Error('Missing capture');return {capture:{...item}};}
    case 'acknowledgeCapture':state.calls.ack.push(options.id);{const item=state.captures.find(row=>row.id===options.id);if(item)item.pending=false;}return {};
    case 'setCaptureRecipe':{const item=state.captures.find(row=>row.id===options.id);if(item)item.recipe=options.recipe;return {};}
    case 'setCaptureVisible':{const item=state.captures.find(row=>row.id===options.id);if(item)item.visible=options.visible;return {};}
    case 'deleteCapture':state.captures=state.captures.filter(row=>row.id!==options.id);return {};
    case 'saveCaptureToPhotos':state.calls.photosSave.push(options.id);{const item=state.captures.find(row=>row.id===options.id);if(item)item.photosSaved=true;}return {saved:true};
    case 'shareCapture':return {completed:true};default:throw Error('Unexpected camera method '+method);
   }}};
  window.webkit={messageHandlers:{bridge:{postMessage(){}}}};
  Object.defineProperty(window,'VideoDecoder',{configurable:true,value:undefined});Object.defineProperty(window,'VideoEncoder',{configurable:true,value:undefined});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw Error('iOS must use native camera preview');}}});
 },{photoId,videoId});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const fixture=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=96;c.height=64;const x=c.getContext('2d');x.fillStyle='#286b82';x.fillRect(0,0,96,64);x.fillStyle='#afb5a7';x.fillRect(24,14,32,34);return c.toDataURL('image/jpeg',.92).split(',')[1];});
 await page.route('**/__ios_mock_file__**',async route=>{const uri=new URL(route.request().url()).searchParams.get('uri')??'',thumbnail=uri.endsWith('/thumbnail'),id=uri.split('/').at(-2);await page.evaluate(({id,thumbnail})=>window.iosBridge.calls[thumbnail?'thumbnailFetches':'sourceFetches'].push(id),{id,thumbnail});await route.fulfill({status:200,contentType:'image/jpeg',body:Buffer.from(fixture,'base64')});});
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:4186/');
 assert.equal(await page.locator('.camera-launch:enabled').count(),1,'iOS native plugin should enable the React camera action');
 for(const language of ['zh-HK','ja','en']){await changeLanguage(page,language);await page.locator('.settings-launch:visible').first().click();assert.equal(await page.locator('.camera-quality-options').count(),1);assert.equal(await page.locator('.offline-model-choices').count(),0);assert.equal(await page.locator('.settings-check input[type=checkbox]').nth(1).isChecked(),true,'new iOS installs default to saving enhanced captures to Photos');for(const width of [320,390,650]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Settings overflow '+language+' at '+width);}await page.locator('.settings-close').click();}
 await page.setViewportSize({width:390,height:844});await page.locator('.camera-launch').click();await page.waitForFunction(()=>window.iosBridge.calls.start===1);await page.locator('.camera-photo').waitFor();await page.waitForFunction(()=>!document.querySelector('.camera-photo')?.disabled);await page.locator('.camera-photo').click();
 await page.waitForFunction(id=>window.iosBridge.calls.photosSave.includes(id),photoId);await page.locator('.camera-close-button').click();await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===1);await page.waitForFunction(id=>window.iosBridge.calls.sourceFetches.includes(id),photoId,{timeout:90000});
 let state=await page.evaluate(()=>window.iosBridge);assert.equal(state.calls.photo,1);assert.deepEqual(state.calls.ack,[photoId]);assert.deepEqual(state.calls.photosSave,[photoId],'new captured photo gets one independent Photos copy');assert.equal(state.calls.sourceFetches.includes(photoId),true,'editor reads durable source after camera closes');assert.deepEqual(errors,[]);
 // The same opt-in saves enhanced MP4 captures as independent Photos copies.
 await page.locator('.camera-launch').click();await page.waitForFunction(()=>window.iosBridge.calls.start===2);await page.locator('.camera-photo').waitFor();await page.waitForFunction(()=>!document.querySelector('.camera-photo')?.disabled);await page.locator('.camera-record').click();await page.waitForFunction(()=>window.iosBridge.calls.record===1);await page.getByRole('button',{name:'Stop recording'}).click();
 await page.waitForFunction(id=>window.iosBridge.calls.photosSave.includes(id),videoId,{timeout:30000});state=await page.evaluate(()=>window.iosBridge);assert.deepEqual(state.calls.photosSave,[photoId,videoId],'enhanced video also receives a single Photos copy');assert.equal(state.calls.ack.includes(videoId),true);assert.deepEqual(errors,[]);
 console.log('PASS iOS React camera: three-locale settings, new-install Photos default, durable native photo/video IDs, independent Photos copies, native inventory acknowledgement and source hydration');
}finally{await browser.close();}
