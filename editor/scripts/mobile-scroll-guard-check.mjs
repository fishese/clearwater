import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const editorDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(editorDir,'..');
// Run with CHECK_URL=http://127.0.0.1:4173 CHECK_BROWSER=chromium [PLAYWRIGHT_CHANNEL=msedge] node scripts/mobile-scroll-guard-check.mjs
// CHECK_SMOKE=1 narrows the matrix to one 390px normal-layout Warmth check.
// CHECK_RECIPES_ONLY=1 runs the preset-stability cases for quick iteration.
// CHECK_INTERACTIONS_ONLY=1 runs drag/tap/keyboard checks without the gesture matrix.
// CHECK_SWITCH_ONLY=1 runs the cross-photo live-preview cancellation case.
const browserName=process.env.CHECK_BROWSER??'chromium';
const baseUrl=process.env.CHECK_URL;
if(!baseUrl)throw new Error('Set CHECK_URL to the production preview URL.');
if(!['chromium','webkit'].includes(browserName))throw new Error('CHECK_BROWSER must be chromium or webkit.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const outputDir=path.join(os.tmpdir(),`clearwater-mobile-scroll-guard-${stamp}`);
await mkdir(outputDir,{recursive:true});

function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function pngChunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4);length.writeUInt32BE(data.length);const sum=Buffer.alloc(4);sum.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,sum]);}
function syntheticPng(seed=0){
  const width=96,height=64,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header.set([8,6,0,0,0],8);
  const rows=[];
  for(let y=0;y<height;y++){
    const row=Buffer.alloc(1+width*4);
    for(let x=0;x<width;x++){const i=1+x*4;row.set([(x*7+y*3+seed)%256,(y*9+x+seed*2)%256,(x*2+y*5+seed*3)%256,255],i);}
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(Buffer.concat(rows))),pngChunk('IEND',Buffer.alloc(0))]);
}

const fixture=syntheticPng();
const browserType=browserName==='webkit'?webkit:chromium;
const launchOptions={headless:true};
if(browserName==='chromium'&&process.env.PLAYWRIGHT_CHANNEL)launchOptions.channel=process.env.PLAYWRIGHT_CHANNEL;
const browser=await browserType.launch(launchOptions);
const results=[];
const failures=[];

function cleanName(value){return value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}

async function captureFailure(page,label,error){
  const screenshot=path.resolve(outputDir,`${cleanName(label)}.png`);
  if(page)await page.screenshot({path:screenshot,fullPage:false}).catch(()=>{});
  const entry={status:'failed',label,error:error instanceof Error?error.message:String(error),...(error?.evidence?{evidence:error.evidence}:{}),screenshot};
  results.push(entry);failures.push(entry);console.error(`FAIL ${label}: ${entry.error}${entry.evidence?`; evidence=${JSON.stringify(entry.evidence)}`:''}; screenshot=${screenshot}`);
}

async function openEditor(width,expanded){
  const context=await browser.newContext({
    viewport:{width,height:700},
    deviceScaleFactor:1,
    isMobile:true,
    hasTouch:true,
    locale:'en-US',
    serviceWorkers:'block',
  });
  const page=await context.newPage();
  await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:45000});
  const updateHint=page.locator('.web-update-hint-ok');
  if(await updateHint.isVisible().catch(()=>false))await updateHint.click();
  await page.locator('input[type=file][multiple]').first().setInputFiles({name:'synthetic-mobile-scroll.png',mimeType:'image/png',buffer:fixture});
  await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:90000});
  await page.waitForFunction(()=>!!document.querySelector('.preview-info'),null,{timeout:30000});
  if(expanded){
    await page.getByRole('button',{name:'Expand photo'}).first().click();
    const toggle=page.getByRole('button',{name:'Toggle adjustments'});
    await toggle.click();
    await page.waitForFunction(()=>document.querySelector('.app-shell')?.classList.contains('adjustments-open'));
  }
  return {context,page};
}

