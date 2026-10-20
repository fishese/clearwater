import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';

const assets=resolve(import.meta.dirname,'../dist/assets');
const modules=(await readdir(assets)).filter(name=>/\.(?:js|mjs)$/.test(name)).map(name=>resolve(assets,name));
const workerEntryPattern=/^(?:processor|video|camera-ai)\.worker-[^.]+\.js$/;
const workerEntries=new Set(modules.filter(file=>workerEntryPattern.test(file.split(/[\\/]/).at(-1))));
for(const prefix of ['processor.worker-','video.worker-','camera-ai.worker-']) {
  assert.ok([...workerEntries].some(file=>file.split(/[\\/]/).at(-1).startsWith(prefix)),`missing emitted ${prefix} entry in ${assets}`);
}

function imports(source) {
  const result=new Set();
  const patterns=[
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    /\b(?:import|export)\s*[^'";]*?\bfrom\s*(['"])([^'"]+)\1/g,
    /\bimport\s*(['"])([^'"]+)\1/g,
  ];
  for(const pattern of patterns)for(const match of source.matchAll(pattern))result.add(match[2]);
  return result;
}

function workerPath(start,graph,entries) {
  const seen=new Set();
  const visit=(file,path)=>{
    if(entries.has(file))return path;
    if(seen.has(file))return undefined;
    seen.add(file);
    for(const dependency of graph.get(file)??[]) {
      const result=visit(dependency,[...path,dependency]);
      if(result)return result;
    }
    return undefined;
  };
  return visit(start,[start]);
}

const fixtureRoot=resolve(assets,'.worker-graph-fixture');
const fixtureSources=new Map([
  ['page.js','import{B as ei,a as ti}from"./models.js";'],
  ['models.js','export{inferField}from"./model-metadata.js";'],
  ['model-metadata.js','const load=()=>import("./processor.worker-old.js");'],
  ['processor.worker-old.js','self.onmessage=()=>{};'],
]);
const fixtureGraph=new Map([...fixtureSources].map(([name,source])=>{
  const file=resolve(fixtureRoot,name);
  return [file,[...imports(source)].map(specifier=>resolve(dirname(file),specifier))];
}));
const fixtureEntries=new Set([resolve(fixtureRoot,'processor.worker-old.js')]);
assert.ok(workerPath(resolve(fixtureRoot,'page.js'),fixtureGraph,fixtureEntries),'minified static and transitive dynamic imports must reach the worker entry in the regression fixture');

function resolveLocal(from,specifier) {
  if(!specifier.startsWith('.')&&!specifier.startsWith('/'))return undefined;
  const clean=decodeURIComponent(specifier.split(/[?#]/,1)[0]);
  const candidate=resolve(clean.startsWith('/')?resolve(assets,'..',clean.slice(1)):dirname(from),clean.startsWith('/')?'.':clean);
  if(!isAbsolute(candidate)||relative(assets,candidate).startsWith('..'))return undefined;
  if(modules.includes(candidate))return candidate;
  if(!extname(candidate))for(const extension of ['.js','.mjs'])if(modules.includes(candidate+extension))return candidate+extension;
  return undefined;
}

const graph=new Map();
for(const file of modules) {
  const source=await readFile(file,'utf8');
  graph.set(file,[...imports(source)].map(specifier=>resolveLocal(file,specifier)).filter(Boolean));
}

const violations=[];
for(const file of modules) {
  if(workerEntries.has(file))continue;
  const path=workerPath(file,graph,workerEntries);
  if(path)violations.push(path.map(item=>item.split(/[\\/]/).at(-1)).join(' -> '));
}
assert.deepEqual(violations,[],`non-entry module chunks must not import a worker entry, directly or transitively:\n${violations.join('\n')}`);
console.log(`PASS ${modules.length} emitted JS modules: non-entry chunks do not import processor, video, or camera AI worker entries`);
