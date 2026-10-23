import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url=process.env.CHECK_URL??'http://127.0.0.1:4197/';
const browser=await chromium.launch({headless:true,channel:process.env.CHECK_BROWSER??'msedge'});
try{
 const context=await browser.newContext({viewport:{width:1100,height:850}}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await page.getByRole('heading',{name:'Photo & video editor'}).waitFor();
 const png=await page.evaluate(async()=>{const c=new OffscreenCanvas(96,72),ctx=c.getContext('2d');ctx.fillStyle='#396b75';ctx.fillRect(0,0,96,72);return Array.from(new Uint8Array(await (await c.convertToBlob()).arrayBuffer()));});
 const browse=page.locator('.empty-state-actions .browse-files-button');
 const chooserPromise=page.waitForEvent('filechooser');await browse.click();const chooser=await chooserPromise;
 assert.equal(chooser.isMultiple(),true,'Browse files allows selecting multiple files');
 assert.equal(await chooser.element().getAttribute('accept'),'','Browse files removes the media-only picker hint');
 await chooser.setFiles({name:'first.png',mimeType:'image/png',buffer:Buffer.from(png)});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 const count=()=>page.locator('.photo-grid .photo-tile').count();
 assert.equal(await count(),1,'valid photo was imported');

 await page.setViewportSize({width:800,height:900});
 const libraryBrowse=page.locator('.library-import-actions .browse-files-button');
 await libraryBrowse.waitFor({state:'visible'});
 assert.ok(await libraryBrowse.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom<=innerHeight;}),'Browse files remains visible in the tablet collection row');

 const invalidChooserPromise=page.waitForEvent('filechooser');await libraryBrowse.click();const invalidChooser=await invalidChooserPromise;
 assert.equal(invalidChooser.isMultiple(),true);assert.equal(await invalidChooser.element().getAttribute('accept'),'');
 await invalidChooser.setFiles({name:'unsupported.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')});
 await page.getByRole('status').filter({hasText:'Choose JPEG, PNG, HEIC, HEIF, DNG, MP4 or MOV files.'}).waitFor();
 assert.equal(await count(),1,'unsupported file did not replace or add to the collection');
 assert.match(await page.locator('.filename').innerText(),/first\.png/,'current photo remains selected');

 // Browsers expose a `cancel` event when a picker closes without a selection. Dispatching
 // it here exercises the app-side no-op; native picker dismissal still needs device QA.
 await page.locator('input[type=file][multiple]').dispatchEvent('cancel');
 assert.equal(await count(),1,'picker cancellation leaves the existing collection intact');

 const filteredChooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open files',exact:true}).click();const filteredChooser=await filteredChooserPromise;
 assert.equal(filteredChooser.isMultiple(),true,'normal Open files retains multi-select');
 assert.match(await filteredChooser.element().getAttribute('accept')??'',/image\/jpeg/,'normal Open files restores the supported-media filter');
 await filteredChooser.setFiles([]);
 assert.equal(await count(),1,'closing the normal picker without files preserves the collection');
 await context.close();

 for(const platform of ['android','ios']){
  const nativeContext=await browser.newContext({viewport:{width:800,height:900}});
  await nativeContext.addInitScript(value=>{window.CapacitorCustomPlatform={name:value};},platform);
  const nativePage=await nativeContext.newPage();await nativePage.goto(url);await nativePage.getByRole('heading',{name:'Photo & video editor'}).waitFor();
  assert.equal(await nativePage.getByRole('button',{name:'Browse files',exact:true}).count(),0,`${platform} shell does not show the web-only Browse files action`);
  assert.equal(await nativePage.getByRole('button',{name:'Open files',exact:true}).count(),1,`${platform} shell retains Open files`);
  if(platform==='android')assert.equal(await nativePage.getByRole('button',{name:'Open folder',exact:true}).count(),1,'Android retains its SAF folder route');
  await nativeContext.close();
 }
 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS Browse files validation, picker accept reset, cancellation preservation, tablet discoverability, and native visibility');
}finally{await browser.close();}
