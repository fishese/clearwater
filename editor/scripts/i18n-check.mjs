import {chromium} from 'playwright';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const url=process.env.CHECK_URL??'http://127.0.0.1:5173/';
try{
 const context=await browser.newContext({locale:'en-GB'}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await page.getByLabel('Choose photos',{exact:true}).setInputFiles(resolve('../analysis/photo-check/normal-12mp.png'));
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('End');
 await page.waitForFunction(()=>document.querySelector('input[aria-label="Warmth"]')?.value==='100');
 await page.waitForTimeout(500); // Latest recipe persists on a 400 ms debounce.
 const generation=await page.locator('canvas[aria-label="Edited photo"]').getAttribute('data-generation');
 for(const [locale,exportLabel,warmth,guide,back] of [['zh-HK','輸出相片','色溫','關於及說明','返回編輯器'],['ja','写真を書き出す','色温度','概要・使い方','編集に戻る'],['en','Export photo','Warmth','About & guide','Back to editor']]){
  await page.locator('.brand-cluster .language-select').selectOption(locale);
  assert.equal(await page.locator('html').getAttribute('lang'),locale);assert.equal(await page.getByRole('slider',{name:warmth,exact:true}).inputValue(),'100');
  assert.equal(await page.locator('canvas[data-generation]').getAttribute('data-generation'),generation);await page.getByRole('button',{name:exportLabel,exact:true}).waitFor();
  for(const width of [320,390,1360]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),locale+' overflow at '+width);}
  await page.locator('.about-footer').click();await page.getByRole('heading',{name:guide,exact:true}).waitFor();assert.ok(await page.locator('#about-files').innerText());
  await page.getByRole('button',{name:back,exact:true}).click();assert.equal(await page.getByRole('slider',{name:warmth,exact:true}).inputValue(),'100');
  await page.reload();await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);assert.equal(await page.locator('.brand-cluster .language-select').inputValue(),locale);
 }
 await page.locator('.brand-cluster .language-select').selectOption('zh-HK');await page.setViewportSize({width:390,height:844});await page.screenshot({path:'../analysis/photo-check/i18n-zh-HK.png'});
 await page.locator('.brand-cluster .language-select').selectOption('ja');await page.screenshot({path:'../analysis/photo-check/i18n-ja.png'});
 // Worker-originated user guidance is translated at presentation.
 await page.getByLabel('写真を選択',{exact:true}).setInputFiles({name:'broken.mov',mimeType:'video/quicktime',buffer:Buffer.from('not a movie')});
 await page.locator('.toast').waitFor();
 assert.deepEqual(errors,[]);
 const detected=await browser.newContext({locale:'ja-JP'}),other=await detected.newPage();await other.goto(url);await other.getByRole('button',{name:'写真を書き出す',exact:true}).waitFor();assert.equal(await other.locator('html').getAttribute('lang'),'ja');
 const blocked=await browser.newContext({locale:'zh-HK'});await blocked.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked');}});});const blockedPage=await blocked.newPage();await blockedPage.goto(url);await blockedPage.locator('.brand-cluster .language-select').selectOption('ja');assert.equal(await blockedPage.locator('html').getAttribute('lang'),'ja');
 console.log('PASS three languages, persistent selection, live edit preservation, browser detection, blocked storage and mobile layout');
}finally{await browser.close();}
