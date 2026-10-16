import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../..');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const context=await browser.newContext({viewport:{width:1280,height:860}});
  const page=await context.newPage(),errors=[];
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message,...args){
      if(message?.type==='render'&&!window.__droppedPreviewRender){
        window.__droppedPreviewRender={gen:message.gen,request:message.request};
        return;
      }
      return Reflect.apply(post,this,[message,...args]);
    };
  });
  await page.goto(process.env.CHECK_URL||'http://127.0.0.1:4176/');
  const ready=()=>page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,null,{timeout:30000});
  const videos=['sampled.mp4','sampled-next.mp4'].map(name=>({name,mimeType:'video/mp4',buffer:readFileSync(resolve(root,'analysis/video-check/sampled.mp4'))}));
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles(videos);
  await page.waitForFunction(()=>!!window.__droppedPreviewRender,null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===2&&!!document.querySelector('.photo-tile.selected')&&!document.querySelector('.photo-tile:not(.selected) .photo-select')?.disabled,null,{timeout:30000});
  const blocked=await page.evaluate(()=>window.__droppedPreviewRender);
  assert.ok(Number.isFinite(blocked.gen)&&Number.isFinite(blocked.request),'intercepted one in-flight preview render');

  const next=page.locator('.photo-tile:not(.selected) .photo-select');
  assert.equal(await next.count(),1,'one unselected source is available');
  await next.evaluate(el=>el.click());
  await ready();
  await page.waitForFunction(()=>document.querySelector('canvas[aria-label="Edited photo"]')?.dataset.generation,null,{timeout:30000});
  const result=await page.locator('canvas[aria-label="Edited photo"]').evaluate(canvas=>({gen:Number(canvas.dataset.generation),request:Number(canvas.dataset.request)}));
  assert.ok(result.gen>blocked.gen,`new source rendered in generation ${result.gen} after blocked generation ${blocked.gen}`);
  assert.ok(result.request>blocked.request,`new source rendered request ${result.request} after blocked request ${blocked.request}`);
  assert.deepEqual(errors,[]);
  console.log('PASS cancelled in-flight preview does not block a later source generation');
}finally{await browser.close();}
