import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const catalogs=Object.fromEntries(['en','zh-HK','ja'].map(language=>[language,JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`,import.meta.url),'utf8'))]));
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
 const iconCredit=page.locator('.about-icon-credit');assert.ok((await iconCredit.innerText()).includes('Fish3'));assert.ok((await iconCredit.innerText()).includes('Coral'));assert.deepEqual(await iconCredit.locator('a').evaluateAll(links=>links.map(a=>a.href)),['https://www.svgrepo.com/svg/317012/fish3','https://www.svgrepo.com/svg/2942/coral','https://www.svgrepo.com/']);
 const contact=[48,63,54,50,33,36,50,39,54,33,19,53,58,32,59,54,32,54,125,48,48].map(code=>String.fromCharCode(code^83)).join('');
 assert.equal(await page.locator('.about-downloads a[href="https://github.com/fishese/clearwater/releases/latest/download/clearwater-release.apk"]').count(),1);assert.equal(await page.locator('.about-downloads a[href="https://github.com/fishese/clearwater/releases/latest"]').count(),1);assert.equal(await page.locator('.about-ios').count(),1);assert.equal(await page.locator('a[href^="mailto:"]').count(),0);assert.ok(!(await page.locator('body').innerText()).includes(contact));
 const iosStatus=page.locator('.about-ios');assert.equal(await iosStatus.getAttribute('aria-disabled'),'true');assert.equal(await iosStatus.evaluate(el=>el.tagName),'SPAN');assert.equal(await iosStatus.locator('a').count(),0);
 assert.equal(await page.locator('.about-intro + .about-process-summary + .about-process-summary + .about-downloads').count(),1,'Keep description paragraphs together before downloads');
 assert.equal(await page.locator('.about-download-links svg').count(),2);
 assert.equal(await page.locator('.about-downloads a[href="https://sideloadly.io/"]').count(),1);
 for(const language of ['zh-HK','ja','en']){await page.locator('.about-header .settings-launch').click();await page.locator('.settings-page .language-select').selectOption(language);await page.locator('.settings-close').click();assert.ok((await page.locator('.about-icon-credit').innerText()).includes(catalogs[language]['App icon:']),`${language} icon credit`);assert.ok(await page.getByRole('heading',{name:catalogs[language]['App versions'],exact:true}).isVisible(),`${language} download block`);assert.equal(await page.locator('.about-ios').getAttribute('aria-disabled'),'true',`${language} unpublished IPA status`);assert.equal(await page.locator('.about-ios').evaluate(el=>el.tagName),'SPAN',`${language} unpublished IPA is not a link`);assert.equal(await page.locator('#about-camera').count(),1,`${language} camera guide remains on web`);assert.equal(await page.locator('#about-credits').count(),1,`${language} attribution remains on web`);for(const width of [320,360,390,650,844,1280]){await page.setViewportSize({width,height:800});const layout=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth,block:document.querySelector('.about-downloads').getBoundingClientRect().toJSON()}));assert.ok(layout.page<=layout.viewport,`${language}/${width}: About page overflow`);assert.ok(layout.block.left>=0&&layout.block.right<=width,`${language}/${width}: download block overflow`);}}
 assert.equal(await page.locator('#about-camera dt').count(),9);const cameraGuide=await page.locator('#about-camera').innerText();for(const description of ['12 Mbps','5 Mbps','zero restoration strength','No raw video is kept','1, 3 or 5 minutes','Each pick replaces'])assert.ok(cameraGuide.includes(description),description);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'about-title');
 await page.getByRole('link',{name:'Editing controls',exact:true}).click();
 assert.ok(page.url().endsWith('#about-controls'));
 for(const name of ['Shallow-UWnet','Five A\\+','WWE-UIE'])assert.ok(await page.getByRole('heading',{name:new RegExp(name)}).isVisible());
 assert.equal(await page.getByRole('heading',{name:/FUnIE-GAN/}).count(),0);
 const modelLayout=()=>page.evaluate(()=>{
  const cards=[...document.querySelectorAll('.about-models .about-card')];
  const titles=cards.map(card=>card.querySelector('h3').childNodes[0].textContent.trim());
  const note=document.querySelector('.about-model-note');
  const maxCardBottom=Math.max(...cards.map(card=>card.getBoundingClientRect().bottom+window.scrollY));
  return {titles,noteInGrid:!!note.closest('.about-models'),noteTop:note.getBoundingClientRect().top+window.scrollY,maxCardBottom};
 });
 for(const [width,height] of [[1280,900],[360,800]]){
  await page.setViewportSize({width,height});
  const layout=await modelLayout();
  assert.deepEqual(layout.titles,['WWE-UIE','Five A+','Shallow-UWnet','Balanced restoration','Original RGB heuristic'],`${width}px model order`);
  assert.equal(layout.noteInGrid,false,`${width}px usage note must sit outside the model grid`);
  assert.ok(layout.noteTop>=layout.maxCardBottom-1,`${width}px usage note must be below every model card`);
 }
 await page.setViewportSize({width:1280,height:900});
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
 for(const platform of ['android','ios']){
  const native=await browser.newContext();
  await native.addInitScript(platform=>{
   window.CapacitorCustomPlatform={name:platform};
   if(platform==='ios')window.Capacitor={PluginHeaders:[{name:'ClearWaterCamera',methods:[...['getLaunchMode','listCaptures','drainCaptures','removeListener'].map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'}]},{name:'ClearWaterExport',methods:[]}],nativePromise:async(_plugin,method)=>method==='getLaunchMode'?{mode:null}:method==='listCaptures'||method==='drainCaptures'?{captures:[]}:{},nativeCallback:()=>({callbackId:'about-check'})};
  },platform);
  const nativePage=await native.newPage();await nativePage.goto(url+'#about');await nativePage.locator('#about-title').waitFor();
  assert.equal(await nativePage.locator('.about-downloads').count(),0,`${platform}: hide app downloads`);
  assert.equal(await nativePage.locator('.about-process-summary').count(),2,`${platform}: retain description`);
  for(const language of ['zh-HK','ja','en']){
   await nativePage.locator('.about-header .settings-launch').click();await nativePage.locator('.settings-page .language-select').selectOption(language);await nativePage.locator('.settings-close').click();
   assert.equal(await nativePage.locator('.about-downloads').count(),0,`${platform}/${language}: hide app downloads`);
   assert.ok(await nativePage.getByRole('heading',{name:catalogs[language]['Attribution & sources'],exact:true}).isVisible(),`${platform}/${language}: retain guide and attribution`);
   assert.ok(await nativePage.locator('#about-camera').isVisible(),`${platform}/${language}: retain camera guide`);
   assert.ok((await nativePage.locator('.about-process-summary').nth(1).innerText()).includes(catalogs[language]['All processing stays on your device. The web version runs in your browser; the Android and iPhone apps also support native camera capture. Photos and videos are not uploaded for processing.']),`${platform}/${language}: retain localized platform description`);
   if(platform==='ios'){
    const cameraText=await nativePage.locator('#about-camera').innerText(),filesText=await nativePage.locator('#about-files').innerText();
    for(const key of ['iOS camera quality','iOS camera copies','iOS camera recovery'])assert.ok(cameraText.includes(catalogs[language][key]),`${platform}/${language}: retain ${key} explanation`);
    for(const key of ['Library items are private to ClearWater. Removing an item or clearing the collection affects only its app copy; exported files and Photos copies remain independent.','On iOS, clearing hides camera captures and removes imported app copies and edits. Private camera originals remain in the app and can be restored in Settings. Exported files and Photos copies stay untouched.'])assert.ok(filesText.includes(catalogs[language][key]),`${platform}/${language}: retain private storage/export explanation`);
   }
  }
  await native.close();
 }
 console.log('PASS About links, licences, hash routes, Escape, mobile layout and edit preservation');
}finally{await browser.close();}
