import { DEFAULT_HINTS, DEFAULT_MANUAL, type Analysis, type Hints, type Recipe, type Suggestion } from './types';

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (lo: number, hi: number, x: number) => { const t = clamp((x-lo)/(hi-lo)); return t*t*(3-2*t); };
const luminance = (r: number, g: number, b: number) => .2126*r + .7152*g + .0722*b;
const decode = (v: number) => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4;
const encode = (v: number) => v <= .0031308 ? 12.92*v : 1.055*v**(1/2.4)-.055;
const linear = Float32Array.from({length: 4097}, (_,i) => decode(i/4096));
const srgb = Float32Array.from({length: 4097}, (_,i) => encode(i/4096));
const toLinear = (v: number) => linear[Math.round(clamp(v)*4096)];
const toSrgb = (v: number) => srgb[Math.round(clamp(v)*4096)];

/** Display-encoded SDR statistics. Subsample spatially; ignore alpha-zero pixels. */
export function analyse(data: Uint8ClampedArray, width: number, height: number): Analysis {
  const sum=[0,0,0], neutral=[0,0,0], histogram=new Uint32Array(256);
  let count=0, neutralCount=0, clipped=0;
  const step=Math.max(1, Math.floor(Math.max(width,height)/384));
  for(let y=0; y<height; y+=step) for(let x=0; x<width; x+=step) {
    const i=(y*width+x)*4; if(data[i+3]<128) continue;
    const r=data[i],g=data[i+1],b=data[i+2], l=luminance(r,g,b);
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    count++; sum[0]+=r;sum[1]+=g;sum[2]+=b; histogram[Math.round(l)]++;
    if(max>=250) clipped++;
    // Exclude near-black, clipped and strongly chromatic pixels from neutral hints.
    if(l>25 && l<225 && max<248 && (max-min)/Math.max(max,1)<.75) {
      neutralCount++;neutral[0]+=r;neutral[1]+=g;neutral[2]+=b;
    }
  }
  const mean=sum.map(v=>v/Math.max(count,1)) as Analysis['mean'];
  const n=(neutralCount>count*.08 ? neutral.map(v=>v/neutralCount) : mean) as Analysis['mean'];
  const percentile=(q:number)=>{let total=0;for(let i=0;i<256;i++){total+=histogram[i];if(total>=Math.max(1,count*q))return i/255;}return 0;};
  return {mean,neutral:n,p05:percentile(.05),p50:percentile(.5),p95:percentile(.95),
    clipping:clipped/Math.max(1,count),redRatio:mean[0]/Math.max(1,(mean[1]+mean[2])/2),
    magenta:(mean[0]+mean[2])/Math.max(2,2*mean[1]),confidence:neutralCount>count*.2?'medium':'low'};
}