async function selectSlider(page,kind){
  if(kind==='warmth'){
    await page.locator('[data-control-tab="enhancement"]').click();
    await page.locator('[data-control-subtab="colour"]').click();
    return page.locator('#control-subpanel-colour input[type="range"][aria-label="Warmth"]');
  }
  if(kind==='depth'){
    await page.locator('[data-control-tab="correction"]').click();
    await page.locator('[data-control-subtab="dive"]').click();
    return page.locator('.depth-control input[type="range"][aria-label="Approx. depth"]');
  }
  await page.locator('[data-control-tab="correction"]').click();
  await page.locator('[data-control-subtab="engine"]').click();
  return page.locator('.restoration-row input[type="range"][aria-label="Restoration strength"]');
}

async function trackFor(slider){return slider.locator('xpath=..').locator('.range-track');}

async function sliderState(page,slider){
  return slider.evaluate(el=>({value:el.value,disabled:el.disabled,ariaValueText:el.getAttribute('aria-valuetext')}));
}

async function undoState(page){return page.getByRole('button',{name:'Undo'}).isDisabled();}
async function redoState(page){return page.getByRole('button',{name:'Redo'}).isDisabled();}

async function sliderSelector(slider){
  return slider.evaluate(el=>{
    const label=el.getAttribute('aria-label');
    if(label==='Warmth')return '#control-subpanel-colour input[aria-label="Warmth"]';
    if(label==='Approx. depth')return '.depth-control input[aria-label="Approx. depth"]';
    return '.restoration-row input[aria-label="Restoration strength"]';
  });
}

async function waitValue(page,selector,value){
  await page.waitForFunction(({selector,value})=>document.querySelector(selector)?.value===String(value),{selector,value},{timeout:5000});
}

async function installScroller(page,slider){
  return slider.evaluate(el=>{
    let node=el.parentElement;
    while(node&&node!==document.body){
      const style=getComputedStyle(node);
      if(/auto|scroll|overlay/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+4)break;
      node=node.parentElement;
    }
    if(!node||node===document.body)node=document.scrollingElement;
    window.__mobileScrollGuardNode=node;
    if(node===document.scrollingElement)window.scrollTo(0,0);else node.scrollTop=0;
    return {
      kind:node===document.scrollingElement?'document':node.className||node.tagName.toLowerCase(),
      top:node===document.scrollingElement?window.scrollY:node.scrollTop,
      max:Math.max(0,node.scrollHeight-node.clientHeight),
    };
  });
}

async function readScroll(page){
  return page.evaluate(()=>{
    const node=window.__mobileScrollGuardNode??document.scrollingElement;
    return {top:node===document.scrollingElement?window.scrollY:node.scrollTop,max:Math.max(0,node.scrollHeight-node.clientHeight)};
  });
}

async function scrollGestureChromium(page,slider,fraction,diagonal=false){
  const track=await trackFor(slider);
  await track.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
  const initialScroll=await installScroller(page,slider);
  assert.ok(initialScroll.max-initialScroll.top>5,`test scroller has room to move (top ${initialScroll.top}, max ${initialScroll.max})`);
  const box=await track.boundingBox();assert.ok(box,'mobile range track has a visible bounding box');
  const thumbFraction=await slider.evaluate(el=>{
    const min=Number(el.min||0),max=Number(el.max||100),value=Number(el.value);
    return max===min?.5:(value-min)/(max-min);
  });
  const x=box.x+8+(box.width-16)*fraction,y=box.y+box.height/2;
  assert.ok(x>0&&x<box.x+box.width,`touch start ${fraction} is on the slider track`);
  const before=await sliderState(page,slider),undoDisabled=await undoState(page),redoDisabled=await redoState(page);
  const session=await page.context().newCDPSession(page);
  let transientValue=null;
  try{
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,force:1}]});
    if(diagonal){
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+10,y,id:1,force:1}]});
      await page.waitForTimeout(50);
      transientValue=(await sliderState(page,slider)).value;
    }
    for(let step=1;step<=8;step++){
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:diagonal?x+10:x,y:y-step*19,id:1,force:1}]});
      await page.waitForTimeout(12);
    }
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }finally{await session.detach().catch(()=>{});}
  await page.waitForTimeout(180);
  const after=await sliderState(page,slider),undoDisabledAfter=await undoState(page),redoDisabledAfter=await redoState(page),scrollAfter=await readScroll(page);
  const evidence={input:diagonal?'CDP trusted diagonal touch takeover (10px horizontal then vertical)':'CDP trusted touch swipe',startFraction:fraction,thumbFraction:+thumbFraction.toFixed(3),valueBefore:before.value,previewDuring:transientValue,valueAfter:after.value,undoDisabledBefore:undoDisabled,undoDisabledAfter,redoDisabledBefore:redoDisabled,redoDisabledAfter,scrollBefore:initialScroll.top,scrollAfter:scrollAfter.top,scroller:initialScroll.kind};
  const problems=[];
  if(after.value!==before.value)problems.push(`slider value changed (${before.value} -> ${after.value})`);
  if(diagonal&&transientValue===before.value)problems.push(`diagonal gesture did not produce a live preview before scroll takeover (${before.value})`);
  if(after.ariaValueText!==before.ariaValueText)problems.push(`accessible value text changed (${before.ariaValueText} -> ${after.ariaValueText})`);
  if(undoDisabledAfter!==undoDisabled)problems.push(`Undo state changed (${undoDisabled} -> ${undoDisabledAfter})`);
  if(redoDisabledAfter!==redoDisabled)problems.push(`Redo state changed (${redoDisabled} -> ${redoDisabledAfter})`);
  if(scrollAfter.top-initialScroll.top<=5)problems.push(`scroll did not advance ${initialScroll.kind} (${initialScroll.top} -> ${scrollAfter.top})`);
  if(problems.length){const error=new Error(problems.join('; '));error.evidence=evidence;throw error;}
  return evidence;
}

