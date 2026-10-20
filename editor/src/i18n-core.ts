import en from './locales/en.json';
import zh from './locales/zh-HK.json';
import ja from './locales/ja.json';

export type Language='en'|'zh-HK'|'ja';
export const catalogs:Record<Language,Record<string,string>>={en,'zh-HK':zh,ja};
export function detectLanguage(languages:readonly string[]):Language {
 for(const language of languages){const tag=language.toLowerCase();if(tag.startsWith('ja'))return 'ja';if(tag.startsWith('zh'))return 'zh-HK';if(tag.startsWith('en'))return 'en';}
 return 'en';
}
const namedPlaceholder=/\{(?:actual|limit)\}/;
const anyPlaceholder=/\{(?:\d+|actual|limit)\}/;
export function translate(language:Language,key:string,values:readonly unknown[]=[]):string {
 const text=catalogs[language][key]??catalogs.en[key]??key;
 if(namedPlaceholder.test(key)){
  const names=[...key.matchAll(/\{(actual|limit)\}/g)].map(match=>match[1]);
  const map=new Map<string,unknown>();
  names.forEach((name,index)=>{if(!map.has(name))map.set(name,values[index]);});
  return text.replace(/\{(actual|limit)\}/g,(placeholder,name)=>map.get(name)===undefined?placeholder:String(map.get(name)));
 }
 return text.replace(/\{(\d+)\}/g,(placeholder,index)=>values[Number(index)]===undefined?placeholder:String(values[Number(index)]));
}

// Workers and native bridges retain English diagnostics. Localise known messages at
// presentation, including variable model names, without translating user filenames.
const patterns=Object.keys(en).filter(key=>anyPlaceholder.test(key)).map(key=>({key,pattern:new RegExp('^'+key.split(/(\{(?:\d+|actual|limit)\})/).map(part=>/^\{(?:\d+|actual|limit)\}$/.test(part)?'(.+?)':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$')}));
export function translateMessage(language:Language,text:string):string {
 if(catalogs.en[text])return translate(language,text);
 for(const {key,pattern} of patterns){const match=text.match(pattern);if(match)return translate(language,key,match.slice(1));}
 const prefix='Could not develop this DNG. Its compression or camera variant may be unsupported, or device memory may be insufficient. Try Reduced resolution. ';
 if(text.startsWith(prefix))return translate(language,prefix.trim())+' '+translateMessage(language,text.slice(prefix.length));
 return text; // Keep unknown OS/codec/library details useful for diagnosis.
}
