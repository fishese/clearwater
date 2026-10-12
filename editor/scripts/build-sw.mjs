import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const files=[];
async function scan(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+'/'+entry.name;if(entry.isDirectory())await scan(join(dir,entry.name),name);else if(entry.name!=='sw.js')files.push(name);}}
await scan('dist');
const hash=createHash('sha256');for(const file of files)hash.update(await readFile('dist'+file));
const template=await readFile('scripts/sw.template.js','utf8');
await writeFile('dist/sw.js',template.replace('__CACHE_NAME__','clearwater-'+hash.digest('hex').slice(0,12)).replace('__PRECACHE__',JSON.stringify(['/',...files])));
console.log(`Offline worker generated for ${files.length} assets.`);
