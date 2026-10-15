import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraAiStatus = 'off' | 'loading' | 'ready' | 'error';
export interface CameraAiAssist {
  enabled: boolean;
  setEnabled(enabled: boolean): void;
  status: CameraAiStatus;
  matrix: number[] | null;
  analyze(source: HTMLVideoElement | HTMLCanvasElement): void;
  /** Invalidate a pending lens sample while leaving AI assist enabled. */
  invalidate(): void;
  reset(): void;
}

const SAMPLE_SIZE = 256;
const MIN_SAMPLE_INTERVAL_MS = 1000;

/** Sampled Five A+ colour assist; model inference stays in a disposable worker. */
export function useCameraAiAssist(): CameraAiAssist {
  const [enabled, setEnabledState] = useState(false);
  const [status, setStatus] = useState<CameraAiStatus>('off');
  const [matrix, setMatrix] = useState<number[] | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const busyRequestRef = useRef<number | null>(null);
  const lastSampleAtRef = useRef(0);

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    requestRef.current++;
    busyRef.current = false;
    busyRequestRef.current = null;
    lastSampleAtRef.current = 0;
    setMatrix(null);
    setStatus('off');
    setEnabledState(false);
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    if (!next) {
      workerRef.current?.terminate();
      workerRef.current = null;
      requestRef.current++;
      busyRef.current = false;
      busyRequestRef.current = null;
      lastSampleAtRef.current = 0;
      setMatrix(null);
      setStatus('off');
    } else {
      setStatus('loading');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const worker = new Worker(new URL('../camera-ai.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<{type: string; request: number; status?: CameraAiStatus; matrix?: number[]; message?: string}>) => {
      if (workerRef.current !== worker) return;
      const terminal = data.type === 'result' || data.type === 'error';
      if (terminal && busyRequestRef.current === data.request) {
        busyRef.current = false;
        busyRequestRef.current = null;
      }
      if (data.request !== requestRef.current) return;
      if (data.type === 'status') {
        setStatus(data.status ?? 'loading');
      } else {
        if (data.type === 'result' && data.matrix?.length === 12 && data.matrix.every(Number.isFinite)) {
          setMatrix(data.matrix);
          setStatus('ready');
        } else if (data.type === 'error') {
          setMatrix(null);
          setStatus('error');
        }
      }
    };
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      busyRef.current = false;
      busyRequestRef.current = null;
      setMatrix(null);
      setStatus('error');
    };
    return () => {
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
        requestRef.current++;
        busyRef.current = false;
        busyRequestRef.current = null;
      }
    };
  }, [enabled]);

  const invalidate = useCallback(() => {
    requestRef.current++;
    setMatrix(null);
    setStatus(enabled ? 'loading' : 'off');
    if (!busyRef.current) lastSampleAtRef.current = 0;
  }, [enabled]);

  const analyze = useCallback((source: HTMLVideoElement | HTMLCanvasElement) => {
    const worker = workerRef.current;
    const now = performance.now();
    const isVideo = 'videoWidth' in source;
    const width = isVideo ? source.videoWidth : source.width;
    const height = isVideo ? source.videoHeight : source.height;
    if (!enabled || !worker || busyRef.current || now - lastSampleAtRef.current < MIN_SAMPLE_INTERVAL_MS ||
        (isVideo && source.readyState < 2) || !width || !height) return;
    try {
      let canvas = sampleCanvasRef.current;
      if (!canvas) sampleCanvasRef.current = canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      if (!context) throw new Error('Could not sample the camera frame for Five A+.');
      context.drawImage(source, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
      const copy = new Uint8ClampedArray(pixels);
      const request = ++requestRef.current;
      busyRef.current = true;
      busyRequestRef.current = request;
      worker.postMessage({ request, pixels: copy.buffer }, [copy.buffer]);
      lastSampleAtRef.current = now;
    } catch {
      busyRef.current = false;
      busyRequestRef.current = null;
      setStatus('error');
    }
  }, [enabled]);

  return { enabled, setEnabled, status, matrix, analyze, invalidate, reset };
}
