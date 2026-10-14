import {spawnSync} from 'node:child_process';
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
