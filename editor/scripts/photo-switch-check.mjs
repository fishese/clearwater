import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const url=process.env.CHECK_URL??'http://127.0.0.1:5173/';
const engine=process.env.CHECK_BROWSER==='webkit'?webkit:chromium;
const browser=await (engine===webkit?engine.launch({headless:true}):engine.launch({channel:process.env.CHECK_BROWSER??'msedge',headless:true}));
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const page=await context.newPage(),errors=[],consoleErrors=[];page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text().slice(0,300));});
 await page.addInitScript(iosShell=>{
  const state=window.__photoSwitchCheck={messages:[],incoming:[],handlers:new Map(),photoWorker:null,holdGeneration:null,held:[]};
  if(iosShell){
   window.webkit={messageHandlers:{bridge:{postMessage(){}}}};
   window.Capacitor={getPlatform:()=> 'ios',isNativePlatform:()=>true,isPluginAvailable:()=>false};
  }
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message,...args){
   state.messages.push({worker:this,type:message?.type,gen:message?.gen,request:message?.request,operation:message?.operation,message:typeof message?.message==='string'?message.message.slice(0,240):undefined});
   if(message?.type==='load'&&message.blob?.type?.startsWith('image/'))state.photoWorker=this;
   return Reflect.apply(post,this,[message,...args]);
  };
  let owner=Worker.prototype,descriptor,descriptorOwner;
  while(owner&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(owner,'onmessage');if(descriptor)descriptorOwner=owner;else owner=Object.getPrototypeOf(owner);}
  if(descriptor?.get&&descriptor?.set){
   state.hookInstalled=true;state.hookOwner=descriptorOwner?.constructor?.name??'Worker';
   Object.defineProperty(Worker.prototype,'onmessage',{
    configurable:true,enumerable:descriptor.enumerable,
    get(){return descriptor.get.call(this);},
    set(handler){
     if(typeof handler!=='function'){descriptor.set.call(this,handler);return;}
     state.handlers.set(this,handler);
     descriptor.set.call(this,event=>{
      const data=event.data;
      state.incoming.push({type:data?.type,gen:data?.gen,request:data?.request,operation:data?.operation,message:typeof data?.message==='string'?data.message.slice(0,240):undefined,keys:data&&typeof data==='object'?Object.keys(data):[]});
      if(state.holdGeneration!==null&&event.data?.type==='rendered'&&event.data.gen===state.holdGeneration){
       state.held.push({worker:this,handler,event});return;
      }
      return handler.call(this,event);
     });
    },
   });
  }else state.hookInstalled=false;
  state.releaseHeld=()=>{const held=state.held.splice(0);for(const item of held)item.handler.call(item.worker,item.event);};
  state.inject=(worker,data)=>state.handlers.get(worker)?.call(worker,{data});
 },process.env.CHECK_IOS_SHELL==='1');
 await page.goto(url);
 assert.equal(await page.evaluate(()=>window.__photoSwitchCheck.hookInstalled),true,'Worker onmessage interception must be installed');
 if(process.env.CHECK_IOS_SHELL==='1'){
  assert.equal(await page.evaluate(()=>window.Capacitor?.getPlatform?.()),'ios','mocked native shell must be active for the iOS switch run');
  assert.equal(await page.locator('.camera-launch').getAttribute('aria-label'),'Native camera is unavailable in this iOS build.','application runtime must recognize the mocked iOS platform');
 }
 const images=await page.evaluate(async()=>{
  const make=(base,accent)=>new Promise(resolve=>{
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
   const context=canvas.getContext('2d');context.fillStyle=base;context.fillRect(0,0,640,480);
   context.fillStyle=accent;context.fillRect(120,90,400,300);canvas.toBlob(blob=>resolve(blob),'image/jpeg',.92);
  });
  const data=await Promise.all([make('#146280','#63a981'),make('#70417d','#d18b45')]);
  return Promise.all(data.map(async(blob,index)=>({name:`switch-${index+1}.jpg`,type:'image/jpeg',base64:await blobToBase64(blob)})));
  async function blobToBase64(blob){return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);});}
 });
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles(images.map(item=>({name:item.name,mimeType:item.type,buffer:Buffer.from(item.base64,'base64')})));
 const ready=()=>page.waitForFunction(()=>document.querySelector('.photo-tile')&&document.querySelector('canvas[aria-label="Edited photo"]')&&window.__photoSwitchCheck.messages.some(message=>message.type==='render')).catch(async error=>{
  console.error('PHOTO SWITCH READINESS FAILED',JSON.stringify({errors,body:(await page.locator('body').innerText()).slice(0,1400),messages:await page.evaluate(()=>window.__photoSwitchCheck.messages.slice(-12).map(({type,gen,request})=>({type,gen,request})))}));
  throw error;
 });
 const navigate=async name=>page.getByRole('button',{name,exact:true}).evaluate(button=>button.click());
 const renderCount=()=>page.evaluate(()=>window.__photoSwitchCheck.messages.filter(message=>message.type==='render').length);
 const waitForRenderAfter=count=>page.waitForFunction(count=>window.__photoSwitchCheck.messages.filter(message=>message.type==='render').length>count,count);
 const settled=()=>page.waitForFunction(()=>{
  const state=window.__photoSwitchCheck,canvas=document.querySelector('canvas[aria-label="Edited photo"]');
  const last=state.messages.filter(message=>message.type==='render').at(-1);
  return !!last&&canvas?.dataset.generation===String(last.gen)&&canvas?.dataset.request===String(last.request);
 });
 const hash=()=>page.locator('canvas[aria-label="Edited photo"]').evaluate(canvas=>{
  const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let value=2166136261;
  for(const byte of data)value=Math.imul(value^byte,16777619);return value>>>0;
 });
 await ready();await settled();
 const originalHash=await hash();
 const oldGeneration=await page.locator('canvas[aria-label="Edited photo"]').getAttribute('data-generation');
 await page.evaluate(generation=>window.__photoSwitchCheck.holdGeneration=Number(generation),oldGeneration);
 const warmth=page.getByRole('slider',{name:'Warmth',exact:true});
 const warmthBefore=Number(await warmth.inputValue()),warmthStep=Number(await warmth.getAttribute('step'))||1,warmthMax=Number(await warmth.getAttribute('max')||Infinity);
 const nextWarmth=Math.min(warmthMax,warmthBefore+warmthStep),previousRenderCount=await renderCount();
 await warmth.evaluate((input,value)=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
  input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
 },nextWarmth);
 assert.equal(Number(await warmth.inputValue()),nextWarmth,'warmth slider must accept the new value');
 await waitForRenderAfter(previousRenderCount);
 await page.waitForFunction(()=>window.__photoSwitchCheck.held.length===1,{timeout:30000}).catch(async error=>{
  const pageState=await page.evaluate(()=>{
   const state=window.__photoSwitchCheck,canvas=document.querySelector('canvas[aria-label="Edited photo"]'),primary=document.querySelector('.top-actions .primary');
   return {hookInstalled:state.hookInstalled,hookOwner:state.hookOwner,holdGeneration:state.holdGeneration,held:state.held.length,handlers:state.handlers.size,messages:state.messages.slice(-16).map(({type,gen,request,operation,message})=>({type,gen,request,operation,message})),incoming:state.incoming.slice(-16),canvas:canvas?{generation:canvas.dataset.generation,request:canvas.dataset.request,width:canvas.width,height:canvas.height}:null,primary:primary?{disabled:primary.disabled,label:primary.getAttribute('aria-label')}:null,toasts:[...document.querySelectorAll('.toast')].map(node=>node.textContent),body:document.body.innerText.slice(0,900)};
  });
  console.error('HELD RENDER NOT INTERCEPTED',JSON.stringify({page:pageState,errors,consoleErrors}));
  throw error;
 });

 let nextRenderCount=await renderCount();await navigate('Next photo');await waitForRenderAfter(nextRenderCount);await settled();
 assert.equal(await page.getByLabel('Photo position',{exact:true}).innerText(),'2 / 2');
 const secondHash=await hash();assert.notEqual(secondHash,originalHash,'next JPG must load its own pixels');
 await page.evaluate(()=>window.__photoSwitchCheck.releaseHeld());
 assert.equal(await hash(),secondHash,'a held render reply from the previous JPG must not replace the current image');
 await page.evaluate(oldGen=>{
  const state=window.__photoSwitchCheck;
  state.inject(state.photoWorker,{type:'error',gen:Number(oldGen),request:0,operation:'render',message:"Couldn't read this file. Re-export it as a standard MP4."});
 },oldGeneration);
 await page.waitForTimeout(100);
 assert.equal(await page.locator('.toast').count(),0,'a stale JPG failure must not show video-only MP4 advice');

 for(let i=0;i<3;i++){
  const direction=i%2===0?'Previous photo':'Next photo';
  nextRenderCount=await renderCount();await navigate(direction);await waitForRenderAfter(nextRenderCount);await settled();
 }
 assert.deepEqual(errors,[],'photo switching must not produce browser errors');
 console.log(`PASS ${process.env.CHECK_BROWSER==='webkit'?'WebKit ':''}${process.env.CHECK_IOS_SHELL==='1'?'mocked iOS shell ':''}held stale render and error replies are ignored while switching JPGs back and forth`);
 await context.close();
}finally{await browser.close();}
