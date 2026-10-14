import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('camera recording settings', () => {
  it('defaults to Auto and persists quality and duration without losing either setting', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const camera = await import('../src/core/camera-settings');
    expect(camera.getCameraSettings()).toEqual({ minutes: 1, quality: 'auto' });
    const listener = vi.fn();
    camera.subscribeCameraSettings(listener);

    camera.setCameraMinutes(3);
    expect(camera.getCameraSettings()).toEqual({ minutes: 3, quality: 'auto' });
    camera.setCameraQuality('high');
    camera.setCameraMinutes(5);
    expect(camera.getCameraSettings()).toEqual({ minutes: 5, quality: 'high' });
    expect(JSON.parse(values.get('clearwater-camera-settings')!)).toEqual({ minutes: 5, quality: 'high' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('migrates existing duration settings and defaults a missing or invalid quality to Auto', async () => {
    const values = new Map<string, string>([['clearwater-camera-settings', JSON.stringify({ minutes: 3 })]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const camera = await import('../src/core/camera-settings');
    expect(camera.getCameraSettings()).toEqual({ minutes: 3, quality: 'auto' });

    vi.resetModules();
    values.set('clearwater-camera-settings', JSON.stringify({ minutes: 5, quality: 'ultra' }));
    const migrated = await import('../src/core/camera-settings');
    expect(migrated.getCameraSettings()).toEqual({ minutes: 5, quality: 'auto' });
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
      estimatedStorageMB: 390,
    });
  });

  it('scales estimates by selected quality and keeps high recordings under the input ceiling', async () => {
    const { cameraRecordingBudget } = await import('../src/core/camera-settings');
    const high = { id: 'high' as const, videoBitrate: 12_000_000, audioBitrate: 192_000 };
    expect(cameraRecordingBudget(1, high)).toMatchObject({
      maxBytes: 128 * 1024 * 1024,
      estimatedFileMB: 92,
      estimatedPeakRamMB: { min: 350, max: 600 },
      estimatedStorageMB: 190,
    });
    expect(cameraRecordingBudget(3, high)).toMatchObject({
      maxBytes: 3 * 128 * 1024 * 1024,
      estimatedFileMB: 275,
      estimatedPeakRamMB: { min: 700, max: 1100 },
      estimatedStorageMB: 550,
    });
    expect(cameraRecordingBudget(5, high)).toMatchObject({
      maxBytes: 500 * 1024 * 1024,
      estimatedFileMB: 458,
      estimatedPeakRamMB: { min: 1100, max: 1600 },
      estimatedStorageMB: 920,
    });
  });
});
