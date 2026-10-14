import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.CHECK_URL||'http://127.0.0.1:4176/');
 const png=await page.evaluate(async()=>{const c=new OffscreenCanvas(200,100),ctx=c.getContext('2d');ctx.fillStyle='rgb(210,65,50)';ctx.fillRect(0,0,100,100);ctx.fillStyle='rgb(150,150,150)';ctx.fillRect(100,0,100,100);return Array.from(new Uint8Array(await(await c.convertToBlob()).arrayBuffer()));});
 await page.locator('input[type=file][multiple]').setInputFiles({name:'white-balance-regression.png',mimeType:'image/png',buffer:Buffer.from(png)});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 async function idle(){await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);}
 async function pick(fraction){await page.getByRole('button',{name:'Pick neutral point',exact:true}).first().click();const box=await page.locator('.image-frame').boundingBox();await page.mouse.click(box.x+box.width*fraction,box.y+box.height*.5);await page.getByText('Neutral point applied. Undo if the selected area was not white or grey.',{exact:true}).waitFor();await idle();await page.waitForTimeout(500);return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('clearwater-library');r.onsuccess=()=>{const db=r.result,tx=db.transaction('photos'),q=tx.objectStore('photos').getAll();q.onsuccess=()=>resolve(q.result[0].recipe.manual.neutral);tx.oncomplete=()=>db.close();};r.onerror=()=>reject(r.error);}));}
 await page.locator('.settings-group').filter({has:page.getByLabel('Correction engine',{exact:true})}).locator('summary').click();
 for(const engine of ['baseline','wwe']){
  await page.getByLabel('Correction engine',{exact:true}).selectOption(engine);await idle();await page.getByRole('button',{name:'Reset manual edits',exact:true}).click();await idle();
  const red=await pick(.25),afterWhite=await pick(.75);
  await page.getByRole('button',{name:'Reset manual edits',exact:true}).click();await idle();const freshWhite=await pick(.75);
  assert.ok(red.some((v,i)=>Math.abs(v-freshWhite[i])>.05),'red pick changes correction');assert.deepEqual(afterWhite,freshWhite,'white pick replaces red pick for '+engine);
  console.log('PASS editor repeated white balance replaces prior pick:',engine,afterWhite);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
