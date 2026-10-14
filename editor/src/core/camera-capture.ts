import { makeRecipe, renderPixels } from './engine';
import type { Analysis, Recipe, Suggestion } from './types';

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

/** Pick an MP4 type supported by MediaRecorder; never fall back to WebM. */
export function chooseCameraVideoMimeType(isSupported: (mimeType: string) => boolean, withAudio = false): string | null {
  return (withAudio ? CAMERA_AUDIO_VIDEO_MIME_TYPES : CAMERA_VIDEO_MIME_TYPES).find(isSupported) ?? null;
}

export function cameraRecordingLimitReached(elapsedMs: number, bytes: number): boolean {
  return elapsedMs >= CAMERA_MAX_RECORDING_MS || bytes >= CAMERA_MAX_RECORDING_BYTES;
}

/** Gradually follow changing scene analysis to avoid visible balance jumps. */
export function makeCameraRecipe(analysis: Analysis, strength = 0.8, previous?: Recipe): Recipe {
  const next = makeRecipe(analysis);
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

/** Neutralise a small raw-camera patch using the current displayed correction. */
export function pickCameraNeutral(pixels:Uint8ClampedArray,recipe:Recipe):Recipe|null {
  const corrected=renderPixels(pixels,recipe),mean=[0,0,0];let count=0;
  for(let i=0;i<corrected.length;i+=4){if(corrected[i+3]===0)continue;for(let c=0;c<3;c++)mean[c]+=corrected[i+c];count++;}
  if(!count)return null;
  for(let c=0;c<3;c++)mean[c]/=count;
  if(mean.some(v=>v<8||v>245))return null;
  const target=(mean[0]+mean[1]+mean[2])/3,next=structuredClone(recipe);
  next.manual.neutral=mean.map((v,c)=>Math.max(.25,Math.min(4,recipe.manual.neutral[c]*target/v))) as [number,number,number];
  return next;
}
