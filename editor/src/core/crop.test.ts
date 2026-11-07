import {describe,it,expect} from 'vitest';
import {cropBounds,validCrop} from './crop';
import {makePhotoRecipe,parseRecipe} from './engine';

describe('photo crop',()=>{
 it('maps normalized crop edges to bounded source pixels',()=>{
  expect(cropBounds(undefined,128,96)).toEqual({x:0,y:0,width:128,height:96});
  expect(cropBounds({x:.25,y:.125,width:.5,height:.5},128,96)).toEqual({x:32,y:12,width:64,height:48});
  expect(cropBounds({x:.999,y:.999,width:.001,height:.001},10,10)).toEqual({x:9,y:9,width:1,height:1});
 });
 it('rejects unsafe or invalid rectangles while accepting older uncropped recipes',()=>{
  for(const value of [null,{x:-.1,y:0,width:1,height:1},{x:0,y:0,width:0,height:1},{x:.8,y:0,width:.3,height:1},{x:0,y:0,width:NaN,height:1}])expect(validCrop(value)).toBe(false);
  const analysis={mean:[20,40,70] as [number,number,number],neutral:[20,40,70] as [number,number,number],p05:.1,p50:.4,p95:.9,clipping:0,redRatio:.3,magenta:1,confidence:'medium' as const};
  const recipe=makePhotoRecipe(analysis);expect(parseRecipe(recipe).crop).toBeUndefined();
  expect(()=>parseRecipe({...recipe,crop:{x:0,y:0,width:2,height:1}})).toThrow('Invalid crop');
  const cropped={x:.1,y:.2,width:.7,height:.6};expect(parseRecipe({...recipe,crop:cropped}).crop).toEqual(cropped);
 });
});
