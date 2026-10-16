import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { Circle, SwitchCamera, Square, X, Pipette, RotateCcw, Check, Mic, MicOff, ZoomIn, Camera as CameraIcon, SlidersHorizontal, Sparkles, LoaderCircle } from 'lucide-react';
import { makeCameraRecipe, pickCameraNeutral, cameraFramePoint, chooseCameraVideoMimeType, cameraRecordingLimitReached, cameraRecordingUiProgress, cameraRecordingTracks, stopStreamTracks } from './core/camera-capture';
import { createCameraPreview } from './core/camera-preview';
import { cameraQualityProfile } from './core/camera-quality';
import { cameraNextZoomPreset, cameraZoomPresets, cameraZoomValue, labeledRearCameras, type ZoomRange } from './core/camera-zoom';
import { useCameraAiAssist } from './core/use-camera-ai';
import { cameraRecordingBudget, getCameraSettings, subscribeCameraSettings } from './core/camera-settings';
import { analyse } from './core/engine';
import { isAndroid } from './native';
import { nativeCamera, readNativeCameraCapture, supportsNativeCamera, type NativeCameraBounds, type NativeCameraCapture, type NativeCameraInfo, type NativeCameraLens } from './native-camera';
import {getIOSCameraPreferences,setIOSMicrophoneEnabled} from './platform/ios-camera';
import { DEFAULT_HINTS, type Hints, type Recipe } from './core/types';
import { t, useLanguage } from './i18n';

export interface CameraHandle {
  requestClose(): void;
}

export interface CameraSaveResult {collection:boolean;device:boolean;deviceExpected:boolean}
export interface CameraCaptureDetails { enhancedVideo?: boolean; jpegQuality?: number; iosCaptureId?:string }

interface CameraProps {
  onCapture: (file: File, recipe: Recipe, details?: CameraCaptureDetails) => Promise<CameraSaveResult>;
  onClose: () => void;
}

const ANALYSIS_WIDTH = 64;
const ANALYSIS_HEIGHT = 48;

function cameraErrorKey(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'Camera permission was denied.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera is available on this device.';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'The camera is already in use.';
  return 'Could not start the camera.';
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function currentCameraBounds(stage: HTMLElement): NativeCameraBounds {
  const rect = stage.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, pixelRatio: window.devicePixelRatio || 1 };
}

type CameraAiRecipe = Recipe & { cameraColour?: { matrix: number[]; source: 'fivea' } };

function recipeWithCameraColour(recipe: Recipe, enabled: boolean, matrix: number[] | null): Recipe {
  const next = { ...recipe } as CameraAiRecipe;
  if (enabled && matrix) next.cameraColour = { matrix, source: 'fivea' };
  else delete next.cameraColour;
  return next;
}

function recipeForFrame(video: HTMLVideoElement | HTMLCanvasElement, strength: number, hints: Hints = DEFAULT_HINTS, previous?: Recipe): Recipe {
  const canvas = document.createElement('canvas');
  canvas.width = ANALYSIS_WIDTH;
  canvas.height = ANALYSIS_HEIGHT;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context) {
      context.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      return makeCameraRecipe(analyse(context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT).data, ANALYSIS_WIDTH, ANALYSIS_HEIGHT), strength, previous, hints);
    }
  } catch { /* Keep capture available if frame analysis fails. */ }
  finally { canvas.width = 1; canvas.height = 1; }
  return makeCameraRecipe(analyse(new Uint8ClampedArray(ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 4), ANALYSIS_WIDTH, ANALYSIS_HEIGHT), strength, previous, hints);
}

