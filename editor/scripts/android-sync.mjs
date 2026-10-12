import {spawnSync} from 'node:child_process';
// Android always bundles root-relative assets, independently of the Pages build.
for(const args of [['run','build'],['exec','cap','sync','android']]){
 const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{stdio:'inherit',shell:process.platform==='win32',env:{...process.env,VITE_BASE_PATH:'/'}});
 if(result.status!==0)process.exit(result.status??1);
}
