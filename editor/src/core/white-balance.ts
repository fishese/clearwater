import { renderPixels } from './engine';
import { DEFAULT_MANUAL, type Recipe, type Suggestion } from './types';

/** Replace the neutral gains from a patch rendered before manual white balance. */
export function pickNeutralFromPixels(pixels:Uint8ClampedArray,recipe:Recipe,neuralBase?:Uint8ClampedArray,balancedAfterAI?:Suggestion):Recipe|null {
  const preNeutral:Recipe={...recipe,manual:structuredClone(DEFAULT_MANUAL)};
  const corrected=renderPixels(pixels,preNeutral,neuralBase,balancedAfterAI),mean=[0,0,0];let count=0;
  for(let i=0;i<corrected.length;i+=4){if(corrected[i+3]===0)continue;for(let c=0;c<3;c++)mean[c]+=corrected[i+c];count++;}
  if(!count)return null;
  for(let c=0;c<3;c++)mean[c]/=count;
  if(mean.some(v=>v<8||v>245))return null;
  const target=(mean[0]+mean[1]+mean[2])/3,m=recipe.manual,next=structuredClone(recipe);
  const warmth=m.warmth/100,tint=m.tint/100,red=m.red/100;
  const otherGains=[2**(warmth*.45+red*.8),2**(-tint*.4),2**(-warmth*.45)];
  next.manual.neutral=mean.map((v,c)=>Math.max(.25,Math.min(4,target/v/otherGains[c]))) as [number,number,number];
  return next;
}
