import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('camera recording settings', () => {
  it('uses one minute by default and persists duration changes', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const camera = await import('../src/core/camera-settings');
    expect(camera.getCameraSettings()).toEqual({ minutes: 1 });
    const listener = vi.fn();
    camera.subscribeCameraSettings(listener);

    camera.setCameraMinutes(3);
    expect(camera.getCameraSettings()).toEqual({ minutes: 3 });
    expect(JSON.parse(values.get('clearwater-camera-settings')!)).toEqual({ minutes: 3 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('provides duration-scaled limits and device-dependent resource estimates', async () => {
    const { cameraRecordingBudget } = await import('../src/core/camera-settings');
    expect(cameraRecordingBudget(1)).toMatchObject({
      maxMs: 60_000,
      maxBytes: 64 * 1024 * 1024,
      estimatedFileMB: 39,
      estimatedPeakRamMB: { min: 200, max: 400 },
      estimatedStorageMB: 80,
    });
    expect(cameraRecordingBudget(3)).toMatchObject({
      maxMs: 180_000,
      maxBytes: 3 * 64 * 1024 * 1024,
      estimatedFileMB: 116,
      estimatedPeakRamMB: { min: 350, max: 600 },
      estimatedStorageMB: 240,
    });
    expect(cameraRecordingBudget(5)).toMatchObject({
      maxMs: 300_000,
      maxBytes: 5 * 64 * 1024 * 1024,
      estimatedFileMB: 193,
      estimatedPeakRamMB: { min: 500, max: 800 },
      estimatedStorageMB: 400,
    });
  });
});
