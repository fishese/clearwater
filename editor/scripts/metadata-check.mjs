import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import piexif from 'piexifjs';
import exifr from 'exifr';
const {parse}=exifr;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.CHECK_URL??'http://127.0.0.1:5173/');
 const jpg=Buffer.from(await page.evaluate(async()=>{const c=new OffscreenCanvas(64,32),ctx=c.getContext('2d');ctx.fillStyle='#298080';ctx.fillRect(0,0,64,32);return Array.from(new Uint8Array(await (await c.convertToBlob({type:'image/jpeg'})).arrayBuffer()));}));
 const exif=Buffer.from(piexif.dump({'0th':{271:'Synthetic DiveCam',274:6,315:'Test author'},Exif:{36867:'2026:10:01 12:34:56',33434:[1,125]},GPS:{1:'S',2:[[33,1],[12,1],[123456,10000]],3:'E',4:[[151,1],[9,1],[365432,10000]]}}),'binary');
 const header=Buffer.from([255,225,(exif.length+2)>>>8,(exif.length+2)&255]);
 const original=Buffer.concat([jpg.subarray(0,2),header,exif,jpg.subarray(2)]);
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'metadata-test.jpg',mimeType:'image/jpeg',buffer:original});
 await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 const keep=page.getByRole('checkbox',{name:'Keep EXIF/GPS metadata'});assert.equal(await keep.isChecked(),true);
 async function exportFile(){const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download instead',exact:true}).click();const d=await download;return await readFile(await d.path());}
 let output=await exportFile(),data=await parse(output,{translateValues:false,reviveValues:false});
 assert.equal(data.Make,'Synthetic DiveCam');assert.equal(data.DateTimeOriginal,'2026:10:01 12:34:56');assert.equal(data.Orientation,1);assert.equal(data.ExifImageWidth,32);assert.equal(data.ExifImageHeight,64);assert.ok(data.latitude<0);
 const dimensions=await page.evaluate(async a=>{const b=await createImageBitmap(new Blob([new Uint8Array(a)],{type:'image/jpeg'}));return [b.width,b.height];},Array.from(output));assert.deepEqual(dimensions,[32,64]);
 await page.getByRole('combobox',{name:'File format'}).selectOption('png');output=await exportFile();data=await parse(output);assert.equal(data.Make,'Synthetic DiveCam');assert.ok(data.latitude<0);
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'roundtrip.png',mimeType:'image/png',buffer:output});await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);
 await page.getByRole('combobox',{name:'File format'}).selectOption('jpg');output=await exportFile();assert.equal((await parse(output)).Make,'Synthetic DiveCam');
 await keep.uncheck();output=await exportFile();data=await parse(output);assert.equal(data?.Make,undefined);assert.equal(data?.latitude,undefined);assert.equal(data?.DateTimeOriginal,undefined);
 await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'plain.jpg',mimeType:'image/jpeg',buffer:jpg});await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false);await keep.check();output=await exportFile();data=await parse(output);assert.equal(data?.latitude,undefined);assert.equal(data?.Make,undefined);
 if(process.env.SAMPLE_HEIC){
  const input=await readFile(process.env.SAMPLE_HEIC),expected=await parse(input,{translateValues:false,reviveValues:false});
  await page.getByLabel('Choose photos',{exact:true}).setInputFiles({name:'camera-sample.heic',mimeType:'image/heic',buffer:input});
  await page.waitForFunction(()=>document.querySelector('.top-actions .primary')?.disabled===false,{},{timeout:60000});
  output=await exportFile();data=await parse(output,{translateValues:false,reviveValues:false});
  for(const tag of ['Make','Model','DateTimeOriginal','OffsetTimeOriginal'])if(expected[tag]!==undefined)assert.equal(data[tag],expected[tag],tag);
  for(const tag of ['latitude','longitude'])if(Number.isFinite(expected[tag]))assert.ok(Math.abs(data[tag]-expected[tag])<0.000001,tag);
  console.log('PASS local HEIC camera sample capture metadata and available GPS (values kept private)');
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS worker JPEG/PNG metadata, orientation, round trip, opt-out, absent metadata and mobile layout');
}finally{await browser.close();}
