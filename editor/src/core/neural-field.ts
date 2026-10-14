/** Transfer a model's low-resolution RGB residual without discarding source detail.
 * This is colour enhancement, not full-resolution neural denoising/restoration. */
export function transferField(input:Uint8ClampedArray,width:number,height:number,field:Float32Array,size=256,offsetY=0,fullHeight=height,offsetX=0,fullWidth=width):Uint8ClampedArray {
  const out=new Uint8ClampedArray(input.length);
  for(let y=0;y<height;y++) {
    const fy=Math.max(0,Math.min(size-1,(y+offsetY+.5)/fullHeight*size-.5)),y0=Math.floor(fy),y1=Math.min(size-1,y0+1),ty=fy-y0;
    for(let x=0;x<width;x++) {
      const fx=Math.max(0,Math.min(size-1,(x+offsetX+.5)/fullWidth*size-.5)),x0=Math.floor(fx),x1=Math.min(size-1,x0+1),tx=fx-x0,i=(y*width+x)*4;
      for(let c=0;c<3;c++) {
        const top=field[(y0*size+x0)*3+c]*(1-tx)+field[(y0*size+x1)*3+c]*tx;
        const bottom=field[(y1*size+x0)*3+c]*(1-tx)+field[(y1*size+x1)*3+c]*tx;
        out[i+c]=input[i+c]+(top*(1-ty)+bottom*ty)*255;
      }
      out[i+3]=input[i+3];
    }
  }
  return out;
}
