import {describe,expect,it} from 'vitest';
import {GUIDED_DEVIATION_LIMIT,prepareGuidedField,transferField,transferFieldBilinear,type GuidedField} from '../src/core/neural-field';

function rgba(width:number,height:number,pixel:(x:number,y:number)=>[number,number,number,number]){
  const out=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const [r,g,b,a]=pixel(x,y),i=(y*width+x)*4;
    out[i]=r;out[i+1]=g;out[i+2]=b;out[i+3]=a;
  }
  return out;
}

describe('guided residual upscale',()=>{
  it('matches bilinear on a constant residual, including across an edge in the photo',()=>{
    const size=8,width=17,height=13;
    const guide=rgba(size,size,(x,y)=>[(x*37+y*11)%256,(x*19)%256,(y*23+40)%256,255]);
    const input=rgba(width,height,(x,y)=>[x<width/2?30:210,(x*3+y)%256,(y*5)%256,200]);
    const field=new Float32Array(size*size*3);
    for(let i=0;i<size*size;i++){field[i*3]=0.125;field[i*3+1]=-0.0625;field[i*3+2]=0.25;}
    const guided=prepareGuidedField(guide,field,size);
    expect([...transferField(input,width,height,guided)]).toEqual([...transferFieldBilinear(input,width,height,field,size)]);
  });

  it('follows a strong edge instead of staying on the bilinear field',()=>{
    const size=8,width=32,height=8;
    const step=(x:number,n:number)=>x<n/2?20:220;
    const guide=rgba(size,size,(x,y)=>[step(x,size),step(x,size),step(x,size),255]);
    const input=rgba(width,height,(x,y)=>[step(x,width),step(x,width),step(x,width),255]);
    const field=new Float32Array(size*size*3);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const delta=x<size/2?-0.2:0.2,i=y*size+x;
      field[i*3]=delta;field[i*3+1]=delta*0.2;field[i*3+2]=-delta;
    }
    const guided=prepareGuidedField(guide,field,size);
    const edge=transferField(input,width,height,guided),bilinear=transferFieldBilinear(input,width,height,field,size);
    expect(edge).not.toEqual(bilinear);
  });

  it('joins export strips without a seam',()=>{
    const size=8,width=20,height=11;
    const guide=rgba(size,size,(x,y)=>[x<size/2?16:240,80+y*10,140,255]);
    const input=rgba(width,height,(x,y)=>[x<width/2?16:240,40+y*8,x*6%256,255]);
    const field=new Float32Array(size*size*3);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=y*size+x,delta=x<size/2?-0.15:0.18;
      field[i*3]=delta;field[i*3+1]=0.05;field[i*3+2]=-delta*0.5;
    }
    const guided=prepareGuidedField(guide,field,size);
    const full=transferField(input,width,height,guided);
    const joined=new Uint8ClampedArray(full.length);
    for(let y=0,offset=0;y<height;){
      const rows=Math.min(3,height-y);
      const strip=input.subarray(y*width*4,(y+rows)*width*4);
      const part=transferField(strip,width,rows,guided,y,height);
      joined.set(part,offset);offset+=part.length;y+=rows;
    }
    expect([...joined]).toEqual([...full]);
    const corner=transferField(input.subarray((height-1)*width*4+ (width-1)*4),1,1,guided,height-1,height,width-1,width);
    expect([...corner]).toEqual([...full.subarray(full.length-4)]);
  });

  it('caps a pure-luma spike at the deviation limit and leaves a small departure alone',()=>{
    const size=2,count=size*size;
    const spike:GuidedField={field:new Float32Array(count*3),coef:new Float32Array(count*12),size};
    const mild:GuidedField={field:new Float32Array(count*3),coef:new Float32Array(count*12),size};
    for(let p=0;p<count;p++){
      spike.coef[p*12+9]=spike.coef[p*12+10]=spike.coef[p*12+11]=1;
      mild.coef[p*12+9]=mild.coef[p*12+10]=mild.coef[p*12+11]=0.08;
    }
    const input=rgba(size,size,()=>[0,0,0,255]);
    const capped=transferField(input,size,size,spike),kept=transferField(input,size,size,mild);
    expect(capped[0]).toBe(Math.round(GUIDED_DEVIATION_LIMIT*255));
    expect(capped[0]).toBeLessThan(64);
    expect(kept[0]).toBe(Math.round(0.08*0.25*255));
    expect(kept[0]).toBeLessThan(capped[0]);
  });
});