async function checkScrollCase(width,expanded,kind,fraction){
  const label=`chromium ${width}px ${expanded?'expanded':'normal'} ${kind} vertical swipe x${Math.round(fraction*100)}`;
  let context,page;
  try{
    ({context,page}=await openEditor(width,expanded));
    const slider=await selectSlider(page,kind);
    if(kind==='restoration'&&!await slider.isVisible().catch(()=>false)){
      results.push({status:'skipped',label,reason:'Restoration strength control is not visible in this layout.'});
      console.log(`SKIP ${label}: restoration strength not visible`);return;
    }
    await slider.waitFor({state:'visible',timeout:10000});
    const selector=await sliderSelector(slider),original=(await sliderState(page,slider)).value;
    // Seed a redo entry so a scroll-cancel rollback must preserve both value and future history.
    const track=await trackFor(slider);await track.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
    const seedBox=await track.boundingBox();assert.ok(seedBox,'range track is visible');
    await pointerSequence(page,seedBox,.15,.78);
    const seeded=(await sliderState(page,slider)).value;assert.notEqual(seeded,original,'setup drag creates an edit');
    await page.getByRole('button',{name:'Undo'}).click();await waitValue(page,selector,original);
    assert.equal(await undoState(page),true,'Undo disabled after setup undo');assert.equal(await redoState(page),false,'Redo enabled after setup undo');
    const evidence=await scrollGestureChromium(page,slider,fraction);
    await page.getByRole('button',{name:'Redo'}).click();await waitValue(page,selector,seeded);
    assert.equal((await sliderState(page,slider)).value,seeded,'Redo remains usable after scroll cancellation');
    results.push({status:'passed',label,...evidence});
    console.log(`PASS ${label}: value=${evidence.valueBefore}, Undo disabled=${evidence.undoDisabledBefore}, ${evidence.scroller} scroll ${evidence.scrollBefore}->${evidence.scrollAfter}`);
  }catch(error){await captureFailure(page,label,error);}
  finally{await context?.close();}
}

async function checkDiagonalCase(width,kind,fraction){
  const label=`chromium ${width}px ${kind} 10px-diagonal-to-vertical takeover x${Math.round(fraction*100)}`;let context,page;
  try{
    ({context,page}=await openEditor(width,false));const slider=await selectSlider(page,kind);
    if(kind==='restoration'&&!await slider.isVisible().catch(()=>false)){results.push({status:'skipped',label,reason:'Restoration strength control is not visible.'});return;}
    const selector=await sliderSelector(slider),original=(await sliderState(page,slider)).value,track=await trackFor(slider);
    await track.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));const box=await track.boundingBox();assert.ok(box);
    await pointerSequence(page,box,.15,.78);const seeded=(await sliderState(page,slider)).value;assert.notEqual(seeded,original);
    await page.getByRole('button',{name:'Undo'}).click();await waitValue(page,selector,original);
    const evidence=await scrollGestureChromium(page,slider,fraction,true);
    await page.getByRole('button',{name:'Redo'}).click();await waitValue(page,selector,seeded);
    assert.equal((await sliderState(page,slider)).value,seeded,'Redo remains available after diagonal-scroll cancellation');
    results.push({status:'passed',label,...evidence});console.log(`PASS ${label}: value=${evidence.valueBefore}, scroll ${evidence.scrollBefore}->${evidence.scrollAfter}, redo survived`);
  }catch(error){await captureFailure(page,label,error);}finally{await context?.close();}
}

