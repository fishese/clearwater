import { describe, expect, it } from 'vitest';
import { cameraNextZoomPreset, cameraZoomPresets, cameraZoomValue, labeledRearCameras } from '../src/core/camera-zoom';

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
});
