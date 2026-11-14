import {makePhotoRecipe,suggest} from './core/engine';
import {isAIEngine} from './core/bundled-models';
import type {Analysis,CustomModel,Hints,PhotoEnhancement,Recipe} from './core/types';
import type {PhotoDevice,PhotoResolution} from './core/photo-size';
import type {MediaPlatform} from './core/platform-limits';
import {PlatformLimitError,presentMediaError} from './core/platform-limits';
import {mediaLimit} from './core/media';

/** A separate worker owns the batch so it cannot supersede the open editor. */
export interface BatchPhotoOptions {
  engine:Recipe['engine']; hints:Hints; balancedAfterAI:boolean; autoEnhance:boolean;
  format:'jpg'|'png'; jpegQuality:.95|.99; keepMetadata:boolean;
  resolution:PhotoResolution; device:PhotoDevice; platform:MediaPlatform;
  custom?:{file:Blob;config:CustomModel};
}
type WorkerResponse={type:string;gen:number;request?:number;operation?:string;message?:string;diagnostic?:string;analysis?:Analysis;enhancement?:PhotoEnhancement;blob?:Blob;metadataWarning?:string;original?:ImageBitmap;progress?:number};
type WorkerLike=Pick<Worker,'postMessage'|'terminate'|'addEventListener'|'removeEventListener'>;

export class BatchPhotoProcessor {
  private generation=0;
  private request=0;
  private closed=false;
  private busy=false;
  private pendingCancel:(()=>void)|null=null;
  constructor(private worker:WorkerLike) {}
  private waitFor(message:Record<string,unknown>,expected:string,progress?:(n:number)=>void):Promise<WorkerResponse> {
    if(this.closed)return Promise.reject(new DOMException('Batch cancelled.','AbortError'));
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{this.worker.removeEventListener('message',receive);this.worker.removeEventListener('error',failed);this.worker.removeEventListener('messageerror',failed);this.pendingCancel=null;};
      const cancel=()=>{cleanup();reject(new DOMException('Batch cancelled.','AbortError'));};
      const failed=()=>{cleanup();reject(new Error('The photo processing worker stopped.'));};
      const receive=(event:Event)=>{
        const data=(event as MessageEvent<WorkerResponse>).data;
        if(!data||data.gen!==message.gen)return;
        if(data.type==='progress'&&data.request===message.request){progress?.(data.progress??0);return;}
        if(data.type==='error'&&(data.request===message.request||message.type==='load'||message.type==='custom-model')){cleanup();const code=/^CW\/(load|enhance|export|custom-model)\/(start|header|decode|resize|analysis)\/(Error|AbortError|EncodingError|InvalidStateError|NotReadableError|NotSupportedError|OperationError|QuotaExceededError|RangeError|SecurityError|TypeError)$/.test(data.diagnostic??'')?` (${data.diagnostic})`:'';reject(new Error((data.message||'The photo could not be processed.')+code));return;}
        if(data.type!==expected||(message.request!==undefined&&data.request!==message.request))return;
        cleanup();resolve(data);
      };
      this.pendingCancel=cancel;
      this.worker.addEventListener('message',receive);this.worker.addEventListener('error',failed);this.worker.addEventListener('messageerror',failed);
      try{this.worker.postMessage({...message,batchDiagnostic:true});}catch(error){cleanup();reject(error);}
    });
  }
  async prepareCustom(custom:NonNullable<BatchPhotoOptions['custom']>):Promise<void> {
    await this.waitFor({type:'custom-model',gen:this.generation,permission:true,blob:custom.file,name:custom.config.name,inputRange:custom.config.inputRange,outputRange:custom.config.outputRange,expectedConfig:custom.config},'custom-ready');
  }
  async process(file:File,options:BatchPhotoOptions,progress?:(n:number)=>void):Promise<{blob:Blob;recipe:Recipe;metadataWarning?:string}> {
    if(this.busy)throw new Error('Another batch photo is already being processed.');
    this.busy=true;
    try{
    const limit=mediaLimit(file,options.platform);if(file.size>limit)throw new Error(presentMediaError(new PlatformLimitError('photo-too-large',options.platform,{unit:'bytes',actual:file.size,limit}),options.platform));
    const gen=++this.generation;
    const loaded=await this.waitFor({type:'load',gen,blob:file,photoResolution:options.resolution,photoDevice:options.device,platform:options.platform},'loaded');
    loaded.original?.close();
    if(!loaded.analysis)throw new Error('Photo analysis is unavailable.');
    const recipe=makePhotoRecipe(loaded.analysis,structuredClone(options.hints));
    recipe.engine=options.engine;
    recipe.auto=suggest(loaded.analysis,recipe.hints,recipe.engine);
    if(isAIEngine(recipe.engine)&&options.balancedAfterAI)recipe.balancedAfterAI={strength:.3};
    else delete recipe.balancedAfterAI;
    if(recipe.engine==='wave'){
      if(!options.custom)throw new Error('Load the custom model before starting the batch.');
      recipe.customModel=options.custom.config;
    }
    if(options.autoEnhance){
      const result=await this.waitFor({type:'enhance',gen,request:++this.request,recipe,platform:options.platform},'enhancement-ready');
      if(!result.enhancement)throw new Error('Auto enhance did not return settings.');
      recipe.enhancement={...result.enhancement,autoApplied:true};
    }
    const result=await this.waitFor({type:'export',gen,request:++this.request,recipe,format:options.format,jpegQuality:options.jpegQuality,keepMetadata:options.keepMetadata,platform:options.platform},'exported',progress);
    if(!result.blob?.size)throw new Error('The photo export was empty.');
    return {blob:result.blob,recipe,metadataWarning:result.metadataWarning};
    }finally{this.busy=false;}
  }
  cancel():void {if(this.closed)return;this.closed=true;this.pendingCancel?.();this.worker.terminate();}
  close():void {this.cancel();}
}
