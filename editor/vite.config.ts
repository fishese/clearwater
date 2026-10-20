import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function workerManualChunk(id:string):string|undefined {
  const normalized=id.replaceAll('\\','/');
  if(normalized.endsWith('/src/core/bundled-models.ts')||normalized.endsWith('/src/core/model-contract.ts'))return 'model-metadata';
}

// Local development convenience only. Never copy personal samples into dist.
function localSamples():Plugin {
  return { name:'local-samples', configureServer(server) {
    const folder=resolve(import.meta.dirname,'../Sample photos');
    const names=existsSync(folder)?readdirSync(folder).filter(n=>/\.(heic|heif|jpe?g|png)$/i.test(n)):[];
    server.middlewares.use((req,res,next)=>{
      const path=(req.url??'').split('?')[0];
      if(path==='/__samples') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(names));return;}
      const thumb=path.startsWith('/__thumb/'),source=path.startsWith('/__sample/');
      if(!thumb&&!source) {next();return;}
      let name=''; try{name=decodeURIComponent(path.slice(thumb?9:10));}catch{res.statusCode=400;res.end();return;}
      if(!names.includes(name)) {res.statusCode=404;res.end();return;}
      const file=thumb?resolve(import.meta.dirname,'../analysis/previews',name+'.jpg'):resolve(folder,name);
      if(!existsSync(file)){res.statusCode=404;res.end();return;}
      res.setHeader('Content-Type',thumb||/\.jpe?g$/i.test(name)?'image/jpeg':/\.png$/i.test(name)?'image/png':'image/heic');
      res.setHeader('Cache-Control','no-store');
      createReadStream(file).on('error',()=>{res.statusCode=500;res.end();}).pipe(res);
    });
  }};
}
export default defineConfig({base:process.env.VITE_BASE_PATH || '/',plugins:[react(),localSamples()],worker:{format:'es',rollupOptions:{output:{manualChunks:workerManualChunk}}},server:{host:'127.0.0.1',port:5173,strictPort:true,fs:{strict:true},watch:{ignored:['**/android/**']}},build:{target:'es2022'}});
