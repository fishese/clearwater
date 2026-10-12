import {describe,it,expect} from 'vitest';
import {validateImageTensor,validateImageOutput} from '../src/core/model-contract';
import {analyse,makeRecipe,parseRecipe} from '../src/core/engine';
describe('custom model compatibility',()=>{
  it('accepts fixed and symbolic NCHW float32 images',()=>{
    expect(()=>validateImageTensor({isTensor:true,type:'float32',shape:[1,3,256,256]})).not.toThrow();
    expect(()=>validateImageTensor({isTensor:true,type:'float32',shape:['batch',3,'height','width']})).not.toThrow();
  });
  for(const shape of [[1,256,256,3],[1,3,512,512],[2,3,256,256],[1,1,256,256]])it(`rejects unsupported shape ${shape}`,()=>{
    expect(()=>validateImageTensor({isTensor:true,type:'float32',shape})).toThrow('NCHW');
  });
  it('rejects incompatible types and invalid output values',()=>{
    expect(()=>validateImageTensor({isTensor:true,type:'float16',shape:[1,3,256,256]})).toThrow();
    expect(()=>validateImageOutput({type:'float32',dims:[1,256,256,3],data:new Float32Array(3*256*256)})).toThrow();
    const data=new Float32Array(3*256*256);data[0]=NaN;
    expect(()=>validateImageOutput({type:'float32',dims:[1,3,256,256],data})).toThrow('finite');
  });
  it('persists model identity and normalization, and rejects malformed metadata',()=>{
    const recipe=makeRecipe(analyse(new Uint8ClampedArray([80,90,100,255]),1,1));
    recipe.engine='wave';recipe.customModel={sha256:'a'.repeat(64),name:'user.onnx',inputRange:'signed',outputRange:'unit'};
    expect(parseRecipe(recipe).customModel).toEqual(recipe.customModel);
    expect(()=>parseRecipe({...recipe,customModel:{...recipe.customModel,sha256:'invalid'}})).toThrow();
    expect(()=>parseRecipe({...recipe,customModel:{...recipe.customModel,inputRange:'other'}})).toThrow();
    expect(parseRecipe({...recipe,customModel:undefined}).engine).toBe('wave');
  });
});
