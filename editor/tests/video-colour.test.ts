import {describe,it,expect} from 'vitest';
import {fitColour,applyColour,colourAt,colourHistogram,sampleTimes,bracket,IDENTITY,type ColourNode} from '../src/core/video-colour';
import {videoBitrate,MAX_VIDEO_OUTPUT_BYTES,MAX_VIDEO_SECONDS} from '../src/core/media';
import {makeRecipe,analyse,parseRecipe,renderPixels} from '../src/core/engine';

describe('sampled video colour',()=>{
 const image=new Uint8ClampedArray(4096*4);for(let p=0;p<4096;p++){image[p*4]=(p*37)%256;image[p*4+1]=(p*79+19)%256;image[p*4+2]=(p*13+97)%256;image[p*4+3]=255;}
 it('fits a spatially independent colour change, preserving alpha and unseen colours',()=>{
  const residual=new Float32Array(4096*3);for(let p=0;p<4096;p++){residual[p*3]=image[p*4]/255*-.25+.1;residual[p*3+1]=image[p*4+1]/255*-.1;residual[p*3+2]=image[p*4+2]/255*-.2;}
  const matrix=fitColour(image,residual),pixel=new Uint8ClampedArray([80,140,200,127]),output=applyColour(pixel,matrix);
  expect(output[0]).toBeCloseTo(86, -1);expect(Math.abs(output[1]-126)).toBeLessThan(5);expect(Math.abs(output[2]-160)).toBeLessThan(5);expect(output[3]).toBe(127);
 });
 it('is stable on monochrome frames and identity model output',()=>{
  const grey=new Uint8ClampedArray(400).fill(80),matrix=fitColour(grey,new Float32Array(300));expect(matrix.every(Number.isFinite)).toBe(true);
  const out=applyColour(image,matrix);expect(Math.max(...out.map((v,i)=>Math.abs(v-image[i])))).toBeLessThanOrEqual(1);
 });
 it('blends gradual changes but chooses the matching scene at cuts',()=>{
  const left:ColourNode={time:0,matrix:[...IDENTITY],histogram:colourHistogram(image)},right:ColourNode={time:10,matrix:IDENTITY.map(v=>v*.8),histogram:colourHistogram(image)};
  expect(colourAt(left,right,5,image)[0]).toBeCloseTo(.9);
  const black=new Uint8ClampedArray(image.length);const white=new Uint8ClampedArray(image.length).fill(255);
  left.histogram=colourHistogram(black);right.histogram=colourHistogram(white);
  expect(colourAt(left,right,5,black)).toEqual(left.matrix);expect(colourAt(left,right,5,white)).toEqual(right.matrix);
 });
 it('covers the end of a ten-minute clip and budgets video plus audio below the buffer limit',()=>{
  const times=sampleTimes(600,5);expect(times.length).toBe(121);expect(bracket(times,599)).toEqual([595,599.999]);expect(bracket([42],100)).toEqual([42,42]);expect(MAX_VIDEO_SECONDS).toBe(600);
  expect((videoBitrate(600)+256000)*600/8).toBeLessThan(MAX_VIDEO_OUTPUT_BYTES*.81);expect(videoBitrate(2)).toBe(8000000);
 });
 it('persists validated settings and leaves strength zero identical to the original',()=>{
  const recipe=makeRecipe(analyse(image,64,64));recipe.engine='shallow';recipe.videoCorrection={mode:'sampled',interval:5,referenceTime:42};recipe.strength=0;
  expect(parseRecipe(recipe).videoCorrection).toEqual(recipe.videoCorrection);expect(renderPixels(image,recipe,applyColour(image,IDENTITY))).toEqual(image);
  expect(()=>parseRecipe({...recipe,videoCorrection:{mode:'sampled',interval:0,referenceTime:0}})).toThrow();
 });
});
