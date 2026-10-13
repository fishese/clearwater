import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
let version=0;
const root=resolve(import.meta.dirname,'../dist'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.mjs':'text/javascript','.json':'application/json'};
const server=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  if(version===0&&path==='/sw.js'){res.setHeader('Content-Type','text/javascript');res.end("self.addEventListener('install',e=>e.waitUntil(caches.open('legacy').then(c=>c.add('/'))));self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname==='/')e.respondWith(caches.match('/'));});");return;}
  if(version===0&&path==='/'){res.setHeader('Content-Type','text/html');res.end("<h1>Previous version</h1><script>navigator.serviceWorker.register('/sw.js');</script>");return;}
  res.setHeader('Content-Type',types[extname(path)]??'application/octet-stream');let body=await readFile(resolve(root,'.'+(path==='/'?'/index.html':path)));
  if(path==='/sw.js')body=Buffer.concat([body,Buffer.from('\n// Test deployment '+version)]);res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 version=1;await page.reload();assert.equal(await page.getByRole('heading').textContent(),'Previous version','Reproduce stale cached navigation');
 await page.goto(url+'/update.html');await page.getByRole('button',{name:'Update and open',exact:true}).click();await page.getByRole('button',{name:'Update app',exact:true}).waitFor({timeout:60000});
 const update=page.getByRole('button',{name:'Update app',exact:true});assert.equal(await update.innerText(),'');assert.equal(await update.evaluate(b=>getComputedStyle(b).borderTopWidth),'0px');assert.ok((await update.boundingBox()).width<=26);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log('PASS recovery from stale worker and compact unframed update icon');
 await update.click();await page.getByRole('status').filter({hasText:'latest version'}).waitFor();
 // Store a real photo and make an edit immediately before requesting activation.
 const png=await page.evaluate(async()=>{const c=new OffscreenCanvas(64,64);c.getContext('2d').fillRect(0,0,64,64);return Array.from(new Uint8Array(await (await c.convertToBlob()).arrayBuffer()));});
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'update-test.png',mimeType:'image/png',buffer:Buffer.from(png)});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 await page.getByRole('slider',{name:'Warmth',exact:true}).focus();await page.keyboard.press('End');
 version=2;await update.click();await page.waitForEvent('load');await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'100');assert.ok((await page.locator('.filename').innerText()).includes('update-test.png'));console.log('PASS update activation/reload preserves photo and latest edits');
 await context.setOffline(true);await page.getByRole('button',{name:'Update app',exact:true}).click();await page.getByRole('status').filter({hasText:'Connect to the internet'}).waitFor();assert.equal(await page.getByRole('button',{name:'Update app',exact:true}).isEnabled(),true);assert.equal(await page.getByRole('slider',{name:'Warmth',exact:true}).inputValue(),'100');
 assert.deepEqual(errors,[]);console.log('PASS offline update fails safely without clearing files or edits');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
