export function validateImageTensor(metadata:{isTensor:boolean;type?:string;shape?:readonly (number|string)[]}) {
  const expected=[1,3,256,256];
  if(!metadata.isTensor||metadata.type!=='float32'||metadata.shape?.length!==4||metadata.shape.some((v,i)=>typeof v==='number'&&v>0&&v!==expected[i]))
    throw new Error('Use a float32 RGB NCHW image model with input and output shape [1, 3, 256, 256].');
}
export function validateImageOutput(tensor:{type:string;dims:readonly number[];data:unknown}) {
  if(tensor.type!=='float32'||tensor.dims.join(',')!=='1,3,256,256'||!(tensor.data instanceof Float32Array)||tensor.data.some(v=>!Number.isFinite(v)))
    throw new Error('Model output must be a finite float32 RGB image with shape [1, 3, 256, 256].');
}
