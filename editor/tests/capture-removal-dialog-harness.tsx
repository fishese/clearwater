import {createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import CaptureRemovalDialog from '../src/CaptureRemovalDialog';
import {setLanguage} from '../src/i18n';

declare global {interface Window {captureDialogTest?:any}}

let root:Root|undefined;
export function mountCaptureRemovalDialog(element:HTMLElement,props:React.ComponentProps<typeof CaptureRemovalDialog>){
 root=createRoot(element);root.render(createElement(CaptureRemovalDialog,props));
 return {
  render:(next:React.ComponentProps<typeof CaptureRemovalDialog>)=>root?.render(createElement(CaptureRemovalDialog,next)),
  unmount:()=>{root?.unmount();root=undefined;},
  setLanguage
 };
}
