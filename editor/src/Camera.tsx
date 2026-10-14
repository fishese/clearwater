import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { Circle, SwitchCamera, Square, X, Pipette, RotateCcw, Check, Mic, MicOff } from 'lucide-react';
import { makeCameraRecipe, pickCameraNeutral, chooseCameraVideoMimeType, cameraRecordingLimitReached, cameraRecordingTracks, stopStreamTracks } from './core/camera-capture';
import { createCameraPreview } from './core/camera-preview';
import { cameraQualityProfile } from './core/camera-quality';
import { cameraRecordingBudget, getCameraSettings, subscribeCameraSettings } from './core/camera-settings';
import { analyse } from './core/engine';
import { isAndroid } from './native';
import type { Recipe } from './core/types';
import { t, useLanguage } from './i18n';

export interface CameraHandle {
  requestClose(): void;
}

export interface CameraSaveResult {collection:boolean;device:boolean;deviceExpected:boolean}
export interface CameraCaptureDetails { enhancedVideo?: boolean; jpegQuality?: number }

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

function recipeForFrame(video: HTMLVideoElement, strength: number): Recipe {
  const canvas = document.createElement('canvas');
  canvas.width = ANALYSIS_WIDTH;
  canvas.height = ANALYSIS_HEIGHT;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context) {
      context.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      return makeCameraRecipe(analyse(context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT).data, ANALYSIS_WIDTH, ANALYSIS_HEIGHT), strength);
    }
  } catch { /* Keep capture available if frame analysis fails. */ }
  finally { canvas.width = 1; canvas.height = 1; }
  return makeCameraRecipe(analyse(new Uint8ClampedArray(ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 4), ANALYSIS_WIDTH, ANALYSIS_HEIGHT), strength);
}

