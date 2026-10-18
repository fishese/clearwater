import {describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({platform:'web'}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=>state.platform,isPluginAvailable:()=>false},registerPlugin:()=>({})}));
import {isIOSWebBrowser,shareWebFile,supportsFileShare} from '../src/export-share';

const jpeg=()=>new Blob([Uint8Array.from([0xff,0xd8,0xff,0xd9])],{type:'image/jpeg'});

describe('iPhone Safari save',()=>{
  it('recognises iPhone and iPad browsers without treating the native app as Safari',()=>{
    expect(isIOSWebBrowser('web','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/605.1.15')).toBe(true);
    expect(isIOSWebBrowser('web','Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/605.1.15')).toBe(true);
    expect(isIOSWebBrowser('web','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15','MacIntel',5)).toBe(true);
    expect(isIOSWebBrowser('web','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36','Win32',0)).toBe(false);
    expect(isIOSWebBrowser('web','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15','MacIntel',0)).toBe(false);
    expect(isIOSWebBrowser('ios','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148')).toBe(false);
  });

  it('keeps iOS Chrome on the share sheet without treating PC or Android Chrome as iOS',async()=>{
    const crios='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
    const ipadCriosDesktop='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Version/18.6 Mobile/15E148 Safari/604.1';
    const windowsChrome='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
    const macChromeTouch='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
    const androidChrome='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
    expect(isIOSWebBrowser('web',crios,'iPhone',5)).toBe(true);
    expect(isIOSWebBrowser('web',ipadCriosDesktop,'MacIntel',5)).toBe(true);
    expect(isIOSWebBrowser('web',windowsChrome,'Win32',0)).toBe(false);
    expect(isIOSWebBrowser('web',macChromeTouch,'MacIntel',10)).toBe(false);
    expect(isIOSWebBrowser('web',androidChrome,'Linux aarch64',5)).toBe(false);
    expect(isIOSWebBrowser('android',androidChrome,'Linux aarch64',5)).toBe(false);
    expect(isIOSWebBrowser('android',crios,'Linux aarch64',5)).toBe(false);
    const share=vi.fn(async()=>{});
    const nav={canShare:()=>false,share};
    await expect(shareWebFile(jpeg(),'dive-restore.jpg',nav,isIOSWebBrowser('web',windowsChrome,'Win32',0))).rejects.toThrow('This browser cannot share this file.');
    await expect(shareWebFile(jpeg(),'dive-restore.jpg',nav,isIOSWebBrowser('web',macChromeTouch,'MacIntel',10))).rejects.toThrow('This browser cannot share this file.');
    await expect(shareWebFile(jpeg(),'dive-restore.jpg',nav,isIOSWebBrowser('web',androidChrome,'Linux aarch64',5))).rejects.toThrow('This browser cannot share this file.');
    expect(share).not.toHaveBeenCalled();
    await shareWebFile(jpeg(),'dive-restore.jpg',nav,isIOSWebBrowser('web',crios,'iPhone',5));
    expect(share).toHaveBeenCalledOnce();
  });

  it('opens the share sheet on iPhone Safari when canShare rejects the file',async()=>{
    const shared:Array<{name:string;type:string;size:number}>=[];
    const nav={
      canShare:()=>false,
      share:vi.fn(async(data:{files:File[]})=>{shared.push({name:data.files[0].name,type:data.files[0].type,size:data.files[0].size});}),
    };
    await shareWebFile(jpeg(),'dive-restore.jpg',nav,true);
    expect(shared).toEqual([{name:'dive-restore.jpg',type:'image/jpeg',size:4}]);
  });

  it('supports iPhone Safari share when canShare is absent',()=>{
    vi.stubGlobal('navigator',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/605.1.15',platform:'iPhone',maxTouchPoints:5,share:vi.fn()});
    expect(supportsFileShare()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('shares only the named recipe JSON file on the web',async()=>{
    const share=vi.fn(async()=>{}),nav={canShare:()=>true,share};
    await shareWebFile(new Blob(['{"engine":"balanced"}'],{type:'application/json'}),'clearwater-recipe.json',nav,false);
    expect(share).toHaveBeenCalledWith({files:[expect.objectContaining({name:'clearwater-recipe.json',type:'application/json'})]});
    await expect(shareWebFile(new Blob(['{}'],{type:'application/json'}),'other.json',nav,false)).rejects.toThrow('type cannot be shared');
  });

  it('does not share from desktop Chrome when canShare rejects the file',async()=>{
    const share=vi.fn();
    await expect(shareWebFile(jpeg(),'dive-restore.jpg',{canShare:()=>false,share},false)).rejects.toThrow('This browser cannot share this file.');
    expect(share).not.toHaveBeenCalled();
  });

  it('lets the user cancel the iPhone share sheet',async()=>{
    const nav={
      canShare:()=>true,
      share:async()=>{throw new DOMException('cancelled','AbortError');},
    };
    await expect(shareWebFile(jpeg(),'dive-restore.jpg',nav,true)).rejects.toMatchObject({name:'AbortError'});
  });
});
