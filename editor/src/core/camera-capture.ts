import { makeRecipe } from './engine';
import { pickNeutralFromPixels } from './white-balance';
import type { CameraRecordingBudget } from './camera-settings';
import { DEFAULT_HINTS, type Analysis, type Hints, type Recipe, type Suggestion } from './types';

export const CAMERA_VIDEO_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
] as const;
export const CAMERA_AUDIO_VIDEO_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
] as const;

export const CAMERA_MAX_RECORDING_MS = 60_000;
export const CAMERA_MAX_RECORDING_BYTES = 64 * 1024 * 1024;

export interface CameraFrameRect { left:number;top:number;width:number;height:number }

/** Map a screen point to a source pixel using the preview's contain or cover fit. */
export function cameraFramePoint(
  clientX:number,
  clientY:number,
  rect:CameraFrameRect,
  width:number,
  height:number,
  fit:'contain'|'cover'='contain',
):{x:number;y:number}|null {
  if(!width||!height||!rect.width||!rect.height)return null;
  if(clientX<rect.left||clientX>rect.left+rect.width||clientY<rect.top||clientY>rect.top+rect.height)return null;
  const scale=fit==='cover'?Math.max(rect.width/width,rect.height/height):Math.min(rect.width/width,rect.height/height);
  const displayWidth=width*scale,displayHeight=height*scale;
  const left=rect.left+(rect.width-displayWidth)/2,top=rect.top+(rect.height-displayHeight)/2;
  if(fit==='contain'&&(clientX<left||clientX>left+displayWidth||clientY<top||clientY>top+displayHeight))return null;
  return {
    x:Math.max(0,Math.min(width-1,(clientX-left)/scale)),
    y:Math.max(0,Math.min(height-1,(clientY-top)/scale)),
  };
}

/** Pick an MP4 type supported by MediaRecorder; never fall back to WebM. */
export function chooseCameraVideoMimeType(isSupported: (mimeType: string) => boolean, withAudio = false): string | null {
  return (withAudio ? CAMERA_AUDIO_VIDEO_MIME_TYPES : CAMERA_VIDEO_MIME_TYPES).find(isSupported) ?? null;
}

export function cameraRecordingLimitReached(elapsedMs: number, bytes: number, budget?: Pick<CameraRecordingBudget, 'maxMs' | 'maxBytes'>): boolean {
  return elapsedMs >= (budget?.maxMs ?? CAMERA_MAX_RECORDING_MS) || bytes >= (budget?.maxBytes ?? CAMERA_MAX_RECORDING_BYTES);
}

/** Quantize progress to the values visible in the camera UI, avoiding renders for every media chunk/frame. */
export function cameraRecordingUiProgress(elapsedMs: number, bytes: number, maxBytes: number): { elapsedMs: number; bytePercent: number } {
  return {
    elapsedMs: Math.floor(Math.max(0, elapsedMs) / 1000) * 1000,
    bytePercent: maxBytes > 0 ? Math.max(0, Math.min(100, Math.floor(Math.max(0, bytes) / maxBytes * 100))) : 0,
  };
}

/** Combine corrected preview video with optional microphone audio, excluding the raw camera stream. */
export function cameraRecordingTracks(
  correctedPreview: Pick<MediaStream, 'getVideoTracks'>,
  microphone?: Pick<MediaStream, 'getAudioTracks'> | null,
): MediaStreamTrack[] {
  return [...correctedPreview.getVideoTracks(), ...(microphone?.getAudioTracks() ?? [])];
}

/** Gradually follow changing scene analysis to avoid visible balance jumps. */
export function makeCameraRecipe(analysis: Analysis, strength = 0.8, previous?: Recipe, hints?: Hints): Recipe {
  const next = makeRecipe(analysis, hints ?? previous?.hints ?? { ...DEFAULT_HINTS });
  next.strength = Math.max(0, Math.min(1, strength));
  if (!previous) return next;
  next.manual = structuredClone(previous.manual);
  next.auto = blendSuggestion(previous.auto, next.auto, 0.3);
  return next;
}

function blendSuggestion(from: Suggestion, to: Suggestion, amount: number): Suggestion {
  const mix = (a: number, b: number) => a + (b - a) * amount;
  return {
    ...to,
    gains: [mix(from.gains[0], to.gains[0]), mix(from.gains[1], to.gains[1]), mix(from.gains[2], to.gains[2])],
    redMix: mix(from.redMix, to.redMix),
    haze: mix(from.haze, to.haze),
    highlights: mix(from.highlights, to.highlights),
  };
}

/** Stop every track and tolerate already-stopped tracks and browser cleanup races. */
export function stopStreamTracks(stream?: Pick<MediaStream, 'getTracks'> | null): void {
  for (const track of stream?.getTracks() ?? []) {
    try { track.stop(); } catch { /* Track may already have ended. */ }
  }
}

/** Camera patches have no neural model; use the same replacement math as the editor. */
export function pickCameraNeutral(pixels:Uint8ClampedArray,recipe:Recipe):Recipe|null {
  return pickNeutralFromPixels(pixels,recipe);
}
