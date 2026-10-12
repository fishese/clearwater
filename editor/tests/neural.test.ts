import {describe,it,expect} from 'vitest';
import {analyse,makeRecipe,parseRecipe,renderPixels,suggest} from '../src/core/engine';
import {transferField} from '../src/core/neural-field';

describe('AI finishing pipeline',()=>{
  const input=new Uint8ClampedArray([50,100,150,255,60,110,160,255,70,120,170,255,80,130,180,255]);
  it('keeps source detail, alpha, and global coordinates across export strips',()=>{
    const field=new Float32Array([.1,0,0,.1,0,0,.2,0,0,.2,0,0]);
    const full=transferField(input,2,2,field,2);
    const top=transferField(input.slice(0,8),2,1,field,2,0,2);
    const bottom=transferField(input.slice(8),2,1,field,2,1,2);
    expect([...top,...bottom]).toEqual([...full]);
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
});
