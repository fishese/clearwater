import {chromium,webkit} from 'playwright';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const fixtures=resolve('/tmp/limit-fixtures');
const shots=resolve('/opt/cursor/artifacts/limit-browser');
mkdirSync(shots,{recursive:true});
const url=process.env.CHECK_URL??'http://127.0.0.1:5173/';
const catalogs=Object.fromEntries(['en','zh-HK','ja'].map(lang=>[lang,JSON.parse(readFileSync(new URL('../src/locales/'+lang+'.json',import.meta.url),'utf8'))]));
const keys={
 'too-large':'Video is {actual}. Max on this device: {limit}. Try exporting smaller or trimming it.',
 'too-long':'Video is {actual} long. Max: {limit}. Trim it into shorter clips.',
 resolution:'Video is {actual}. Max: {limit}. Export at 4K or lower.',
 'photo-too-large':'Photo is {actual}. Max on this device: {limit}.',
 unreadable:"Couldn't read this file. Re-export it as a standard MP4.",
};
const fill=(lang,code,actual='',limit='')=>catalogs[lang][keys[code]].replaceAll('{actual}',actual).replaceAll('{limit}',limit);
const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/605.1.15';
const android='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const only=new Set((process.env.ONLY_RUNTIMES??'').split(',').filter(Boolean));
const runtimes=[
 {id:'desktop',engine:'chromium',over:'over-desktop.mp4',overActual:'520 MB',overLimit:'512 MB'},
 {id:'android-chrome',engine:'chromium',userAgent:android,over:'over-desktop.mp4',overActual:'520 MB',overLimit:'512 MB'},
 {id:'ios-chromium',engine:'chromium',userAgent:iphone,over:'over-ios.mp4',overActual:'300 MB',overLimit:'256 MB'},
 {id:'ios-webkit',engine:'webkit',userAgent:iphone,over:'over-ios.mp4',overActual:'300 MB',overLimit:'256 MB'},
];
const languages=['en','zh-HK','ja'];
const results=[];

function record(row){results.push(row);console.log(`${row.pass?'PASS':'FAIL'} ${row.runtime} ${row.lang} ${row.case}: ${row.detail}`);}

async function reset(page,lang){
 await page.evaluate(async language=>{
  await new Promise(resolve=>{const request=indexedDB.deleteDatabase('clearwater-library');request.onsuccess=request.onerror=request.onblocked=()=>resolve();});
  localStorage.setItem('clearwater-language',language);
 },lang);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('html').getAttribute('lang').then(value=>{if(value!==lang)throw new Error('language '+value);});
}

async function toastText(page){
 const toast=page.locator('.toast > span');
 await toast.waitFor({timeout:90000});
 return (await toast.innerText()).replace(/\s+/g,' ').trim();
}

async function openFile(page,name){
 await page.getByLabel(catalogs[(await page.locator('html').getAttribute('lang'))]['Choose photos'],{exact:true}).setInputFiles(resolve(fixtures,name));
}

async function shot(page,name){
 const path=resolve(shots,name);
 await page.screenshot({path,fullPage:false});
 return path;
}

async function expectError(page,{runtime,lang,caseName,file,expected,shotName}){
 try{
  await reset(page,lang);
  await openFile(page,file);
  const text=await toastText(page);
  if(text!==expected)throw new Error(`got “${text}” wanted “${expected}”`);
  const path=await shot(page,shotName);
  record({pass:true,runtime,lang,case:caseName,detail:text,screenshot:path});
 }catch(error){
  const path=resolve(shots,`fail_${shotName}`);
  await page.screenshot({path}).catch(()=>{});
  record({pass:false,runtime,lang,case:caseName,detail:String(error.message??error),screenshot:path});
 }
}

