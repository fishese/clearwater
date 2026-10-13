import type {PhotoEnhancement} from './types';
import {DEFAULT_ENHANCEMENT} from './types';
const clamp=(v:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
const luma=(r:number,g:number,b:number)=>(.2126*r+.7152*g+.0722*b)/255;
const smooth=(lo:number,hi:number,v:number)=>{const x=clamp((v-lo)/(hi-lo));return x*x*(3-2*x);};

/** Analyse the corrected preview, rather than stretching each RGB channel separately. */
export function suggestEnhancement(pixels:Uint8ClampedArray):PhotoEnhancement {
 const histogram=new Uint32Array(256);let count=0;
 for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>=128){histogram[Math.round(luma(pixels[i],pixels[i+1],pixels[i+2])*255)]++;count++;}
 const percentile=(q:number)=>{let sum=0;for(let i=0;i<256;i++){sum+=histogram[i];if(sum>=Math.max(1,count*q))return i/255;}return 1;};
 const low=percentile(.005),high=percentile(.995);
 // A flat patch is not evidence of haze. Avoid amplifying quantisation/noise.
 if(!count||high-low<.12)return {...DEFAULT_ENHANCEMENT};
 return {black:clamp(low-.015,0,.2),white:clamp(high+.025,.6,1),contrast:80,clarity:35,sharpness:25};
}

/** Radii in output pixels; preview scales these to preserve the apparent size. */
export function enhancementRadii(width:number,height:number,referenceWidth=width,referenceHeight=height){
 const long=Math.max(referenceWidth,referenceHeight),scale=width/referenceWidth;
 return {clarity:Math.max(1,Math.round(Math.min(96,Math.max(1,long*.009))*scale)),sharpness:Math.max(1,Math.round(Math.min(8,Math.max(1,long*.0008))*scale))};
}

// Separable running sums are linear in pixel count, independent of blur radius.
// Alpha weights prevent transparent pixels from creating dark edge halos.
function blur(luminance:Float32Array,pixels:Uint8ClampedArray,width:number,height:number,radius:number){
 const horizontal=new Float32Array(luminance.length),weights=new Float32Array(luminance.length),out=new Float32Array(luminance.length);
 for(let y=0;y<height;y++){
  let sum=0,weight=0;
  const add=(x:number,sign:number)=>{if(x<0||x>=width)return;const i=y*width+x,a=pixels[i*4+3]/255;sum+=luminance[i]*a*sign;weight+=a*sign;};
  for(let x=0;x<=Math.min(radius,width-1);x++)add(x,1);
  for(let x=0;x<width;x++){const i=y*width+x;horizontal[i]=sum;weights[i]=weight;add(x-radius,-1);add(x+radius+1,1);}
 }
 for(let x=0;x<width;x++){
  let sum=0,weight=0;
  const add=(y:number,sign:number)=>{if(y<0||y>=height)return;const i=y*width+x;sum+=horizontal[i]*sign;weight+=weights[i]*sign;};
  for(let y=0;y<=Math.min(radius,height-1);y++)add(y,1);
  for(let y=0;y<height;y++){const i=y*width+x;out[i]=weight>1e-6?sum/weight:luminance[i];add(y-radius,-1);add(y+radius+1,1);}
 }
 return out;
}

/** Photo-only finishing after the shared renderer. Pass neighbouring rows for strips. */
export function enhancePixels(input:Uint8ClampedArray,width:number,height:number,settings?:PhotoEnhancement,referenceWidth=width,referenceHeight=height):Uint8ClampedArray {
 if(!settings||!(settings.contrast||settings.clarity||settings.sharpness))return input;
 if(input.length!==width*height*4)throw new Error('Photo enhancement dimensions do not match.');
 const tone=new Float32Array(width*height),amount=settings.contrast/100;
 const gain=Math.min(1.7,1/Math.max(.4,settings.white-settings.black));
 for(let i=0;i<tone.length;i++){
  const at=i*4,y=luma(input[at],input[at+1],input[at+2]);
  tone[i]=y+(clamp((y-settings.black)*gain)-y)*amount;
 }
 const radii=enhancementRadii(width,height,referenceWidth,referenceHeight);
 const local=settings.clarity?blur(tone,input,width,height,radii.clarity):undefined;
 const detail=settings.sharpness?blur(tone,input,width,height,radii.sharpness):undefined;
 const out=new Uint8ClampedArray(input);
 for(let i=0;i<tone.length;i++){
  const at=i*4;if(!input[at+3])continue;
  const y=tone[i],protection=smooth(.025,.18,y)*(1-smooth(.75,.98,y));
  const localDelta=local?clamp(y-local[i],-.09,.09)*settings.clarity/100*.9*protection:0;
  const difference=detail?y-detail[i]:0;
  // A soft threshold and bounded overshoot reduce noise/backscatter amplification.
  const sharpDelta=Math.sign(difference)*Math.min(.035,Math.max(0,Math.abs(difference)-2/255))*settings.sharpness/100*protection;
  const target=clamp(y+localDelta+sharpDelta),original=luma(input[at],input[at+1],input[at+2]);
  const peak=Math.max(input[at],input[at+1],input[at+2])/255;
  const ratio=Math.min(target/Math.max(original,1e-6),1/Math.max(peak,1e-6));
  out[at]=input[at]*ratio;out[at+1]=input[at+1]*ratio;out[at+2]=input[at+2]*ratio;
 }
 return out;
}
