import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const url=process.env.CHECK_URL??'http://127.0.0.1:5173/';
 await page.goto(url);
 const png=await page.evaluate(async()=>{const c=new OffscreenCanvas(64,64);c.getContext('2d').fillRect(0,0,64,64);return Array.from(new Uint8Array(await (await c.convertToBlob()).arrayBuffer()));});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'about-test.png',mimeType:'image/png',buffer:Buffer.from(png)});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('End');
 await page.locator('.about-nav').click();await page.getByRole('heading',{name:'About & guide',exact:true}).waitFor();
 assert.equal(await page.locator('.app-shell').isVisible(),false);
 assert.equal(await page.locator('#about-camera dt').count(),8);const cameraGuide=await page.locator('#about-camera').innerText();for(const description of ['12 Mbps','5 Mbps','zero restoration strength','No raw video is kept','1, 3 or 5 minutes','Each pick replaces'])assert.ok(cameraGuide.includes(description),description);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'about-title');
 await page.getByRole('link',{name:'Editing controls',exact:true}).click();
 assert.ok(page.url().endsWith('#about-controls'));
 for(const name of ['Shallow-UWnet','FUnIE-GAN','WWE-UIE'])assert.ok(await page.getByRole('heading',{name:new RegExp(name)}).isVisible());
 for(const a of await page.locator('.about-content a').all()){
  const href=await a.getAttribute('href');
  if(href.includes('/models/')||href.includes('/licenses/'))assert.equal((await page.request.get(new URL(href,url).href)).status(),200,href);
 }
 await page.getByRole('button',{name:'Back to editor'}).click();await page.locator('.app-shell').waitFor();
 assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'100');
 assert.ok((await page.locator('.filename').innerText()).includes('about-test.png'));
 await page.setViewportSize({width:360,height:800});await page.locator('.about-footer').click();await page.locator('.about-page').waitFor();
 assert.ok(await page.evaluate(()=>document.querySelector('.about-page').scrollWidth<=innerWidth));
 await page.keyboard.press('Escape');await page.locator('.app-shell').waitFor();
 await page.goto(url+'#about-video');await page.getByRole('heading',{name:'About & guide',exact:true}).waitFor();
 await page.getByRole('button',{name:'Back to editor'}).click();await page.locator('.app-shell').waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS About links, licences, hash routes, Escape, mobile layout and edit preservation');
}finally{await browser.close();}
