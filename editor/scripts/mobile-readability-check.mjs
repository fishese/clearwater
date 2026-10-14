import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({channel:'msedge',headless:true});
const url=process.env.CHECK_URL??'http://127.0.0.1:4176/';
await mkdir(new URL('../../analysis/photo-check/',import.meta.url),{recursive:true});
try{
 for(const language of ['en','zh-HK','ja']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('.brand-cluster .language-select').selectOption(language);
  assert.deepEqual(await page.locator('.brand-cluster .language-select option').allTextContents(),['EN','中','日']);
  const png=await page.evaluate(async()=>{const c=new OffscreenCanvas(96,72);c.getContext('2d').fillRect(0,0,96,72);return Array.from(new Uint8Array(await (await c.convertToBlob()).arrayBuffer()));});
  await page.locator('input[type=file][multiple]').setInputFiles({name:'mobile-type.png',mimeType:'image/png',buffer:Buffer.from(png)});
  await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
  const check=async(width,section)=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${language}/${width}/${section}: page overflow`);
   const bad=await page.evaluate(()=>{
    const bad=[];
    const brand=document.querySelector('.brand-cluster').getBoundingClientRect(),actions=document.querySelector('.top-actions').getBoundingClientRect();if(brand.right>actions.left+1)bad.push('header overlap');
    for(const el of document.querySelectorAll('.canvas-toolbar,.workspace-bottom,.expanded-zoom-controls'))if(el.getClientRects().length&&el.scrollWidth>el.clientWidth+1)bad.push(el.className+' overflow');
    for(const el of document.querySelectorAll('.control-tabs button,.radio-group label>span')){
     if(!el.getClientRects().length)continue;
     const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),tops=new Set(),box=el.getBoundingClientRect();let node;
     while(node=walker.nextNode()){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects()){tops.add(Math.round(r.top));if(r.left<box.left-1||r.right>box.right+1)bad.push(el.textContent+' clipped');}}
     if(tops.size>1)bad.push(el.textContent+' wrapped');
    }
    return bad;
   });assert.deepEqual(bad,[],`${language}/${width}/${section}`);
  };
  for(const width of [320,360,390,430,650]){
   await page.setViewportSize({width,height:844});
   await page.locator('[data-control-tab=correction]').click();await page.locator('[data-control-subtab=dive]').click();await check(width,'dive');
   await page.locator('[data-control-tab=enhancement]').click();
   for(const sub of ['colour','light','clarity','effects']){await page.locator(`[data-control-subtab=${sub}]`).click();await check(width,sub);}
   await page.locator('[data-control-tab=export]').click();await check(width,'export');
   const preview=await page.locator('.preview-viewport').boundingBox(),info=await page.locator('.preview-info').boundingBox();
   assert.ok(preview.height<=306&&preview.height>=210,'Normal mobile preview is compact');
   assert.ok(info.y>=preview.y&&info.y+info.height<=preview.y+preview.height,'Resolution stays inside preview');
   assert.equal(await page.locator('.workspace-bottom>span').count(),0);
   assert.ok((await page.locator('.preview-info').innerText()).includes(' MP'));
   assert.equal(await page.locator('.canvas-tools .expand-view-button').count(),0);
   await page.locator('.workspace-bottom .expand-view-button').click();await page.locator('.expanded-zoom-controls .expand-view-button').waitFor();await check(width,'expanded');
   await page.locator('.expanded-zoom-controls .expand-view-button').click();
  }
  await page.setViewportSize({width:390,height:844});await page.locator('[data-control-tab=correction]').click();await page.locator('[data-control-subtab=dive]').click();await page.screenshot({path:fileURLToPath(new URL(`../../analysis/photo-check/mobile-type-${language}.png`,import.meta.url)),fullPage:true});
  for(const width of [901,1280,1920]){await page.setViewportSize({width,height:900});const summary=page.locator('.enhancement-group>summary');const gap=await summary.evaluate(el=>{const node=[...el.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());const range=document.createRange();range.selectNodeContents(node);return range.getBoundingClientRect().left-el.getBoundingClientRect().left;});assert.ok(gap>=9,`${language}/${width}: Effects label needs inset padding`);}
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS EN/中/日, mobile typography, unwrapped tabs/radios, footer zoom/expand and no overflow at 320–650px');
}finally{await browser.close();}
