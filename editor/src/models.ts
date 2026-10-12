import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import {validateImageTensor,validateImageOutput} from './core/model-contract';
import type {CustomModel} from './core/types';

export type ModelName='shallow'|'funie'|'wave';
ort.env.wasm.wasmPaths={wasm:wasmUrl,mjs:wasmModuleUrl};
ort.env.wasm.numThreads=1;
ort.env.wasm.proxy=false;
const sessions=new Map<ModelName,Promise<ort.InferenceSession>>();
let custom:CustomModel|undefined;
async function session(name:ModelName) {
  if(name==='wave'&&!sessions.has(name))throw new Error('Load your custom ONNX model first.');
  if(!sessions.has(name)) {
    const pending=(async()=>{
      const response=await fetch(`${import.meta.env.BASE_URL}models/${name}.onnx`);
      if(!response.ok)throw new Error(`Could not load ${name==='shallow'?'Shallow-UWnet':'FUnIE-GAN'}. Check the model files and retry.`);
      return ort.InferenceSession.create(await response.arrayBuffer(),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    })();
    sessions.set(name,pending);
    pending.catch(()=>sessions.delete(name));
  }
  return sessions.get(name)!;
}
export async function registerCustomModel(bytes:ArrayBuffer,config:CustomModel) {
  const net=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  try {
    if(net.inputNames.length!==1||net.outputNames.length!==1)throw new Error('Use a model with exactly one image input and one image output.');
    validateImageTensor(net.inputMetadata[0]);validateImageTensor(net.outputMetadata[0]);
    const result=await net.run({[net.inputNames[0]]:new ort.Tensor('float32',new Float32Array(3*256*256).fill(config.inputRange==='signed'?0:.5),[1,3,256,256])});
    try{validateImageOutput(result[net.outputNames[0]]);}finally{Object.values(result).forEach(t=>t.dispose());}
  }catch(error){await net.release();throw error;}
  const previous=sessions.get('wave');
  sessions.set('wave',Promise.resolve(net));custom=config;
  if(previous)await (await previous).release();
}
export async function inferField(name:ModelName,source:OffscreenCanvas):Promise<Float32Array> {
  const net=await session(name),size=256,count=size*size;
  const canvas=new OffscreenCanvas(size,size),c=canvas.getContext('2d',{willReadFrequently:true})!;
  c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(source,0,0,size,size);
  const pixels=c.getImageData(0,0,size,size).data,input=new Float32Array(count*3);
  const signedInput=name==='funie'||(name==='wave'&&custom?.inputRange==='signed');
  const signedOutput=name==='funie'||(name==='wave'&&custom?.outputRange==='signed');
  for(let i=0;i<count;i++)for(let ch=0;ch<3;ch++) {
    const v=pixels[i*4+ch]/255;
    input[ch*count+i]=signedInput?v*2-1:v;
  }
  const result=await net.run({[net.inputNames[0]]:new ort.Tensor('float32',input,[1,3,size,size])});
  try {
  const tensor=result[net.outputNames[0]],output=tensor.data as Float32Array;
  validateImageOutput(tensor);
  const field=new Float32Array(count*3);
  for(let i=0;i<count;i++)for(let ch=0;ch<3;ch++) {
    let v=output[ch*count+i];if(!Number.isFinite(v))throw new Error('AI returned an invalid colour value.');
    if(signedOutput)v=(v+1)/2;
    field[i*3+ch]=Math.max(0,Math.min(1,v))-pixels[i*4+ch]/255;
  }
  return field;
  }finally{Object.values(result).forEach(t=>t.dispose());}
}
