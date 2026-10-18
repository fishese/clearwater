import {afterEach,expect,it,vi} from 'vitest';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});

async function loadInstall(){
 const handlers=new Map<string,(event:Event)=>void>();
 vi.stubGlobal('window',{
  addEventListener:(name:string,handler:(event:Event)=>void)=>handlers.set(name,handler),
  matchMedia:()=>({matches:false,addEventListener:()=>{}}),
 });
 vi.stubGlobal('navigator',{userAgent:'Mozilla/5.0',platform:'Win32',maxTouchPoints:0});
 vi.resetModules();
 return {install:await import('./web-install'),dispatch:(name:string,event:Event)=>handlers.get(name)?.(event)};
}

it('keeps an install prompt received before Settings subscribes',async()=>{
 const {install,dispatch}=await loadInstall();
 const prompt=vi.fn(async()=>{});
 const event=Object.assign(new Event('beforeinstallprompt',{cancelable:true}),{prompt,userChoice:Promise.resolve({outcome:'accepted' as const})});
 dispatch('beforeinstallprompt',event);
 expect(event.defaultPrevented).toBe(true);
 expect(install.getWebInstallState()).toBe('prompt');
 expect(await install.promptWebInstall()).toBe('accepted');
 expect(prompt).toHaveBeenCalledOnce();
 expect(install.getWebInstallState()).toBe('manual');
 dispatch('appinstalled',new Event('appinstalled'));
 expect(install.getWebInstallState()).toBe('installed');
});

it('recognizes iPad desktop user agents for install instructions',async()=>{
 const {install}=await loadInstall();
 expect(install.browserDevice('Mozilla/5.0 (Macintosh)','MacIntel',5)).toBe('ios');
 expect(install.browserDevice('Mozilla/5.0 (Linux; Android 16)','Linux armv8l',5)).toBe('android');
 expect(install.browserDevice('Mozilla/5.0 (Macintosh)','MacIntel',0)).toBe('desktop');
});
