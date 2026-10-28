import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const url = process.env.CHECK_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const page = await context.newPage();
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) { const name=Buffer.from(type), length=Buffer.alloc(4), sum=Buffer.alloc(4); length.writeUInt32BE(data.length); sum.writeUInt32BE(crc32(Buffer.concat([name,data]))); return Buffer.concat([length,name,data,sum]); }
function syntheticPng() { const width=96,height=64,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header.set([8,6,0,0,0],8);const rows=[];for(let y=0;y<height;y++){const row=Buffer.alloc(1+width*4);for(let x=0;x<width;x++){const i=1+x*4;row.set([(x*7+y*3)%256,(y*9+x)%256,(x*2+y*5)%256,255],i);}rows.push(row);}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(Buffer.concat(rows))),pngChunk('IEND',Buffer.alloc(0))]); }
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const updateHint=page.locator('.web-update-hint-ok');if(await updateHint.isVisible().catch(()=>false))await updateHint.click();
  await page.locator('input[type=file][multiple]').first().setInputFiles({ name:'range-disabled-synthetic.png', mimeType:'image/png', buffer:syntheticPng() });
  await page.waitForFunction(() => !!document.querySelector('.preview-info') && document.querySelector('.control-body')?.matches(':disabled') === false, null, { timeout: 90000 });
  await page.locator('[data-control-tab="enhancement"]').click();
  await page.locator('[data-control-subtab="colour"]').click();
  const slider=page.locator('.control-body input[type="range"][aria-label="Warmth"]');
  const track=slider.locator('xpath=..').locator('.range-track');
  const base=Number(await slider.inputValue());
  const fire=async (kind,coords,id,pointerType='mouse')=>track.evaluate((el,{kind,coords,id,pointerType})=>{const ev=new PointerEvent(kind,{bubbles:true,cancelable:true,pointerId:id,pointerType,isPrimary:true,button:0,clientX:coords.x,clientY:coords.y});el.dispatchEvent(ev);},{kind,coords,id,pointerType});
  const points=await track.evaluate(el=>{const r=el.getBoundingClientRect();return {start:{x:r.left+r.width*.2,y:r.top+r.height/2},end:{x:r.left+r.width*.8,y:r.top+r.height/2}}});
  const undo=page.getByRole('button',{name:'Undo',exact:true});
  assert.equal(await undo.isDisabled(), true, 'synthetic photo starts with no undo entry');
  const redo=page.getByRole('button',{name:'Redo',exact:true});
  await slider.focus();await slider.press('ArrowRight');
  await page.waitForFunction(({selector,base})=>Number(document.querySelector(selector).value)!==base,{selector:'.control-body input[type="range"][aria-label="Warmth"]',base},{timeout:5000});
  await undo.click();await page.waitForFunction(({selector,base})=>Number(document.querySelector(selector).value)===base,{selector:'.control-body input[type="range"][aria-label="Warmth"]',base},{timeout:5000});
  assert.equal(await redo.isDisabled(),false,'fixture has redo history before cancellation checks');
  await page.locator('.control-body').evaluate(el=>el.disabled=true);
  for(const [type,id] of [['mouse',21],['touch',23]]){await fire('pointerdown',points.start,id,type);await fire('pointermove',points.end,id,type);await fire('pointerup',points.end,id,type);}
  await page.waitForTimeout(50);
  assert.equal(Number(await slider.inputValue()),base,'disabled fieldset blocks mouse and touch track gestures');
  assert.equal(await undo.isDisabled(),true,'blocked gestures must not create undo entries');
  assert.equal(await redo.isDisabled(),false,'blocked gestures must preserve redo history');
  await page.locator('.control-body').evaluate(el=>el.disabled=false);
  for(const [type,id] of [['mouse',22],['touch',24]]){
    await fire('pointerdown',points.start,id,type);await fire('pointermove',points.end,id,type);
    await page.waitForFunction(({selector,base})=>Number(document.querySelector(selector).value)!==base,{selector:'.control-body input[type="range"][aria-label="Warmth"]',base},{timeout:5000});
    assert.notEqual(Number(await slider.inputValue()),base,`${type} gesture shows live preview`);
    await page.locator('.control-body').evaluate(el=>el.disabled=true);
    await fire('pointermove',{x:points.end.x-4,y:points.end.y},id,type);
    await page.waitForFunction(({selector,base})=>Number(document.querySelector(selector).value)===base,{selector:'.control-body input[type="range"][aria-label="Warmth"]',base},{timeout:5000});
    assert.equal(Number(await slider.inputValue()),base,`${type} mid-drag disable rolls preview back`);
    assert.equal(await undo.isDisabled(),true,`${type} cancellation removes its undo checkpoint`);
    assert.equal(await redo.isDisabled(),false,`${type} cancellation preserves redo history`);
    await fire('pointerup',points.end,id,type);
    await page.locator('.control-body').evaluate(el=>el.disabled=false);
  }
  console.log('PASS inherited fieldset disable blocks mouse/touch starts; mid-drag disable rolls previews back and restores undo/redo history.');
} finally { await context.close(); await browser.close(); }
