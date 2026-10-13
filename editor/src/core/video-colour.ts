/** A regularized global RGB affine fit: independent of subject position. */
export type ColourTransform=number[];
export interface ColourNode {time:number;matrix:ColourTransform;histogram:number[]}
export const IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0];
export function fitColour(input:Uint8ClampedArray,residual:Float32Array):ColourTransform {
 const normal=Array.from({length:4},()=>[0,0,0,0]),rhs=Array.from({length:3},()=>[0,0,0,0]);
 const count=input.length/4;
 for(let p=0;p<count;p+=4){const x=[input[p*4]/255,input[p*4+1]/255,input[p*4+2]/255,1];
  for(let a=0;a<4;a++){for(let b=0;b<4;b++)normal[a][b]+=x[a]*x[b];for(let c=0;c<3;c++)rhs[c][a]+=x[a]*Math.max(0,Math.min(1,x[c]+residual[p*3+c]));}}
 // Shrink towards identity, especially when a frame contains few distinct colours.
 const ridge=Math.max(1,count/4*.01);for(let i=0;i<4;i++)normal[i][i]+=ridge;
 const result:number[]=[];
 for(let c=0;c<3;c++){rhs[c][c]+=ridge;const rows=normal.map((row,i)=>[...row,rhs[c][i]]);
  for(let col=0;col<4;col++){let pivot=col;for(let j=col+1;j<4;j++)if(Math.abs(rows[j][col])>Math.abs(rows[pivot][col]))pivot=j;
   [rows[col],rows[pivot]]=[rows[pivot],rows[col]];const d=rows[col][col];for(let j=col;j<5;j++)rows[col][j]/=d;
   for(let i=0;i<4;i++)if(i!==col){const factor=rows[i][col];for(let j=col;j<5;j++)rows[i][j]-=factor*rows[col][j];}}
  for(let i=0;i<4;i++)result.push(Math.max(i===3?-.4:-2,Math.min(i===3?.4:3,rows[i][4])));
 }
 if(!result.every(Number.isFinite))throw new Error('Could not estimate a stable AI colour correction.');
 return result;
}
export function colourHistogram(input:Uint8ClampedArray):number[]{const bins=new Array<number>(48).fill(0);const stride=Math.max(1,Math.floor(input.length/4/4096));let n=0;
 for(let p=0;p<input.length/4;p+=stride){for(let c=0;c<3;c++)bins[c*16+(input[p*4+c]>>4)]++;n++;}return bins.map(v=>v/Math.max(1,n));}
const distance=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/6;
export function colourAt(left:ColourNode,right:ColourNode,time:number,input:Uint8ClampedArray):ColourTransform {
 if(left===right||left.time===right.time)return left.matrix;
 // At sampled scene boundaries choose the nearer scene, rather than blend across a cut.
 if(distance(left.histogram,right.histogram)>.4){const current=colourHistogram(input);return distance(current,left.histogram)<=distance(current,right.histogram)?left.matrix:right.matrix;}
 const mix=Math.max(0,Math.min(1,(time-left.time)/(right.time-left.time)));
 return left.matrix.map((value,i)=>value*(1-mix)+right.matrix[i]*mix);
}
export function applyColour(input:Uint8ClampedArray,matrix:ColourTransform):Uint8ClampedArray {const out=new Uint8ClampedArray(input.length);
 for(let p=0;p<input.length;p+=4){const r=input[p]/255,g=input[p+1]/255,b=input[p+2]/255;
  for(let c=0;c<3;c++){const k=c*4;out[p+c]=Math.max(0,Math.min(255,(matrix[k]*r+matrix[k+1]*g+matrix[k+2]*b+matrix[k+3])*255));}out[p+3]=input[p+3];}return out;}
export function sampleTimes(duration:number,interval:number):number[]{const end=Math.max(0,duration-.001),times=[0];for(let t=interval;t<end;t+=interval)times.push(t);if(end>0)times.push(end);return times;}
export function bracket(times:number[],time:number):[number,number]{let right=times.findIndex(t=>t>=time);if(right<0)right=times.length-1;return [times[Math.max(0,right-1)],times[right]];}
