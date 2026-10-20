import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {catalogs,detectLanguage,translate,translateMessage} from '../src/i18n-core';

function parseJsonWithoutDuplicateKeys(source:string):unknown{
 JSON.parse(source);
 let index=0;
 const whitespace=()=>{while(/\s/.test(source[index]??''))index++;};
 const string=()=>{
  const start=index++;
  while(index<source.length){
   if(source[index]==='\\'){index+=2;continue;}
   if(source[index++]==='"')return JSON.parse(source.slice(start,index)) as string;
  }
  throw new Error('Unterminated JSON string');
 };
 const value=():void=>{
  whitespace();
  if(source[index]==='{'){
   index++;
   const keys=new Set<string>();
   whitespace();
   if(source[index]==='}'){index++;return;}
   while(true){
    whitespace();
    const key=string();
    if(keys.has(key))throw new Error(`Duplicate JSON object key: ${key}`);
    keys.add(key);
    whitespace();index++;
    value();
    whitespace();
    if(source[index]==='}'){index++;return;}
    index++;
   }
  }
  if(source[index]==='['){
   index++;
   whitespace();
   if(source[index]===']'){index++;return;}
   while(true){
    value();whitespace();
    if(source[index]===']'){index++;return;}
    index++;
   }
  }
  if(source[index]==='"'){string();return;}
  while(index<source.length&&!/[\s,}\]]/.test(source[index]))index++;
 };
 value();
 return JSON.parse(source) as unknown;
}

describe('localisation',()=>{
 it('rejects duplicate keys in locale JSON files',()=>{
  expect(()=>parseJsonWithoutDuplicateKeys('{"outer":{"label":"first","label":"second"}}')).toThrow('Duplicate JSON object key: label');
  for(const language of ['en','zh-HK','ja'] as const){
   const source=readFileSync(new URL(`../src/locales/${language}.json`,import.meta.url),'utf8');
   expect(()=>parseJsonWithoutDuplicateKeys(source)).not.toThrow();
  }
 });
 it('covers every source key and preserves interpolation placeholders',()=>{
  const keys=Object.keys(catalogs.en).sort();
  for(const language of ['zh-HK','ja'] as const){
   expect(Object.keys(catalogs[language]).sort()).toEqual(keys);
   for(const key of keys){expect(catalogs[language][key].trim()).not.toBe('');expect(catalogs[language][key].match(/\{\d+\}/g)?.sort()??[]).toEqual(key.match(/\{\d+\}/g)?.sort()??[]);}
  }
  for(const file of ['App.tsx','About.tsx','Settings.tsx','OfflineModels.tsx','Camera.tsx','i18n.tsx']){
   const source=ts.createSourceFile(file,readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
   const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))expect(keys).toContain(node.arguments[0].text);ts.forEachChild(node,visit);};visit(source);
  }
 });
 it('uses browser preference order with a predictable English fallback',()=>{
  expect(detectLanguage(['fr','ja-JP','en'])).toBe('ja');
  expect(detectLanguage(['zh-Hant-HK'])).toBe('zh-HK');
  expect(detectLanguage(['en-GB','ja'])).toBe('en');
  expect(detectLanguage(['fr'])).toBe('en');
 });
 it('substitutes filenames literally, never as markup or replacement syntax',()=>{
  expect(translate('zh-HK','Saved {0}.',['<photo>$&.jpg'])).toBe('已儲存 <photo>$&.jpg。');
  expect(translate('ja','Unknown diagnostic')).toBe('Unknown diagnostic');
 });
 it('localises variable worker diagnostics and retained English recipe explanations',()=>{
  expect(translateMessage('ja','Loading and running Shallow-UWnet…')).toBe('Shallow-UWnet を読み込み・実行中…');
  expect(translateMessage('zh-HK','Video clips can be up to 10 minutes long.')).toBe('影片長度上限為 10 分鐘。');
  expect(translateMessage('zh-HK','Video is 10:01 long. Max: 10:00. Trim it into shorter clips.')).toBe('影片長度為 10:01，上限為 10:00。請先剪成較短片段。');
  expect(translateMessage('ja','Photo is 600 MB. Max on this device: 512 MB.')).toBe('写真は 600 MB、この端末の上限は 512 MB です。');
  expect(translateMessage('ja','OS error 123')).toBe('OS error 123');
 });
});
