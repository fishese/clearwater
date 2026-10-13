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
    await page.locator('.language-select').first().selectOption(language);
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
      await page.screenshot({path:path.join(outputDir,`controls-${width}-${language}.png`),fullPage:true});
    }
    await page.close();
    console.log(`PASS ${width}px ${language}`);
  }
  console.log('PASS layered controls, locale layout, keyboard tabs, depth unknown/zero, video Effects fallback and tab side effects');
}finally{await browser.close();server?.kill();}