async function pointerSequence(page,box,fromFraction,toFraction){
  const xAt=f=>box.x+8+(box.width-16)*f,y=box.y+box.height/2;
  if(browserName==='chromium'){
    const session=await page.context().newCDPSession(page);
    try{
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:xAt(fromFraction),y,id:1,force:1}]});
      for(let step=1;step<=8;step++){
        const f=fromFraction+(toFraction-fromFraction)*step/8;
        await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:xAt(f),y,id:1,force:1}]});
        await page.waitForTimeout(12);
      }
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }finally{await session.detach().catch(()=>{});}
  }else{
    await page.mouse.move(xAt(fromFraction),y);await page.mouse.down();
    for(let step=1;step<=8;step++){
      const f=fromFraction+(toFraction-fromFraction)*step/8;
      await page.mouse.move(xAt(f),y,{steps:1});await page.waitForTimeout(12);
    }
    await page.mouse.up();
  }
}

async function interactionCase(width,expanded,kind){
  const label=`${browserName} ${width}px ${expanded?'expanded':'normal'} ${kind} horizontal drag, tap, keyboard, Undo`;
  let context,page;
  try{
    ({context,page}=await openEditor(width,expanded));
    const slider=await selectSlider(page,kind);
    if(kind==='restoration'&&!await slider.isVisible().catch(()=>false)){
      results.push({status:'skipped',label,reason:'Restoration strength control is not visible in this layout.'});
      console.log(`SKIP ${label}: restoration strength not visible`);return;
    }
    await slider.waitFor({state:'visible',timeout:10000});
    await slider.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
    const selector=await sliderSelector(slider),track=await trackFor(slider);
    await track.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
    const initial=(await sliderState(page,slider)).value;
    const box=await track.boundingBox();assert.ok(box,'range track has a visible bounding box');
    const layout=await track.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,orientation:el.parentElement.querySelector('input[type=range]')?.getAttribute('aria-orientation')}));
    assert.ok(layout.height>=44,'touch target is at least 44px high');
    assert.equal(layout.orientation,'horizontal','mobile range exposes horizontal orientation');
    await pointerSequence(page,box,.14,.86);
    await page.waitForFunction(({selector,initial})=>document.querySelector(selector)?.value!==initial,{selector,initial},{timeout:5000});
    const dragged=(await sliderState(page,slider)).value;
    assert.notEqual(dragged,initial,'horizontal drag changes the slider value');
    await page.getByRole('button',{name:'Undo'}).click();
    await page.waitForFunction(({selector,initial})=>document.querySelector(selector)?.value===initial,{selector,initial},{timeout:5000});
    assert.equal((await sliderState(page,slider)).value,initial,'Undo restores the pre-drag value');
    assert.equal(await undoState(page),true,'Undo is unavailable after reverting the drag');

    await track.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
    const tapBox=await track.boundingBox();assert.ok(tapBox,'range track remains visible after Undo');
    const tapX=tapBox.x+8+(tapBox.width-16)*.24,tapY=tapBox.y+tapBox.height/2;
    await page.touchscreen.tap(tapX,tapY);
    await page.waitForTimeout(80);
    const tapped=(await sliderState(page,slider)).value;
    assert.notEqual(tapped,initial,'direct touchscreen tap changes the slider value');
    if(!(await undoState(page)))await page.getByRole('button',{name:'Undo'}).click();
    await waitValue(page,selector,initial);

    await slider.focus();await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(80);
    const keyed=(await sliderState(page,slider)).value;
    assert.notEqual(keyed,initial,'ArrowRight changes the slider value');
    await page.getByRole('button',{name:'Undo'}).click();
    await waitValue(page,selector,initial);
    assert.equal(await undoState(page),true,'Undo restores the pre-keyboard value');

    const evidence={status:'passed',label,input:browserName==='webkit'?'Playwright touchscreen.tap + keyboard; horizontal drag uses mouse because WebKit has no CDP touch-swipe API':'CDP touch horizontal drag + Playwright touchscreen.tap + keyboard',initial,dragged,tapped,keyed};
    results.push(evidence);console.log(`PASS ${label}: ${JSON.stringify(evidence)}`);
  }catch(error){await captureFailure(page,label,error);}
  finally{await context?.close();}
}