export function suggest(a: Analysis, hints: Hints, engine: Recipe['engine']='balanced'): Suggestion {
  if(engine==='shallow'||engine==='funie'||engine==='wave') return {gains:[1,1,1],redMix:0,haze:0,highlights:0,mode:'gentle',
    explanation:`${engine==='shallow'?'Shallow-UWnet':engine==='wave'?'Custom ONNX model':'FUnIE-GAN'} runs on the original photo. Its 256 × 256 colour correction is transferred to the original resolution. Dive hints are used by Balanced restoration only; use manual controls to refine AI results.`};
  const [r,g,b]=a.mean;
  if(engine==='baseline') return {
    gains:[clamp(128/Math.max(r,1),.5,2),clamp(128/Math.max(g,1),.8,1.5),clamp(128/Math.max(b,1),.8,1.2)],
    redMix:clamp((60-r)/60)*.35,haze:0,highlights:0,mode:'restore',
    explanation:'Original heuristic: averages toward 128, bounded RGB gains, extra red below 60. Useful for comparison.',
  };
  const filter = hints.filter==='yes' || (hints.filter==='auto' && (a.redRatio>1.5 || (a.magenta>1.55 && r>80)));
  const surface=hints.scene==='surface';
  const weakRed=clamp((.8-a.redRatio)/.8);
  let gains: [number,number,number]=[1,1,1], redMix=0;
  let mode: Suggestion['mode']='gentle';
  if(filter) {
    // Relative balance, normalized to preserve original estimated luminance.
    const target=(a.neutral[0]+a.neutral[1]+a.neutral[2])/3;
    gains=a.neutral.map(v=>clamp((target/Math.max(v,12))**.8,.35,2.7)) as typeof gains;
    const norm=luminance(r,g,b)/Math.max(1,luminance(r*gains[0],g*gains[1],b*gains[2]));
    gains=gains.map(v=>v*norm) as typeof gains;
    mode='filter';
  } else if(!surface && weakRed>.08) {
    const depth=hints.depth===null?1: .75+.4*clamp(hints.depth/30);
    const green=hints.water==='green' || (hints.water==='auto' && g>b*1.08);
    gains=[1+weakRed*1.2, green? .86:1, green?1:.85];
    redMix=weakRed*.72*depth;
    mode='restore';
  } else if(!surface) {
    const target=(a.neutral[0]+a.neutral[1]+a.neutral[2])/3;
    gains=a.neutral.map(v=>clamp((target/Math.max(12,v))**.35,.85,1.2)) as typeof gains;
  }
  const haze=!surface && a.p05>.12 && a.p95-a.p05<.6 ? clamp((a.p05-.1)*.5,0,.09):0;
  const highlights = a.clipping>.008 ? -.12:0;
  const explanation=filter ? 'Red / magenta cast detected. Balancing channels while keeping the scene’s brightness.' :
    surface ? 'Surface mode keeps natural warm light. Fine-tune warmth and tint, or enable red-filter correction.' :
    mode==='restore' ? (a.redRatio<.15 ? 'Very little red remains. A conservative colour reconstruction is suggested; original colours are uncertain.' : 'Blue / green cast detected. Restoring warmth while preserving the water’s character.') :
    haze>0 ? 'Colour is fairly balanced. A little haze reduction is suggested.' : 'A gentle colour balance is suggested. Use manual controls to refine it.';
  return {gains,redMix,haze,highlights,mode,explanation};
}

export function makeRecipe(a:Analysis,hints:Hints={...DEFAULT_HINTS}):Recipe {
  return {version:1,engine:'balanced',strength:.8,hints,auto:suggest(a,hints),manual:structuredClone(DEFAULT_MANUAL)};
}

/** Shared, deterministic CPU renderer used for preview and source-resolution export.
 * RGB correction is tuned in display-encoded SDR; automatic blend and exposure are linear-light.
 * Haze is bounded global veil/contrast reduction, not physical depth reconstruction.
 */
