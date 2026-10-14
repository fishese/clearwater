import {describe,expect,it} from 'vitest';
import {analyse,makeRecipe,renderPixels} from '../src/core/engine';
import {pickNeutralFromPixels} from '../src/core/white-balance';

describe('neutral point replacement',()=>{
 it('replaces severe clipped gains from the original white patch',()=>{
  const source=new Uint8ClampedArray([30,120,180,255]),white=new Uint8ClampedArray([130,130,130,255]);
  const recipe=makeRecipe(analyse(source,1,1));recipe.strength=0;
  const first=pickNeutralFromPixels(source,recipe)!;first.manual.neutral=[4,1,1];
  expect(renderPixels(white,first)[0]).toBe(255);
  const replacement=pickNeutralFromPixels(white,first);
  expect(replacement?.manual.neutral).toEqual([1,1,1]);
  expect(pickNeutralFromPixels(white,recipe)?.manual.neutral).toEqual(replacement?.manual.neutral);
 });

 it('keeps other edits and balances an AI corrected sample with warmth, tint and red edits active',()=>{
  const pixels=new Uint8ClampedArray([80,130,110,255]),neuralBase=new Uint8ClampedArray([90,110,120,255]);
  const recipe=makeRecipe(analyse(pixels,1,1));recipe.engine='wwe';recipe.strength=1;
  recipe.manual={...recipe.manual,neutral:[2,.8,1.4],exposure:.4,warmth:12,tint:8,red:22,vibrance:22};
  const before={...recipe.manual},picked=pickNeutralFromPixels(pixels,recipe,neuralBase)!;
  expect({...picked.manual,neutral:before.neutral}).toEqual(before);
  const balanced=renderPixels(pixels,picked,neuralBase),channels=[balanced[0],balanced[1],balanced[2]];
  expect(Math.max(...channels)-Math.min(...channels)).toBeLessThanOrEqual(1);
 });
});
