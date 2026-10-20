import {Capacitor} from '@capacitor/core';
import {detectMediaPlatform,type MediaPlatform} from '../core/platform-limits';

/** Main-thread runtime. Native shells win over the WebView user agent. */
export function currentMediaPlatform():MediaPlatform {
 const nav=typeof navigator==='undefined'?undefined:navigator;
 return detectMediaPlatform({
  capacitorPlatform:Capacitor.getPlatform(),
  userAgent:nav?.userAgent??'',
  navigatorPlatform:nav?.platform??'',
  maxTouchPoints:nav?.maxTouchPoints??0,
 });
}
