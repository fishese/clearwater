import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
const browser=await (process.env.CHECK_BROWSER==='webkit'?webkit.launch():chromium.launch({channel:'msedge'}));
await mkdir(new URL('../../analysis/photo-check/',import.meta.url),{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true});
 await page.goto(process.env.CHECK_URL||'http://127.0.0.1:4176/');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=960;c.height=640;const x=c.getContext('2d');x.fillStyle='#438998';x.fillRect(0,0,960,640);return c.toDataURL().split(',')[1];});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:120000});
 const storageWarning=page.getByRole('button',{name:'Dismiss storage warning',exact:true});
 if(await storageWarning.isVisible()){console.log('Storage warning shown in this browser context; dismissing through the UI before gesture checks.');await storageWarning.click();}
 const hint=page.locator('.web-update-hint-ok');if(await hint.isVisible())await hint.click();
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});
  for(const expanded of [false,true]){
   if(expanded)await page.getByRole('button',{name:'Expand photo',exact:true}).click();
   await page.getByRole('button',{name:'Fit',exact:true}).click();
   await page.getByRole('button',{name:'Zoom in',exact:true}).click();
   const input=page.locator('.comparison-input');
   const frame=await page.locator('.image-frame').boundingBox();
   const stage=await page.locator('.stage').boundingBox();
   const value=Number(await input.getAttribute('aria-valuenow'));
   const y=Math.max(stage.y+10,Math.min(frame.y+frame.height/2,stage.y+stage.height-10));
   const x=Math.max(stage.x+15,frame.x+frame.width*.2);
   await page.mouse.click(x,y);
   assert.equal(Number(await input.getAttribute('aria-valuenow')),value,`${width} expanded=${expanded}: click away must not move divider`);
   const dx=frame.x+frame.width*value/100;
   const dy=Math.max(stage.y+15,frame.y+20);
   if(dx>stage.x&&dx<stage.x+stage.width){
    await page.mouse.move(dx,dy);await page.mouse.down();await page.mouse.move(dx+35,dy,{steps:5});await page.mouse.up();
    assert.ok(Number(await input.getAttribute('aria-valuenow'))>value,`${width}: full divider line must drag`);
   }
   await input.focus();const before=Number(await input.getAttribute('aria-valuenow'));await page.keyboard.press('ArrowLeft');assert.ok(Number(await input.getAttribute('aria-valuenow'))<before,'keyboard slider retained');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
   await page.screenshot({path:fileURLToPath(new URL('../../analysis/photo-check/review-'+width+'-'+expanded+'.png',import.meta.url)),fullPage:true});
   if(expanded)await page.getByRole('button',{name:'Exit expanded view',exact:true}).click();
  }
 }
 console.log('PASS comparison band at 150%, keyboard and responsive overflow: desktop/390/320, normal/expanded');
}finally{await browser.close();}
