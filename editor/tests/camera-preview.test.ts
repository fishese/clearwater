import { describe, expect, it } from 'vitest';
import { createCameraPreview, getCameraPreviewSize } from '../src/core/camera-preview';

describe('camera preview', () => {
  it('caps the GPU upload size at 1280 by 720 while preserving aspect ratio', () => {
    expect(getCameraPreviewSize(3840, 2160)).toEqual([1280, 720]);
    expect(getCameraPreviewSize(640, 480)).toEqual([640, 480]);
    expect(getCameraPreviewSize(1920, 1080)).toEqual([1280, 720]);
  });

  it('reports the supported message when WebGL is unavailable', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => createCameraPreview(canvas)).toThrow('Live correction needs WebGL on this device.');
  });
});
