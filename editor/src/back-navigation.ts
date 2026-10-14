export type BackAction =
 | 'busy' | 'clear-dialog' | 'custom-dialog' | 'save-dialog' | 'folder-browser'
 | 'neutral-picker' | 'settings' | 'about' | 'adjustments' | 'expanded' | 'correction-tab'
 | 'engine-tab' | 'confirm-exit' | 'exit';

export interface BackState {
 activeWork:boolean;
 clearDialog:boolean;
 customDialog:boolean;
 saveDialog:boolean;
 folderBrowser:boolean;
 neutralPicker:boolean;
 about:boolean;
 settings?:boolean;
 adjustmentsOpen:boolean;
 expanded:boolean;
 narrowControls:boolean;
 controlTab:'correction'|'enhancement'|'export';
 correctionTab:'engine'|'dive';
 lastBackAt:number;
 now:number;
}

export function nextBackAction(state:BackState):BackAction {
 if(state.settings)return 'settings';
 if(state.about)return 'about';
 if(state.activeWork)return 'busy';
 if(state.clearDialog)return 'clear-dialog';
 if(state.customDialog)return 'custom-dialog';
 if(state.saveDialog)return 'save-dialog';
 if(state.neutralPicker)return 'neutral-picker';
 if(state.adjustmentsOpen)return 'adjustments';
 if(state.expanded)return 'expanded';
 if(state.narrowControls&&state.controlTab!=='correction')return 'correction-tab';
 if(state.narrowControls&&state.correctionTab!=='engine')return 'engine-tab';
 if(state.folderBrowser)return 'folder-browser';
 return state.lastBackAt>0&&state.now-state.lastBackAt<=2000?'exit':'confirm-exit';
}
