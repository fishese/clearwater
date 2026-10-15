/// <reference lib="webworker" />
import { fitColour } from './core/video-colour';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let latestRequest = 0;
let modelTask: Promise<typeof import('./models')> | undefined;

ctx.onmessage = async ({ data }: MessageEvent<{ request: number; pixels: ArrayBuffer }>) => {
  const { request, pixels } = data;
  latestRequest = request;
  try {
    ctx.postMessage({ type: 'status', request, status: 'loading' });
    const models = await (modelTask ??= import('./models'));
    if (request !== latestRequest) return;
    const size = 256;
    const input = new Uint8ClampedArray(pixels);
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!context) throw new Error('Could not sample the camera frame for Five A+.');
    context.putImageData(new ImageData(input, size, size), 0, 0);
    const residual = await models.inferField('fivea', canvas);
    if (request !== latestRequest) return;
    const matrix = fitColour(input, residual);
    ctx.postMessage({ type: 'result', request, matrix });
  } catch (cause) {
    if (request !== latestRequest) return;
    modelTask = undefined;
    ctx.postMessage({
      type: 'error', request,
      message: cause instanceof Error ? cause.message : 'Five A+ camera colour assist failed.',
    });
  }
};
