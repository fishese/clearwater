import {describe,expect,it} from 'vitest';
import {nextBackAction,type BackState} from '../src/back-navigation';

const state=(overrides:Partial<BackState>={}):BackState=>({activeWork:false,clearDialog:false,customDialog:false,saveDialog:false,folderBrowser:false,neutralPicker:false,about:false,adjustmentsOpen:false,expanded:false,narrowControls:false,controlTab:'correction',correctionTab:'engine',lastBackAt:0,now:10,...overrides});

describe('system Back action selection',()=>{
 it('returns Settings to its parent before leaving About',()=>{expect(nextBackAction(state({settings:true,about:true,activeWork:true}))).toBe('settings');});
 it('keeps active processing and saves safe, while About returns to the editor',()=>{
  expect(nextBackAction(state({activeWork:true}))).toBe('busy');
  expect(nextBackAction(state({activeWork:true,about:true}))).toBe('about');
 });
 it('dismisses dialogs and neutral picking before leaving editor views',()=>{
  expect(nextBackAction(state({clearDialog:true,customDialog:true}))).toBe('clear-dialog');
  expect(nextBackAction(state({customDialog:true}))).toBe('custom-dialog');
  expect(nextBackAction(state({saveDialog:true}))).toBe('save-dialog');
  expect(nextBackAction(state({neutralPicker:true,expanded:true}))).toBe('neutral-picker');
 });
 it('collapses adjustments before expanded view and restores narrow tabs',()=>{
  expect(nextBackAction(state({adjustmentsOpen:true,expanded:true}))).toBe('adjustments');
  expect(nextBackAction(state({expanded:true}))).toBe('expanded');
  expect(nextBackAction(state({narrowControls:true,controlTab:'enhancement',correctionTab:'dive'}))).toBe('correction-tab');
  expect(nextBackAction(state({narrowControls:true,correctionTab:'dive'}))).toBe('engine-tab');
 });
 it('requires a second root Back within two seconds',()=>{
  expect(nextBackAction(state())).toBe('confirm-exit');
  expect(nextBackAction(state({lastBackAt:100,now:2099}))).toBe('exit');
  expect(nextBackAction(state({lastBackAt:100,now:2101}))).toBe('confirm-exit');
 });
});
