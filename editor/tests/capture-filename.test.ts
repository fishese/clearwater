import {describe,expect,it} from 'vitest';
import {captureFilename} from '../src/core/capture-filename';

describe('capture filenames',()=>{
 it('uses local calendar date and zero-padded 24-hour time with the media extension',()=>{
  const date=new Date(2025,0,2,3,4,5);
  expect(captureFilename(date,'jpg')).toBe('CW_20250102_030405.jpg');
  expect(captureFilename(date,'mp4')).toBe('CW_20250102_030405.mp4');
 });
 it('uses the local year rather than an ISO UTC or week-year date',()=>{
  const date=new Date(2025,0,1,0,0,0);
  expect(captureFilename(date,'jpg')).toBe(`CW_${date.getFullYear()}0101_000000.jpg`);
 });
});
