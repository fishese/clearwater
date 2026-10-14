import {spawnSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function run(args){
 const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{stdio:'inherit',shell:process.platform==='win32',cwd:root,env:{...process.env,VITE_BASE_PATH:'/'}});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
run(['run','build']);
run(['exec','cap','sync','ios']);

// Capacitor 8.5.3 emits a SwiftPM 5.9 manifest, but Xcode 26 deployment
// targets use PackageDescription's .iOS(.v26), which was added in tools 6.2.
const manifest=resolve(root,'ios','App','CapApp-SPM','Package.swift');
let packageSource=await readFile(manifest,'utf8');
if(packageSource.includes('platforms: [.iOS(.v26)]')){
 if(!packageSource.startsWith('// swift-tools-version: 5.9'))throw new Error('Unexpected Capacitor SPM tools version for iOS 26.');
 packageSource=packageSource.replace('// swift-tools-version: 5.9','// swift-tools-version: 6.2');
 await writeFile(manifest,packageSource);
}
