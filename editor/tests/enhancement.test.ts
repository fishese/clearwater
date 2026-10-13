import {it,expect} from 'vitest';
import {enhancePixels,enhancementRadii,suggestEnhancement} from '../src/core/enhancement';
import {DEFAULT_ENHANCEMENT} from '../src/core/types';
import {analyse,makeRecipe,parseRecipe} from '../src/core/engine';
function fixture(width:number,height:number){const p=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4,v=50+(x*7+y*3)%140;p.set([v,v,Math.min(255,v+20),y===10?0:255],at);}return p;}
it('keeps old recipes and disabled enhancement exactly unchanged',()=>{
 const p=fixture(12,20),r=makeRecipe(analyse(p,12,20));expect(parseRecipe(r).enhancement).toBeUndefined();expect(enhancePixels(p,12,20)).toBe(p);expect(enhancePixels(p,12,20,DEFAULT_ENHANCEMENT)).toBe(p);
 for(const enhancement of [null,{...DEFAULT_ENHANCEMENT,black:NaN},{...DEFAULT_ENHANCEMENT,sharpness:101},{...DEFAULT_ENHANCEMENT,white:.4},{...DEFAULT_ENHANCEMENT,brightness:NaN},{...DEFAULT_ENHANCEMENT,brightness:-101},{...DEFAULT_ENHANCEMENT,brightness:101}])expect(()=>parseRecipe({...r,enhancement})).toThrow('Invalid photo enhancement');
 expect(parseRecipe({...r,enhancement:{...DEFAULT_ENHANCEMENT,black:.2,white:.6}}).enhancement?.white).toBe(.6);
 expect(parseRecipe({...r,enhancement:{...DEFAULT_ENHANCEMENT,sharpness:50}}).enhancement?.sharpness).toBe(50);
 expect(parseRecipe({...r,enhancement:{contrast:80,clarity:0,sharpness:0,black:.1,white:.9}}).enhancement?.brightness).toBeUndefined();
});
it('expands a compressed tonal range without reacting to flat patches or transparent RGB',()=>{
 const p=new Uint8ClampedArray(Array.from({length:1000},(_,i)=>[80+i%100,80+i%100,80+i%100,255]).flat()),settings=suggestEnhancement(p),out=enhancePixels(p,100,10,{...settings,clarity:0,sharpness:0});
 expect(out[0]).toBeLessThan(p[0]);expect(out[396]).toBeGreaterThan(p[396]);expect(settings.black).toBeLessThanOrEqual(.2);
 expect(suggestEnhancement(new Uint8ClampedArray([90,90,90,255,255,255,255,0]))).toEqual(DEFAULT_ENHANCEMENT);
});
it('preserves hue, alpha, and input pixels; tiny noise does not trigger sharpening',()=>{
 const p=new Uint8ClampedArray([40,80,120,128,0,0,0,0]),before=p.slice(),out=enhancePixels(p,2,1,{...DEFAULT_ENHANCEMENT,contrast:80,black:.1,white:.8});expect(p).toEqual(before);expect(out[3]).toBe(128);expect(out.slice(4)).toEqual(before.slice(4));expect(Math.abs(out[0]*3-out[2])).toBeLessThanOrEqual(2);
 const noisy=new Uint8ClampedArray(Array.from({length:100},(_,i)=>[100+i%2,100+i%2,100+i%2,255]).flat());expect(enhancePixels(noisy,10,10,{...DEFAULT_ENHANCEMENT,sharpness:100})).toEqual(noisy);
});
it('brightens and darkens midtones while preserving legacy behavior, hue, and alpha',()=>{
 const p=new Uint8ClampedArray([64,128,192,173,0,0,0,0]);
 const legacy={contrast:40,clarity:0,sharpness:0,black:.08,white:.92};
 expect(enhancePixels(p,2,1,{...legacy,brightness:0})).toEqual(enhancePixels(p,2,1,legacy));
 expect(enhancePixels(p,2,1,{...DEFAULT_ENHANCEMENT})).toBe(p);
 const bright=enhancePixels(p,2,1,{...DEFAULT_ENHANCEMENT,brightness:60}),dark=enhancePixels(p,2,1,{...DEFAULT_ENHANCEMENT,brightness:-60});
 expect(bright[0]).toBeGreaterThan(p[0]);expect(dark[0]).toBeLessThan(p[0]);
 expect(bright[3]).toBe(173);expect(bright.slice(4)).toEqual(p.slice(4));
 expect(Math.abs(bright[0]/bright[2]-p[0]/p[2])).toBeLessThan(.02);
 expect(parseRecipe({...makeRecipe(analyse(p,2,1)),enhancement:{...DEFAULT_ENHANCEMENT,brightness:100}}).enhancement?.brightness).toBe(100);
});
it('renders halo strips identically to full buffers in portrait and landscape, including transparent edges',()=>{
 for(const [width,height] of [[70,530],[530,70]]){
  const p=fixture(width,height),settings={...suggestEnhancement(p),clarity:85,sharpness:80,brightness:37},full=enhancePixels(p,width,height,settings),out=new Uint8ClampedArray(p.length),r=enhancementRadii(width,height),halo=Math.max(r.clarity,r.sharpness);
  for(let y=0;y<height;y+=32){const end=Math.min(height,y+32),top=Math.max(0,y-halo),bottom=Math.min(height,end+halo);const strip=enhancePixels(p.slice(top*width*4,bottom*width*4),width,bottom-top,settings,width,height);out.set(strip.subarray((y-top)*width*4,(end-top)*width*4),y*width*4);}
  expect(out).toEqual(full);
 }
});
it('scales neighbourhoods with export resolution rather than export strip height',()=>{
 expect(enhancementRadii(4000,256,4000,6000)).toEqual(enhancementRadii(4000,6000));
 const full=enhancementRadii(4000,6000),preview=enhancementRadii(800,1200,4000,6000);expect(Math.abs(preview.clarity-full.clarity/5)).toBeLessThanOrEqual(.5);
});
