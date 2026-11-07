import {describe,it,expect} from 'vitest';
import {BatchPhotoProcessor,type BatchPhotoOptions} from './batch-photo';
import type {Analysis} from './core/types';

const analysis:Analysis={mean:[30,80,100],neutral:[30,80,100],p05:.1,p50:.4,p95:.9,clipping:0,redRatio:.3,magenta:1,confidence:'medium'};
const options:BatchPhotoOptions={engine:'balanced',hints:{scene:'underwater',filter:'yes',water:'blue',depth:12},balancedAfterAI:false,autoEnhance:true,format:'jpg',jpegQuality:.95,keepMetadata:true,resolution:'auto',device:{mobile:true},platform:'ios-safari'};
class FakeWorker extends EventTarget {
  messages:Record<string,unknown>[]=[];terminated=false;hold=false;closedImages=0;
  postMessage(message:Record<string,unknown>){
    this.messages.push(message);if(this.hold)return;
    queueMicrotask(()=>{
      const base={gen:message.gen,request:message.request};let data:Record<string,unknown>;
      if(message.type==='load')data={...base,type:'loaded',analysis,original:{close:()=>this.closedImages++}};
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
  });
});
