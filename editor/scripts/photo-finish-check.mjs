import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {changeLanguage} from './settings-helpers.mjs';

const root=resolve(import.meta.dirname,'../..');
const output=resolve(root,'analysis/adaptive-finish/editor-check');
const url=process.env.CHECK_URL??'http://127.0.0.1:5173/';
const browser=await chromium.launch({channel:process.env.CHECK_BROWSER??'msedge',headless:true});
const report={url,checks:[],errors:[],startedAt:new Date().toISOString()};
const locales=Object.fromEntries(await Promise.all(['en','zh-HK','ja'].map(async locale=>[
 locale,JSON.parse(await readFile(resolve(root,'editor/src/locales',`${locale}.json`),'utf8')),
])));
await mkdir(output,{recursive:true});

function pass(name,details={}){report.checks.push({name,...details});console.log(`PASS ${name}`);}
function hash(data){let value=2166136261;for(const byte of data)value=Math.imul(value^byte,16777619);return value>>>0;}

try{
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:1360,height:950}});
 const page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.addInitScript(()=>{
  const state=window.__photoFinishCheck={messages:[],workers:[],holdFinishReply:false,heldFinishReply:null,holdNextRender:false,heldRender:null};
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message,...args){
   state.workers.push(this);
   if(message&&typeof message==='object')state.messages.push({type:message.type,gen:message.gen,request:message.request,look:message.look});
   if(message?.type==='render'&&state.holdNextRender){state.holdNextRender=false;state.heldRender={worker:this,message,args};return;}
   return Reflect.apply(post,this,[message,...args]);
  };
  const descriptor=Object.getOwnPropertyDescriptor(Worker.prototype,'onmessage');
  if(descriptor?.get&&descriptor?.set)Object.defineProperty(Worker.prototype,'onmessage',{
   configurable:true,enumerable:descriptor.enumerable,
   get(){return descriptor.get.call(this);},
   set(handler){
    if(typeof handler!=='function'){descriptor.set.call(this,handler);return;}
    descriptor.set.call(this,event=>{
     if(state.holdFinishReply&&['finish-ready','error'].includes(event.data?.type)&&
        (event.data?.type==='finish-ready'||event.data?.operation==='finish')){
      state.holdFinishReply=false;state.heldFinishReply={worker:this,data:event.data};return;
     }
     return handler.call(this,event);
    });
   },
  });
  state.releaseRender=()=>{const held=state.heldRender;state.heldRender=null;if(held)Reflect.apply(post,held.worker,[held.message,...held.args]);};
  state.inject=(workerIndex,data)=>state.workers[workerIndex]?.dispatchEvent(new MessageEvent('message',{data}));
 });
 await page.goto(url);
 const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 const preview=()=>page.locator('canvas[aria-label="Edited photo"]');
 const pixels=()=>preview().evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
 const canvasHash=async()=>hash(await pixels());
 const renderCount=()=>page.evaluate(()=>window.__photoFinishCheck.messages.filter(message=>message.type==='render').length);
 const waitNewRender=async(priorCount,timeout=30000)=>{
  await page.waitForFunction(priorCount=>window.__photoFinishCheck.messages.filter(message=>message.type==='render').length>priorCount,priorCount,{timeout});
  await page.waitForFunction(priorCount=>{
   const canvas=document.querySelector('canvas[aria-label="Edited photo"]');
   return window.__photoFinishCheck.messages.slice().filter(message=>message.type==='render').slice(priorCount)
    .some(message=>canvas?.dataset.generation===String(message.gen)&&canvas?.dataset.request===String(message.request));
  },priorCount,{timeout});
  const target=await page.evaluate(priorCount=>{
   const canvas=document.querySelector('canvas[aria-label="Edited photo"]');
   return window.__photoFinishCheck.messages.filter(message=>message.type==='render').slice(priorCount)
    .find(message=>canvas?.dataset.generation===String(message.gen)&&canvas?.dataset.request===String(message.request));
  },priorCount);
  await ready();return target;
 };
 const currentRequest=()=>preview().getAttribute('data-request');
 const saveRecipe=async()=>{
  const downloadEvent=page.waitForEvent('download');
  await page.getByLabel('Save recipe',{exact:true}).click();
  const download=await downloadEvent;
  return JSON.parse(await readFile(await download.path(),'utf8'));
 };
 const loadRecipe=async recipe=>{
  const prior=await renderCount();
  await page.getByLabel('Choose recipe',{exact:true}).setInputFiles({name:'clearwater-recipe.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recipe))});
  await waitNewRender(prior,120000);
 };
 const clickAndWait=async locator=>{const prior=await renderCount();await locator.click();await waitNewRender(prior);};
 const setSliderEnd=async(label,atEnd=true)=>{
  const slider=page.getByRole('slider',{name:label,exact:true});
  const prior=await renderCount();await slider.focus();await page.keyboard.press(atEnd?'End':'Home');await waitNewRender(prior);
 };
 const saveRecipeInput=page.getByLabel('Choose recipe',{exact:true});
 const selectBalanced=async()=>{
  const group=page.locator('.engine-details').locator('xpath=..');
  if(!(await group.evaluate(element=>element.open)))await group.locator('summary').click();
  const prior=await renderCount();await page.getByLabel('Correction engine',{exact:true}).selectOption('balanced');await waitNewRender(prior);
 };

 const png=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=600;
  const context=canvas.getContext('2d');
  const gradient=context.createLinearGradient(0,0,canvas.width,canvas.height);
  gradient.addColorStop(0,'#285e83');gradient.addColorStop(.35,'#618d72');gradient.addColorStop(.68,'#c7a46a');gradient.addColorStop(1,'#a75855');
  context.fillStyle=gradient;context.fillRect(0,0,canvas.width,canvas.height);
  const image=context.getImageData(0,0,canvas.width,canvas.height),data=image.data;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
   const at=(y*canvas.width+x)*4,offset=((x*13+y*7+(x*y)%29)%31)-15;
   data[at]=Math.max(0,Math.min(255,data[at]+offset));data[at+1]=Math.max(0,Math.min(255,data[at+1]-offset*.45));data[at+2]=Math.max(0,Math.min(255,data[at+2]+offset*.3));data[at+3]=Math.round(155+100*y/canvas.height);
  }
  context.putImageData(image,0,0);
  return Array.from(new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer()));
 });
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'photo-finish-gradient.png',mimeType:'image/png',buffer:Buffer.from(png)});
 await ready();
 await selectBalanced();
 const defaultRecipe=await saveRecipe();
 assert.equal(defaultRecipe.adaptiveFinish,undefined,'new photo recipe has finish off by default');
 const baselinePixels=await pixels(),baseline=hash(baselinePixels);
 pass('finish is optional and off by default');

 const finishRequests=async()=>page.evaluate(()=>window.__photoFinishCheck.messages.filter(message=>message.type==='finish'));
 const applyLook=async look=>{
  const priorRenders=await renderCount(),priorFinishes=(await finishRequests()).length;
  await page.getByRole('button',{name:look,exact:true}).click();
  await page.waitForFunction(prior=>window.__photoFinishCheck.messages.filter(message=>message.type==='finish').length>prior,priorFinishes);
  await waitNewRender(priorRenders);
  assert.equal(await page.getByRole('button',{name:look,exact:true}).getAttribute('aria-pressed'),'true');
 };
 await applyLook('Natural');
 const natural=await canvasHash();
 assert.notEqual(natural,baseline,'Natural changes the capable gradient fixture');
 let fitted=await saveRecipe();
 assert.equal(fitted.adaptiveFinish.look,'natural');assert.equal(fitted.adaptiveFinish.fit.variant,'tone');assert.ok(fitted.adaptiveFinish.fit.active);
 const countAfterFit=(await finishRequests()).length;
 await setSliderEnd('Finish amount',false);
 const zeroHash=await canvasHash(),zeroAmount=await page.getByRole('slider',{name:'Finish amount',exact:true}).inputValue(),zeroRecipe=await saveRecipe();
 assert.equal(zeroAmount,'0');assert.equal(zeroRecipe.adaptiveFinish.amount,0);
 await clickAndWait(page.getByRole('button',{name:'Off',exact:true}));
 assert.equal(zeroHash,await canvasHash(),'finish amount zero is pixel-identical to Off from the same edited state');
 assert.equal((await finishRequests()).length,countAfterFit,'changing amount reuses its saved fit');
 await loadRecipe(fitted);
 assert.equal(await canvasHash(),natural,'restoring 100% uses the original fit exactly');
 assert.equal((await finishRequests()).length,countAfterFit,'changing amount does not rerun fit/inference');
 pass('Natural changes pixels; amount zero matches Off and amount changes reuse one fit');

 for(const engine of ['wwe','fivea','shallow']){
  const prior=await renderCount();
  await page.getByLabel('Correction engine',{exact:true}).selectOption(engine);
  await waitNewRender(prior);
  await applyLook('Natural');
  const modelRecipe=await saveRecipe();
  assert.equal(modelRecipe.engine,engine,`${engine} recipe keeps its selected correction engine`);
  assert.equal(modelRecipe.adaptiveFinish.look,'natural',`${engine} can save a fitted Natural look`);
  await clickAndWait(page.getByRole('button',{name:'Off',exact:true}));
  assert.equal(await page.getByRole('button',{name:'Off',exact:true}).getAttribute('aria-pressed'),'true');
 }
 pass('photo finish fits and saves independently with WWE-UIE, Five A+, and Shallow-UWnet');

 const priorCustomRender=await renderCount();
 await page.getByLabel('Correction engine',{exact:true}).selectOption('wave');
 await page.getByLabel('ONNX model file',{exact:true}).setInputFiles(resolve(root,'editor/public/models/wwe.onnx'));
 await page.getByRole('checkbox',{name:/I have permission to use this model/}).check();
 await page.getByRole('button',{name:'Load model',exact:true}).click();
 await page.locator('.research-dialog').waitFor({state:'detached',timeout:120000});
 await waitNewRender(priorCustomRender,120000);
 await applyLook('Natural');
 const customRecipe=await saveRecipe();
 assert.equal(customRecipe.engine,'wave','custom ONNX recipe keeps its selected correction engine');
 assert.equal(customRecipe.adaptiveFinish.look,'natural','custom ONNX can save a fitted Natural look');
 await clickAndWait(page.getByRole('button',{name:'Off',exact:true}));
 pass('photo finish fits and saves independently with a user-loaded compatible ONNX model');

 await selectBalanced();

 await applyLook('Vivid');
 const vivid=await canvasHash();
 assert.notEqual(vivid,natural,'Vivid differs from Natural on the gradient fixture');
 fitted=await saveRecipe();
 assert.equal(fitted.adaptiveFinish.look,'vivid');assert.equal(fitted.adaptiveFinish.fit.variant,'vivid');
 const vividRecipe=structuredClone(fitted);
 const finishCountBeforeLoad=(await finishRequests()).length;
 await clickAndWait(page.getByRole('button',{name:'Off',exact:true}));
 const offHash=await canvasHash();
 await loadRecipe(vividRecipe);
 assert.equal(await canvasHash(),vivid,'saved fit reproduces the same preview after load');
 assert.equal((await finishRequests()).length,finishCountBeforeLoad,'loading a fitted recipe does not refit it');
 pass('Vivid recipe save/load reuses the saved fit and reproduces pixels');

 let prior=await renderCount();await page.getByLabel('Undo',{exact:true}).click();await waitNewRender(prior);
 assert.equal(await page.getByRole('button',{name:'Off',exact:true}).getAttribute('aria-pressed'),'true','undo removes the loaded fitted look');
 assert.equal(await canvasHash(),offHash,'undo returns to the pre-finish preview');
 prior=await renderCount();await page.getByLabel('Redo',{exact:true}).click();await waitNewRender(prior);
 assert.equal(await page.getByRole('button',{name:'Vivid',exact:true}).getAttribute('aria-pressed'),'true','redo restores the fitted look');
 assert.equal(await canvasHash(),vivid,'redo restores the fitted preview');
 await loadRecipe(vividRecipe);
 await clickAndWait(page.getByRole('button',{name:'Clear enhancement',exact:true}));
 assert.equal(await page.getByRole('button',{name:'Off',exact:true}).getAttribute('aria-pressed'),'true');
 await loadRecipe(vividRecipe);
 await clickAndWait(page.getByRole('button',{name:'Reset manual edits',exact:true}));
 assert.equal(await page.getByRole('button',{name:'Off',exact:true}).getAttribute('aria-pressed'),'true','Reset manual edits clears the fitted look');
 await loadRecipe(vividRecipe);
 await clickAndWait(page.getByRole('button',{name:'Auto restore',exact:true}));
 assert.equal(await page.getByRole('button',{name:'Off',exact:true}).getAttribute('aria-pressed'),'true','Auto restore clears the fitted look');
 await loadRecipe(vividRecipe);
 await setSliderEnd('Restoration strength',true);
 assert.equal(await page.getByRole('button',{name:'Off',exact:true}).getAttribute('aria-pressed'),'true','restoration strength invalidates the saved fit');
 await loadRecipe(vividRecipe);
 await setSliderEnd('Warmth',true);
 assert.equal(await page.getByRole('button',{name:'Off',exact:true}).getAttribute('aria-pressed'),'true','white balance invalidates the saved fit');
 await loadRecipe(vividRecipe);
 await setSliderEnd('Brightness',true);
 const lightEdit=await saveRecipe();
 assert.equal(lightEdit.adaptiveFinish.fit.variant,'vivid','manual light edits retain the fitted look');
 pass('undo/redo, clear, reset, WB/strength invalidation, and manual light retention');

 const autoFinishRecipe=structuredClone(vividRecipe);
 autoFinishRecipe.enhancement={brightness:0,contrast:80,clarity:35,sharpness:25,black:.05,white:.95,autoApplied:true};
 await loadRecipe(autoFinishRecipe);
 await setSliderEnd('Brightness',true);
 const brightnessAfterAuto=await saveRecipe();
 assert.equal(brightnessAfterAuto.enhancement.contrast,0,'editing brightness clears the suppressed auto contrast value');
 assert.equal(brightnessAfterAuto.enhancement.autoApplied,undefined,'manual brightness clears autoApplied');
 await setSliderEnd('Auto contrast',true);
 const manualContrast=await saveRecipe();
 assert.equal(manualContrast.enhancement.contrast,100,'a manual contrast choice remains available with a finish');
 assert.equal(manualContrast.enhancement.autoApplied,undefined);
 pass('editing other enhancement controls clears hidden auto contrast; explicit manual contrast is retained');

 const selectedFinish=await canvasHash();
 await page.getByRole('combobox',{name:'File format'}).selectOption('png');
 const downloadWait=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download instead',exact:true}).click();
 const exported=await downloadWait,exportBytes=await readFile(await exported.path());
 const parity=await page.evaluate(async bytes=>{
  const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);
  const output=context.getImageData(0,0,bitmap.width,bitmap.height).data;
  const preview=document.querySelector('canvas[aria-label="Edited photo"]');
  const shown=preview.getContext('2d').getImageData(0,0,preview.width,preview.height).data;
  let max=0,alphaDiff=0,transparent=0;const differences=[];
  for(let index=0;index<output.length;index++){
   const delta=Math.abs(output[index]-shown[index]);max=Math.max(max,delta);
   if(delta&&differences.length<12)differences.push({index,exported:output[index],preview:shown[index]});
   if(index%4===3){alphaDiff=Math.max(alphaDiff,delta);if(output[index]<255)transparent++;}
  }
  return {width:bitmap.width,height:bitmap.height,max,alphaDiff,transparent,differences};
 },Array.from(exportBytes));
 report.checks.push({name:'png preview/export pixel comparison',...parity});console.log('PNG parity',JSON.stringify(parity));
 assert.deepEqual([parity.width,parity.height],[384,600]);
 assert.equal(parity.alphaDiff,0);assert.ok(parity.transparent>0,'PNG keeps the source alpha channel');
 assert.ok(parity.max<=1,'partial-alpha PNG round-trip changes RGB by at most one sRGB level');
 assert.notEqual(selectedFinish,baseline);
 pass('same-size partial-alpha PNG export preserves alpha and matches preview within one sRGB level',parity);

 await page.getByRole('button',{name:'Off',exact:true}).click();await ready();
 await page.getByRole('combobox',{name:'File format'}).selectOption('png');
 const offDownloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'Download instead',exact:true}).click();
 const offDownload=await offDownloadWait,offBytes=await readFile(await offDownload.path());
 const offParity=await page.evaluate(async bytes=>{
  const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)])),canvas=document.createElement('canvas');
  canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);
  const output=context.getImageData(0,0,bitmap.width,bitmap.height).data,preview=document.querySelector('canvas[aria-label="Edited photo"]'),shown=preview.getContext('2d').getImageData(0,0,preview.width,preview.height).data;
  let max=0,alphaDiff=0;for(let index=0;index<output.length;index++){const delta=Math.abs(output[index]-shown[index]);max=Math.max(max,delta);if(index%4===3)alphaDiff=Math.max(alphaDiff,delta);}
  return {width:bitmap.width,height:bitmap.height,max,alphaDiff};
 },Array.from(offBytes));
 report.checks.push({name:'partial-alpha Off preview/export control',...offParity});
 assert.deepEqual([offParity.width,offParity.height],[384,600]);assert.ok(offParity.max<=1,'Off partial-alpha PNG round-trip establishes the same one-level Canvas limit');assert.equal(offParity.alphaDiff,0);
 pass('partial-alpha Off control has the same bounded PNG round-trip delta',offParity);

 const opaquePng=await page.evaluate(async bytes=>{
  const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)])),canvas=document.createElement('canvas');
  canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);
  const image=context.getImageData(0,0,canvas.width,canvas.height);for(let index=3;index<image.data.length;index+=4)image.data[index]=255;
  context.putImageData(image,0,0);return Array.from(new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer()));
 },png);
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'photo-finish-opaque.png',mimeType:'image/png',buffer:Buffer.from(opaquePng)});await ready();await selectBalanced();await applyLook('Natural');
 await page.getByRole('combobox',{name:'File format'}).selectOption('png');
 const opaqueDownloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'Download instead',exact:true}).click();
 const opaqueDownload=await opaqueDownloadWait,opaqueBytes=await readFile(await opaqueDownload.path());
 const opaqueParity=await page.evaluate(async bytes=>{
  const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)])),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);const output=context.getImageData(0,0,bitmap.width,bitmap.height).data;
  const preview=document.querySelector('canvas[aria-label="Edited photo"]'),shown=preview.getContext('2d').getImageData(0,0,preview.width,preview.height).data;
  let max=0,alphaDiff=0;for(let index=0;index<output.length;index++){const delta=Math.abs(output[index]-shown[index]);max=Math.max(max,delta);if(index%4===3)alphaDiff=Math.max(alphaDiff,delta);}
  return {width:bitmap.width,height:bitmap.height,max,alphaDiff};
 },Array.from(opaqueBytes));
 report.checks.push({name:'opaque png preview/export pixel comparison',...opaqueParity});
 assert.deepEqual([opaqueParity.width,opaqueParity.height],[384,600]);assert.equal(opaqueParity.max,0,'opaque PNG export is pixel-identical across strip boundaries');assert.equal(opaqueParity.alphaDiff,0);
 pass('same-size opaque PNG export matches preview exactly across strip boundaries',opaqueParity);

 const generatedVideo=await page.evaluate(async()=>{
  const mimeType=['video/mp4;codecs=avc1.42E01E','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
  if(!mimeType)return null;
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;
  const context=canvas.getContext('2d'),stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType}),chunks=[];
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  const stopped=new Promise(resolve=>recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType})));
  recorder.start();let frame=0;const timer=setInterval(()=>{context.fillStyle=`hsl(${frame*43%360} 60% 45%)`;context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#fff';context.fillRect(frame++%canvas.width,12,12,40);},100);
  await new Promise(resolve=>setTimeout(resolve,850));clearInterval(timer);recorder.stop();const blob=await stopped;stream.getTracks().forEach(track=>track.stop());
  return {mimeType:blob.type,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))};
 });
 const sampleVideo=resolve(root,'analysis/video-check/sampled.mp4');
 if(generatedVideo){
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'photo-finish-video.mp4',mimeType:generatedVideo.mimeType,buffer:Buffer.from(generatedVideo.bytes)});
 }else if(existsSync(sampleVideo)){
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles(sampleVideo);
 }else{
  report.skipped??=[];report.skipped.push('video controls check: MediaRecorder MP4 unavailable and generated MP4 test fixture absent');
 }
 if(generatedVideo||existsSync(sampleVideo)){
  await ready();
  assert.equal(await page.locator('.photo-finish-group').count(),0,'photo finish controls are absent for video');
  assert.equal(await page.getByRole('button',{name:'Natural',exact:true}).count(),0);
  pass('photo finish controls are unavailable for video');
 }

 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'photo-finish-mobile.png',mimeType:'image/png',buffer:Buffer.from(png)});
 await ready();
 assert.equal(await page.locator('.photo-finish-group').count(),1,'photo finish controls return for photos');
 for(const locale of ['en','zh-HK','ja']){
  await changeLanguage(page,locale);
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   await page.locator('#control-tab-enhancement').click();await page.locator('#control-subtab-effects').click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${locale} mobile layout overflows at ${width}px`);
   await page.getByRole('button',{name:locales[locale].Natural,exact:true}).waitFor({state:'visible'});
   await page.getByRole('button',{name:locales[locale].Vivid,exact:true}).waitFor({state:'visible'});
   if(width===390)await page.screenshot({path:resolve(output,`${locale}-effects.png`),fullPage:true});
  }
 }
 pass('English, Traditional Chinese, and Japanese mobile layouts fit 320px and 390px viewports');

 // Hold a real finish result, load a saved recipe that supersedes it, and hold
 // the resulting render while delivering both stale worker message shapes.
 await changeLanguage(page,'en');await page.setViewportSize({width:1360,height:950});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'photo-finish-race.png',mimeType:'image/png',buffer:Buffer.from(png)});
 await ready();await selectBalanced();
 const raceBase=await saveRecipe();
 await page.evaluate(()=>{window.__photoFinishCheck.holdFinishReply=true;});
 await page.getByRole('button',{name:'Natural',exact:true}).click();
 await page.waitForFunction(()=>window.__photoFinishCheck.heldFinishReply!==null);
 assert.equal(await page.locator('.top-actions .primary').isDisabled(),true,'export remains locked while a finish fit is pending');
 assert.equal(await page.getByLabel('Save recipe',{exact:true}).isDisabled(),true,'recipe save remains locked while a finish fit is pending');
 await page.evaluate(()=>{window.__photoFinishCheck.holdNextRender=true;});
 await saveRecipeInput.setInputFiles({name:'clearwater-recipe.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raceBase))});
 await page.waitForFunction(()=>window.__photoFinishCheck.heldRender!==null);
 const held=await page.evaluate(()=>({gen:window.__photoFinishCheck.heldFinishReply.data.gen,request:window.__photoFinishCheck.heldFinishReply.data.request,workerIndex:window.__photoFinishCheck.workers.indexOf(window.__photoFinishCheck.heldFinishReply.worker)}));
 assert.equal(await page.locator('.top-actions .primary').isDisabled(),true,'export remains locked while replacement render is held');
 assert.equal(await page.getByLabel('Save recipe',{exact:true}).isDisabled(),true,'recipe save remains locked while replacement render is held');
 await page.evaluate(held=>{
  const state=window.__photoFinishCheck;
  state.inject(held.workerIndex,{type:'finish-ready',gen:held.gen,request:held.request,look:'natural',fit:{variant:'tone',active:true,reason:'fit',sampleCount:64,colourReason:'fit',colourGains:[1,1,1],toneScale:1.06,toneOffset:-.01}});
  state.inject(held.workerIndex,{type:'error',gen:held.gen,request:held.request,operation:'finish',message:'Late finish failure.'});
 },held);
 await page.waitForTimeout(100);
 assert.equal(await page.locator('.top-actions .primary').isDisabled(),true,'stale finish messages cannot unlock save before replacement render');
 assert.equal(await page.getByLabel('Save recipe',{exact:true}).isDisabled(),true);
 await page.evaluate(()=>window.__photoFinishCheck.releaseRender());
 await ready();
 assert.equal(await page.getByRole('button',{name:'Off',exact:true}).getAttribute('aria-pressed'),'true','late fit does not apply to the replacement recipe');
 await page.waitForTimeout(700);
 assert.equal(await page.locator('.top-actions .primary').isDisabled(),false,'replacement render unlocks export');
 assert.equal(await page.getByLabel('Save recipe',{exact:true}).isDisabled(),false,'replacement render unlocks recipe save');
 pass('stale finish success/error cannot unlock or alter a replacement recipe before its render completes');

 assert.deepEqual(report.errors,[],'no browser exceptions');
 await writeFile(resolve(output,'report.json'),JSON.stringify({...report,finishedAt:new Date().toISOString()},null,2));
 await context.close();
 console.log(`PASS photo finish browser checks; report: ${resolve(output,'report.json')}`);
}catch(error){
 report.failure=error instanceof Error?error.stack:String(error);
 await writeFile(resolve(output,'report.json'),JSON.stringify({...report,finishedAt:new Date().toISOString()},null,2));
 throw error;
}finally{await browser.close();}
