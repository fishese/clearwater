import { webkit } from 'playwright';
import assert from 'node:assert/strict';

const browser=await webkit.launch({headless:true});
try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/605.1.15'});
    Object.defineProperty(navigator,'platform',{configurable:true,value:'iPhone'});
    Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:5});
    Object.defineProperty(navigator,'canShare',{configurable:true,value:undefined});
    window.sharedFiles=[];
    Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>window.sharedFiles.push({name:files[0].name,type:files[0].type})});
  });
  await page.goto(process.env.CHECK_URL||'http://127.0.0.1:5173/');
  const result=await page.evaluate(async()=>{
    const {supportsFileShare,shareExport}=await import('/src/export-share.ts');
    const supported=supportsFileShare();
    await shareExport(new Blob([Uint8Array.from([0xff,0xd8,0xff,0xd9])],{type:'image/jpeg'}),'photo-restore.jpg');
    await shareExport(new Blob(['{"engine":"balanced"}'],{type:'application/json'}),'clearwater-recipe.json');
    let invalidRecipeRejected=false;
    try{await shareExport(new Blob(['{}'],{type:'application/json'}),'other.json');}catch{invalidRecipeRejected=true;}
    return {supported,files:window.sharedFiles,invalidRecipeRejected};
  });
  assert.equal(result.supported,true,'Safari file sharing works when canShare is absent');
  assert.deepEqual(result.files,[{name:'photo-restore.jpg',type:'image/jpeg'},{name:'clearwater-recipe.json',type:'application/json'}]);
  assert.equal(result.invalidRecipeRejected,true,'web recipe sharing keeps its strict filename guard');
  console.log('PASS WebKit share wrapper with absent canShare, JPEG and restricted recipe JSON');
}finally{await browser.close();}