export const Camera = forwardRef<CameraHandle, CameraProps>(function Camera({ onCapture, onClose }, ref) {
  useLanguage();
  const cameraSettings = useSyncExternalStore(subscribeCameraSettings, getCameraSettings);
  const [qualityProfile] = useState(() => cameraQualityProfile(cameraSettings.quality, isAndroid()));
  const recordingBudget = cameraRecordingBudget(cameraSettings.minutes, qualityProfile);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const [loupeVisible,setLoupeVisible]=useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const previewCaptureStreamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<ReturnType<typeof createCameraPreview> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recipeRef = useRef<Recipe | null>(null);
  const strengthRef = useRef(80);
  const whiteBalanceLocked = useRef(false);
  const savingRef = useRef(false);
  const frozenRecipeRef = useRef<Recipe | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const generationRef = useRef(0);
  const recordRequestRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const recordingRef = useRef(false);
  const recordingStartedRef = useRef(0);
  const recordingBytesRef = useRef(0);
  const facingRef = useRef<'environment' | 'user'>('environment');
  const startCameraRef = useRef<(nextFacing?: 'environment' | 'user') => Promise<void>>(async () => {});
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
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [recordingBytes, setRecordingBytes] = useState(0);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [recordPending, setRecordPending] = useState(false);
  const photoPendingRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const [videoMimeType, setVideoMimeType] = useState<string | null>(() => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
    return chooseCameraVideoMimeType(type => MediaRecorder.isTypeSupported(type));
  });
  const [audioVideoMimeType] = useState<string | null>(() => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
    return chooseCameraVideoMimeType(type => MediaRecorder.isTypeSupported(type), true);
  });

  const releaseCamera = useCallback(() => {
    generationRef.current++;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    previewRef.current?.dispose();
    previewRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    stopStreamTracks(cameraStreamRef.current);
    cameraStreamRef.current = null;
    setReady(false);
  }, []);

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

  const requestClose = useCallback(() => {
    recordRequestRef.current++;
    if (recording) {
      if (!window.confirm(t('Discard this recording?'))) return;
      stopRecording(true);
    }
    onClose();
  }, [onClose, recording, stopRecording]);

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
    }
  }, []);

  const startCamera = useCallback(async (nextFacing = facing) => {
    if (!aliveRef.current) return;
    releaseCamera();
    recipeRef.current = null;
    setRecipe(null);
    const generation = generationRef.current;
    setStarting(true);
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera-unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: nextFacing },
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
      const firstRecipe = recipeForFrame(video, strengthRef.current / 100);
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
            const currentRecipe = isRecording ? frozenRecipeRef.current : recipeRef.current;
            if (currentRecipe) livePreview.render(source, source.videoWidth, source.videoHeight, currentRecipe);
            if (!isRecording && !whiteBalanceLocked.current && time - lastAnalysisAt >= 500 && analysisContext) {
              analysisContext.drawImage(source, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
              const pixels = analysisContext.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
              const analysis = analyse(pixels.data, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
              const next = makeCameraRecipe(analysis, strengthRef.current / 100, recipeRef.current ?? undefined);
              recipeRef.current = next;
              setRecipe(next);
              lastAnalysisAt = time;
            }
            if (isRecording && time - lastUiAt >= 200) {
              setRecordingElapsed(performance.now() - recordingStartedRef.current);
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
    }
  }, [facing, recording, strength, releaseCamera, qualityProfile]);

  startCameraRef.current = startCamera;

  useEffect(() => {
    aliveRef.current = true;
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
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    // startCamera intentionally reads the initial facing state; flipping is an explicit action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function showPickerLoupe(event:React.PointerEvent<HTMLCanvasElement>){
    if(!pickingBalance||recordingRef.current||savingRef.current)return;
    const source=previewCanvasRef.current,loupe=loupeRef.current;
    if(!source||!loupe||!source.width||!source.height)return;
    const rect=source.getBoundingClientRect();
    const x=Math.max(0,Math.min(source.width,(event.clientX-rect.left)/rect.width*source.width));
    const y=Math.max(0,Math.min(source.height,(event.clientY-rect.top)/rect.height*source.height));
    const ctx=loupe.getContext('2d');if(!ctx)return;
    const video=videoRef.current,current=recipeRef.current;
    if(video&&current)previewRef.current?.render(video,video.videoWidth,video.videoHeight,current);
    // Fixed-size, event-driven crop: no full-frame readback or extra animation loop.
    const size=Math.min(36,source.width,source.height);
    ctx.imageSmoothingEnabled=false;ctx.fillStyle='#091215';ctx.fillRect(0,0,112,112);
    ctx.drawImage(source,x-size/2,y-size/2,size,size,0,0,112,112);
    setLoupeVisible(true);
  }
  function pickBalance(event:React.PointerEvent<HTMLCanvasElement>){
    if(!pickingBalance||recordingRef.current||savingRef.current)return;
    const video=videoRef.current,current=recipeRef.current;
    if(!video||!current||!video.videoWidth)return;
    const rect=event.currentTarget.getBoundingClientRect();
    const x=Math.max(0,Math.min(video.videoWidth-1,(event.clientX-rect.left)/rect.width*video.videoWidth));
    const y=Math.max(0,Math.min(video.videoHeight-1,(event.clientY-rect.top)/rect.height*video.videoHeight));
    const patch=document.createElement('canvas');patch.width=9;patch.height=9;
    const ctx=patch.getContext('2d');if(!ctx)return;
    const left=Math.max(0,Math.min(video.videoWidth-9,Math.round(x)-4)),top=Math.max(0,Math.min(video.videoHeight-9,Math.round(y)-4));
    ctx.drawImage(video,left,top,Math.min(9,video.videoWidth),Math.min(9,video.videoHeight),0,0,9,9);
    const next=pickCameraNeutral(ctx.getImageData(0,0,9,9).data,current);
    if(!next){setError('Choose a midtone white or grey area.');return;}
    recipeRef.current=next;setRecipe(next);whiteBalanceLocked.current=true;setBalanceLocked(true);setPickingBalance(false);setError('');
  }
  function resetBalance(){
    whiteBalanceLocked.current=false;setBalanceLocked(false);setPickingBalance(false);
    if(videoRef.current){const next=recipeForFrame(videoRef.current,strengthRef.current/100);recipeRef.current=next;setRecipe(next);}
  }

  const capturePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight || recording || photoPendingRef.current || savingRef.current) return;
    photoPendingRef.current = true;
    setPhotoPending(true);
    setError('');
    const frozenRecipe = structuredClone(recipeRef.current ?? recipeForFrame(video, strength / 100));
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
  }, [saveCapture, recording, strength, qualityProfile]);

  const startRecording = useCallback(async () => {
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
      const frozen = structuredClone(recipeRef.current ?? recipeForFrame(videoRef.current!, strength / 100));
      frozenRecipeRef.current = frozen;
      chunksRef.current = [];
      recordingBytesRef.current = 0;
      setRecordingBytes(0);
      setRecordingElapsed(0);
      discardRecordingRef.current = false;
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
        recordingBytesRef.current += event.data.size;
        setRecordingBytes(recordingBytesRef.current);
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
  }, [microphoneEnabled, qualityProfile, recordingBudget, saveCapture, recording, stopAudio, stopPreviewCapture, stopRecording, strength, videoMimeType]);

  const stopFromUser = useCallback(() => stopRecording(false), [stopRecording]);
  const flipCamera = useCallback(() => {
    if (recording || starting) return;
    const next = facing === 'environment' ? 'user' : 'environment';
    facingRef.current = next;
    whiteBalanceLocked.current=false;setBalanceLocked(false);setPickingBalance(false);
    setFacing(next);
    void startCamera(next);
  }, [facing, recording, starting, startCamera]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
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
  const byteLimitPercent = Math.min(100, recordingBytes / recordingBudget.maxBytes * 100);

  return <div className="camera-page" role="dialog" aria-modal="true" aria-labelledby="camera-title" onKeyDown={onKeyDown}>
    <header className="camera-header">
      <div><h1 id="camera-title">{t('Camera')}</h1><p>{t('Balanced preview')}</p></div>
      <button ref={closeButtonRef} type="button" className="icon-button" aria-label={t('Close camera')} onClick={requestClose}><X size={20}/></button>
    </header>
    <div className="camera-stage">
      <video ref={videoRef} className="camera-source" muted playsInline aria-hidden="true"/>
      <canvas ref={previewCanvasRef} className={`camera-preview ${pickingBalance?'picking-balance':''}`} aria-label={t('Balanced preview')} onPointerDown={e=>{if(pickingBalance){e.currentTarget.setPointerCapture(e.pointerId);showPickerLoupe(e);}}} onPointerMove={e=>{if(e.buttons)showPickerLoupe(e);}} onPointerUp={pickBalance} onPointerCancel={()=>setLoupeVisible(false)} onLostPointerCapture={()=>setLoupeVisible(false)}/>
      {pickingBalance&&<div className={`camera-picker-loupe ${loupeVisible?'visible':''}`} aria-hidden="true"><canvas ref={loupeRef} width={112} height={112}/><span/></div>}
      {pickingBalance&&<div className="camera-picker-hint">{t('Tap a white or grey area.')}</div>}
      {(savePending||saveStatus)&&<div className="camera-save-status" role="status">{!savePending&&<Check size={16}/>} {savePending?t('Saving…'):t(saveStatus)}{savedCount>0&&` · ${savedCount}`}</div>}
      {!ready && <div className="camera-loading" aria-live="polite">{starting ? t('Starting camera…') : t('Camera unavailable.')}</div>}
      {recording && <div className="camera-recording" role="status"><Circle size={11} fill="currentColor"/>{t('Recording')} · {formatElapsed(timeLimit)} / {formatElapsed(recordingBudget.maxMs)}</div>}
      {ready && videoRef.current && <small className="camera-resolution">{t('Video recordings include the visible correction; no raw video is kept.')} · {t('Stream resolution: {0} × {1}', [previewCanvasRef.current?.width ?? 0, previewCanvasRef.current?.height ?? 0])}</small>}
    </div>
    {error && <div className="camera-error" role="alert">{t(error)}{!ready && !starting && <button className="text-button" type="button" onClick={() => void startCamera(facing)}>{t('Retry camera')}</button>}</div>}
    <div className="camera-options">
      <label>{t('Strength')} <output>{strength}%</output><input type="range" aria-label={t('Strength')} min="0" max="100" value={strength} disabled={!ready || recording || recordPending} onChange={event => applyStrength(Number(event.target.value))}/></label>
      <div className="camera-white-balance"><button type="button" className={`camera-control ${pickingBalance||balanceLocked?'active':''}`} aria-label={pickingBalance?t('Cancel picker'):t('White balance')} title={t('White balance')} aria-pressed={pickingBalance||balanceLocked} disabled={!ready||recording||recordPending} onClick={()=>{setPickingBalance(v=>!v);setLoupeVisible(false);}}><Pipette size={28}/></button><button type="button" className="camera-control" aria-label={t('Reset white balance')} title={t('Reset white balance')} disabled={!ready||recording||recordPending||(!balanceLocked&&!pickingBalance)} onClick={()=>{setLoupeVisible(false);resetBalance();}}><RotateCcw size={28}/></button><button type="button" className={`camera-control camera-audio ${microphoneEnabled?'active':''}`} aria-label={t('Use microphone audio')} title={t('Use microphone audio')} aria-pressed={microphoneEnabled} disabled={recording||starting||recordPending} onClick={()=>setMicrophoneEnabled(v=>!v)}>{microphoneEnabled?<Mic size={28}/>:<MicOff size={28}/>}</button></div>
      <small>{t('{0} min / {1} MiB limit', [cameraSettings.minutes, Math.round(recordingBudget.maxBytes / (1024 * 1024))])}{recording && ` · ${Math.round(byteLimitPercent)}%`}</small>
    </div>
    {ready && typeof previewCanvasRef.current?.captureStream !== 'function' && <p className="camera-error" role="status">{t('Enhanced video recording is unavailable on this device. Photos still work.')}</p>}
    {!videoMimeType && <p className="camera-error" role="status">{t('MP4 recording is unavailable on this device. Photos still work.')}</p>}
    <footer className="camera-actions">
      <button type="button" className="camera-control camera-flip" disabled={!ready || recording || starting || recordPending || photoPending || savePending} aria-label={t('Flip camera')} title={t('Flip camera')} onClick={flipCamera}><SwitchCamera size={30}/></button>
      <button type="button" className="camera-photo" aria-label={t('Take photo')} title={t('Take photo')} disabled={!ready || recording || starting || recordPending || photoPending || savePending} onClick={() => void capturePhoto()}><span aria-hidden="true"/></button>
      {recording
        ? <button type="button" className="camera-record recording" aria-label={t('Stop recording')} title={t('Stop recording')} onClick={stopFromUser}><Square size={25} fill="currentColor"/></button>
        : <button type="button" className="camera-record" aria-label={t('Record video')} title={t('Record video')} disabled={!ready || starting || recordPending || photoPending || savePending || !videoMimeType || typeof previewCanvasRef.current?.captureStream !== 'function' || (microphoneEnabled && !audioVideoMimeType)} onClick={() => void startRecording()}><Circle size={30} fill="currentColor"/></button>}
    </footer>
  </div>;
});

export default Camera;
