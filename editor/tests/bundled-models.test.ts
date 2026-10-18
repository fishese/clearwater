import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import * as ort from 'onnxruntime-web/wasm';
import {BUNDLED_MODEL_IDS,BUNDLED_MODELS,migrateOfflineModelSelection} from '../src/core/bundled-models';

const modelsDir=fileURLToPath(new URL('../public/models/',import.meta.url));
ort.env.wasm.numThreads=1;
ort.env.wasm.proxy=false;
ort.env.wasm.wasmPaths={
  wasm:new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',import.meta.url).href,
  mjs:new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',import.meta.url).href,
};

type TensorSpec={name:string;shape:number[];dtype:string;range:'unit'|'signed'};
type Entry={
  sha256:string;bytes:number;max_abs_parity_error:number;parity_tolerance:number;
  input:TensorSpec;output:TensorSpec;
};

describe('bundled ONNX models',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/models/manifest.json',import.meta.url),'utf8')) as Record<string,Entry>;

  it('lists exactly the bundled engines',()=>{
    expect(Object.keys(manifest).sort()).toEqual([...BUNDLED_MODEL_IDS].sort());
    expect(manifest).not.toHaveProperty('funie');
  });

  it('maps the retired offline selection to Five A+',()=>{
    expect(migrateOfflineModelSelection(['wwe','shallow','funie'])).toEqual(['wwe','fivea','shallow']);
    expect(migrateOfflineModelSelection(['funie'])).toEqual(['fivea']);
  });

  for(const id of BUNDLED_MODEL_IDS) it(`${id} matches the manifest and runs in onnxruntime-web`,async()=>{
    const entry=manifest[id],bytes=readFileSync(modelsDir+id+'.onnx');
    expect(bytes.byteLength).toBe(entry.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    expect(entry.max_abs_parity_error).toBeLessThanOrEqual(entry.parity_tolerance);
    expect(entry.input).toMatchObject({dtype:'float32',range:BUNDLED_MODELS[id].inputRange,shape:[1,3,256,256]});
    expect(entry.output).toMatchObject({dtype:'float32',range:BUNDLED_MODELS[id].outputRange,shape:[1,3,256,256]});
    const session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    try {
      expect(session.inputNames).toEqual([entry.input.name]);
      expect(session.outputNames).toEqual([entry.output.name]);
      const inputMeta=session.inputMetadata[0],outputMeta=session.outputMetadata[0];
      expect(inputMeta.isTensor).toBe(true);
      expect(outputMeta.isTensor).toBe(true);
      if(!inputMeta.isTensor||!outputMeta.isTensor) throw new Error('expected image tensors');
      if(id==='fivea'){
        expect(inputMeta.shape).toEqual([1,3,'H','W']);
        expect(outputMeta.shape).toEqual(['Concatoutput_dim_0',3,'H','W']);
      }else{
        expect(inputMeta.shape).toEqual([1,3,256,256]);
        expect(outputMeta.shape).toEqual([1,3,256,256]);
      }
      const input=new Float32Array(3*256*256);
      for(let i=0;i<input.length;i++) input[i]=(i%251)/250;
      const result=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',input,[1,3,256,256])});
      const output=result[session.outputNames[0]];
      expect(output.type).toBe('float32');
      expect(output.dims).toEqual([1,3,256,256]);
      const data=output.data as Float32Array;
      expect(data).toBeInstanceOf(Float32Array);
      expect(data.length).toBe(input.length);
      let finite=true,changed=false;
      for(let i=0;i<data.length;i++){if(!Number.isFinite(data[i])) finite=false; if(Math.abs(data[i]-input[i])>1e-6) changed=true;}
      expect(finite).toBe(true);
      expect(changed).toBe(true);
      if(id==='fivea'){
        const plane=256*256;
        for(let c=0;c<3;c++) expect(data[c*plane]).toBe(data[c*plane+256+1]);
      }
    } finally {await session.release();}
  },30000);
});
