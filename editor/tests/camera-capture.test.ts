import { describe, expect, it, vi } from 'vitest';
import { CAMERA_MAX_RECORDING_BYTES, CAMERA_MAX_RECORDING_MS, cameraRecordingLimitReached, chooseCameraVideoMimeType, makeCameraRecipe, pickCameraNeutral, stopStreamTracks } from '../src/core/camera-capture';
import { analyse } from '../src/core/engine';

describe('camera capture helpers', () => {
  it('selects the first supported MP4 profile and never substitutes WebM', () => {
    const supported = vi.fn((mime: string) => mime === 'video/mp4');
    expect(chooseCameraVideoMimeType(supported)).toBe('video/mp4');
    expect(supported.mock.calls.map(([mime]) => mime)).toEqual([
      'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4',
    ]);
    expect(chooseCameraVideoMimeType(mime => mime.includes('webm'))).toBeNull();
  });

  it('chooses a video-and-AAC MP4 profile when recording microphone audio', () => {
    const supported = vi.fn((mime: string) => mime === 'video/mp4;codecs=avc1,mp4a.40.2');
    expect(chooseCameraVideoMimeType(supported, true)).toBe('video/mp4;codecs=avc1,mp4a.40.2');
    expect(supported.mock.calls.map(([mime]) => mime)).toEqual([
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2',
    ]);
  });

  it('stops at either capture bound and remains active below both', () => {
    expect(CAMERA_MAX_RECORDING_MS).toBe(60_000);
    expect(CAMERA_MAX_RECORDING_BYTES).toBe(64 * 1024 * 1024);
    expect(cameraRecordingLimitReached(59_999, CAMERA_MAX_RECORDING_BYTES - 1)).toBe(false);
    expect(cameraRecordingLimitReached(60_000, 0)).toBe(true);
    expect(cameraRecordingLimitReached(0, 64 * 1024 * 1024)).toBe(true);
  });

  it('keeps Balanced defaults, applies the requested strength and eases analysis changes', () => {
    const blue = new Uint8ClampedArray(4 * 32).fill(0);
    const teal = new Uint8ClampedArray(4 * 32).fill(0);
    for (let i = 0; i < 32; i++) {
      blue[i * 4] = 30; blue[i * 4 + 1] = 100; blue[i * 4 + 2] = 190; blue[i * 4 + 3] = 255;
      teal[i * 4] = 120; teal[i * 4 + 1] = 150; teal[i * 4 + 2] = 45; teal[i * 4 + 3] = 255;
    }
    const first = makeCameraRecipe(analyse(blue, 8, 4), 0.8);
    const next = makeCameraRecipe(analyse(teal, 8, 4), 0.55, first);
    expect(first.engine).toBe('balanced');
    expect(first.strength).toBe(0.8);
    expect(next.strength).toBe(0.55);
    expect(next.auto.gains[0]).not.toBe(first.auto.gains[0]);
    expect(next.auto.gains[0]).not.toBe(makeCameraRecipe(analyse(teal, 8, 4)).auto.gains[0]);
  });

  it('stops every track and tolerates track stop failures', () => {
    const stopA = vi.fn();
    const stopB = vi.fn(() => { throw new Error('already ended'); });
    stopStreamTracks({ getTracks: () => [{ stop: stopA }, { stop: stopB }] as unknown as MediaStreamTrack[] });
    expect(stopA).toHaveBeenCalledOnce();
    expect(stopB).toHaveBeenCalledOnce();
    expect(() => stopStreamTracks(null)).not.toThrow();
  });
});

// The sampled live analysis must not erase a user-selected neutral point.
it('retains manual white balance across scene analysis',()=>{
 const first=makeCameraRecipe(analyse(new Uint8ClampedArray([40,110,130,255]),1,1));
 first.manual.neutral=[1.3,.9,.8];
 const next=makeCameraRecipe(analyse(new Uint8ClampedArray([60,100,120,255]),1,1),.8,first);
 expect(next.manual.neutral).toEqual([1.3,.9,.8]);
 expect(next.manual).not.toBe(first.manual);
});

it('neutralises a useful camera patch without changing the original recipe',()=>{
 const pixels=new Uint8ClampedArray([90,120,150,255]);
 const recipe=makeCameraRecipe(analyse(pixels,1,1),0);
 const picked=pickCameraNeutral(pixels,recipe);
 expect(picked?.manual.neutral).toEqual([120/90,1,120/150]);
 expect(recipe.manual.neutral).toEqual([1,1,1]);
 expect(picked?.auto).toEqual(recipe.auto);
});
it('rejects dark, clipped and empty white balance patches',()=>{
 const recipe=makeCameraRecipe(analyse(new Uint8ClampedArray([80,100,120,255]),1,1),0);
 for(const pixel of [[0,0,0,255],[255,255,255,255],[80,100,120,0]])expect(pickCameraNeutral(new Uint8ClampedArray(pixel),recipe)).toBeNull();
});