export function renderPixels(input:Uint8ClampedArray,recipe:Recipe,neuralBase?:Uint8ClampedArray):Uint8ClampedArray {
  if((recipe.engine==='shallow'||recipe.engine==='funie'||recipe.engine==='wave')&&!neuralBase) throw new Error('AI correction is not ready.');
  if(neuralBase&&neuralBase.length!==input.length) throw new Error('AI correction dimensions do not match.');
  const out=new Uint8ClampedArray(input.length);
  const {auto:a,manual:m,strength:s}=recipe;
  const warmth=m.warmth/100,tint=m.tint/100;
  const gains=[m.neutral[0]*2**(warmth*.45+m.red/100*.8),m.neutral[1]*2**(-tint*.4),m.neutral[2]*2**(-warmth*.45)];
  const exposure=2**m.exposure;
  const haze=clamp((neuralBase?0:a.haze*s)+m.haze/100*.12,-.1,.18);
  const highlights=clamp(m.highlights/100+(neuralBase?0:a.highlights*s),-1,1);
  const shadows=m.shadows/100;
  const contrast=1+m.contrast/100*.65;
  for(let i=0;i<input.length;i+=4) {
    let r=input[i]/255,g=input[i+1]/255,b=input[i+2]/255;
    const origR=toLinear(r),origG=toLinear(g),origB=toLinear(b);
    // Cross-channel red reconstruction favours foreground green over pure blue water.
    const restoredR=neuralBase?neuralBase[i]/255:clamp(r*a.gains[0]+a.redMix*Math.max(0,g-.3*b)*(1-.45*smooth(.65,1,Math.max(r,g,b))));
    r=toSrgb(origR*(1-s)+toLinear(restoredR)*s);
    g=toSrgb(origG*(1-s)+toLinear(neuralBase?neuralBase[i+1]/255:g*a.gains[1])*s);
    b=toSrgb(origB*(1-s)+toLinear(neuralBase?neuralBase[i+2]/255:b*a.gains[2])*s);
    r=clamp(r*gains[0]);g=clamp(g*gains[1]);b=clamp(b*gains[2]);
    let lr=toLinear(r)*exposure,lg=toLinear(g)*exposure,lb=toLinear(b)*exposure;
    const l=luminance(lr,lg,lb);
    const adjusted=l*(1+highlights*.65*smooth(.18,.95,l)) + shadows*.16*(1-smooth(0,.5,l));
    const ratio=adjusted/Math.max(l,.00001);
    lr*=ratio;lg*=ratio;lb*=ratio;
    r=toSrgb(lr);g=toSrgb(lg);b=toSrgb(lb);
    const veil=(v:number)=>clamp(((v-haze)/(1-haze)-.5)*contrast+.5);
    r=veil(r);g=veil(g);b=veil(b);
    const y=luminance(r,g,b),sat=Math.max(r,g,b)-Math.min(r,g,b);
    const vib=1+m.vibrance/100*.8*(1-sat);
    out[i]=clamp(y+(r-y)*vib)*255;out[i+1]=clamp(y+(g-y)*vib)*255;out[i+2]=clamp(y+(b-y)*vib)*255;
    out[i+3]=input[i+3];
  }
  return out;
}

export function parseRecipe(value:unknown): Recipe {
  if(!value || typeof value!=='object') throw new Error('This is not a ClearWater recipe.');
  const r=value as Recipe;
  const finite=(v:unknown,lo:number,hi:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
  const triple=(v:unknown,lo:number,hi:number)=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,lo,hi));
  if(r.customModel&&(!/^[a-f0-9]{64}$/.test(r.customModel.sha256)||typeof r.customModel.name!=='string'||r.customModel.name.length>255||!['unit','signed'].includes(r.customModel.inputRange)||!['unit','signed'].includes(r.customModel.outputRange)))throw new Error('Invalid custom model settings.');
  if(r.version!==1 || !['balanced','baseline','shallow','funie','wave'].includes(r.engine) || !finite(r.strength,0,1) ||
    !r.hints || !['auto','underwater','surface'].includes(r.hints.scene) || !['auto','blue','green'].includes(r.hints.water) ||
    !['auto','yes','no'].includes(r.hints.filter) || !(r.hints.depth===null||finite(r.hints.depth,0,100)) ||
    !r.auto || !triple(r.auto.gains,0,5) || !finite(r.auto.redMix,0,2) || !finite(r.auto.haze,-.2,.2) || !finite(r.auto.highlights,-1,1) ||
    !['restore','filter','gentle'].includes(r.auto.mode) || typeof r.auto.explanation!=='string' || r.auto.explanation.length>500 ||
    !r.manual || !triple(r.manual.neutral,.1,10) || !finite(r.manual.exposure,-2,2) ||
    !(['warmth','tint','red','highlights','shadows','contrast','haze','vibrance'] as const).every(k=>finite(r.manual[k],-100,100)))
    throw new Error('Unsupported or invalid recipe. Use a version 1 ClearWater recipe.');
  return structuredClone(r);
}
