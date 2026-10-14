import {chromium} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const bridgeMock=`
 export const Capacitor={getPlatform:()=>window.__platform,convertFileSrc:value=>value};
 export const registerPlugin=name=>new Proxy({}, {get:(_,method)=>options=>window.__nativeCall(name,method,options)});
`;
const bundle=await build({
 stdin:{contents:`import {saveAndroidCameraCapture,replaceAndroidCameraCapture,probeAndroidSources,deleteAndroidCameraCapture} from './src/native';export {saveAndroidCameraCapture,replaceAndroidCameraCapture,probeAndroidSources,deleteAndroidCameraCapture};`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},
 bundle:true,write:false,format:'iife',globalName:'CameraSaveCheck',platform:'browser',
 plugins:[{name:'capacitor-bridge-mock',setup(build){build.onResolve({filter:/^@capacitor\/core$/},()=>({path:'capacitor-bridge-mock',namespace:'camera-save-check'}));build.onLoad({filter:/.*/,namespace:'camera-save-check'},()=>({contents:bridgeMock,loader:'js'}));}}]
});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();
 await page.addInitScript(()=>{
  window.__platform='android';window.__captureCalls=[];window.__writes=[];window.__finishes=[];window.__updates=[];window.__failChunk=-1;window.__probeResponse={};let uuid=0;
  Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>`test-uuid-${++uuid}`});
  window.__nativeCall=async(plugin,method,options)=>{
   if(plugin!=='ClearWaterFiles')throw new Error(`Unexpected native plugin ${plugin}.${method}`);
   window.__captureCalls.push({method,options});
   if(method==='createCapture')return {uri:`content://capture/${window.__captureCalls.length}`,name:options.name,destination:`Pictures/ClearWater/${options.name}`};
   if(method==='beginWrite')return {id:`write-${window.__captureCalls.filter(call=>call.method==='beginWrite').length}`};
   if(method==='beginCameraUpdate'){window.__updates.push({uri:options.uri});return {id:`update-${window.__updates.length}`};}
   if(method==='probeAndroidSources')return window.__probeResponse;
   if(method==='deleteCameraCapture')return {};
   if(method==='writeChunk'){
    const index=window.__writes.length;window.__writes.push({id:options.id,data:options.data});
    if(index===window.__failChunk){window.__failChunk=-1;throw new Error('Simulated native write failure.');}
    return {};
   }
   if(method==='finishWrite'){window.__finishes.push(options);return {};}
   throw new Error(`Unexpected native method ${method}`);
  };
 });
 await page.goto('about:blank');
 await page.addScriptTag({content:bundle.outputFiles[0].text});

 const result=await page.evaluate(async()=>{
  const makeFile=(size,type,seed)=>{const bytes=new Uint8Array(size);for(let i=0;i<size;i++)bytes[i]=(i*31+seed)%256;return {file:new File([bytes],type==='video/mp4'?'source.mp4':'source.jpg',{type}),expected:Array.from(bytes,byte=>String.fromCharCode(byte)).join('')};};
  const encodedWrites=(calls,id)=>calls.filter(call=>call.id===id).map(call=>atob(call.data)).join('');
  const jpeg=makeFile(600001,'image/jpeg',17);const jpegResult=await CameraSaveCheck.saveAndroidCameraCapture(jpeg.file);
  const jpegCapture=window.__captureCalls.find(call=>call.method==='createCapture');
  const jpegWrites=encodedWrites(window.__writes,'write-1');
  const mp4=makeFile(900001,'video/mp4',83);await CameraSaveCheck.saveAndroidCameraCapture(mp4.file);
  const mp4Capture=window.__captureCalls.filter(call=>call.method==='createCapture')[1];
  const mp4Writes=encodedWrites(window.__writes,'write-2');
  window.__failChunk=window.__writes.length;
  const broken=makeFile(8000,'image/jpeg',109);let writeFailure='';try{await CameraSaveCheck.saveAndroidCameraCapture(broken.file);}catch(error){writeFailure=error.message;}
  const captureCount=window.__captureCalls.filter(call=>call.method==='createCapture').length;
  const originalUri='content://media/existing-owned-capture';const replacement=makeFile(300007,'image/jpeg',44);await CameraSaveCheck.replaceAndroidCameraCapture(originalUri,new Blob([new Uint8Array(300007).fill(44)],{type:'image/jpeg'}));
  const replacementWrites=encodedWrites(window.__writes,'update-1');
  window.__failChunk=window.__writes.length;let replaceFailure='';try{await CameraSaveCheck.replaceAndroidCameraCapture(originalUri,new Blob([new Uint8Array([1,2,3])],{type:'image/jpeg'}));}catch(error){replaceFailure=error.message;}
  window.__probeResponse={states:{'content://one':'present','content://two':'missing','content://three':'unavailable','content://four':'trashed','content://five':'bogus'}};
  const probed=await CameraSaveCheck.probeAndroidSources(['content://one','content://two','content://three','content://four','content://five','content://unknown','content://one']);
  const probeCall=window.__captureCalls.find(call=>call.method==='probeAndroidSources');
  await CameraSaveCheck.deleteAndroidCameraCapture(originalUri);const deleteCall=window.__captureCalls.find(call=>call.method==='deleteCameraCapture');
  const invalid=[];
  for(const [file,label] of [[new File([], 'empty.jpg',{type:'image/jpeg'}),'empty'],[new File([new Uint8Array([1])],'bad.png',{type:'image/png'}),'type']]){
   try{await CameraSaveCheck.saveAndroidCameraCapture(file);invalid.push({label,error:''});}catch(error){invalid.push({label,error:error.message});}
  }
  window.__platform='web';let nonAndroid='';try{await CameraSaveCheck.saveAndroidCameraCapture(new File([new Uint8Array([1])],'photo.jpg',{type:'image/jpeg'}));}catch(error){nonAndroid=error.message;}
  return {jpegResult,jpegType:jpegCapture.options.type,jpegName:jpegCapture.options.name,jpegMatches:jpegWrites===jpeg.expected,jpegChunks:window.__writes.filter(c=>c.id==='write-1').length,mp4Type:mp4Capture.options.type,mp4Name:mp4Capture.options.name,mp4Matches:mp4Writes===mp4.expected,mp4Chunks:window.__writes.filter(c=>c.id==='write-2').length,finishes:window.__finishes,updates:window.__updates,replacementMatches:replacementWrites===Array.from(new Uint8Array(300007).fill(44),byte=>String.fromCharCode(byte)).join(''),replaceFailure,probed,probeCall,deleteCall,createCaptureCount:window.__captureCalls.filter(call=>call.method==='createCapture').length,beginWriteCount:window.__captureCalls.filter(call=>call.method==='beginWrite').length,captureCount,invalid,nonAndroid,writeFailure};
 });
 assert.equal(result.jpegType,'image/jpeg');assert.match(result.jpegName,/\.jpg$/);assert.equal(result.jpegMatches,true);assert.equal(result.jpegChunks,3);
 assert.deepEqual(result.jpegResult,{uri:'content://capture/1',name:result.jpegName,destination:`Pictures/ClearWater/${result.jpegName}`},'save must return the native capture descriptor');
 assert.equal(result.mp4Type,'video/mp4');assert.match(result.mp4Name,/\.mp4$/);assert.equal(result.mp4Matches,true);assert.equal(result.mp4Chunks,4);
 assert.deepEqual(result.finishes.slice(0,2),[{id:'write-1',abort:false},{id:'write-2',abort:false}]);
 assert.deepEqual(result.finishes[2],{id:'write-3',abort:true});assert.equal(result.writeFailure,'Simulated native write failure.');
 assert.equal(result.captureCount,3,'invalid inputs must not create native captures');
 assert.deepEqual(result.updates,[{uri:'content://media/existing-owned-capture'},{uri:'content://media/existing-owned-capture'}]);
 assert.equal(result.replacementMatches,true,'replacement bytes must be staged for the same owned URI');
 assert.equal(result.createCaptureCount,3,'replacement must never create or overwrite a different photo');assert.equal(result.beginWriteCount,3,'replacement must use the camera-update staging session');
 assert.deepEqual(result.finishes.slice(3),[{id:'update-1',abort:false},{id:'update-2',abort:true}]);
 assert.equal(result.replaceFailure,'Simulated native write failure.');
 assert.deepEqual(result.probeCall.options.uris,['content://one','content://two','content://three','content://four','content://five','content://unknown']);
 assert.deepEqual(result.probed,{ 'content://one':'present','content://two':'missing','content://three':'unavailable','content://four':'trashed','content://five':'unavailable','content://unknown':'unavailable'});
 assert.deepEqual(result.deleteCall.options,{uri:'content://media/existing-owned-capture'});
 assert.deepEqual(result.invalid,[{label:'empty',error:'The camera capture is empty.'},{label:'type',error:'Camera captures must be JPEG photos or MP4 videos.'}]);
 assert.equal(result.nonAndroid,'Camera captures can only be saved from the Android app.');
 console.log('PASS Android camera bridge JPEG/MP4 types, exact chunk bytes, commit/abort, and invalid-input rejection.');
}finally{await browser.close();}
