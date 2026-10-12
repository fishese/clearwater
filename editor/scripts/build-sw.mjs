import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const base=process.env.VITE_BASE_PATH || '/';
const files=[];
async function scan(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+'/'+entry.name;if(entry.isDirectory())await scan(join(dir,entry.name),name);else if(entry.name!=='sw.js')files.push(name);}}
await scan('dist');
const hash=createHash('sha256');for(const file of files)hash.update(await readFile('dist'+file));
const template=await readFile('scripts/sw.template.js','utf8');
const optional=files.filter(f=>f.endsWith('.onnx')||f.endsWith('.wasm'));
await writeFile('dist/sw.js',template.replace('__CACHE_NAME__','clearwater-'+createHash('sha256').update(base).digest('hex').slice(0,8)+'-'+hash.digest('hex').slice(0,12)).replace('__BASE__',JSON.stringify(base)).replace('__PRECACHE__',JSON.stringify([base,...files.filter(f=>!optional.includes(f)).map(f=>base+f.slice(1))])).replace('__OPTIONAL__',JSON.stringify(optional.map(f=>base+f.slice(1)))));
console.log(`Offline worker generated for ${files.length} assets.`);