async function pointerCancelCase(width,expanded,kind){
  const label=`webkit ${width}px ${expanded?'expanded':'normal'} ${kind} synthetic pointercancel`;
  let context,page;
  try{
    ({context,page}=await openEditor(width,expanded));
    const slider=await selectSlider(page,kind);
    if(kind==='restoration'&&!await slider.isVisible().catch(()=>false)){
      results.push({status:'skipped',label,reason:'Restoration strength control is not visible in this layout.'});
      console.log(`SKIP ${label}: restoration strength not visible`);return;
    }
    await slider.waitFor({state:'visible',timeout:10000});
    await slider.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
    const before=(await sliderState(page,slider)).value,undoDisabled=await undoState(page);
    const track=await trackFor(slider);
    await track.evaluate(el=>{
      const rect=el.getBoundingClientRect(),init={bubbles:true,cancelable:true,pointerId:7,pointerType:'touch',isPrimary:true,button:0,buttons:1,clientX:rect.left+rect.width*.5,clientY:rect.top+rect.height*.5};
      el.dispatchEvent(new PointerEvent('pointerdown',init));
      el.dispatchEvent(new PointerEvent('pointercancel',{...init,buttons:0}));
    });
    await page.waitForTimeout(80);
    const after=(await sliderState(page,slider)).value,undoAfter=await undoState(page);
    assert.equal(after,before,`synthetic pointercancel leaves value unchanged (${before} -> ${after})`);
    assert.equal(undoAfter,undoDisabled,`synthetic pointercancel leaves Undo state unchanged (${undoDisabled} -> ${undoAfter})`);
    const evidence={status:'passed',label,input:'synthetic DOM PointerEvent pointerdown+pointercancel (not native WebKit gesture)',valueBefore:before,valueAfter:after,undoDisabledBefore:undoDisabled,undoDisabledAfter:undoAfter};
    results.push(evidence);console.log(`PASS ${label}: ${JSON.stringify(evidence)}`);
  }catch(error){await captureFailure(page,label,error);}
  finally{await context?.close();}
}

async function desktopLayoutCase(){
  const label='desktop 1280px vertical slider layout';let context,page;
  try{
    context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1,isMobile:false,hasTouch:false,locale:'en-US',serviceWorkers:'block'});
    page=await context.newPage();await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('input[type=file][multiple]').first().setInputFiles({name:'synthetic-desktop.png',mimeType:'image/png',buffer:fixture});
    await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:90000});
    const slider=page.locator('input[type="range"][aria-label="Warmth"]');await slider.waitFor({state:'visible'});
    const layout=await slider.evaluate(el=>({orientation:el.getAttribute('aria-orientation'),trackDisplay:getComputedStyle(el.parentElement.querySelector('.range-track')).display,inputDisplay:getComputedStyle(el).display}));
    assert.equal(layout.orientation,'vertical','desktop slider keeps vertical accessibility orientation');
    assert.equal(layout.trackDisplay,'none','custom horizontal mobile track is hidden on desktop');
    results.push({status:'passed',label,...layout});console.log(`PASS ${label}: ${JSON.stringify(layout)}`);
  }catch(error){await captureFailure(page,label,error);}finally{await context?.close();}
}

async function exportedRecipe(page){
  await page.locator('[data-control-tab="export"]').click();
  const [download]=await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button',{name:'Save recipe'}).click(),
  ]);
  const file=await download.path();assert.ok(file,'preset download completed');
  return JSON.parse(await readFile(file,'utf8'));
}

