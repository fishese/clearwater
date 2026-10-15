import { describe, expect, it } from 'vitest';
import { analyse, makePhotoRecipe, makeRecipe, makeVideoRecipe, parseRecipe, renderPixels, suggest } from '../src/core/engine';
import { DEFAULT_HINTS } from '../src/core/types';

function fixture(r:number,g:number,b:number){return new Uint8ClampedArray(Array.from({length:64},()=>[r,g,b,255]).flat());}
const stats=(r:number,g:number,b:number)=>analyse(fixture(r,g,b),8,8);
describe('restoration decisions',()=>{
  it('reconstructs severely missing red rather than only amplifying a nearly empty channel',()=>{
    const a=stats(2,136,178),r=makeRecipe(a);r.strength=1;
    const result=renderPixels(fixture(2,136,178),r);
    expect(r.auto.mode).toBe('restore');expect(result[0]).toBeGreaterThan(30);expect(result[0]).toBeLessThan(result[1]);
  });
  it('corrects surface red-filter casts in both directions without forcing mean brightness to 128',()=>{
    const a=stats(160,49,52),r=makeRecipe(a,{...DEFAULT_HINTS,scene:'surface',filter:'yes'});
    const output=renderPixels(fixture(160,49,52),r);
    expect(r.auto.mode).toBe('filter');expect(output[0]/output[1]).toBeLessThan(160/49);expect(output[1]).toBeGreaterThan(49);
    const l=(rgb:number[])=>.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    expect(Math.abs(l(Array.from(output.slice(0,3)))-l([160,49,52]))).toBeLessThan(20);
  });
  it('addresses weak green in magenta filter shots',()=>{
    const s=suggest(stats(155,73,166),{...DEFAULT_HINTS,filter:'yes'});
    expect(s.gains[1]).toBeGreaterThan(s.gains[0]);expect(s.gains[1]).toBeGreaterThan(s.gains[2]);expect(s.redMix).toBe(0);
  });
  it('does not reconstruct red for an explicitly unfiltered surface scene',()=>{
    const s=suggest(stats(20,100,150),{...DEFAULT_HINTS,scene:'surface',filter:'no'});
    expect(s.redMix).toBe(0);expect(s.gains).toEqual([1,1,1]);
  });
  it('keeps unknown depth distinct from an explicitly shallow depth',()=>{
    const analysis=stats(20,100,150),unknown=suggest(analysis,{...DEFAULT_HINTS,depth:null}),shallow=suggest(analysis,{...DEFAULT_HINTS,depth:0});
    expect(unknown.redMix).toBeGreaterThan(shallow.redMix);
    expect(shallow.redMix).toBeCloseTo(unknown.redMix*.75);
  });
  it('has a separate green-water suggestion and does not mutate hints',()=>{
    const hints={...DEFAULT_HINTS,water:'green' as const};const before=structuredClone(hints);
    expect(suggest(stats(7,138,117),hints).gains[1]).toBeLessThan(1);expect(hints).toEqual(before);
  });
});
describe('render and recipe integrity',()=>{
  it('uses WWE-UIE with a 30% Balanced follow-up for new photos while preserving the generic default',()=>{
    const analysis=stats(30,100,150),photo=makePhotoRecipe(analysis),generic=makeRecipe(analysis);
    expect(photo.engine).toBe('wwe');expect(photo.balancedAfterAI).toEqual({strength:.3});
    expect(generic.engine).toBe('balanced');expect(generic.balancedAfterAI).toBeUndefined();
    expect(parseRecipe(JSON.parse(JSON.stringify(generic)))).toEqual(generic);
  });
  it('uses Five A+ sampled colour for new videos and keeps the live-camera default classical',()=>{
    const analysis=stats(30,100,150),video=makeVideoRecipe(analysis),camera=makeRecipe(analysis);
    expect(video.engine).toBe('fivea');expect(video.videoCorrection).toEqual({mode:'sampled',interval:5,referenceTime:0});
    expect(video.balancedAfterAI).toBeUndefined();
    expect(camera.engine).toBe('balanced');
    expect(parseRecipe(JSON.parse(JSON.stringify(video)))).toEqual(video);
  });
  it('opens a retired FUnIE-GAN recipe on WWE-UIE',()=>{
    const recipe=makeRecipe(stats(30,100,150));
    const retired={...recipe,engine:'funie',auto:{...recipe.auto,explanation:'FUnIE-GAN runs on the original photo. Its 256 × 256 colour correction is transferred to the original resolution. Dive hints are used by Balanced restoration only; use manual controls to refine AI results.'}};
    const opened=parseRecipe(retired);
    expect(opened.engine).toBe('wwe');
    expect(opened.auto.explanation.startsWith('WWE-UIE')).toBe(true);
    expect(recipe.engine).toBe('balanced');
  });
  it('strength zero leaves the original intact to rounding tolerance and preserves alpha',()=>{
    const input=new Uint8ClampedArray([1,136,178,255,87,93,111,128,0,0,0,0,255,255,255,255]);
    const r=makeRecipe(analyse(input,4,1));r.strength=0;
    const output=renderPixels(input,r);input.forEach((v,i)=>expect(Math.abs(output[i]-v)).toBeLessThanOrEqual(1));
    expect(input[0]).toBe(1);expect(output[7]).toBe(128);
  });
  it('separates strength from manual edits',()=>{const r=makeRecipe(stats(120,120,120));r.strength=0;r.manual.exposure=1;expect(renderPixels(fixture(120,120,120),r)[0]).toBeGreaterThan(150);});
  it('renders strips identically to a complete buffer',()=>{
    const input=new Uint8ClampedArray([...fixture(2,136,178),...fixture(155,73,166)]),r=makeRecipe(analyse(input,8,16));r.manual.haze=12;r.manual.highlights=-40;
    const full=renderPixels(input,r),parts=new Uint8ClampedArray([...renderPixels(input.slice(0,256),r),...renderPixels(input.slice(256),r)]);
    expect(full).toEqual(parts);
  });
  it('validates imported recipes and rejects nonfinite, unsupported or dangerous numeric inputs',()=>{
    const r=makeRecipe(stats(30,100,150));expect(parseRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(()=>parseRecipe({...r,strength:Infinity})).toThrow();expect(()=>parseRecipe({...r,version:2})).toThrow();
    expect(()=>parseRecipe({...r,manual:{...r.manual,exposure:300}})).toThrow();expect(()=>parseRecipe(null)).toThrow();
  });
  it('keeps the original gain-limited baseline available',()=>{
    const s=suggest(stats(2,136,178),DEFAULT_HINTS,'baseline');expect(s.gains[0]).toBe(2);expect(s.gains[1]).toBeCloseTo(128/136);expect(s.gains[2]).toBe(.8);
  });
  it('analyses completely transparent input without NaNs',()=>{const a=analyse(new Uint8ClampedArray(16),2,2);expect(a.mean).toEqual([0,0,0]);expect(Number.isFinite(a.redRatio)).toBe(true);});
});