async function waitReady(page){
 await page.waitForFunction(()=>{
  const button=document.querySelector('.top-actions .primary');
  return !!button&&button.disabled===false&&/\d+\s*×\s*\d+/.test(document.body.innerText);
 },null,{timeout:90000});
 const toast=await page.locator('.toast > span').innerText().catch(()=>'');
 if(/Max:|上限|Couldn't|無法讀取|読み込めません|HDR/.test(toast))throw new Error('unexpected toast '+toast);
}
async function expectOpen(page,{runtime,lang,caseName,file,shotName,check}){
 try{
  await reset(page,lang);
  await openFile(page,file);
  await waitReady(page);
  if(check)await check(page);
  const path=shotName?await shot(page,shotName):'';
  record({pass:true,runtime,lang,case:caseName,detail:'opened',screenshot:path});
 }catch(error){
  const path=resolve(shots,`fail_${shotName||caseName}.png`);
  await page.screenshot({path}).catch(()=>{});
  record({pass:false,runtime,lang,case:caseName,detail:String(error.message??error),screenshot:path});
 }
}

async function runRuntime(browser,runtime){
 const context=await browser.newContext({
  viewport:{width:390,height:844},
  deviceScaleFactor:1,
  hasTouch:true,
  isMobile:true,
  ...(runtime.userAgent?{userAgent:runtime.userAgent}:{}),
  acceptDownloads:true,
 });
 const page=await context.newPage();
 const pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.goto(url);
 for(const lang of languages){
  const slug=lang.toLowerCase().replace('-','');
  await expectError(page,{runtime:runtime.id,lang,caseName:'too-large',file:runtime.over,expected:fill(lang,'too-large',runtime.overActual,runtime.overLimit),shotName:`${runtime.id}_${slug}_too_large.png`});
  await expectError(page,{runtime:runtime.id,lang,caseName:'too-long',file:'too-long.mp4',expected:fill(lang,'too-long','10:01','10:00'),shotName:`${runtime.id}_${slug}_too_long.png`});
  await expectError(page,{runtime:runtime.id,lang,caseName:'resolution',file:'over-frame.mp4',expected:fill(lang,'resolution','8192×4320 (35.4 MP)','34 MP'),shotName:`${runtime.id}_${slug}_resolution.png`});
  await expectError(page,{runtime:runtime.id,lang,caseName:'rotated-over',file:'over-frame-rot90.mp4',expected:fill(lang,'resolution','4320×8192 (35.4 MP)','34 MP'),shotName:`${runtime.id}_${slug}_rotated.png`});
  await expectError(page,{runtime:runtime.id,lang,caseName:'photo-too-large',file:'over-photo.png',expected:fill(lang,'photo-too-large','20001×10000 (200.1 MP)','200 MP'),shotName:`${runtime.id}_${slug}_photo.png`});
  await expectError(page,{runtime:runtime.id,lang,caseName:'unreadable',file:'corrupt.mp4',expected:fill(lang,'unreadable'),shotName:`${runtime.id}_${slug}_unreadable.png`});
  await expectOpen(page,{runtime:runtime.id,lang,caseName:'display-p3',file:'live-p3.mov',shotName:lang==='en'?`${runtime.id}_en_display_p3.png`:''});
  await expectOpen(page,{runtime:runtime.id,lang,caseName:'near-rotated',file:'near-frame-rot90.mp4',shotName:lang==='en'?`${runtime.id}_en_near_rotated.png`:''});
  if(lang==='en'){
   const reduced=runtime.overLimit==='256 MB';
   await expectOpen(page,{runtime:runtime.id,lang,caseName:'auto-photo',file:'big-photo.jpg',shotName:`${runtime.id}_en_auto_photo.png`,check:async current=>{
    const text=await current.locator('.export-panel summary .summary-meta').evaluate(element=>element.textContent?.trim()??'');
    const wanted=catalogs.en[reduced?'Reduced resolution':'Full resolution'];
    if(text!==wanted)throw new Error(`export summary “${text}” wanted “${wanted}”`);
   }});
   await expectOpen(page,{runtime:runtime.id,lang,caseName:'normal-photo',file:'normal.jpg',shotName:`${runtime.id}_en_normal_photo.png`});
   try{
    await reset(page,'en');
    await openFile(page,'normal.jpg');
    await waitReady(page);
    const downloadInstead=page.getByRole('button',{name:'Download instead',exact:true});
    if(await downloadInstead.count()){
     const download=page.waitForEvent('download',{timeout:90000});
     await downloadInstead.click({force:true});
     const file=await download;
     if(!file.suggestedFilename().toLowerCase().endsWith('.jpg'))throw new Error(file.suggestedFilename());
     record({pass:true,runtime:runtime.id,lang:'en',case:'export-photo',detail:file.suggestedFilename()});
    }else{
     await page.locator('.top-actions .primary').click({force:true});
     const share=page.getByRole('heading',{name:'Share or save…'});
     const download=page.waitForEvent('download',{timeout:90000}).then(file=>file.suggestedFilename()).catch(()=>null);
     const shared=share.waitFor({timeout:90000}).then(()=>'share-sheet').catch(()=>null);
     const outcome=await Promise.race([download,shared]);
     if(!outcome)throw new Error('export produced neither a download nor the iOS share sheet');
     record({pass:true,runtime:runtime.id,lang:'en',case:'export-photo',detail:outcome});
    }
   }catch(error){record({pass:false,runtime:runtime.id,lang:'en',case:'export-photo',detail:String(error.message??error)});}
   await expectOpen(page,{runtime:runtime.id,lang,caseName:'normal-video',file:'normal.mp4',shotName:`${runtime.id}_en_normal_video.png`});
  }
 }
 if(pageErrors.length)record({pass:false,runtime:runtime.id,lang:'*',case:'pageerror',detail:pageErrors.join(' | ')});
 await context.close();
}

const selected=runtimes.filter(runtime=>!only.size||only.has(runtime.id));
const engines=[...new Set(selected.map(runtime=>runtime.engine))];
const browsers=Object.fromEntries(await Promise.all(engines.map(async engine=>[engine,await (engine==='webkit'?webkit:chromium).launch({headless:true})])));
try{
 for(const runtime of selected)await runRuntime(browsers[runtime.engine],runtime);
}finally{
 await Promise.all(Object.values(browsers).map(browser=>browser.close()));
}
const failed=results.filter(row=>!row.pass);
console.log(`\n${results.length-failed.length}/${results.length} passed`);
if(failed.length){console.log(JSON.stringify(failed,null,2));process.exitCode=1;}
