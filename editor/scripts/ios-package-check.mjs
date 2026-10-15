import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';

function fail(message){console.error(`iOS package check failed: ${message}`);process.exit(1);}
function arg(name){const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];}
function run(command,args){try{return execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch(error){fail(`${command} ${args.join(' ')}: ${error.stderr?.toString().trim()||error.message}`);}}
function allFiles(path){const result=[];if(!existsSync(path))return result;for(const item of readdirSync(path,{withFileTypes:true})){const full=join(path,item.name);if(item.isDirectory())result.push(...allFiles(full));else result.push(full);}return result;}
function checkApp(app){
 app=resolve(app);
 if(!['App.app','ClearWater.app'].includes(basename(app)))fail(`expected an App.app or ClearWater.app bundle, got ${app}`);
 const plist=join(app,'Info.plist');if(!existsSync(plist))fail(`missing ${plist}`);
 const info=JSON.parse(run('plutil',['-convert','json','-o','-',plist]));
 if(info.CFBundleIdentifier!=='com.fishese.clearwater')fail(`unexpected bundle ID ${info.CFBundleIdentifier}`);
 if(info.CFBundleDisplayName!=='ClearWater')fail('display name must be ClearWater');
 if(info.MinimumOSVersion!=='26.0')fail(`deployment target must be 26.0, got ${info.MinimumOSVersion}`);
 for(const key of ['NSCameraUsageDescription','NSMicrophoneUsageDescription','NSPhotoLibraryAddUsageDescription'])if(!info[key])fail(`missing ${key} in Info.plist`);
 const executable=join(app,info.CFBundleExecutable);if(!existsSync(executable))fail(`missing app executable ${executable}`);
 const binary=readFileSync(executable);
 for(const plugin of ['ClearWaterExportPlugin','ClearWaterCameraPlugin'])if(!binary.includes(Buffer.from(plugin)))fail(`native ${plugin} is missing from the compiled app`);
 const metalLibrary=join(app,'default.metallib');
 if(!existsSync(metalLibrary)||statSync(metalLibrary).size===0)fail('missing compiled Balanced Metal library');
 const archs=run('lipo',['-archs',executable]).split(/\s+/);if(!archs.includes('arm64'))fail(`app executable lacks arm64 (${archs.join(', ')})`);
 const build=run('xcrun',['vtool','-show-build',executable]);if(!/^\s*platform IOS\s*$/m.test(build))fail(`app executable is not built for physical iOS: ${build}`);
 const web=join(app,'public'),html=join(web,'index.html');if(!existsSync(html))fail('missing bundled public/index.html');
 if(!/\b(?:src|href)="\/assets\//.test(readFileSync(html,'utf8')))fail('index.html does not use root-relative asset paths');
 for(const model of ['shallow','funie','wwe'])if(!existsSync(join(web,'models',`${model}.onnx`)))fail(`missing bundled ${model}.onnx model`);
 const webFiles=allFiles(web);
 for(const asset of ['ort-wasm-simd-threaded.wasm','ort-wasm-simd-threaded.mjs','libraw.wasm']){
  const dot=asset.lastIndexOf('.'),stem=asset.slice(0,dot),ext=asset.slice(dot);
  if(!webFiles.some(file=>basename(file).startsWith(`${stem}-`)&&basename(file).endsWith(ext)))fail(`missing bundled ${asset}`);
 }
 for(const locale of ['en','zh-HK','ja']){
  const strings=join(app,`${locale}.lproj`,'InfoPlist.strings');if(!existsSync(strings))fail(`missing ${locale} permission localization`);
  const localized=JSON.parse(run('plutil',['-convert','json','-o','-',strings]));
  for(const key of ['NSCameraUsageDescription','NSMicrophoneUsageDescription','NSPhotoLibraryAddUsageDescription'])if(!localized[key])fail(`${locale} localization is missing ${key}`);
 }
 console.log(`Validated unsigned arm64 native camera app: ${app}`);
}

const app=arg('--app'),ipa=arg('--ipa');
if(!app&&!ipa)fail('pass --app <ClearWater.app> and optionally --ipa <file.ipa>');
if(app)checkApp(app);
if(ipa){
 const archive=resolve(ipa);if(!existsSync(archive)||statSync(archive).size===0)fail(`missing or empty IPA ${archive}`);
 const entries=run('unzip',['-Z1',archive]).split(/\r?\n/);
 if(!entries.includes('Payload/ClearWater.app/Info.plist'))fail('IPA lacks Payload/ClearWater.app/Info.plist');
 if(!entries.some(path=>path.startsWith('Payload/ClearWater.app/public/models/')))fail('IPA lacks bundled model assets');
 const extracted=mkdtempSync(join(tmpdir(),'clearwater-ipa-check-'));
 try{run('unzip',['-q',archive,'-d',extracted]);checkApp(join(extracted,'Payload','ClearWater.app'));}
 finally{rmSync(extracted,{recursive:true,force:true});}
 console.log(`Validated IPA archive structure: ${archive}`);
}
