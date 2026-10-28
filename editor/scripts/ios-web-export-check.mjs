import { chromium,webkit } from 'playwright';
import assert from 'node:assert/strict';

const engineName=process.env.CHECK_BROWSER==='webkit'?'webkit':process.env.CHECK_BROWSER==='msedge'?'msedge':'chromium';
const iosBrowser=(process.env.CHECK_IOS_BROWSER??'safari').toLowerCase();
const canShareMode=(process.env.CHECK_CAN_SHARE??'missing').toLowerCase();
assert.ok(['safari','chrome'].includes(iosBrowser),'CHECK_IOS_BROWSER must be safari or chrome');
assert.ok(['missing','false','true'].includes(canShareMode),'CHECK_CAN_SHARE must be missing, false or true');
const browser=await (engineName==='webkit'?webkit:chromium).launch({headless:true,...(engineName==='msedge'?{channel:'msedge'}:{})});
try{
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  const downloads=[],pageErrors=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
  page.on('pageerror',error=>{pageErrors.push(error.message);console.error('PAGE ERROR',error.message);});
  page.on('console',message=>{if(message.type()==='error')console.error('CONSOLE',message.text());});
  await page.addInitScript(({browserKind,shareMode})=>{
    delete window.showDirectoryPicker;
    const safari='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
    const chrome='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.82 Mobile/15E148 Safari/604.1';
    Object.defineProperty(navigator,'userAgent',{configurable:true,value:browserKind==='chrome'?chrome:safari});
    Object.defineProperty(navigator,'platform',{configurable:true,value:'iPhone'});
    Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:5});
    window.iosCanShareCalls=0;
    if(shareMode==='missing')Object.defineProperty(navigator,'canShare',{configurable:true,value:undefined});
    else Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>{window.iosCanShareCalls++;return shareMode==='true';}});
    window.iosShareCalls=[];window.iosShareCancelNext=true;
    window.iosPreviewRenders=0;window.delayNextEnhance=false;window.enhanceDelayed=false;window.holdNextRender=false;window.heldRender=null;
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message,...args){
      if(message?.type==='render')window.iosPreviewRenders++;
      if(message?.type==='render'&&window.holdNextRender){
        window.holdNextRender=false;window.heldRender={worker:this,message,args};
        return;
      }
      if(message?.type==='enhance'&&window.delayNextEnhance){
        window.delayNextEnhance=false;window.enhanceDelayed=true;window.delayedEnhance={worker:this,gen:message.gen,request:message.request};
        setTimeout(()=>Reflect.apply(post,this,[message,...args]),500);
        return;
      }
      return Reflect.apply(post,this,[message,...args]);
    };
    window.releaseHeldRender=()=>{const held=window.heldRender;window.heldRender=null;Reflect.apply(post,held.worker,[held.message,...held.args]);};
    Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{
      const file=files[0],call={name:file.name,type:file.type,userActivationSupported:!!navigator.userActivation,userActivationActive:navigator.userActivation?.isActive??null};window.iosShareCalls.push(call);
      if(file.type==='application/json')call.text=await file.text();
      if(window.iosShareCancelNext){window.iosShareCancelNext=false;throw new DOMException('cancelled','AbortError');}
    }});
  },{browserKind:iosBrowser,shareMode:canShareMode});
  await page.goto(process.env.CHECK_URL||'http://127.0.0.1:4197/');
  const png=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const context=canvas.getContext('2d');context.fillStyle='#527b70';context.fillRect(0,0,64,64);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const exportName=`ios-${iosBrowser}-export.png`;
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:exportName,mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(name=>document.querySelector('.filename')?.textContent.includes(name),exportName);
  await page.waitForFunction(()=>!document.querySelector('.top-actions .primary')?.disabled).catch(async error=>{console.error('BUTTONS',await page.locator('.top-actions button').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,disabled:button.disabled,aria:button.getAttribute('aria-label')}))));console.error('BODY',(await page.locator('body').innerText()).slice(0,2000));throw error;});

  const exportButton=page.locator('.top-actions .primary');
  const initialPreviewRenders=await page.evaluate(()=>window.iosPreviewRenders);
  await page.locator('[data-control-tab="enhancement"]').click();
  await page.locator('[data-control-subtab="colour"]').click();
  const warmth=page.locator('#control-subpanel-colour input[aria-label="Warmth"]');
  const rangeTrack=warmth.locator('xpath=..').locator('.range-track');
  await rangeTrack.waitFor({state:'visible'});
  const initialWarmth=await warmth.inputValue();
  await page.evaluate(()=>{window.holdNextRender=true;});
  const trackBox=await rangeTrack.boundingBox();assert.ok(trackBox,'mobile Warmth touch track is visible');
  await rangeTrack.evaluate((track,rect)=>{
    const x=rect.x+rect.width*.24,y=rect.y+rect.height/2;
    const init={bubbles:true,cancelable:true,pointerId:71,pointerType:'touch',isPrimary:true,button:0,buttons:1};
    track.dispatchEvent(new PointerEvent('pointerdown',{...init,clientX:x,clientY:y}));
    track.dispatchEvent(new PointerEvent('pointermove',{...init,clientX:x+rect.width*.32,clientY:y}));
    track.dispatchEvent(new PointerEvent('pointerup',{...init,buttons:0,clientX:x+rect.width*.32,clientY:y}));
  },trackBox);
  await page.waitForFunction(()=>window.heldRender!==null,null,{timeout:10000});
  const pendingWarmth=await warmth.inputValue();
  assert.notEqual(pendingWarmth,initialWarmth,'touch drag commits a changed Warmth value');
  assert.equal(await exportButton.isDisabled(),true,'export remains disabled while the slider preview render is pending');
  await page.locator('[data-control-tab="export"]').click();
  assert.equal(await page.locator('.save-as').isDisabled(),true,'Save as remains disabled while the slider preview render is pending');
  assert.equal(await page.getByRole('button',{name:'Save recipe'}).isDisabled(),true,'recipe save remains disabled while the slider preview render is pending');
  assert.equal(await page.getByRole('button',{name:'Undo'}).isDisabled(),false,'committed touch drag creates an undo entry');
  await page.evaluate(()=>window.releaseHeldRender());
  await page.waitForFunction(()=>!document.querySelector('.top-actions .primary')?.disabled,null,{timeout:30000});
  await page.waitForFunction(()=>!document.querySelector('.save-as')?.disabled,null,{timeout:30000});
  await page.waitForTimeout(650);
  assert.equal(await exportButton.isDisabled(),false,'export re-enables after the slider preview render completes');
  assert.equal(await page.locator('.save-as').isDisabled(),false,'Save as re-enables after the slider preview render completes');
  assert.equal(await page.getByRole('button',{name:'Save recipe'}).isDisabled(),false,'recipe save re-enables after the slider preview render completes');
  const sliderPreviewRenders=await page.evaluate(()=>window.iosPreviewRenders);
  assert.ok(sliderPreviewRenders>initialPreviewRenders,'slider edit rendered a new preview before export');
  assert.ok(initialPreviewRenders>0,'initial photo preview rendered before export');
  await exportButton.click();
  let dialog=page.getByRole('dialog',{name:'Share or save…'});
  await dialog.waitFor().catch(async error=>{console.error('BUTTONS',await page.locator('.top-actions button').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,disabled:button.disabled,aria:button.getAttribute('aria-label')}))));console.error('BODY',(await page.locator('body').innerText()).slice(0,2500));throw error;});
  assert.equal(await page.evaluate(()=>window.iosShareCalls.length),0,'render completion opens a prompt without sharing automatically');
  assert.equal(await exportButton.isDisabled(),true,'top export is locked while the iOS share prompt is open');
  assert.equal(await page.locator('.save-as').isDisabled(),true,'Export pane save is locked while the same prompt is open');
  assert.equal(await page.getByRole('button',{name:'Save recipe'}).isDisabled(),true,'recipe export is locked during the share prompt');
  await dialog.getByRole('button',{name:'Cancel'}).click();
  await dialog.waitFor({state:'detached'});
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.iosPreviewRenders),sliderPreviewRenders,'export completion does not queue an unchanged preview render');
  assert.equal(await exportButton.isDisabled(),false,'export is ready immediately after the share prompt is cancelled');

  await page.locator('.save-as').click();dialog=page.getByRole('dialog',{name:'Share or save…'});await dialog.waitFor();
  await dialog.getByRole('button',{name:'Share now'}).click();
  await page.waitForFunction(()=>window.iosShareCalls.length===1);
  await dialog.waitFor();
  assert.equal((await page.evaluate(()=>window.iosShareCalls[0])).name,`ios-${iosBrowser}-export-restore.jpg`);
  await dialog.getByRole('button',{name:'Share now'}).click();
  await page.waitForFunction(()=>window.iosShareCalls.length===2);
  await dialog.waitFor({state:'detached'});
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.iosPreviewRenders),sliderPreviewRenders,'sharing does not repeat the unchanged preview render');
  assert.equal(await exportButton.isDisabled(),false,'export remains ready after sharing');

  await page.locator('[data-control-tab="export"]').click();
  await page.getByRole('button',{name:'Save recipe'}).click();
  dialog=page.getByRole('dialog',{name:'Share or save…'});await dialog.waitFor();
  assert.equal(await page.evaluate(()=>window.iosShareCalls.length),2,'toolbar recipe save waits for a fresh share tap');
  await dialog.getByRole('button',{name:'Share now'}).click();
  await page.waitForFunction(()=>window.iosShareCalls.length===3);
  await dialog.waitFor({state:'detached'});

  await page.locator('[data-control-tab="export"]').click();
  await page.locator('.preset-group').evaluate(group=>{group.open=true;});
  await page.getByRole('button',{name:'Save preset',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Share or save…'});await dialog.waitFor();
  assert.equal(await page.evaluate(()=>window.iosShareCalls.length),3,'preset save also waits for a fresh share tap');
  assert.equal(await dialog.locator('p').first().textContent(),'clearwater-recipe.json');
  await dialog.getByRole('button',{name:'Share now'}).click();
  await page.waitForFunction(()=>window.iosShareCalls.length===4);
  await dialog.waitFor({state:'detached'});
  const presets=await page.evaluate(()=>window.iosShareCalls.slice(2));
  for(const preset of presets){
    assert.equal(preset.name,'clearwater-recipe.json');
    assert.equal(preset.type,'application/json');
    assert.equal(typeof JSON.parse(preset.text).engine,'string','shared preset contains serialized recipe JSON');
  }
  await page.evaluate(()=>{window.delayNextEnhance=true;window.holdNextRender=true;});
  await page.locator('[data-control-tab="enhancement"]').click();
  await page.locator('[data-control-subtab="effects"]').click();
  await page.getByRole('button',{name:'Auto enhance'}).click();
  await page.waitForFunction(()=>window.enhanceDelayed);
  assert.equal(await exportButton.isDisabled(),true,'enhancement keeps export locked while it is active');
  await page.getByLabel('Choose recipe').setInputFiles({name:'clearwater-recipe.json',mimeType:'application/json',buffer:Buffer.from(presets[0].text)});
  await page.waitForFunction(()=>window.heldRender!==null);
  await page.evaluate(()=>{const old=window.delayedEnhance;old.worker.onmessage({data:{type:'error',operation:'enhance',gen:old.gen,request:old.request,message:'Superseded enhancement failed.'}});});
  assert.equal(await exportButton.isDisabled(),true,'a late enhancement error cannot unlock an unfinished preview render');
  await page.evaluate(()=>window.releaseHeldRender());
  await page.waitForFunction(()=>!document.querySelector('.top-actions .primary')?.disabled);
  await page.waitForTimeout(650);
  assert.equal(await exportButton.isDisabled(),false,'a superseded enhancement cannot leave export busy after a recipe loads');
  assert.deepEqual(downloads,[],'Safari save paths do not fall through to scripted downloads');
  const shareDiagnostics=await page.evaluate(()=>({calls:window.iosShareCalls,canShareCalls:window.iosCanShareCalls}));
  if(canShareMode==='missing')assert.equal(shareDiagnostics.canShareCalls,0,'missing canShare remains a supported iOS path');
  else assert.ok(shareDiagnostics.canShareCalls>0,'configured canShare mock is exercised');
  if(shareDiagnostics.calls.some(call=>call.userActivationSupported))assert.ok(shareDiagnostics.calls.every(call=>call.userActivationSupported&&call.userActivationActive===true),'each native share call starts inside fresh user activation');
  assert.deepEqual(pageErrors,[],'page has no uncaught errors');
  await context.close();
  console.log(`PASS ${engineName} engine with iPhone ${iosBrowser==='chrome'?'CriOS':'Safari'} UA; canShare=${canShareMode}; cancel/retry, recipe sharing, user activation, and superseded enhancement`);
}finally{await browser.close();}
