import {changeLanguage,readLanguage} from './settings-helpers.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const editorDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outputDir=path.resolve(editorDir,'../analysis/layered-controls');
await mkdir(outputDir,{recursive:true});
const baseUrl=process.env.CHECK_URL??'http://127.0.0.1:4182/';
let server;
if(!process.env.CHECK_URL){
  server=spawn(process.execPath,[path.join(editorDir,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4182','--strictPort'],{cwd:editorDir,stdio:'ignore'});
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(baseUrl)).ok){ready=true;break;}}catch{}await delay(250);}
  if(!ready){server.kill();throw new Error('Vite did not start at '+baseUrl);}
}

function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function pngChunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4);length.writeUInt32BE(data.length);const sum=Buffer.alloc(4);sum.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,sum]);}
function syntheticPng(){
  const width=32,height=24,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header.set([8,6,0,0,0],8);
  const rows=[];for(let y=0;y<height;y++){const row=Buffer.alloc(1+width*4);for(let x=0;x<width;x++){const i=1+x*4;row.set([30+x*5,70+y*5,115+(x+y)%80,255],i);}rows.push(row);}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',(awaitDeflate(Buffer.concat(rows)))),pngChunk('IEND',Buffer.alloc(0))]);
}
function awaitDeflate(bytes){return deflateSync(bytes);}
import { deflateSync } from 'node:zlib';