export const Camera = forwardRef<CameraHandle, CameraProps>(function Camera({ onCapture, onClose }, ref) {
  useLanguage();
  const cameraAi = useCameraAiAssist();
  const cameraAiAnalyzeRef = useRef(cameraAi.analyze);
  const cameraAiMatrixRef = useRef<number[] | null>(cameraAi.matrix);
  const cameraAiEnabledRef = useRef(cameraAi.enabled);
  const cameraAiInvalidateRef = useRef(cameraAi.invalidate);
  cameraAiAnalyzeRef.current = cameraAi.analyze;
  cameraAiMatrixRef.current = cameraAi.matrix;
  cameraAiEnabledRef.current = cameraAi.enabled;
  cameraAiInvalidateRef.current = cameraAi.invalidate;
  const cameraSettings = useSyncExternalStore(subscribeCameraSettings, getCameraSettings);
  const [qualityProfile] = useState(() => cameraQualityProfile(cameraSettings.quality, isAndroid()));
  const recordingBudget = cameraRecordingBudget(cameraSettings.minutes, qualityProfile);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStageRef = useRef<HTMLDivElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const [loupeVisible,setLoupeVisible]=useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const nativeSessionActiveRef = useRef(false);
  const nativeRecordingRef = useRef(false);
  const nativeFrameBusyRef = useRef(false);
  const nativeLastFrameAtRef = useRef(0);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const previewCaptureStreamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<ReturnType<typeof createCameraPreview> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recipeRef = useRef<Recipe | null>(null);
  const strengthRef = useRef(80);
  const whiteBalanceLocked = useRef(false);
  const savingRef = useRef(false);
  const saveCaptureRef = useRef<(file: File, frozen: Recipe, details?: CameraCaptureDetails) => Promise<void>>(async () => {});
  const frozenRecipeRef = useRef<Recipe | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const generationRef = useRef(0);
  const nativeStopQueueRef = useRef<Promise<void>>(Promise.resolve());
  const nativeStartAttemptRef = useRef(0);
  const nativeStartInFlightRef = useRef(0);
  const recordRequestRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const recordingRef = useRef(false);
  const recordingStartedRef = useRef(0);
  const recordingBytesRef = useRef(0);
  const facingRef = useRef<'environment' | 'user'>('environment');
  const startCameraRef = useRef<(nextFacing?: 'environment' | 'user', deviceId?: string | null) => Promise<void>>(async () => {});
  const aliveRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState('');
  const [pickingBalance,setPickingBalance]=useState(false);
  const [balanceLocked,setBalanceLocked]=useState(false);
  const [savePending,setSavePending]=useState(false);
  const [savedCount,setSavedCount]=useState(0);
  const [saveStatus,setSaveStatus]=useState('');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [strength, setStrength] = useState(80);
  const [cameraHints, setCameraHints] = useState<Hints>(() => ({ ...DEFAULT_HINTS }));
  const cameraHintsRef = useRef<Hints>(cameraHints);
  const [depthChooserOpen, setDepthChooserOpen] = useState(false);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [recordingBytePercent, setRecordingBytePercent] = useState(0);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(()=>supportsNativeCamera()&&getIOSCameraPreferences().microphoneEnabled);
  const [photoPending, setPhotoPending] = useState(false);
  const [recordPending, setRecordPending] = useState(false);
  const photoPendingRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const [videoMimeType, setVideoMimeType] = useState<string | null>(() => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
    return chooseCameraVideoMimeType(type => MediaRecorder.isTypeSupported(type));
  });
  const [zoomRange, setZoomRange] = useState<ZoomRange | undefined>();
  const [zoom, setZoom] = useState(1);
  const [zoomChooserOpen, setZoomChooserOpen] = useState(false);
  const [rearCameras, setRearCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const nativeCameraSupported = supportsNativeCamera();
  const [nativeActive, setNativeActive] = useState(false);
  const [nativeInfo, setNativeInfo] = useState<NativeCameraInfo | null>(null);
  const nativeInfoRef = useRef<NativeCameraInfo | null>(nativeInfo);
  const [nativeLenses, setNativeLenses] = useState<NativeCameraLens[]>([]);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const depthButtonRef = useRef<HTMLButtonElement>(null);
  const zoomChooserRef = useRef<HTMLDivElement>(null);
  const depthChooserRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressZoomClickRef = useRef(false);
  const zoomPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const [audioVideoMimeType] = useState<string | null>(() => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
    return chooseCameraVideoMimeType(type => MediaRecorder.isTypeSupported(type), true);
  });

  cameraHintsRef.current = cameraHints;
  nativeInfoRef.current = nativeInfo;

  const enqueueNativeStop = useCallback(() => {
    const stop = nativeStopQueueRef.current.catch(() => {}).then(() => nativeCamera.stopSession()).then(() => undefined).catch(() => {});
    nativeStopQueueRef.current = stop;
    return stop;
  }, []);

  const releaseCamera = useCallback((preservePendingStart = false) => {
    generationRef.current++;
    if (!preservePendingStart) nativeStartInFlightRef.current = 0;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    previewRef.current?.dispose();
    previewRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    let nativeStop = Promise.resolve();
    if (nativeSessionActiveRef.current || nativeCameraSupported) {
      nativeSessionActiveRef.current = false;
      nativeStop = enqueueNativeStop();
    }
    setNativeActive(false);
    nativeInfoRef.current = null;
    setNativeInfo(null);
    nativeFrameBusyRef.current = false;
    stopStreamTracks(cameraStreamRef.current);
    cameraStreamRef.current = null;
    setReady(false);
    setStarting(false);
    return nativeStop;
  }, [enqueueNativeStop]);

  const stopAudio = useCallback(() => {
    stopStreamTracks(audioStreamRef.current);
    audioStreamRef.current = null;
  }, []);

  const stopPreviewCapture = useCallback(() => {
    stopStreamTracks(previewCaptureStreamRef.current);
    previewCaptureStreamRef.current = null;
  }, []);

  const stopRecording = useCallback((discard: boolean) => {
    if (discard) discardRecordingRef.current = true;
    if (nativeSessionActiveRef.current && (nativeRecordingRef.current || startingRecordingRef.current)) {
      void nativeCamera.stopRecording({ discard }).catch(() => {
        if (aliveRef.current) setError('Could not stop recording.');
      });
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder) {
      stopPreviewCapture();
      stopAudio();
      return;
    }
    if (recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* The browser may have ended it already. */ }
    }
  }, [stopAudio, stopPreviewCapture]);

  const closeCamera = useCallback(() => {
    recordRequestRef.current++;
    if (recording) {
      if (!window.confirm(t('Discard this recording?'))) return;
      stopRecording(true);
    }
    onClose();
  }, [onClose, recording, stopRecording]);

  const requestClose = useCallback(() => {
    if (depthChooserOpen) { setDepthChooserOpen(false); depthButtonRef.current?.focus(); return; }
    if (zoomChooserOpen) { setZoomChooserOpen(false); zoomButtonRef.current?.focus(); return; }
    closeCamera();
  }, [depthChooserOpen, zoomChooserOpen, closeCamera]);

  useImperativeHandle(ref, () => ({ requestClose }), [requestClose]);

  const applyStrength = useCallback((value: number) => {
    const nextStrength = Math.max(0, Math.min(100, value));
    strengthRef.current = nextStrength;
    setStrength(nextStrength);
    const current = recipeRef.current;
    if (current) {
      const next = { ...current, strength: nextStrength / 100 };
      recipeRef.current = next;
      setRecipe(next);
      if (nativeSessionActiveRef.current) void nativeCamera.setCorrection({ recipe: next }).catch(() => {});
    }
  }, []);

  const updateCameraHints = useCallback((patch: Partial<Hints>) => {
    const nextHints = { ...cameraHintsRef.current, ...patch };
    cameraHintsRef.current = nextHints;
    setCameraHints(nextHints);
    const video = nativeSessionActiveRef.current ? sourceCanvasRef.current : videoRef.current;
    const current = recipeRef.current;
    const frameWidth = video instanceof HTMLCanvasElement ? video.width : video?.videoWidth;
    if (video && frameWidth && current) {
      const nextRecipe = recipeWithCameraColour(recipeForFrame(video, strengthRef.current / 100, nextHints, current), cameraAiEnabledRef.current, cameraAiMatrixRef.current);
      recipeRef.current = nextRecipe;
      setRecipe(nextRecipe);
      if (nativeSessionActiveRef.current) void nativeCamera.setCorrection({ recipe: nextRecipe }).catch(() => {});
    }
  }, []);

  const startCamera = useCallback(async (nextFacing = facing, requestedDeviceId?: string | null) => {
    if (!aliveRef.current) return;
    if (nativeCameraSupported && nativeSessionActiveRef.current) return;
    if (nativeCameraSupported && nativeStartInFlightRef.current) return;
    const nativeAttempt = nativeCameraSupported ? ++nativeStartAttemptRef.current : 0;
    if (nativeCameraSupported) nativeStartInFlightRef.current = nativeAttempt;
    let startupTimeout = 0;
    const startupDeadline = nativeCameraSupported
      ? new Promise<never>((_resolve, reject) => {
          startupTimeout = window.setTimeout(() => reject(new Error('native-camera-timeout')), 20_000);
        })
      : null;
    if (cameraAiEnabledRef.current) {
      cameraAiInvalidateRef.current();
      cameraAiMatrixRef.current = null;
    }
    const stopBeforeStart = releaseCamera(true);
    recipeRef.current = null;
    setRecipe(null);
    const generation = generationRef.current;
    setStarting(true);
    setError('');
    try {
      await (startupDeadline ? Promise.race([stopBeforeStart, startupDeadline]) : stopBeforeStart);
      if (!aliveRef.current || generation !== generationRef.current) return;
      if (nativeCameraSupported) {
        const stage = cameraStageRef.current;
        const sourceCanvas = sourceCanvasRef.current;
        if (!stage || !sourceCanvas) throw new Error('camera-unavailable');
        const initialRecipe = recipeWithCameraColour(
          makeCameraRecipe(analyse(new Uint8ClampedArray(ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 4), ANALYSIS_WIDTH, ANALYSIS_HEIGHT), strengthRef.current / 100, undefined, cameraHintsRef.current),
          cameraAiEnabledRef.current,
          cameraAiMatrixRef.current,
        );
        const info: NativeCameraInfo = await Promise.race([
            nativeCamera.startSession({
              bounds: currentCameraBounds(stage),
              facing: nextFacing,
              quality: qualityProfile.id,
              recipe: initialRecipe,
            }),
            startupDeadline!,
          ]);
        if (!aliveRef.current || generation !== generationRef.current) return;
        nativeSessionActiveRef.current = true;
        nativeRecordingRef.current = false;
        setNativeActive(true);
        nativeInfoRef.current = info;
        setNativeInfo(info);
        setNativeLenses(info.lenses);
        setSelectedDeviceId(info.lensId);
        setRearCameras([]);
        setZoomRange(info.maxZoom >= info.minZoom ? { min: info.minZoom, max: info.maxZoom } : undefined);
        setZoom(info.zoom);
        facingRef.current = nextFacing;
        sourceCanvas.width = 1;
        sourceCanvas.height = 1;
        recipeRef.current = initialRecipe;
        setRecipe(initialRecipe);
        whiteBalanceLocked.current = false;
        setBalanceLocked(false);
        setPickingBalance(false);
        void nativeCamera.setCorrection({ recipe: initialRecipe }).catch(() => {});
        setReady(true);
        setStarting(false);
        let lastUiAt = 0;
        const drawNative = (time: number) => {
          if (!aliveRef.current || generation !== generationRef.current) return;
          if (!nativeRecordingRef.current && !startingRecordingRef.current && !nativeFrameBusyRef.current && time - nativeLastFrameAtRef.current >= 500) {
            nativeFrameBusyRef.current = true;
            nativeLastFrameAtRef.current = time;
            void nativeCamera.sampleFrame().then(async frame => {
              if (!aliveRef.current || generation !== generationRef.current || nativeRecordingRef.current || startingRecordingRef.current) return;
              const binary = atob(frame.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
              try {
                if (!aliveRef.current || generation !== generationRef.current) return;
                const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
                if (!context) return;
                sourceCanvas.width = frame.width;
                sourceCanvas.height = frame.height;
                context.drawImage(bitmap, 0, 0, frame.width, frame.height);
                cameraAiAnalyzeRef.current(sourceCanvas);
                if (!whiteBalanceLocked.current) {
                  const nextRecipe = recipeWithCameraColour(recipeForFrame(sourceCanvas, strengthRef.current / 100, cameraHintsRef.current, recipeRef.current ?? undefined), cameraAiEnabledRef.current, cameraAiMatrixRef.current);
                  recipeRef.current = nextRecipe;
                  setRecipe(nextRecipe);
                  void nativeCamera.setCorrection({ recipe: nextRecipe }).catch(() => {});
                }
              } finally { bitmap.close(); }
            }).catch(() => {}).finally(() => { nativeFrameBusyRef.current = false; });
          }
          if (recordingRef.current && time - lastUiAt >= 200) {
            setRecordingElapsed(Math.floor((performance.now() - recordingStartedRef.current) / 1000) * 1000);
            lastUiAt = time;
          }
          frameRef.current = requestAnimationFrame(drawNative);
        };
        frameRef.current = requestAnimationFrame(drawNative);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera-unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(requestedDeviceId ? { deviceId: { exact: requestedDeviceId } } : { facingMode: { ideal: nextFacing } }),
          width: { ideal: qualityProfile.maxWidth, max: qualityProfile.maxWidth },
          height: { ideal: qualityProfile.maxHeight, max: qualityProfile.maxHeight },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      if (!aliveRef.current || generation !== generationRef.current) {
        stopStreamTracks(stream);
        return;
      }
      const video = videoRef.current;
      const canvas = previewCanvasRef.current;
      if (!video || !canvas) {
        stopStreamTracks(stream);
        throw new Error('camera-unavailable');
      }
      cameraStreamRef.current = stream;
      const activeTrack = stream.getVideoTracks()[0];
      let capabilities: (MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } }) | undefined;
      let activeSettings: (MediaTrackSettings & { zoom?: number }) | undefined;
      try {
        capabilities = activeTrack?.getCapabilities?.() as typeof capabilities;
        activeSettings = activeTrack?.getSettings?.() as typeof activeSettings;
      } catch { /* Some browsers omit track capability reporting while still streaming. */ }
      const reportedZoom = capabilities?.zoom;
      const activeZoomRange = reportedZoom && Number.isFinite(reportedZoom.min) && Number.isFinite(reportedZoom.max)
        ? { min: reportedZoom.min, max: reportedZoom.max, step: reportedZoom.step }
        : undefined;
      const settingsZoom = activeSettings?.zoom;
      setZoomRange(activeZoomRange);
      setZoom(settingsZoom ?? 1);
      if (requestedDeviceId) {
        setSelectedDeviceId(requestedDeviceId);
      } else if (nextFacing === 'user') {
        setSelectedDeviceId('');
      }
      if (navigator.mediaDevices?.enumerateDevices) {
        void navigator.mediaDevices.enumerateDevices().then(devices => {
          if (aliveRef.current && generation === generationRef.current) setRearCameras(labeledRearCameras(devices));
        }).catch(() => { /* Device labels may remain unavailable on restricted browsers. */ });
      }
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      const preview = createCameraPreview(canvas, qualityProfile);
      previewRef.current = preview;
      await video.play();
      if (!aliveRef.current || generation !== generationRef.current) {
        stopStreamTracks(stream);
        preview.dispose();
        return;
      }
      const firstRecipe = recipeWithCameraColour(recipeForFrame(video, strengthRef.current / 100, cameraHintsRef.current), cameraAiEnabledRef.current, cameraAiMatrixRef.current);
      whiteBalanceLocked.current=false;setBalanceLocked(false);setPickingBalance(false);
      recipeRef.current = firstRecipe;
      setRecipe(firstRecipe);
      preview.render(video, video.videoWidth, video.videoHeight, firstRecipe);
      setReady(true);
      setStarting(false);
      let lastDrawAt = 0;
      let lastAnalysisAt = 0;
      let lastUiAt = 0;
      let analysisCanvas = analysisCanvasRef.current;
      if (!analysisCanvas) {
        analysisCanvas = document.createElement('canvas');
        analysisCanvas.width = ANALYSIS_WIDTH;
        analysisCanvas.height = ANALYSIS_HEIGHT;
        analysisCanvasRef.current = analysisCanvas;
      }
      const analysisContext = analysisCanvas.getContext('2d', { willReadFrequently: true });
      const draw = (time: number) => {
        if (!aliveRef.current || generation !== generationRef.current) return;
        const source = videoRef.current;
        const livePreview = previewRef.current;
        if (source && livePreview && source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && source.videoWidth && source.videoHeight && time - lastDrawAt >= 1000 / 30) {
          try {
            lastDrawAt = time;
            const isRecording = recordingRef.current;
            const isStartingRecording = startingRecordingRef.current;
            if (!isRecording && !isStartingRecording) cameraAiAnalyzeRef.current(source);
            const currentRecipe = isRecording ? frozenRecipeRef.current : recipeRef.current;
            if (currentRecipe) {
              const previewRecipe = isRecording ? currentRecipe : recipeWithCameraColour(currentRecipe, cameraAiEnabledRef.current, cameraAiMatrixRef.current);
              if (!isRecording) recipeRef.current = previewRecipe;
              livePreview.render(source, source.videoWidth, source.videoHeight, previewRecipe);
            }
            if (!isRecording && !isStartingRecording && !whiteBalanceLocked.current && time - lastAnalysisAt >= 500 && analysisContext) {
              analysisContext.drawImage(source, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
              const pixels = analysisContext.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
              const analysis = analyse(pixels.data, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
              const next = recipeWithCameraColour(makeCameraRecipe(analysis, strengthRef.current / 100, recipeRef.current ?? undefined, cameraHintsRef.current), cameraAiEnabledRef.current, cameraAiMatrixRef.current);
              recipeRef.current = next;
              setRecipe(next);
              lastAnalysisAt = time;
            }
            if (isRecording && time - lastUiAt >= 200) {
              const progress = cameraRecordingUiProgress(performance.now() - recordingStartedRef.current, recordingBytesRef.current, recordingBudget.maxBytes);
              setRecordingElapsed(progress.elapsedMs);
              setRecordingBytePercent(progress.bytePercent);
              lastUiAt = time;
            }
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('Could not start the camera.'));
            releaseCamera();
            return;
          }
        }
        frameRef.current = requestAnimationFrame(draw);
      };
      frameRef.current = requestAnimationFrame(draw);
    } catch (cause) {
      if (!aliveRef.current || generation !== generationRef.current) return;
      if (cause instanceof Error && cause.message === 'native-camera-timeout') {
        void releaseCamera();
        setError('Could not start the camera.');
        setReady(false);
        setStarting(false);
        return;
      }
      const failedStream = cameraStreamRef.current;
      cameraStreamRef.current = null;
      stopStreamTracks(failedStream);
      previewRef.current?.dispose();
      previewRef.current = null;
      if (cause instanceof Error && cause.message === 'Live correction needs WebGL on this device.') setError(cause.message);
      else if (cause instanceof Error && cause.message === 'camera-unavailable') setError('Could not start the camera.');
      else setError(cameraErrorKey(cause));
      setReady(false);
      setStarting(false);
    } finally {
      if (startupTimeout) window.clearTimeout(startupTimeout);
      if (nativeCameraSupported && nativeStartInFlightRef.current === nativeAttempt) nativeStartInFlightRef.current = 0;
    }
  }, [facing, recording, strength, releaseCamera, qualityProfile, nativeCameraSupported]);

  startCameraRef.current = startCamera;

  useEffect(() => {
    aliveRef.current = true;
    if (nativeCameraSupported) {
      document.documentElement.classList.add('native-camera');
      document.body.classList.add('native-camera');
    }
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    void startCamera(facing);
    return () => {
      aliveRef.current = false;
      recordRequestRef.current++;
      discardRecordingRef.current = true;
      stopRecording(true);
      stopAudio();
      releaseCamera();
      document.documentElement.classList.remove('native-camera');
      document.body.classList.remove('native-camera');
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    // startCamera intentionally reads the initial facing state; flipping is an explicit action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!nativeCameraSupported) return;
    let disposed = false;
    const handles: { remove(): Promise<void> }[] = [];
    const attach = (promise: Promise<{ remove(): Promise<void> }>) => {
      void promise.then(handle => {
        if (disposed) void handle.remove().catch(() => {});
        else handles.push(handle);
      }).catch(() => {});
    };
    attach(nativeCamera.addListener('recordingFinished', result => {
      nativeRecordingRef.current = false;
      recordingRef.current = false;
      setRecording(false);
      setRecordPending(false);
      if (discardRecordingRef.current) return;
      if (result.error) { setError('Could not save video capture.'); return; }
      if (result.discarded) return;
      if (!result.uri || !result.name || !result.type) { setError('The recording contained no video data.'); return; }
        const capture = result as NativeCameraCapture;
      const frozen = structuredClone(frozenRecipeRef.current ?? recipeRef.current ?? makeCameraRecipe(analyse(new Uint8ClampedArray(4), 1, 1)));
        const save = capture.iosCaptureId
          ? Promise.resolve(new File([],capture.name,{type:capture.type,lastModified:Date.now()})).then(file=>saveCaptureRef.current(file,frozen,{enhancedVideo:true,iosCaptureId:capture.iosCaptureId}))
          : readNativeCameraCapture(capture).then(file=>saveCaptureRef.current(file,frozen,{enhancedVideo:true}));
        void save.catch(() => setError('Could not save video capture.')).finally(() => void nativeCamera.releaseCapture({ uri: capture.uri }).catch(() => {}));
    }));
    attach(nativeCamera.addListener('cameraError', event => {
      if (!aliveRef.current) return;
      setError(event.message || 'Could not start the camera.');
      if(event.sessionClosed){whiteBalanceLocked.current=false;setBalanceLocked(false);setPickingBalance(false);setLoupeVisible(false);void releaseCamera();}
    }));
    return () => {
      disposed = true;
      for (const handle of handles) void handle.remove().catch(() => {});
    };
  }, [nativeCameraSupported,releaseCamera]);

  useEffect(() => {
    if (!nativeActive || !cameraStageRef.current) return;
    const updateBounds = () => {
      if (!nativeSessionActiveRef.current || !cameraStageRef.current) return;
      void nativeCamera.setPreviewBounds(currentCameraBounds(cameraStageRef.current)).catch(() => {});
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateBounds) : null;
    if (observer) observer.observe(cameraStageRef.current);
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);
    window.addEventListener('orientationchange', updateBounds);
    updateBounds();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, true);
      window.removeEventListener('orientationchange', updateBounds);
    };
  }, [nativeActive]);

  useEffect(() => {
    const endForBackground = () => {
      recordRequestRef.current++;
      stopRecording(false);
      stopAudio();
      releaseCamera();
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') endForBackground(); else if (aliveRef.current && !cameraStreamRef.current) void startCameraRef.current(facingRef.current); };
    const resumeAfterBackground = () => { if (aliveRef.current && !cameraStreamRef.current && document.visibilityState === 'visible') void startCameraRef.current(facingRef.current); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', endForBackground);
    window.addEventListener('pageshow', resumeAfterBackground);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', endForBackground);
      window.removeEventListener('pageshow', resumeAfterBackground);
    };
  }, [releaseCamera, stopAudio, stopRecording]);

  useEffect(() => {
    if (!zoomChooserOpen && !depthChooserOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !zoomChooserRef.current?.contains(target) && !zoomButtonRef.current?.contains(target)) setZoomChooserOpen(false);
      if (target && !depthChooserRef.current?.contains(target)) setDepthChooserOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [zoomChooserOpen, depthChooserOpen]);
  useEffect(() => () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
  }, []);

  const saveCapture = useCallback(async (file:File, frozen:Recipe, details?:CameraCaptureDetails) => {
    savingRef.current=true;
    if(aliveRef.current){setSavePending(true);setSaveStatus('');setError('');}
    try{
      const result=await onCapture(file,frozen,details);
      if(!aliveRef.current)return;
      if(result.collection||result.device)setSavedCount(n=>n+1);
      setSaveStatus(result.device?'Saved on phone.':result.collection?'Saved in collection.':'');
      if(result.deviceExpected&&!result.device)setError(result.collection?'Saved in collection. Could not save on phone.':'Capture could not be saved. Keep the app open.');
      else if(!result.collection)setError(result.device?'Saved on phone. Could not save in collection.':'Capture could not be saved. Keep the app open.');
    }catch{if(aliveRef.current)setError('Capture could not be saved. Keep the app open.');}
    finally{savingRef.current=false;if(aliveRef.current)setSavePending(false);}
  },[onCapture]);
  saveCaptureRef.current = saveCapture;

  function showPickerLoupe(event:React.PointerEvent<HTMLCanvasElement>){
    if(!pickingBalance||recordingRef.current||savingRef.current)return;
    const source=nativeSessionActiveRef.current?sourceCanvasRef.current:previewCanvasRef.current,loupe=loupeRef.current;
    if(!source||!loupe||!source.width||!source.height)return;
    const rect=previewCanvasRef.current?.getBoundingClientRect();
    if(!rect)return;
    const point=cameraFramePoint(event.clientX,event.clientY,rect,source.width,source.height,nativeSessionActiveRef.current?'cover':'contain');
    if(!point)return;
    const {x,y}=point;
    const ctx=loupe.getContext('2d');if(!ctx)return;
    const video=videoRef.current,current=recipeRef.current;
    if(!nativeSessionActiveRef.current&&video&&current)previewRef.current?.render(video,video.videoWidth,video.videoHeight,current);
    // Fixed-size, event-driven crop: no full-frame readback or extra animation loop.
    const size=Math.min(36,source.width,source.height);
    ctx.imageSmoothingEnabled=false;ctx.fillStyle='#091215';ctx.fillRect(0,0,112,112);
    ctx.drawImage(source,x-size/2,y-size/2,size,size,0,0,112,112);
    setLoupeVisible(true);
  }
  function pickBalance(event:React.PointerEvent<HTMLCanvasElement>){
    if(!pickingBalance||recordingRef.current||savingRef.current)return;
    const source=nativeSessionActiveRef.current?sourceCanvasRef.current:videoRef.current,current=recipeRef.current;
    const width=source instanceof HTMLCanvasElement?source.width:source?.videoWidth;
    const height=source instanceof HTMLCanvasElement?source.height:source?.videoHeight;
    if(!source||!current||!width||!height)return;
    const rect=event.currentTarget.getBoundingClientRect();
    const point=cameraFramePoint(event.clientX,event.clientY,rect,width,height,nativeSessionActiveRef.current?'cover':'contain');
    if(!point){setError('Tap inside the camera image.');return;}
    const {x,y}=point;
    const patch=document.createElement('canvas');patch.width=9;patch.height=9;
    const ctx=patch.getContext('2d');if(!ctx)return;
    const left=Math.max(0,Math.min(width-9,Math.round(x)-4)),top=Math.max(0,Math.min(height-9,Math.round(y)-4));
    ctx.drawImage(source,left,top,Math.min(9,width),Math.min(9,height),0,0,9,9);
    const next=pickCameraNeutral(ctx.getImageData(0,0,9,9).data,current);
    if(!next){setError('Choose a midtone white or grey area.');return;}
    recipeRef.current=next;setRecipe(next);if(nativeSessionActiveRef.current)void nativeCamera.setCorrection({recipe:next}).catch(()=>{});whiteBalanceLocked.current=true;setBalanceLocked(true);setPickingBalance(false);setError('');
  }
  function resetBalance(){
    whiteBalanceLocked.current=false;setBalanceLocked(false);setPickingBalance(false);
    const source=nativeSessionActiveRef.current?sourceCanvasRef.current:videoRef.current;
    const width=source instanceof HTMLCanvasElement?source.width:source?.videoWidth;
    if(source&&width){const next=recipeWithCameraColour(recipeForFrame(source,strengthRef.current/100,cameraHintsRef.current,recipeRef.current??undefined),cameraAiEnabledRef.current,cameraAiMatrixRef.current);recipeRef.current=next;setRecipe(next);if(nativeSessionActiveRef.current)void nativeCamera.setCorrection({recipe:next}).catch(()=>{});}
  }

  const applyCameraZoom = useCallback(async (value: number) => {
    if (nativeSessionActiveRef.current) {
      const next = cameraZoomValue(value, zoomRange);
      if (next === null) return;
      try {
        const result = await nativeCamera.setZoom({ ratio: next });
        setZoom(result.zoom);
        const currentInfo = nativeInfoRef.current;
        if (currentInfo) {
          const updated = { ...currentInfo, zoom: result.zoom };
          nativeInfoRef.current = updated;
          setNativeInfo(updated);
        }
      } catch {
        const actual = nativeInfoRef.current?.zoom;
        if (typeof actual === 'number' && Number.isFinite(actual)) setZoom(actual);
      }
      return;
    }
    const track = cameraStreamRef.current?.getVideoTracks()[0];
    const next = cameraZoomValue(value, zoomRange);
    if (!track || next === null) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: next } as MediaTrackConstraintSet] } as MediaTrackConstraints);
      const actual = (track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom;
      if (typeof actual === 'number' && Number.isFinite(actual)) setZoom(actual);
    } catch {
      const actual = (track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom;
      if (typeof actual === 'number' && Number.isFinite(actual)) setZoom(actual);
    }
  }, [zoomRange]);

  const cycleCameraZoom = useCallback(() => {
    const presets = cameraZoomPresets(zoomRange);
    const next = cameraNextZoomPreset(zoom, presets);
    if (next !== null) void applyCameraZoom(next);
  }, [zoomRange, zoom, applyCameraZoom]);

  const cancelZoomLongPress = () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const handleZoomPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (longPressTimerRef.current === null || !zoomPointerStartRef.current) return;
    if (Math.hypot(event.clientX - zoomPointerStartRef.current.x, event.clientY - zoomPointerStartRef.current.y) > 12) {
      cancelZoomLongPress();
      suppressZoomClickRef.current = true;
    }
  };

  const chooseRearCamera = async (deviceId: string) => {
    if (recording || starting || recordPending || photoPending || savePending || !ready) return;
    setZoomChooserOpen(false);
    zoomButtonRef.current?.focus();
    whiteBalanceLocked.current = false;
    setBalanceLocked(false);
    setPickingBalance(false);
    setLoupeVisible(false);
    if (nativeSessionActiveRef.current) {
      try {
        if (cameraAiEnabledRef.current) {
          cameraAiInvalidateRef.current();
          cameraAiMatrixRef.current = null;
        }
        const info = await nativeCamera.setLens({ lensId: deviceId });
        nativeInfoRef.current = info;
        setNativeInfo(info);
        setNativeLenses(info.lenses);
        setSelectedDeviceId(info.lensId);
        setZoomRange(info.maxZoom >= info.minZoom ? { min: info.minZoom, max: info.maxZoom } : undefined);
        setZoom(info.zoom);
        facingRef.current = info.lenses.find(lens => lens.id === info.lensId)?.facing ?? 'environment';
        setFacing(facingRef.current);
        if (recipeRef.current) {
          const freshRecipe = recipeWithCameraColour(recipeRef.current, cameraAiEnabledRef.current, cameraAiMatrixRef.current);
          recipeRef.current = freshRecipe;
          setRecipe(freshRecipe);
          void nativeCamera.setCorrection({ recipe: freshRecipe }).catch(() => {});
        }
      } catch { setError('Could not switch camera.'); }
      return;
    }
    facingRef.current = 'environment';
    setFacing('environment');
    void startCamera('environment', deviceId);
  };

  const capturePhoto = useCallback(async () => {
    if (nativeSessionActiveRef.current) {
      if (recording || photoPendingRef.current || savingRef.current) return;
      photoPendingRef.current = true;
      setPhotoPending(true);
      setError('');
      const frozenRecipe = structuredClone(recipeWithCameraColour(recipeRef.current ?? makeCameraRecipe(analyse(new Uint8ClampedArray(4), 1, 1), strength / 100, undefined, cameraHintsRef.current), cameraAi.enabled, cameraAi.matrix));
      let capture: NativeCameraCapture | null = null;
      try {
        capture = await nativeCamera.capturePhoto();
          const file = capture.iosCaptureId
            ? new File([],capture.name,{type:capture.type,lastModified:Date.now()})
            : await readNativeCameraCapture(capture);
          await saveCapture(file, frozenRecipe, capture.iosCaptureId?{iosCaptureId:capture.iosCaptureId}:{jpegQuality: qualityProfile.jpegQuality});
      } catch {
        setError('Photo capture failed.');
      } finally {
        if (capture) await nativeCamera.releaseCapture({ uri: capture.uri }).catch(() => {});
        photoPendingRef.current = false;
        if (aliveRef.current) setPhotoPending(false);
      }
      return;
    }
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight || recording || photoPendingRef.current || savingRef.current) return;
    photoPendingRef.current = true;
    setPhotoPending(true);
    setError('');
    const frozenRecipe = structuredClone(recipeWithCameraColour(recipeRef.current ?? recipeForFrame(video, strength / 100, cameraHintsRef.current), cameraAi.enabled, cameraAi.matrix));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('Photo capture failed.');
      photoPendingRef.current = false;
      setPhotoPending(false);
      return;
    }
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Photo capture failed.')), 'image/jpeg', qualityProfile.jpegQuality));
      await saveCapture(new File([blob], `clearwater-camera-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }), frozenRecipe, { jpegQuality: qualityProfile.jpegQuality });
    } catch {
      setError('Photo capture failed.');
    } finally {
      canvas.width = 1;
      canvas.height = 1;
      photoPendingRef.current = false;
      if (aliveRef.current) setPhotoPending(false);
    }
  }, [saveCapture, recording, strength, qualityProfile, cameraAi.enabled, cameraAi.matrix]);

  const startRecording = useCallback(async () => {
    if (nativeSessionActiveRef.current) {
      if (recordingRef.current || startingRecordingRef.current || photoPendingRef.current || savingRef.current) return;
      setError('');
      startingRecordingRef.current = true;
      setRecordPending(true);
      const frozen = structuredClone(recipeWithCameraColour(recipeRef.current ?? makeCameraRecipe(analyse(new Uint8ClampedArray(4), 1, 1), strength / 100, undefined, cameraHintsRef.current), cameraAi.enabled, cameraAi.matrix));
      try {
        await nativeCamera.startRecording({ maxMs: recordingBudget.maxMs, maxBytes: recordingBudget.maxBytes, microphone: microphoneEnabled, recipe: frozen });
        if (!aliveRef.current) {
          nativeRecordingRef.current = true;
          recordingRef.current = true;
          await nativeCamera.stopRecording({ discard: true }).catch(() => {});
          nativeRecordingRef.current = false;
          recordingRef.current = false;
          return;
        }
        frozenRecipeRef.current = frozen;
        chunksRef.current = [];
        discardRecordingRef.current = false;
        recordingStartedRef.current = performance.now();
        recordingBytesRef.current = 0;
        nativeRecordingRef.current = true;
        recordingRef.current = true;
        setRecordingElapsed(0);
        setRecordingBytePercent(0);
        setRecording(true);
      } catch {
        nativeRecordingRef.current = false;
        recordingRef.current = false;
        setError('Could not start recording.');
      } finally {
        startingRecordingRef.current = false;
        if (aliveRef.current) setRecordPending(false);
      }
      return;
    }
    const canvas = previewCanvasRef.current;
    if (!cameraStreamRef.current || !canvas || typeof canvas.captureStream !== 'function' || recordingRef.current || startingRecordingRef.current || photoPendingRef.current || savingRef.current || !videoMimeType) return;
    setError('');
    const selectedMimeType = microphoneEnabled
      ? chooseCameraVideoMimeType(type => MediaRecorder.isTypeSupported(type), true)
      : videoMimeType;
    if (!selectedMimeType) {
      setError('MP4 recording is unavailable on this device. Photos still work.');
      return;
    }
    startingRecordingRef.current = true;
    setRecordPending(true);
    const request = ++recordRequestRef.current;
    let audio: MediaStream | null = null;
    try {
      if (microphoneEnabled) {
        try {
          audio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch {
          if (request === recordRequestRef.current && aliveRef.current) setError('Microphone permission was denied.');
          return;
        }
        if (request !== recordRequestRef.current || !aliveRef.current) {
          stopStreamTracks(audio);
          return;
        }
        audioStreamRef.current = audio;
      }
      const previewStream = canvas.captureStream(30);
      previewCaptureStreamRef.current = previewStream;
      const combined = new MediaStream(cameraRecordingTracks(previewStream, audio));
      const recorder = new MediaRecorder(combined, { mimeType: selectedMimeType, videoBitsPerSecond: qualityProfile.videoBitrate, ...(microphoneEnabled ? { audioBitsPerSecond: qualityProfile.audioBitrate } : {}) });
      const frozen = structuredClone(recipeWithCameraColour(recipeRef.current ?? recipeForFrame(videoRef.current!, strength / 100, cameraHintsRef.current), cameraAi.enabled, cameraAi.matrix));
      frozenRecipeRef.current = frozen;
      chunksRef.current = [];
      recordingBytesRef.current = 0;
      setRecordingBytePercent(0);
      setRecordingElapsed(0);
      discardRecordingRef.current = false;
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
        recordingBytesRef.current += event.data.size;
        const progress = cameraRecordingUiProgress(performance.now() - recordingStartedRef.current, recordingBytesRef.current, recordingBudget.maxBytes);
        setRecordingBytePercent(progress.bytePercent);
        if (cameraRecordingLimitReached(performance.now() - recordingStartedRef.current, recordingBytesRef.current, recordingBudget)) stopRecording(false);
      };
      recorder.onerror = () => {
        setError('Could not start recording.');
        stopRecording(true);
      };
      recorder.onstop = () => {
        const discard = discardRecordingRef.current;
        const chunks = chunksRef.current;
        chunksRef.current = [];
        recorderRef.current = null;
        stopPreviewCapture();
        stopAudio();
        recordingRef.current = false;
        setRecording(false);
        if (discard) return;
        if (!chunks.length) {
          setError('The recording contained no video data.');
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/mp4' });
        if (!blob.type.toLowerCase().startsWith('video/mp4')) {
          setVideoMimeType(null);
          setError('MP4 recording is unavailable on this device. Photos still work.');
          return;
        }
        const extension = 'mp4';
        void saveCapture(new File([blob], `clearwater-camera-${Date.now()}.${extension}`, { type: 'video/mp4', lastModified: Date.now() }), frozen, { enhancedVideo: true });
      };
      recorder.start(250);
      recordingStartedRef.current = performance.now();
      recordingRef.current = true;
      setRecording(true);
    } catch {
      stopPreviewCapture();
      stopStreamTracks(audio);
      audioStreamRef.current = null;
      recorderRef.current = null;
      recordingRef.current = false;
      setError('Could not start recording.');
      setRecording(false);
    } finally { startingRecordingRef.current = false; if (aliveRef.current) setRecordPending(false); }
  }, [microphoneEnabled, qualityProfile, recordingBudget, saveCapture, recording, stopAudio, stopPreviewCapture, stopRecording, strength, videoMimeType, cameraAi.enabled, cameraAi.matrix]);

  const stopFromUser = useCallback(() => stopRecording(false), [stopRecording]);
  const flipCamera = useCallback(() => {
    if (recording || starting) return;
    const next = facing === 'environment' ? 'user' : 'environment';
    if (nativeSessionActiveRef.current) {
      const lens = nativeInfoRef.current?.lenses.find(candidate => candidate.facing === next);
      if (lens) { void chooseRearCamera(lens.id); return; }
      return;
    }
    facingRef.current = next;
    whiteBalanceLocked.current=false;setBalanceLocked(false);setPickingBalance(false);
    setFacing(next);
    void startCamera(next);
  }, [facing, recording, starting, startCamera, chooseRearCamera]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (depthChooserOpen) {
        setDepthChooserOpen(false);
        depthButtonRef.current?.focus();
        return;
      }
      if (zoomChooserOpen) {
        setZoomChooserOpen(false);
        zoomButtonRef.current?.focus();
        return;
      }
      requestClose();
    } else if (event.key === 'Tab') {
      const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };

  const timeLimit = Math.min(recordingBudget.maxMs, recordingElapsed);
  const byteLimitPercent = recordingBytePercent;
  const activeNativeLens = nativeInfo?.lenses.find(lens => lens.id === nativeInfo.lensId);
  const intrinsicZoom = activeNativeLens?.intrinsicZoom;
  const displayedZoom = nativeActive && typeof intrinsicZoom === 'number' && Number.isFinite(intrinsicZoom) && intrinsicZoom > 0 ? zoom * intrinsicZoom : zoom;
  const zoomLabel = `${displayedZoom.toFixed(displayedZoom % 1 ? 1 : 0)}×`;
  const canAdjustZoom = !!zoomRange && zoomRange.max > zoomRange.min;
  const hasCameraChoices = nativeActive ? nativeLenses.length > 1 : rearCameras.length > 1;
  const photoWidth = nativeActive ? nativeInfo?.photoWidth : videoRef.current?.videoWidth;
  const photoHeight = nativeActive ? nativeInfo?.photoHeight : videoRef.current?.videoHeight;
  const enhancedVideoWidth = previewCanvasRef.current?.width;
  const enhancedVideoHeight = previewCanvasRef.current?.height;
  const resolutionLabel = recording
    ? nativeActive
      ? t('Video target: {0}', [`${qualityProfile.maxHeight}p`])
      : enhancedVideoWidth && enhancedVideoHeight
        ? t('Enhanced video: {0} × {1}', [enhancedVideoWidth, enhancedVideoHeight])
        : t('Video target: {0}', [`${qualityProfile.maxHeight}p`])
    : photoWidth && photoHeight
      ? t('Photo resolution: {0} × {1}', [photoWidth, photoHeight])
      : '';

  return <div className="camera-page" role="dialog" aria-modal="true" aria-label={t('Camera')} onKeyDown={onKeyDown}>
    <div className="camera-stage" ref={cameraStageRef}>
      <video ref={videoRef} className="camera-source" muted playsInline aria-hidden="true"/>
      <canvas ref={sourceCanvasRef} className="camera-source" aria-hidden="true"/>
      <canvas ref={previewCanvasRef} className={`camera-preview ${pickingBalance?'picking-balance':''}`} aria-label={t(cameraAi.matrix ? 'Five A+ colour preview' : 'Balanced preview')} onPointerDown={e=>{if(pickingBalance){e.currentTarget.setPointerCapture(e.pointerId);showPickerLoupe(e);}}} onPointerMove={e=>{if(e.buttons)showPickerLoupe(e);}} onPointerUp={pickBalance} onPointerCancel={()=>setLoupeVisible(false)} onLostPointerCapture={()=>setLoupeVisible(false)}/>
      <button ref={closeButtonRef} type="button" className="icon-button camera-close-button" aria-label={t('Close camera')} onClick={closeCamera}><X size={20}/></button>
      {pickingBalance&&<div className={`camera-picker-loupe ${loupeVisible?'visible':''}`} aria-hidden="true"><canvas ref={loupeRef} width={112} height={112}/><span/></div>}
      {pickingBalance&&<div className="camera-picker-hint">{t('Tap a white or grey area.')}</div>}
      {(savePending||saveStatus)&&<div className="camera-save-status" role="status">{!savePending&&<Check size={16}/>} {savePending?t('Saving…'):t(saveStatus)}{savedCount>0&&` · ${savedCount}`}</div>}
      {!ready && <div className="camera-loading" aria-live="polite">{starting ? t('Starting camera…') : t('Camera unavailable.')}</div>}
      {recording && <div className="camera-recording" role="status"><Circle size={11} fill="currentColor"/>{t('Recording')} · {formatElapsed(timeLimit)} / {formatElapsed(recordingBudget.maxMs)}</div>}
      {ready && resolutionLabel && <>
        {recording && <small className="camera-recording-note">{t('Corrected video · No raw')}</small>}
        <small className="camera-resolution">{resolutionLabel}</small>
      </>}
      {ready && (canAdjustZoom || hasCameraChoices) && <div className="camera-zoom-tools">
        {canAdjustZoom ? <button
          ref={zoomButtonRef}
          type="button"
          className={`camera-zoom-button ${zoomChooserOpen ? 'active' : ''}`}
          aria-label={t('Zoom {0}×', [zoomLabel.slice(0,-1)])}
          aria-expanded={zoomChooserOpen}
          aria-controls="camera-zoom-chooser"
          disabled={!ready || recording || starting || recordPending}
          onPointerDown={event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            cancelZoomLongPress();
            suppressZoomClickRef.current = false;
            zoomPointerStartRef.current = { x: event.clientX, y: event.clientY };
            longPressTimerRef.current = window.setTimeout(() => {
              suppressZoomClickRef.current = true;
              setZoomChooserOpen(true);
              longPressTimerRef.current = null;
            }, 520);
          }}
          onPointerMove={handleZoomPointerMove}
          onPointerUp={() => { cancelZoomLongPress(); zoomPointerStartRef.current = null; }}
          onPointerCancel={() => { cancelZoomLongPress(); zoomPointerStartRef.current = null; suppressZoomClickRef.current = false; }}
          onContextMenu={event => { event.preventDefault(); cancelZoomLongPress(); suppressZoomClickRef.current = true; setZoomChooserOpen(true); }}
          onClick={event => {
            event.preventDefault();
            cancelZoomLongPress();
            if (suppressZoomClickRef.current) { suppressZoomClickRef.current = false; return; }
            cycleCameraZoom();
          }}
        ><ZoomIn size={20}/><span>{zoomLabel}</span></button> : <button type="button" ref={zoomButtonRef} className={`camera-zoom-button ${zoomChooserOpen ? 'active' : ''}`} aria-label={t(nativeActive ? 'Choose camera lens' : 'Choose rear camera')} aria-expanded={zoomChooserOpen} aria-controls="camera-zoom-chooser" disabled={!ready || recording || starting || recordPending} onClick={() => setZoomChooserOpen(v => !v)}><CameraIcon size={20}/><span>{t('Camera')}</span></button>}
        {zoomChooserOpen && <div id="camera-zoom-chooser" ref={zoomChooserRef} className="camera-zoom-chooser" role="group" aria-label={t('Camera controls')}>
          {canAdjustZoom && zoomRange && <label className="camera-zoom-slider">{t('Zoom')} <output>{zoomLabel}</output>
            <input type="range" min={zoomRange.min} max={zoomRange.max} step={zoomRange.step && zoomRange.step > 0 ? zoomRange.step : 'any'} value={zoom} disabled={recording || recordPending} aria-label={t('Zoom')} onChange={event => void applyCameraZoom(Number(event.target.value))}/>
          </label>}
          {hasCameraChoices && <div className="camera-lens-choices" role="group" aria-label={t(nativeActive ? 'Camera lenses' : 'Rear cameras')}>
            {nativeActive ? nativeLenses.map(lens => <button type="button" key={lens.id} className="camera-lens-choice" aria-pressed={selectedDeviceId === lens.id} disabled={!ready || recording || starting || recordPending || photoPending || savePending} onClick={() => void chooseRearCamera(lens.id)}><CameraIcon size={16}/><span>{lens.facing === 'user' ? t('Front camera') : ['Camera','Wide','Ultra-wide','Telephoto'].includes(lens.label) ? t(lens.label) : lens.label}{Number.isFinite(lens.intrinsicZoom) && lens.intrinsicZoom > 0 ? ` · ${lens.intrinsicZoom.toFixed(lens.intrinsicZoom % 1 ? 1 : 0)}×` : ''}</span></button>) : rearCameras.map(device => <button type="button" key={device.deviceId} className="camera-lens-choice" aria-pressed={selectedDeviceId === device.deviceId} disabled={!ready || recording || starting || recordPending || photoPending || savePending} onClick={() => void chooseRearCamera(device.deviceId)}><CameraIcon size={16}/><span>{device.label}</span></button>)}
          </div>}
        </div>}
      </div>}
    </div>
    {error && <div className="camera-error" role="alert">{t(error)}{!ready && !starting && <button className="text-button" type="button" onClick={() => void startCamera(facing)}>{t('Retry camera')}</button>}</div>}
    <div className="camera-options">
      <div className="camera-feature-controls" aria-label={t('Camera controls')}>
        <button type="button" className={`camera-feature-button ${cameraAi.matrix ? 'active' : ''} ${cameraAi.status === 'error' ? 'camera-ai-error-state' : ''}`} aria-pressed={cameraAi.enabled} aria-label={t('Five A+ assist · {0}', [t(cameraAi.status)])} title={t('Five A+ assist · {0}', [t(cameraAi.status)])} disabled={!ready || recording || recordPending} onClick={() => { if (!cameraAi.enabled) setDepthChooserOpen(false); cameraAi.setEnabled(!cameraAi.enabled); }}>{cameraAi.enabled && cameraAi.status === 'loading' ? <LoaderCircle size={18} className="camera-ai-spinner" aria-hidden="true"/> : <Sparkles size={18}/>}<span>{t('AI')}</span></button>
        <button type="button" className={`camera-feature-button ${cameraHints.filter !== 'auto' ? 'active' : ''}`} aria-label={t('Red filter: {0}', [t(cameraHints.filter === 'yes' ? 'Yes' : cameraHints.filter === 'no' ? 'No' : 'Auto')])} title={t('Red filter')} disabled={!ready || recording || recordPending || cameraAi.enabled} onClick={() => updateCameraHints({ filter: cameraHints.filter === 'auto' ? 'yes' : cameraHints.filter === 'yes' ? 'no' : 'auto' })}><span>{t('Red')}</span><small>{t(cameraHints.filter === 'yes' ? 'Yes' : cameraHints.filter === 'no' ? 'No' : 'Auto')}</small></button>
        <div className="camera-depth-control" ref={depthChooserRef}>
          <button ref={depthButtonRef} type="button" className={`camera-feature-button ${cameraHints.depth !== null ? 'active' : ''}`} aria-expanded={depthChooserOpen} aria-controls="camera-depth-chooser" disabled={!ready || recording || recordPending || cameraAi.enabled} onClick={() => setDepthChooserOpen(value => !value)}><SlidersHorizontal size={18}/><span>{t('Depth')} {cameraHints.depth === null ? t('Auto') : `${cameraHints.depth} m`}</span></button>
          {depthChooserOpen && <div id="camera-depth-chooser" className="camera-depth-chooser" role="group" aria-label={t('Depth hint')}>
            <label>{t('Depth')} <output>{cameraHints.depth === null ? t('Auto') : t('{0} m', [cameraHints.depth])}</output>
              <input type="range" min="0" max="100" step="1" value={cameraHints.depth ?? 0} disabled={recording || recordPending || cameraAi.enabled} aria-label={t('Depth in metres')} onChange={event => updateCameraHints({ depth: Number(event.target.value) })}/>
            </label>
            <button type="button" className="camera-depth-auto" aria-pressed={cameraHints.depth === null} disabled={cameraAi.enabled} onClick={() => updateCameraHints({ depth: null })}>{t('Use automatic depth')}</button>
            <small>{t('Balanced restoration uses this hint.')}</small>
          </div>}
        </div>
      </div>
      <label className="camera-strength-control">{t('Strength')} <output>{strength}%</output><input type="range" aria-label={t('Strength')} min="0" max="100" value={strength} disabled={!ready || recording || recordPending} onChange={event => applyStrength(Number(event.target.value))}/></label>
      <div className="camera-white-balance"><button type="button" className={`camera-control ${pickingBalance||balanceLocked?'active':''}`} aria-label={pickingBalance?t('Cancel picker'):t('White balance')} title={t('White balance')} aria-pressed={pickingBalance||balanceLocked} disabled={!ready||recording||recordPending} onClick={()=>{setPickingBalance(v=>!v);setLoupeVisible(false);}}><Pipette size={28}/></button><button type="button" className="camera-control" aria-label={t('Reset white balance')} title={t('Reset white balance')} disabled={!ready||recording||recordPending||(!balanceLocked&&!pickingBalance)} onClick={()=>{setLoupeVisible(false);resetBalance();}}><RotateCcw size={28}/></button><button type="button" className={`camera-control camera-audio ${microphoneEnabled?'active':''}`} aria-label={t('Use microphone audio')} title={t('Use microphone audio')} aria-pressed={microphoneEnabled} disabled={recording||starting||recordPending} onClick={()=>setMicrophoneEnabled(v=>{const next=!v;if(supportsNativeCamera())setIOSMicrophoneEnabled(next);return next;})}>{microphoneEnabled?<Mic size={28}/>:<MicOff size={28}/>}</button></div>
      <small>{t('{0} min / {1} MiB limit', [cameraSettings.minutes, Math.round(recordingBudget.maxBytes / (1024 * 1024))])}{recording && !nativeActive && ` · ${Math.round(byteLimitPercent)}%`}</small>
    </div>
    {cameraAi.enabled && <small className="camera-hints-note">{t('Red filter and depth hints apply to Balanced restoration.')}</small>}
    {cameraAi.enabled && cameraAi.status === 'error' && <p className="camera-error" role="status">{t('Balanced preview')} · {t('Five A+ assist unavailable.')}</p>}
    {ready && !nativeActive && typeof previewCanvasRef.current?.captureStream !== 'function' && <p className="camera-error" role="status">{t('Enhanced video recording is unavailable on this device. Photos still work.')}</p>}
    {!nativeActive && !videoMimeType && <p className="camera-error" role="status">{t('MP4 recording is unavailable on this device. Photos still work.')}</p>}
    <footer className="camera-actions">
      <button type="button" className="camera-control camera-flip" disabled={!ready || recording || starting || recordPending || photoPending || savePending} aria-label={t('Flip camera')} title={t('Flip camera')} onClick={() => { setSelectedDeviceId(''); flipCamera(); }}><SwitchCamera size={30}/></button>
      <button type="button" className="camera-photo" aria-label={t('Take photo')} title={t('Take photo')} disabled={!ready || recording || starting || recordPending || photoPending || savePending} onClick={() => void capturePhoto()}><span aria-hidden="true"/></button>
      {recording
        ? <button type="button" className="camera-record recording" aria-label={t('Stop recording')} title={t('Stop recording')} onClick={stopFromUser}><Square size={25} fill="currentColor"/></button>
        : <button type="button" className="camera-record" aria-label={t('Record video')} title={t('Record video')} disabled={!ready || starting || recordPending || photoPending || savePending || (!nativeActive && (!videoMimeType || typeof previewCanvasRef.current?.captureStream !== 'function' || (microphoneEnabled && !audioVideoMimeType)))} onClick={() => void startRecording()}><Circle size={30} fill="currentColor"/></button>}
    </footer>
  </div>;
});

export default Camera;