async function recipePreservationCase(mode){
  const label=`mobile ${mode} retained through cancelled Warmth scroll; exported recipe unchanged`;let context,page;
  try{
    if(browserName!=='chromium'){
      results.push({status:'skipped',label,reason:'Recipe-scroll preservation uses Chromium CDP trusted touch input; WebKit cancellation is tested separately with synthetic pointercancel.'});
      console.log(`SKIP ${label}: recipe gesture requires Chromium CDP`);return;
    }
    ({context,page}=await openEditor(390,false));
    await page.locator('[data-control-tab="enhancement"]').click();await page.locator('[data-control-subtab="effects"]').click();
    if(mode==='Natural'){
      const natural=page.getByRole('button',{name:'Natural'});await natural.click();
      await page.waitForFunction(()=>document.querySelector('.photo-finish-choices button[aria-pressed="true"]')?.textContent?.includes('Natural'),null,{timeout:15000});
    }else{
      const auto=page.locator('.auto-enhance-button');await auto.waitFor({state:'visible'});await auto.click();
      await page.waitForFunction(()=>document.querySelector('.auto-enhance-button')?.getAttribute('aria-pressed')==='true',null,{timeout:45000});
    }
    const before=await exportedRecipe(page);
    if(mode==='Natural')assert.ok(before.adaptiveFinish?.look==='natural','exported setup recipe contains Natural finish');
    else assert.ok(before.enhancement?.autoApplied===true,'exported setup recipe records Auto enhance');
    await page.locator('[data-control-tab="enhancement"]').click();await page.locator('[data-control-subtab="colour"]').click();
    const slider=await selectSlider(page,'warmth');const selector=await sliderSelector(slider),track=await trackFor(slider),original=(await sliderState(page,slider)).value;
    const evidence=await scrollGestureChromium(page,slider,.12,true);
    assert.equal((await sliderState(page,slider)).value,original,'scroll cancellation does not leave a Warmth edit');
    if(mode==='Natural')assert.ok(await page.locator('.photo-finish-choices button').filter({hasText:'Natural'}).getAttribute('aria-pressed')==='true','Natural remains selected after scroll cancellation');
    else assert.ok(await page.locator('.auto-enhance-button').getAttribute('aria-pressed')==='true','Auto enhance remains selected after scroll cancellation');
    const after=await exportedRecipe(page);
    assert.deepEqual(after,before,'serialized edit recipe is unchanged by the cancelled gesture');
    const report={status:'passed',label,scroller:evidence.scroller,scrollBefore:evidence.scrollBefore,scrollAfter:evidence.scrollAfter,recipeUnchanged:true,finish:mode==='Natural'?after.adaptiveFinish?.look:undefined,autoApplied:after.enhancement?.autoApplied};
    results.push(report);console.log(`PASS ${label}: scroll ${evidence.scrollBefore}->${evidence.scrollAfter}; exported recipe JSON unchanged`);
  }catch(error){await captureFailure(page,label,error);}finally{await context?.close();}
}