const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
const languages=['en','zh-HK','ja'],widths=[320,390,650,1280],png=syntheticPng();
try{
  for(const language of languages)for(const width of widths){
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.addInitScript(()=>{
      window.__cwWorkerCount=0;window.__cwWorkerMessages=[];
      const NativeWorker=window.Worker;
      window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.__cwWorkerCount++;const send=this.postMessage.bind(this);this.postMessage=(data,...rest)=>{window.__cwWorkerMessages.push(data?.type??'unknown');return send(data,...rest);};}};
    });
    await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
    await changeLanguage(page,language);
    await page.locator('input[type=file][multiple]').setInputFiles({name:'synthetic-dive.png',mimeType:'image/png',buffer:png});
    await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
    const workerBaseline=await page.evaluate(()=>({count:window.__cwWorkerCount,messages:window.__cwWorkerMessages.length}));
    if(width<=650){
      const visible=(selector)=>page.locator(selector).evaluateAll(nodes=>nodes.filter(node=>getComputedStyle(node).display!=='none'));
      const panelVisible=async id=>page.locator(id).evaluate(node=>node.getClientRects().length>0);
      const checkNav=async(main,sub)=>{
        assert.equal(await panelVisible(`#control-panel-${main}`),true,`${width}px ${language}: selected ${main} panel is visible`);
        const mains=await page.locator('#control-panel-correction,#control-panel-enhancement,#control-panel-export').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length>0));
        assert.equal(mains.length,1,`${width}px ${language}: one main panel visible`);
        const navs=await visible('.control-tabs');
        assert.equal(navs.length,sub?2:1,`${width}px ${language}: only active tab bars visible`);
        if(sub){
          assert.equal(await panelVisible(`#control-subpanel-${sub}`),true,`${width}px ${language}: selected ${sub} panel is visible`);
          const ids=main==='correction'?['engine','dive']:['colour','light','clarity','effects'];
          const active=await page.locator(ids.map(id=>`#control-subpanel-${id}`).join(',')).evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length>0));
          assert.equal(active.length,1,`${width}px ${language}: one subpanel visible`);
        }
        for(const tab of await page.locator('.control-tabs [role=tab]:visible').all()){
          const target=await tab.getAttribute('aria-controls');assert.ok(target&&await page.locator(`#${target}`).count()===1,`${width}px ${language}: tab panel association exists`);
        }
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px ${language}: no horizontal overflow`);
      };
      await checkNav('correction','engine');
      assert.ok(await page.locator('#control-subpanel-engine .analysis-note').isVisible(),`${width}px ${language}: analysis explanation stays visible`);
      assert.ok(await page.locator('.engine-details select').isVisible(),`${width}px ${language}: engine selector stays visible`);
      if(language==='en'&&width===390){
        await page.evaluate(()=>{const tabs=document.querySelector('.main-control-tabs');if(tabs)window.scrollTo(0,window.scrollY+tabs.getBoundingClientRect().top-96);});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const baseline=await page.evaluate(()=>({y:window.scrollY,top:document.querySelector('.main-control-tabs')?.getBoundingClientRect().top??NaN}));
        const assertTabScrollStable=async label=>{
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const current=await page.evaluate(()=>({y:window.scrollY,top:document.querySelector('.main-control-tabs')?.getBoundingClientRect().top??NaN}));
          assert.ok(Math.abs(current.y-baseline.y)<=1,`390px en ${label}: tab switch preserves window scrollY (${baseline.y} → ${current.y})`);
          assert.ok(Math.abs(current.top-baseline.top)<=1,`390px en ${label}: main tab bar stays at the same viewport position (${baseline.top} → ${current.top})`);
        };
        await page.locator('[data-control-subtab="dive"]').click();await assertTabScrollStable('correction subtab');
        await page.locator('[data-control-tab="enhancement"]').click();await assertTabScrollStable('enhancement tab');
        await page.locator('[data-control-subtab="effects"]').click();await assertTabScrollStable('enhancement subtab');
        await page.locator('[data-control-tab="export"]').click();await assertTabScrollStable('export tab');
        await page.locator('[data-control-tab="correction"]').click();await assertTabScrollStable('return to correction');
        await page.locator('[data-control-subtab="engine"]').click();await assertTabScrollStable('return to engine');
        await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const bottomBefore=await page.evaluate(()=>({y:window.scrollY,max:document.documentElement.scrollHeight-innerHeight}));
        await page.evaluate(()=>document.querySelector('[data-control-tab="export"]')?.click());
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const bottomExport=await page.evaluate(()=>({y:window.scrollY,max:document.documentElement.scrollHeight-innerHeight}));
        assert.ok(Math.abs(bottomExport.y-bottomBefore.y)<=1,`390px en bottom: shorter Export preserves window scrollY (${bottomBefore.y} → ${bottomExport.y})`);
        assert.ok(Math.abs(bottomExport.max-bottomBefore.max)<=1,`390px en bottom: shorter Export preserves document height (${bottomBefore.max} → ${bottomExport.max})`);
        await page.evaluate(()=>document.querySelector('[data-control-tab="correction"]')?.click());
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const bottomCorrection=await page.evaluate(()=>({y:window.scrollY,max:document.documentElement.scrollHeight-innerHeight}));
        assert.ok(Math.abs(bottomCorrection.y-bottomBefore.y)<=1,`390px en bottom: longer Correction preserves window scrollY (${bottomBefore.y} → ${bottomCorrection.y})`);
        assert.ok(Math.abs(bottomCorrection.max-bottomBefore.max)<=1,`390px en bottom: longer Correction preserves document height (${bottomBefore.max} → ${bottomCorrection.max})`);

        await page.setViewportSize({width:390,height:600});
        await page.evaluate(()=>document.querySelector('[data-control-tab="export"]')?.click());
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.getByRole('button',{name:'Expand photo'}).click();
        await page.locator('.adjustments-toggle').click();
        await page.locator('.controls').evaluate(el=>{el.scrollTop=el.scrollHeight;});
        const expandedTop=await page.locator('.controls').evaluate(el=>el.scrollTop);
        assert.ok(expandedTop>0,`390px en expanded: adjustment sheet is internally scrollable (${expandedTop})`);
        await page.evaluate(()=>document.querySelector('[data-control-tab="enhancement"]')?.click());
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const expandedAfter=await page.locator('.controls').evaluate(el=>el.scrollTop);
        assert.ok(Math.abs(expandedAfter-expandedTop)<=1,`390px en expanded: tab switch preserves controls scrollTop (${expandedTop} → ${expandedAfter})`);
        await page.evaluate(()=>document.querySelector('[data-control-subtab="colour"]')?.click());
        await page.evaluate(()=>document.querySelector('[data-control-tab="correction"]')?.click());
        await page.getByRole('button',{name:'Exit expanded view'}).click();
      }
      if(language==='en'&&[320,390].includes(width))await page.screenshot({path:path.join(outputDir,`controls-${width}-en-engine.png`),fullPage:true});
      for(const button of await page.locator('.main-control-tabs button:visible,.correction-subtabs.is-visible button:visible').all())assert.ok((await button.boundingBox()).height>=40,`${width}px ${language}: tabs have touch-sized hit areas`);
      await page.locator('[data-control-subtab="dive"]').focus();await page.keyboard.press('Home');await checkNav('correction','engine');
      await page.locator('[data-control-subtab="dive"]').focus();await page.keyboard.press('ArrowLeft');await checkNav('correction','engine');
      await page.locator('[data-control-subtab="dive"]').click();
      if(language==='en'&&[320,390].includes(width))await page.screenshot({path:path.join(outputDir,`controls-${width}-en-dive.png`),fullPage:true});
      const unsure=page.locator('.depth-unsure input');await unsure.check();
      assert.equal(await page.locator('.depth-control output').textContent(),'—');
      assert.notEqual(await page.locator('.depth-control input[type=range]').getAttribute('aria-valuetext'),'0 m');
      await unsure.uncheck();await page.locator('.depth-control input[type=range]').focus();await page.keyboard.press('Home');
      assert.equal(await page.locator('.depth-control output').textContent(),'0 m');
      await page.locator('[data-control-tab="correction"]').focus();await page.keyboard.press('ArrowRight');await checkNav('enhancement','colour');
      await page.locator('[data-control-subtab="light"]').focus();await page.keyboard.press('End');await checkNav('enhancement','effects');
      if(language==='en'&&[320,390].includes(width))await page.screenshot({path:path.join(outputDir,`controls-${width}-en-effects.png`),fullPage:true});
      assert.equal(await page.locator('#control-subpanel-light input[type=range]').count(),3);
      await page.locator('[data-control-subtab="clarity"]').click();assert.equal(await page.locator('#control-subpanel-clarity input[type=range]').count(),2);
      await page.locator('[data-control-tab="export"]').click();await checkNav('export',null);
      await page.locator('[data-control-tab="correction"]').click();await page.locator('[data-control-subtab="engine"]').click();
      await page.locator('.engine-details select').selectOption('baseline');
      await page.locator('[data-control-subtab="dive"]').click();
      assert.ok(await page.locator('.balanced-only-note').isVisible());
      await page.locator('[data-control-subtab="engine"]').click();
      await page.locator('.engine-details select').selectOption('balanced');
      await page.locator('[data-control-tab="enhancement"]').click();await page.locator('[data-control-subtab="light"]').click();
      const exposure=page.locator('#control-subpanel-light input[type=range]').first();
      await exposure.focus();await page.keyboard.press('ArrowRight');
      const retained=await exposure.inputValue();await page.locator('[data-control-subtab="clarity"]').click();await page.locator('[data-control-subtab="light"]').click();
      assert.equal(await exposure.inputValue(),retained,`${width}px ${language}: slider value retained between tabs`);
      assert.equal(await page.locator('#control-subpanel-effects .enhancement-group').count(),1);
      assert.equal(await page.locator('#control-subpanel-effects input[type=range]').first().getAttribute('min'),'-100');
      await page.screenshot({path:path.join(outputDir,`controls-${width}-${language}.png`),fullPage:true});
      await page.locator('[data-control-tab="enhancement"]').click();await page.locator('[data-control-subtab="effects"]').click();
      if(language==='en'&&width===390){
        const autoButton=page.getByRole('button',{name:'Auto enhance'}),brightness=page.locator('#control-subpanel-effects input[type=range]').first();
        const readyPaint=await autoButton.evaluate(button=>{const style=getComputedStyle(button);return {background:style.backgroundColor,border:style.borderTopColor};});
        assert.deepEqual(readyPaint,{background:'rgba(0, 0, 0, 0)',border:'rgb(142, 203, 180)'},'narrow ready state has a mint outline');
        await autoButton.evaluate(button=>button.classList.add('is-applied'));await page.waitForTimeout(180);
        const appliedPaint=await autoButton.evaluate(button=>{const style=getComputedStyle(button);return {background:style.backgroundColor,border:style.borderTopColor};});
        assert.deepEqual(appliedPaint,{background:'rgb(44, 88, 71)',border:'rgb(167, 223, 206)'},'narrow applied state has a filled mint treatment');
        await autoButton.evaluate(button=>button.classList.remove('is-applied'));
        assert.equal(await autoButton.getAttribute('aria-pressed'),'false','manual-only effect starts in the ready state');
        await brightness.focus();await page.keyboard.press('ArrowRight');
        assert.equal(await autoButton.getAttribute('aria-pressed'),'false','manual slider edits do not claim Auto enhance');
        await page.getByRole('button',{name:'Undo'}).click();assert.equal(await autoButton.getAttribute('aria-pressed'),'false','undo returns to the ready state');
        await page.getByRole('button',{name:'Redo'}).click();assert.equal(await autoButton.getAttribute('aria-pressed'),'false','redo restores a manual-only state');
        await page.waitForFunction(()=>{const button=document.querySelector('.auto-enhance-button');return button&&!button.disabled;});
        await autoButton.click();await page.waitForFunction(()=>document.querySelector('.auto-enhance-button')?.getAttribute('aria-pressed')==='true',null,{timeout:15000});
        await brightness.focus();await page.keyboard.press('ArrowRight');assert.equal(await autoButton.getAttribute('aria-pressed'),'false','manual edits clear the Auto marker');
        await page.getByRole('button',{name:'Undo'}).click();assert.equal(await autoButton.getAttribute('aria-pressed'),'true','undo restores Auto origin');
        await page.getByRole('button',{name:'Redo'}).click();assert.equal(await autoButton.getAttribute('aria-pressed'),'false','redo restores manual state');
        await page.waitForFunction(()=>{const button=document.querySelector('.auto-enhance-button');return button&&!button.disabled;});
        await autoButton.click();await page.waitForFunction(()=>document.querySelector('.auto-enhance-button')?.getAttribute('aria-pressed')==='true',null,{timeout:15000});
        await delay(800);await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
        await page.locator('[data-control-tab="enhancement"]').click();await page.locator('[data-control-subtab="effects"]').click();
        await page.waitForFunction(()=>document.querySelector('.auto-enhance-button')?.getAttribute('aria-pressed')==='true',null,{timeout:10000});
        await page.getByRole('button',{name:'Clear enhancement'}).click();assert.equal(await autoButton.getAttribute('aria-pressed'),'false','clear removes applied state');
      }
      await page.locator('input[type=file][multiple]').setInputFiles({name:'switch-test.mp4',mimeType:'video/mp4',buffer:Buffer.from([0,0,0,0])});
      await page.waitForFunction(()=>!document.querySelector('[data-control-subtab="effects"]')&&document.querySelector('[data-control-subtab="colour"]')?.getAttribute('aria-selected')==='true');
      const afterVideo=await page.evaluate(()=>({count:window.__cwWorkerCount,messages:window.__cwWorkerMessages.length}));
      await page.locator('[data-control-tab="enhancement"]').click();await page.locator('[data-control-subtab="light"]').click();await page.locator('[data-control-tab="correction"]').click();
      const afterNav=await page.evaluate(()=>({count:window.__cwWorkerCount,messages:window.__cwWorkerMessages.length}));
      assert.equal(afterNav.count,workerBaseline.count,`${width}px ${language}: tab changes create no workers`);
      assert.equal(afterNav.messages,afterVideo.messages,`${width}px ${language}: tab changes cause no worker messages`);
    }else{
      assert.equal(await page.locator('[data-control-tab]').count(),3);
      assert.equal(await page.locator('#control-panel-correction').evaluate(node=>getComputedStyle(node).display),'contents');
      assert.equal(await page.locator('.light-clarity-group').count(),1,`${width}px ${language}: one combined desktop light/clarity group`);
      assert.equal(await page.locator('.light-clarity-grid input[type=range]').count(),5,`${width}px ${language}: desktop retains five manual sliders`);
      const autoButton=page.locator('.auto-enhance-button');
      const readyPaint=await autoButton.evaluate(button=>{const style=getComputedStyle(button);return {background:style.backgroundColor,border:style.borderTopColor};});
      assert.deepEqual(readyPaint,{background:'rgba(0, 0, 0, 0)',border:'rgb(142, 203, 180)'},`${width}px ${language}: desktop ready state has a mint outline`);
      await autoButton.evaluate(button=>button.classList.add('is-applied'));await page.waitForTimeout(180);
      const appliedPaint=await autoButton.evaluate(button=>{const style=getComputedStyle(button);return {background:style.backgroundColor,border:style.borderTopColor};});
      assert.deepEqual(appliedPaint,{background:'rgb(44, 88, 71)',border:'rgb(167, 223, 206)'},`${width}px ${language}: desktop applied state has a filled mint treatment`);
      await autoButton.evaluate(button=>button.classList.remove('is-applied'));
      await page.screenshot({path:path.join(outputDir,`controls-${width}-${language}.png`),fullPage:true});
    }
    await page.close();
    console.log(`PASS ${width}px ${language}`);
  }
  console.log('PASS layered controls, locale layout, keyboard tabs, depth unknown/zero, video Effects fallback and tab side effects');
}finally{await browser.close();server?.kill();}
