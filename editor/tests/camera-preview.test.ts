import { describe, expect, it } from 'vitest';
import { cameraColourMatrixForWebGl, createCameraPreview, getCameraPreviewSize } from '../src/core/camera-preview';
import { cameraQualityProfile } from '../src/core/camera-quality';

describe('camera preview', () => {
  it('caps the GPU upload size at 1280 by 720 while preserving aspect ratio', () => {
    expect(getCameraPreviewSize(3840, 2160)).toEqual([1280, 720]);
    expect(getCameraPreviewSize(640, 480)).toEqual([640, 480]);
    expect(getCameraPreviewSize(1920, 1080)).toEqual([1280, 720]);
  });

  it('selects the Android high profile automatically and keeps web on standard', () => {
    expect(cameraQualityProfile('auto', true)).toMatchObject({
      id: 'high', maxWidth: 1920, maxHeight: 1080, videoBitrate: 12_000_000, audioBitrate: 192_000,
    });
    expect(cameraQualityProfile('auto', false)).toMatchObject({
      id: 'standard', maxWidth: 1280, maxHeight: 720, videoBitrate: 5_000_000, audioBitrate: 128_000,
    });
    expect(cameraQualityProfile('high', false).jpegQuality).toBe(0.97);
    expect(cameraQualityProfile('standard', true).jpegQuality).toBe(0.94);
  });

  it('uses the selected profile as the preview ceiling without upscaling smaller camera frames', () => {
    const high = cameraQualityProfile('high', true);
    expect(getCameraPreviewSize(3840, 2160, high)).toEqual([1920, 1080]);
    expect(getCameraPreviewSize(1920, 1080, high)).toEqual([1920, 1080]);
    expect(getCameraPreviewSize(640, 480, high)).toEqual([640, 480]);
    expect(getCameraPreviewSize(3840, 2160)).toEqual([1280, 720]);
  });

  it('keeps portrait camera frames within the orientation-aware long and short edge limits', () => {
    expect(getCameraPreviewSize(608, 1080)).toEqual([608, 1080]);
    expect(getCameraPreviewSize(1080, 1920, cameraQualityProfile('high', true))).toEqual([1080, 1920]);
    expect(getCameraPreviewSize(2160, 3840)).toEqual([720, 1280]);
  });

  it('maps row-wise RGB affine coefficients to the shader matrix without transposing channels', () => {
    const shaderMatrix = cameraColourMatrixForWebGl([1, 2, 3, .1, 4, 5, 6, .2, 7, 8, 9, .3]);
    expect(Array.from(shaderMatrix.slice(0, 12))).toEqual([1, 4, 7, 0, 2, 5, 8, 0, 3, 6, 9, 0]);
    expect(shaderMatrix[12]).toBeCloseTo(.1);
    expect(shaderMatrix[13]).toBeCloseTo(.2);
    expect(shaderMatrix[14]).toBeCloseTo(.3);
    expect(shaderMatrix[15]).toBe(1);
    expect(() => cameraColourMatrixForWebGl([1, 2])).toThrow('Invalid camera colour matrix.');
  });

  it('reports the supported message when WebGL is unavailable', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => createCameraPreview(canvas)).toThrow('Live correction needs WebGL on this device.');
  });
});
