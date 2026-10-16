import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const catalogues=Object.fromEntries(['en','ja','zh-HK'].map(language=>[language,JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`,import.meta.url),'utf8'))]));
const browser=await chromium.launch({channel:'msedge',headless:true});
const base=new URL(process.env.CHECK_URL??'http://127.0.0.1:5173/');
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(base.href);
 await page.evaluate(async()=>{
  const {mountCaptureRemovalDialog}=await import('/tests/capture-removal-dialog-harness.tsx');
  const host=document.createElement('div'),opener=document.createElement('button');opener.textContent='Open dialog';document.body.append(opener,host);opener.focus();
  const state=window.captureDialogTest={hideCalls:0,deleteCalls:0,closeCalls:0,resolve:null,reject:null,controller:null};
  const props={filename:'dive.jpg',busy:false,error:'',onCancel:()=>{state.closeCalls++;state.controller.unmount();},onHide:()=>{state.hideCalls++;state.controller.render({...props,busy:true});return new Promise((resolve,reject)=>{state.resolve=resolve;state.reject=reject;});},onDelete:()=>{state.deleteCalls++;state.controller.render({...props,busy:true});return new Promise((resolve,reject)=>{state.resolve=resolve;state.reject=reject;});}};
  state.controller=mountCaptureRemovalDialog(host,props);
  state.renderError=(error)=>state.controller.render({...props,busy:false,error});
  state.finish=()=>{state.closeCalls++;state.controller.unmount();};
 });
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 for(const language of ['en','zh-HK','ja']){
  await page.evaluate(language=>window.captureDialogTest.controller.setLanguage(language),language);
  const text=catalogues[language];
  const title=text['Remove {0} from ClearWater?'].replace('{0}','dive.jpg');
  await page.getByRole('heading',{name:title,exact:true}).waitFor();
  await page.getByRole('button',{name:text['Hide capture'],exact:true}).waitFor();
  await page.getByRole('button',{name:text['Delete permanently'],exact:true}).waitFor();
  await page.setViewportSize({width:320,height:700});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),language+' 320px overflow');
 }
 await page.evaluate(()=>window.captureDialogTest.controller.setLanguage('en'));
 await page.getByRole('button',{name:'Delete permanently',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
 await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Delete permanently');
 await page.getByRole('button',{name:'Hide capture',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.captureDialogTest.hideCalls),1);
 await page.getByRole('button',{name:'Hiding…',exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');
 assert.equal(await page.getByRole('button',{name:'Delete permanently',exact:true}).isDisabled(),true);
 await page.evaluate(()=>window.captureDialogTest.renderError('Could not hide the capture. Its private original is still on this device.'));
 await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'false');
 assert.equal(await page.getByRole('button',{name:'Hide capture',exact:true}).isDisabled(),false);
 await page.getByRole('button',{name:'Delete permanently',exact:true}).click();
 await page.getByRole('button',{name:'Deleting…',exact:true}).waitFor();
 await page.evaluate(()=>window.captureDialogTest.renderError('Could not delete the capture. Its files are still on this device.'));
 await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/still on this device/);
 await page.getByRole('button',{name:'Cancel',exact:true}).focus();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Open dialog');
 assert.deepEqual(await page.evaluate(()=>[window.captureDialogTest.hideCalls,window.captureDialogTest.deleteCalls,window.captureDialogTest.closeCalls]),[1,1,1]);
 console.log('PASS localized dialog, filename title, recoverable/permanent choices, busy/error states, Escape close, focus return and narrow layout');
}finally{await browser.close();}
