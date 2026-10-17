import {describe,expect,it,vi} from 'vitest';
import {isIOSWebBrowser,shareWebFile} from '../src/export-share';

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

  it('opens the share sheet on iPhone Safari when canShare rejects the file',async()=>{
    const shared:Array<{name:string;type:string;size:number}>=[];
    const nav={
      canShare:()=>false,
      share:vi.fn(async(data:{files:File[]})=>{shared.push({name:data.files[0].name,type:data.files[0].type,size:data.files[0].size});}),
    };
    await shareWebFile(jpeg(),'dive-restore.jpg',nav,true);
    expect(shared).toEqual([{name:'dive-restore.jpg',type:'image/jpeg',size:4}]);
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
