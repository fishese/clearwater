import { describe, expect, it, vi } from 'vitest';
import { cameraApplyNativeAutoZoom, cameraNativeAutoRange, cameraNativeZoomChoice, cameraNextZoomPreset, cameraZoomPresets, cameraZoomValue, labeledRearCameras } from '../src/core/camera-zoom';

describe('camera zoom capabilities', () => {
  it('builds cycle stops from the active camera capability range', () => {
    expect(cameraZoomPresets({ min: 1, max: 4, step: 0.1 })).toEqual([1, 2, 3, 4]);
    expect(cameraNextZoomPreset(1, [1, 2, 3, 4])).toBe(2);
    expect(cameraNextZoomPreset(4, [1, 2, 3, 4])).toBe(1);
  });

  it('limits tap cycling to useful standard stops while keeping high zoom in the slider', () => {
    expect(cameraZoomPresets({ min: 0.5, max: 100, step: 0.25 })).toEqual([0.5, 1, 2, 3, 5, 10]);
    expect(cameraZoomPresets({ min: 12, max: 100, step: 1 })).toEqual([12]);
    expect(cameraZoomPresets({ min: 1, max: 9.5, step: 0.5 })).toContain(9.5);
  });

  it('includes 1× only when the reported range and step support it', () => {
    expect(cameraZoomPresets({ min: 0.5, max: 2, step: 0.25 })).toEqual([0.5, 1, 2]);
    expect(cameraZoomPresets({ min: 1.2, max: 2, step: 0.2 })).toEqual([1.2, 2]);
    expect(cameraZoomValue(1.37, { min: 0.5, max: 2, step: 0.25 })).toBe(1.25);
  });

  it('omits unsupported zoom ranges and cycles safely from an intermediate value', () => {
    expect(cameraZoomPresets(undefined)).toEqual([]);
    expect(cameraZoomPresets({ min: 0, max: 2 })).toEqual([]);
    expect(cameraNextZoomPreset(2, [])).toBeNull();
    expect(cameraNextZoomPreset(1.4, [1, 2])).toBe(2);
    expect(cameraNextZoomPreset(2.4, [1, 2])).toBe(1);
  });

  it('returns only rear cameras with trustworthy browser labels', () => {
    const devices = [
      { kind: 'videoinput', label: 'Back Camera 0' },
      { kind: 'videoinput', label: 'Wide rear camera' },
      { kind: 'videoinput', label: 'Camera 2' },
      { kind: 'audioinput', label: 'Rear microphone' },
    ] as MediaDeviceInfo[];
    expect(labeledRearCameras(devices).map(device => device.label)).toEqual(['Back Camera 0', 'Wide rear camera']);
  });

  it('chooses the reported 5.1× Android module for 5× and clamps its local minimum', async () => {
    const lenses = [
      { id: 'wide', facing: 'environment' as const, intrinsicZoom: 1, minZoom: 1, maxZoom: 10 },
      { id: 'tele', facing: 'environment' as const, intrinsicZoom: 5.1, minZoom: 1, maxZoom: 20 },
      { id: 'front', facing: 'user' as const, intrinsicZoom: 1, minZoom: 1, maxZoom: 10 },
    ];
    const info = { lenses, lensId: 'wide', zoom: 1, minZoom: 1, maxZoom: 10 };
    const setLens = vi.fn(async (lensId: string) => ({ ...info, lensId, zoom: 1, minZoom: 1, maxZoom: 20 }));
    const setZoom = vi.fn(async (ratio: number) => ({ zoom: ratio }));
    const result = await cameraApplyNativeAutoZoom(info, 5, 'environment', { setLens, setZoom });
    expect(setLens).toHaveBeenCalledWith('tele');
    expect(setZoom).toHaveBeenCalledWith(1);
    expect(result.zoom * 5.1).toBeCloseTo(5.1);
    expect(cameraNativeAutoRange(lenses, 'wide', 'environment', { min: 1, max: 10 })).toEqual({ min: 1, max: 102 });
  });

  it('selects a native 4× iPhone lens at 5× with a 1.25× local crop', async () => {
    const lenses = [
      { id: 'wide', facing: 'environment' as const, intrinsicZoom: 1, minZoom: 1, maxZoom: 10 },
      { id: 'tele', facing: 'environment' as const, intrinsicZoom: 4, minZoom: 1, maxZoom: 10 },
    ];
    const info = { lenses, lensId: 'wide', zoom: 1, minZoom: 1, maxZoom: 10 };
    const calls: string[] = [];
    const result = await cameraApplyNativeAutoZoom(info, 5, 'environment', {
      setLens: async lensId => { calls.push(`lens:${lensId}`); return { ...info, lensId, zoom: 1 }; },
      setZoom: async ratio => { calls.push(`zoom:${ratio}`); return { zoom: ratio }; },
    });
    expect(calls).toEqual(['lens:tele', 'zoom:1.25']);
    expect(result.zoom * 4).toBe(5);
    expect(cameraNativeZoomChoice(lenses, 'wide', 'environment', 3, { min: 1, max: 10 })?.lensId).toBe('wide');
  });

  it('falls back to the active wide lens when a reported telephoto bind fails', async () => {
    const lenses = [
      { id: 'wide', facing: 'environment' as const, intrinsicZoom: 1, minZoom: 1, maxZoom: 10 },
      { id: 'tele', facing: 'environment' as const, intrinsicZoom: 5.1, minZoom: 1, maxZoom: 20 },
    ];
    const info = { lenses, lensId: 'wide', zoom: 1, minZoom: 1, maxZoom: 10 };
    const setZoom = vi.fn(async (ratio: number) => ({ zoom: ratio }));
    const result = await cameraApplyNativeAutoZoom(info, 5, 'environment', {
      setLens: async () => { throw new Error('Camera bind failed'); },
      setZoom,
    });
    expect(setZoom).toHaveBeenCalledWith(5);
    expect(result).toMatchObject({ lensId: 'wide', zoom: 5 });
  });

  it('does not choose a front camera or unknown lens for a rear request and keeps an active front lens', () => {
    const lenses = [
      { id: 'wide', facing: 'environment' as const, intrinsicZoom: 1, minZoom: 1, maxZoom: 10 },
      { id: 'unknown', facing: 'environment' as const, minZoom: 1, maxZoom: 20 },
      { id: 'front', facing: 'user' as const, intrinsicZoom: 1, minZoom: 1, maxZoom: 10 },
      { id: 'front-crop', facing: 'user' as const, intrinsicZoom: 1.2, minZoom: 1, maxZoom: 10 },
    ];
    expect(cameraNativeZoomChoice(lenses, 'wide', 'environment', 5, { min: 1, max: 10 })?.lensId).toBe('wide');
    expect(cameraNativeZoomChoice(lenses, 'front', 'user', 2, { min: 1, max: 10 })?.lensId).toBe('front');
  });
});
