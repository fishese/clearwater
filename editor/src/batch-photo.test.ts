import {describe,it,expect} from 'vitest';
import {BatchPhotoProcessor,BatchPhotoWorkerError,type BatchPhotoOptions} from './batch-photo';
import type {Analysis} from './core/types';

const analysis:Analysis={mean:[30,80,100],neutral:[30,80,100],p05:.1,p50:.4,p95:.9,clipping:0,redRatio:.3,magenta:1,confidence:'medium'};
const options:BatchPhotoOptions={engine:'balanced',hints:{scene:'underwater',filter:'yes',water:'blue',depth:12},balancedAfterAI:false,autoEnhance:true,format:'jpg',jpegQuality:.95,keepMetadata:true,resolution:'auto',device:{mobile:true},platform:'ios-safari'};
const custom:NonNullable<BatchPhotoOptions['custom']>={file:new Blob(['model']),config:{name:'Custom test model',sha256:'test-hash',inputRange:'unit',outputRange:'signed'}};
class FakeWorker extends EventTarget {
  messages:Record<string,unknown>[]=[];terminated=false;hold=false;closedImages=0;diagnostic:string|undefined;
  postMessage(message:Record<string,unknown>){
    this.messages.push(message);if(this.hold)return;
    queueMicrotask(()=>{
      const base={gen:message.gen,request:message.request};let data:Record<string,unknown>;
      if(message.type==='load'&&this.diagnostic)data={...base,type:'error',message:'Could not read photo.',diagnostic:this.diagnostic};
      else if(message.type==='load')data={...base,type:'loaded',analysis,original:{close:()=>this.closedImages++}};
      else if(message.type==='enhance')data={...base,type:'enhancement-ready',enhancement:{black:.03,white:.95,contrast:80,clarity:35,sharpness:25}};
      else if(message.type==='export')data={...base,type:'exported',blob:new Blob(['result'],{type:'image/jpeg'})};
      else data={...base,type:'custom-ready'};
      this.dispatchEvent(new MessageEvent('message',{data}));
    });
  }
  terminate(){this.terminated=true;}
}
describe('batch photo processing',()=>{
  it('analyses each photo independently and reuses its correction for auto enhance and export',async()=>{
    const worker=new FakeWorker(),processor=new BatchPhotoProcessor(worker as unknown as Worker);
    const file=new File(['first'],'a.jpg',{type:'image/jpeg'});
    const first=await processor.process(file,options);
    const second=await processor.process(new File(['second'],'b.jpg',{type:'image/jpeg'}),options);
    expect(worker.messages.map(m=>m.type)).toEqual(['load','enhance','export','load','enhance','export']);
    expect(worker.messages.filter(m=>m.type==='load').map(m=>m.gen)).toEqual([1,2]);
    expect(worker.closedImages).toBe(2);
    expect(first.recipe.hints).toEqual(options.hints);
    expect(first.recipe.enhancement?.autoApplied).toBe(true);
    expect(second.blob.type).toBe('image/jpeg');
    const firstExport=worker.messages.find(m=>m.type==='export')!;
    expect((firstExport.recipe as typeof first.recipe).enhancement).toEqual(first.recipe.enhancement);
    expect(firstExport.keepMetadata).toBe(true);
    processor.close();expect(worker.terminated).toBe(true);
  });
  it('does not add a Balanced follow-up to an AI model unless selected',async()=>{
    const worker=new FakeWorker(),processor=new BatchPhotoProcessor(worker as unknown as Worker);
    const result=await processor.process(new File(['a'],'a.png'),{...options,engine:'fivea',autoEnhance:false});
    expect(result.recipe.balancedAfterAI).toBeUndefined();
    expect(worker.messages.map(m=>m.type)).toEqual(['load','export']);
    processor.close();
  });
  it('cancels pending work and terminates its isolated worker',async()=>{
    const worker=new FakeWorker();worker.hold=true;
    const processor=new BatchPhotoProcessor(worker as unknown as Worker);
    const pending=processor.process(new File(['a'],'a.jpg'),options);
    processor.cancel();
    await expect(pending).rejects.toMatchObject({name:'AbortError'});
    expect(worker.terminated).toBe(true);
    await expect(processor.process(new File(['b'],'b.jpg'),options)).rejects.toMatchObject({name:'AbortError'});
    expect(worker.messages).toHaveLength(1);
  });
  it.each(['error','messageerror'])('rejects subsequent photos immediately after a terminal %s',async(event)=>{
    const worker=new FakeWorker();worker.hold=true;
    const processor=new BatchPhotoProcessor(worker as unknown as Worker);
    const pending=processor.process(new File(['a'],'a.jpg'),options);
    worker.dispatchEvent(new Event(event));
    await expect(pending).rejects.toBeInstanceOf(BatchPhotoWorkerError);
    await expect(processor.process(new File(['b'],'b.jpg'),options)).rejects.toBeInstanceOf(BatchPhotoWorkerError);
    expect(worker.terminated).toBe(true);
    expect(worker.messages).toHaveLength(1);
    processor.close();
  });
  it('recognizes initialization failure before the first request',async()=>{
    const worker=new FakeWorker(),processor=new BatchPhotoProcessor(worker as unknown as Worker);
    worker.dispatchEvent(new Event('error'));
    await expect(processor.process(new File(['a'],'a.jpg'),options)).rejects.toBeInstanceOf(BatchPhotoWorkerError);
    expect(worker.messages).toHaveLength(0);
    processor.close();
  });
  it('retains completed output and allows a fresh processor to restore a custom model after idle failure',async()=>{
    const waveOptions={...options,engine:'wave' as const,custom};
    const worker=new FakeWorker(),processor=new BatchPhotoProcessor(worker as unknown as Worker);
    await processor.prepareCustom(custom);
    const completed=await processor.process(new File(['a'],'a.jpg'),waveOptions);
    worker.dispatchEvent(new Event('error'));
    await expect(processor.prepareCustom(custom)).rejects.toBeInstanceOf(BatchPhotoWorkerError);
    await expect(processor.process(new File(['b'],'b.jpg'),waveOptions)).rejects.toBeInstanceOf(BatchPhotoWorkerError);
    expect(await completed.blob.text()).toBe('result');
    expect(worker.messages.map(m=>m.type)).toEqual(['custom-model','load','enhance','export']);
    processor.close();
    const freshWorker=new FakeWorker(),fresh=new BatchPhotoProcessor(freshWorker as unknown as Worker);
    await fresh.prepareCustom(custom);
    const retried=await fresh.process(new File(['b'],'b.jpg'),waveOptions);
    expect(freshWorker.messages[0]).toMatchObject({type:'custom-model',blob:custom.file,expectedConfig:custom.config});
    expect(retried.recipe.customModel).toEqual(custom.config);
    expect(retried.blob.size).toBeGreaterThan(0);
    fresh.close();
  });
  it('rejects custom-model initialization when the worker fails and prepares it on a fresh retry',async()=>{
    const worker=new FakeWorker();worker.hold=true;
    const processor=new BatchPhotoProcessor(worker as unknown as Worker);
    const pending=processor.prepareCustom(custom);
    worker.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toBeInstanceOf(BatchPhotoWorkerError);
    await expect(processor.process(new File(['a'],'a.jpg'),options)).rejects.toBeInstanceOf(BatchPhotoWorkerError);
    expect(worker.messages).toHaveLength(1);
    processor.close();
    const freshWorker=new FakeWorker(),fresh=new BatchPhotoProcessor(freshWorker as unknown as Worker);
    await fresh.prepareCustom(custom);
    expect(freshWorker.messages[0]).toMatchObject({type:'custom-model',inputRange:'unit',outputRange:'signed',expectedConfig:custom.config});
    fresh.close();
  });
  it('continues after a recoverable per-file worker response',async()=>{
    const worker=new FakeWorker(),processor=new BatchPhotoProcessor(worker as unknown as Worker);
    worker.diagnostic='CW/load/decode/EncodingError';
    await expect(processor.process(new File(['bad'],'bad.jpg'),options)).rejects.not.toBeInstanceOf(BatchPhotoWorkerError);
    worker.diagnostic=undefined;
    const result=await processor.process(new File(['good'],'good.jpg'),options);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(worker.terminated).toBe(false);
    processor.close();
  });
  it('shows only a recognized diagnostic code and requests diagnostics for batch work',async()=>{
    const worker=new FakeWorker(),processor=new BatchPhotoProcessor(worker as unknown as Worker);
    worker.diagnostic='CW/load/header/NotReadableError';
    await expect(processor.process(new File(['a'],'a.jpg'),options)).rejects.toThrow('CW/load/header/NotReadableError');
    expect(worker.messages[0].batchDiagnostic).toBe(true);
    worker.diagnostic='CW/load/header/private-file-path';
    await expect(processor.process(new File(['a'],'a.jpg'),options)).rejects.toThrow(/^Could not read photo\.$/);
    processor.close();
  });
});
