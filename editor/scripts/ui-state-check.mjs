import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const url=process.env.CHECK_URL??'http://127.0.0.1:5173/';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(()=>{
    const text=File.prototype.text;
    File.prototype.text=function(){const result=text.call(this);return this.name==='slow-recipe.json'?new Promise(resolve=>setTimeout(()=>result.then(resolve),500)):result;};
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  const fixture=Buffer.from((await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=192;const context=canvas.getContext('2d');const gradient=context.createLinearGradient(0,0,256,192);gradient.addColorStop(0,'#174e61');gradient.addColorStop(.5,'#47aa94');gradient.addColorStop(1,'#e2c798');context.fillStyle=gradient;context.fillRect(0,0,256,192);context.fillStyle='#f2e9d7';context.beginPath();context.arc(130,92,34,0,Math.PI*2);context.fill();return canvas.toDataURL('image/png');})).split(',')[1],'base64');
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles([
    {name:'first.jpg',mimeType:'image/jpeg',buffer:fixture},
    {name:'second.jpg',mimeType:'image/jpeg',buffer:fixture},
  ]);
  const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,{timeout:120000});
  await ready();
  const recipe={version:1,engine:'baseline',strength:.8,hints:{scene:'auto',water:'auto',filter:'auto',depth:null},auto:{gains:[1,1,1],redMix:0,haze:0,highlights:0,mode:'gentle',explanation:''},manual:{warmth:35,tint:0,red:0,exposure:0,highlights:0,shadows:0,contrast:0,haze:0,vibrance:0,neutral:[1,1,1]}};
  await page.getByLabel('Choose recipe',{exact:true}).setInputFiles({name:'slow-recipe.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recipe))});
  await page.waitForTimeout(80);
  await page.getByRole('button',{name:'Next photo',exact:true}).click();
  await ready();
  await page.waitForTimeout(600);
  assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'0','late recipe import must not edit the newly selected photo');
  await page.getByRole('button',{name:'Previous photo',exact:true}).click();
  await ready();
  assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'35','recipe import should apply to the originally selected photo');

  await page.getByRole('button',{name:/^Save as/}).click();
  await page.getByLabel('Export filename',{exact:true}).waitFor();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),'Cancel','Shift+Tab should wrap inside the save dialog');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Export filename','Tab should wrap to the first dialog control');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0,'Escape should close the save dialog');

  await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'loading.jpg',mimeType:'image/jpeg',buffer:fixture});
  await page.getByRole('button',{name:'Remove loading.jpg',exact:true}).click();
  await ready();
  assert.equal(await page.getByLabel('Photo position',{exact:true}).innerText(),'1 / 2');
  assert.equal(await page.locator('.processing-overlay').count(),0,'removal during load must not leave a stuck processing overlay');

  await page.getByRole('button',{name:'Remove second.jpg',exact:true}).click();
  await page.getByRole('button',{name:'Remove first.jpg',exact:true}).click();
  await page.getByText('Open a photo, MP4 or MOV to start.',{exact:true}).waitFor();
  assert.equal(await page.locator('.processing-overlay').count(),0);
  assert.equal(await page.locator('.top-actions .primary').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS delayed recipe import remains bound to its original photo; modal focus stays trapped and Escape closes Save as; removing during load and removing the last photo clears worker/UI state.');
} finally {await browser.close();}
