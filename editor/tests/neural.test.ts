import {describe,it,expect} from 'vitest';
import {analyse,makeRecipe,parseRecipe,renderPixels,suggest} from '../src/core/engine';
import {transferField} from '../src/core/neural-field';
import {DEFAULT_HINTS} from '../src/core/types';

describe('AI finishing pipeline',()=>{
  const input=new Uint8ClampedArray([50,100,150,255,60,110,160,255,70,120,170,255,80,130,180,255]);
  it('keeps source detail, alpha, and global coordinates across export strips',()=>{
    const field=new Float32Array([.1,0,0,.1,0,0,.2,0,0,.2,0,0]);
    const full=transferField(input,2,2,field,2);
    const top=transferField(input.slice(0,8),2,1,field,2,0,2);
    const bottom=transferField(input.slice(8),2,1,field,2,1,2);
    const corner=transferField(input.slice(12),1,1,field,2,1,2,1,2);
    expect([...top,...bottom]).toEqual([...full]);
    expect([...corner]).toEqual([...full.slice(12)]);
    expect(full[4]-full[0]).toBe(10);
    expect(full[3]).toBe(255);
  });
  for(const engine of ['shallow','funie','wave'] as const)it(`${engine}: zero strength, manual refinement and recipe persistence`,()=>{
    const a=analyse(input,2,2),recipe=makeRecipe(a);
    recipe.engine=engine;recipe.auto=suggest(a,recipe.hints,engine);
    const base=transferField(input,2,2,new Float32Array(12).fill(.1),2);
    recipe.strength=0;
    const zero=renderPixels(input,recipe,base);
    zero.forEach((v,i)=>expect(Math.abs(v-input[i])).toBeLessThanOrEqual(1));
    recipe.strength=1;
    const enhanced=renderPixels(input,recipe,base);
    expect(enhanced[0]).toBeGreaterThan(input[0]);
    recipe.manual.exposure=-1;
    expect(renderPixels(input,recipe,base)[0]).toBeLessThan(enhanced[0]);
    expect(parseRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
    expect(()=>renderPixels(input,recipe)).toThrow('AI correction is not ready');
  });
  it('keeps the optional follow-up disabled by default and makes it a separate, alpha-safe pass',()=>{
    const a=analyse(input,2,2),recipe=makeRecipe(a);recipe.engine='shallow';recipe.strength=.8;
    const ai=new Uint8ClampedArray([120,90,70,255,115,95,75,127,110,100,80,0,105,105,85,255]);
    const alphaInput=input.slice();alphaInput[7]=127;alphaInput[11]=0;
    const off=renderPixels(alphaInput,recipe,ai);
    expect(renderPixels(alphaInput,recipe,ai,undefined)).toEqual(off);
    recipe.balancedAfterAI={strength:.3};
    const suggestion=suggest(analyse(ai,2,2),{...DEFAULT_HINTS,filter:'yes'},'balanced');
    const followed=renderPixels(alphaInput,recipe,ai,suggestion);
    expect(followed).not.toEqual(off);expect(followed[3]).toBe(255);expect(followed[7]).toBe(127);expect(followed[11]).toBe(0);
    expect(renderPixels(alphaInput,recipe,ai,suggestion)).toEqual(followed);
  });
  it('uses dive hints for the post-AI Balanced suggestion and reuses it across strips',()=>{
    const image=new Uint8ClampedArray([...input,...input]),a=analyse(input,2,2),recipe=makeRecipe(a);
    recipe.engine='wwe';recipe.balancedAfterAI={strength:.3};
    const ai=new Uint8ClampedArray([...input,...input].map((v,i)=>i%4===3?v:Math.max(0,v-25)));
    const analysis=analyse(ai,2,4),underwater=suggest(analysis,{...DEFAULT_HINTS,scene:'underwater',water:'green'},'balanced');
    const filtered=suggest(analysis,{...DEFAULT_HINTS,scene:'surface',filter:'yes'},'balanced');
    const full=renderPixels(image,recipe,ai,underwater),first=renderPixels(image.slice(0,16),recipe,ai.slice(0,16),underwater),second=renderPixels(image.slice(16),recipe,ai.slice(16),underwater);
    expect(underwater).not.toEqual(filtered);expect(full).toEqual(new Uint8ClampedArray([...first,...second]));
  });
  it('validates optional Balanced after AI recipe settings and keeps older recipes valid',()=>{
    const recipe=makeRecipe(analyse(input,2,2));
    expect(parseRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
    expect(parseRecipe({...recipe,balancedAfterAI:{strength:.3}}).balancedAfterAI).toEqual({strength:.3});
    expect(()=>parseRecipe({...recipe,balancedAfterAI:{strength:Infinity}})).toThrow('Invalid Balanced after AI settings.');
    expect(()=>parseRecipe({...recipe,balancedAfterAI:[]})).toThrow('Invalid Balanced after AI settings.');
  });
});
