import { chromium,webkit } from 'playwright';
import assert from 'node:assert/strict';

const browser=await (process.env.CHECK_BROWSER==='webkit'?webkit:chromium).launch({headless:true});
try{
  const context=await browser.newContext({acceptDownloads:true});
  const page=await context.newPage();
  const downloads=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
  page.on('pageerror',error=>console.error('PAGE ERROR',error.message));
  page.on('console',message=>{if(message.type()==='error')console.error('CONSOLE',message.text());});
  await page.addInitScript(()=>{
    delete window.showDirectoryPicker;
    Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/605.1.15'});
    Object.defineProperty(navigator,'platform',{configurable:true,value:'iPhone'});
    Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:5});
    Object.defineProperty(navigator,'canShare',{configurable:true,value:undefined});
    window.iosShareCalls=[];window.iosShareCancelNext=true;
    window.iosPreviewRenders=0;window.delayNextEnhance=false;window.enhanceDelayed=false;window.holdNextRender=false;window.heldRender=null;
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message,...args){
      if(message?.type==='render')window.iosPreviewRenders++;
      if(message?.type==='render'&&window.holdNextRender){
        window.holdNextRender=false;window.heldRender={worker:this,message,args};
        return;
      }
      if(message?.type==='enhance'&&window.delayNextEnhance){
        window.delayNextEnhance=false;window.enhanceDelayed=true;window.delayedEnhance={worker:this,gen:message.gen,request:message.request};
        setTimeout(()=>Reflect.apply(post,this,[message,...args]),500);
        return;
      }
      return Reflect.apply(post,this,[message,...args]);
    };
    window.releaseHeldRender=()=>{const held=window.heldRender;window.heldRender=null;Reflect.apply(post,held.worker,[held.message,...held.args]);};
    Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{
      const file=files[0];window.iosShareCalls.push({name:file.name,type:file.type,text:file.type==='application/json'?await file.text():null});
      if(window.iosShareCancelNext){window.iosShareCancelNext=false;throw new DOMException('cancelled','AbortError');}
    }});
  });
  await page.goto(process.env.CHECK_URL||'http://127.0.0.1:5173/');
  const png=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const context=canvas.getContext('2d');context.fillStyle='#527b70';context.fillRect(0,0,64,64);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'safari-export.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>document.querySelector('.filename')?.textContent.includes('safari-export.png'));
  await page.waitForFunction(()=>!document.querySelector('.top-actions .primary')?.disabled).catch(async error=>{console.error('BUTTONS',await page.locator('.top-actions button').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,disabled:button.disabled,aria:button.getAttribute('aria-label')}))));console.error('BODY',(await page.locator('body').innerText()).slice(0,2000));throw error;});

  const exportButton=page.locator('.top-actions .primary');
  const initialPreviewRenders=await page.evaluate(()=>window.iosPreviewRenders);
  assert.ok(initialPreviewRenders>0,'initial photo preview rendered before export');
  await exportButton.click();
  let dialog=page.getByRole('dialog',{name:'Share or save…'});
  await dialog.waitFor().catch(async error=>{console.error('BUTTONS',await page.locator('.top-actions button').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,disabled:button.disabled,aria:button.getAttribute('aria-label')}))));console.error('BODY',(await page.locator('body').innerText()).slice(0,2500));throw error;});
  assert.equal(await page.evaluate(()=>window.iosShareCalls.length),0,'render completion opens a prompt without sharing automatically');
  assert.equal(await exportButton.isDisabled(),true,'top export is locked while the iOS share prompt is open');
  assert.equal(await page.locator('.save-as').isDisabled(),true,'Export pane save is locked while the same prompt is open');
  assert.equal(await page.getByRole('button',{name:'Save recipe'}).isDisabled(),true,'recipe export is locked during the share prompt');
  await dialog.getByRole('button',{name:'Cancel'}).click();
  await dialog.waitFor({state:'detached'});
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.iosPreviewRenders),initialPreviewRenders,'export completion does not queue an unchanged preview render');
  assert.equal(await exportButton.isDisabled(),false,'export is ready immediately after the share prompt is cancelled');

  await page.locator('.save-as').click();dialog=page.getByRole('dialog',{name:'Share or save…'});await dialog.waitFor();
  await dialog.getByRole('button',{name:'Share now'}).click();
  await page.waitForFunction(()=>window.iosShareCalls.length===1);
  await dialog.waitFor();
  assert.equal((await page.evaluate(()=>window.iosShareCalls[0])).name,'safari-export-restore.jpg');
  await dialog.getByRole('button',{name:'Share now'}).click();
  await page.waitForFunction(()=>window.iosShareCalls.length===2);
  await dialog.waitFor({state:'detached'});
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.iosPreviewRenders),initialPreviewRenders,'sharing does not repeat the unchanged preview render');
  assert.equal(await exportButton.isDisabled(),false,'export remains ready after sharing');

  await page.getByRole('button',{name:'Save recipe'}).click();
  dialog=page.getByRole('dialog',{name:'Share or save…'});await dialog.waitFor();
  assert.equal(await page.evaluate(()=>window.iosShareCalls.length),2,'toolbar recipe save waits for a fresh share tap');
  await dialog.getByRole('button',{name:'Share now'}).click();
  await page.waitForFunction(()=>window.iosShareCalls.length===3);
  await dialog.waitFor({state:'detached'});

  await page.locator('.preset-group>summary').click();
  await page.getByRole('button',{name:'Save preset',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Share or save…'});await dialog.waitFor();
  assert.equal(await page.evaluate(()=>window.iosShareCalls.length),3,'preset save also waits for a fresh share tap');
  assert.equal(await dialog.locator('p').first().textContent(),'clearwater-recipe.json');
  await dialog.getByRole('button',{name:'Share now'}).click();
  await page.waitForFunction(()=>window.iosShareCalls.length===4);
  await dialog.waitFor({state:'detached'});
  const presets=await page.evaluate(()=>window.iosShareCalls.slice(2));
  for(const preset of presets){
    assert.equal(preset.name,'clearwater-recipe.json');
    assert.equal(preset.type,'application/json');
    assert.equal(typeof JSON.parse(preset.text).engine,'string','shared preset contains serialized recipe JSON');
  }
  await page.evaluate(()=>{window.delayNextEnhance=true;window.holdNextRender=true;});
  await page.getByRole('button',{name:'Auto enhance'}).click();
  await page.waitForFunction(()=>window.enhanceDelayed);
  assert.equal(await exportButton.isDisabled(),true,'enhancement keeps export locked while it is active');
  await page.getByLabel('Choose recipe').setInputFiles({name:'clearwater-recipe.json',mimeType:'application/json',buffer:Buffer.from(presets[0].text)});
  await page.waitForFunction(()=>window.heldRender!==null);
  await page.evaluate(()=>{const old=window.delayedEnhance;old.worker.onmessage({data:{type:'error',operation:'enhance',gen:old.gen,request:old.request,message:'Superseded enhancement failed.'}});});
  assert.equal(await exportButton.isDisabled(),true,'a late enhancement error cannot unlock an unfinished preview render');
  await page.evaluate(()=>window.releaseHeldRender());
  await page.waitForFunction(()=>!document.querySelector('.top-actions .primary')?.disabled);
  await page.waitForTimeout(650);
  assert.equal(await exportButton.isDisabled(),false,'a superseded enhancement cannot leave export busy after a recipe loads');
  assert.deepEqual(downloads,[],'Safari save paths do not fall through to scripted downloads');
  await context.close();
  console.log('PASS iPhone Safari export readiness, cancel/retry, recipe sharing, and superseded enhancement');
}finally{await browser.close();}