async function switchDuringPreviewCase(){
  const label='mobile active range preview cancelled when switching photos';let context,page;
  try{
    context=await browser.newContext({viewport:{width:390,height:700},deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'en-US',serviceWorkers:'block'});
    page=await context.newPage();await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:45000});
    const updateHint=page.locator('.web-update-hint-ok');if(await updateHint.isVisible().catch(()=>false))await updateHint.click();
    const fixture2=syntheticPng(83);
    await page.locator('input[type=file][multiple]').first().setInputFiles([
      {name:'synthetic-switch-a.png',mimeType:'image/png',buffer:fixture},
      {name:'synthetic-switch-b.png',mimeType:'image/png',buffer:fixture2},
    ]);
    await page.waitForFunction(()=>document.querySelector('[aria-label="Photo position"]')?.textContent?.includes('/ 2'),null,{timeout:30000});
    const slider=await selectSlider(page,'warmth'),track=await trackFor(slider),selector=await sliderSelector(slider);
    await track.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
    const original=(await sliderState(page,slider)).value,box=await track.boundingBox();assert.ok(box);
    if(browserName!=='chromium'){
      results.push({status:'skipped',label,reason:'Holding a native touch stream while triggering a separate UI tap requires Chromium CDP.'});console.log(`SKIP ${label}: active cross-control touch stream is Chromium CDP-specific`);return;
    }
    const session=await page.context().newCDPSession(page);
    try{
      const x=box.x+box.width*.72,y=box.y+box.height/2;
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,force:1}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+box.width*.16,y,id:1,force:1}]});
      await page.waitForTimeout(80);
      const previewVal=(await sliderState(page,slider)).value;
      assert.notEqual(previewVal,original,'horizontal touch drag has a live preview before release');
      // The external trusted click triggers the range's outside-pointer cancellation and file switch.
      await page.getByRole('button',{name:'Next photo'}).click();
      await waitValue(page,selector,original);
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(100);
      const second=(await sliderState(page,slider)).value;
      assert.equal(second,original,'new photo does not inherit the cancelled live preview');
      await page.getByRole('button',{name:'Previous photo'}).click();await waitValue(page,selector,original);
      const undoDisabled=await undoState(page),redoDisabled=await redoState(page);
      assert.equal(undoDisabled,true,'cancelled preview adds no undo entry to prior photo');
      assert.equal(redoDisabled,true,'cancelled preview adds no redo entry to prior photo');
      const evidence={status:'passed',label,original,livePreview:previewVal,afterSwitch:second,undoDisabled,redoDisabled};
      results.push(evidence);console.log(`PASS ${label}: ${JSON.stringify(evidence)}`);
    }finally{await session.detach().catch(()=>{});}
  }catch(error){await captureFailure(page,label,error);}finally{await context?.close();}
}

try{
  console.log(`Mobile scroll guard regression: browser=${browserName}${browserName==='chromium'?`, channel=${process.env.PLAYWRIGHT_CHANNEL??'Playwright default'}`:''}; CHECK_URL=${baseUrl}`);
  console.log(`Synthetic fixture only; screenshots/reports go to ${outputDir}`);
  const smoke=process.env.CHECK_SMOKE==='1';
  const recipesOnly=process.env.CHECK_RECIPES_ONLY==='1';
  const interactionsOnly=process.env.CHECK_INTERACTIONS_ONLY==='1';
  const switchOnly=process.env.CHECK_SWITCH_ONLY==='1';
  const widths=smoke?[390]:[320,390],layouts=smoke?[false]:[false,true],controls=smoke?['warmth']:['warmth','restoration','depth'];
  if(!recipesOnly&&!interactionsOnly&&!switchOnly&&browserName==='chromium'){
    for(const width of widths)for(const expanded of layouts)for(const kind of controls)for(const fraction of [.12,.5,.88])
      await checkScrollCase(width,expanded,kind,fraction);
    for(const width of widths)for(const kind of (smoke?['warmth']:['warmth','depth']))for(const fraction of [.12,.88])await checkDiagonalCase(width,kind,fraction);
  }else if(!recipesOnly&&!interactionsOnly&&!switchOnly){
    console.log('SKIP Chromium CDP swipe matrix: WebKit does not use the Chromium CDP touch-input API. Running touchscreen taps, keyboard and synthetic pointercancel checks instead.');
  }
  if(!recipesOnly&&!switchOnly){
    for(const width of widths)for(const expanded of layouts)for(const kind of controls){
      await interactionCase(width,expanded,kind);
      if(browserName==='webkit')await pointerCancelCase(width,expanded,kind);
    }
  }
  if(switchOnly)await switchDuringPreviewCase();else if(!recipesOnly&&!interactionsOnly)await switchDuringPreviewCase();
  if(!interactionsOnly&&!switchOnly){await recipePreservationCase('Natural');await recipePreservationCase('Auto enhance');}
  if(!recipesOnly&&!switchOnly)await desktopLayoutCase();

  const report={browser:browserName,channel:browserName==='chromium'?(process.env.PLAYWRIGHT_CHANNEL??null):null,checkUrl:baseUrl,createdAt:new Date().toISOString(),fixture:'synthetic 96x64 PNG',evidence:results,failures:failures.length};
  const reportPath=path.resolve(outputDir,'report.json');
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n','utf8');
  console.log(`Evidence report: ${reportPath}`);
  console.log(`Completed ${results.length} cases; ${failures.length} failed, ${results.filter(item=>item.status==='skipped').length} skipped.`);
  if(failures.length)process.exitCode=1;
}finally{
  await browser.close();
}
