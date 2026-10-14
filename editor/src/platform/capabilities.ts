import {Capacitor} from '@capacitor/core';

export type AppPlatform='ios'|'android'|'web'|'unknown';
export type PlatformCapabilities={
 platform:AppPlatform;
 nativeShell:boolean;
 nativeCamera:boolean;
 webStreamCamera:boolean;
 nativeMediaSave:boolean;
 androidLinkedCapture:boolean;
 androidHdrConversion:boolean;
 webServiceWorkerUpdates:boolean;
 bundledModels:boolean;
 videoEditing:boolean;
 videoExport:boolean;
};

/** Derive app behavior from explicit platform facts rather than assuming every non-Android host is a browser. */
export function platformCapabilities(platform:AppPlatform,nativeShell=platform==='ios'||platform==='android',nativeMediaSave=false):PlatformCapabilities{
 const android=platform==='android',ios=platform==='ios',web=platform==='web';
 return {
  platform,nativeShell,
  // The Android and browser camera is implemented with getUserMedia. The iOS shell
  // must wait for the separate AVFoundation plugin instead of opening that path.
  nativeCamera:false,
  webStreamCamera:!ios,
  nativeMediaSave:ios&&nativeMediaSave,
  androidLinkedCapture:android,
  androidHdrConversion:android,
  webServiceWorkerUpdates:web,
  bundledModels:nativeShell,
  videoEditing:false,
  videoExport:false,
 };
}

function currentPlatform():AppPlatform{
 const platform=Capacitor.getPlatform();
 return platform==='ios'||platform==='android'||platform==='web'?platform:'unknown';
}

export function getPlatformCapabilities():PlatformCapabilities{
 const platform=currentPlatform();
 const nativeMediaSave=platform==='ios'&&Capacitor.isPluginAvailable('ClearWaterExport');
 const videoEditing=typeof VideoDecoder!=='undefined'&&typeof OffscreenCanvas!=='undefined';
 const videoExport=videoEditing&&typeof VideoEncoder!=='undefined'&&(platform!=='ios'||nativeMediaSave);
 return {...platformCapabilities(platform,Capacitor.isNativePlatform(),nativeMediaSave),videoEditing,videoExport};
}
