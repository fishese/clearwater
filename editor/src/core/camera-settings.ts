export type CameraRecordingMinutes = 1 | 3 | 5;
export type CameraQuality = 'auto' | 'standard' | 'high';
export type CameraSettings = { minutes: CameraRecordingMinutes; quality: CameraQuality };
export type CameraBudgetProfile = {
  id: 'standard' | 'high';
  videoBitrate: number;
  audioBitrate: number;
};
export type CameraRecordingBudget = {
  minutes: CameraRecordingMinutes;
  maxMs: number;
  maxBytes: number;
  estimatedFileMB: number;
  estimatedPeakRamMB: { min: number; max: number };
  estimatedStorageMB: number;
};

const storageKey = 'clearwater-camera-settings';
const durations: CameraRecordingMinutes[] = [1, 3, 5];
const qualities: CameraQuality[] = ['auto', 'standard', 'high'];
function loadSettings(): CameraSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (durations.includes(saved?.minutes)) return {
      minutes: saved.minutes,
      quality: qualities.includes(saved?.quality) ? saved.quality : 'auto',
    };
  } catch { /* Keep the session default if storage is unavailable. */ }
  return { minutes: 1, quality: 'auto' };
}

let settings = loadSettings();
const listeners = new Set<() => void>();
export const subscribeCameraSettings = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getCameraSettings = () => settings;

export function setCameraMinutes(minutes: CameraRecordingMinutes) {
  if (!durations.includes(minutes)) return;
  settings = { ...settings, minutes };
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Session choice still applies. */ }
  listeners.forEach(listener => listener());
}

export function setCameraQuality(quality: CameraQuality) {
  if (!qualities.includes(quality)) return;
  settings = { ...settings, quality };
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Session choice still applies. */ }
  listeners.forEach(listener => listener());
}

export function cameraRecordingBudget(minutes: CameraRecordingMinutes, profile?: CameraBudgetProfile): CameraRecordingBudget {
  const quality = profile?.id ?? 'standard';
  const peakRam: Record<CameraRecordingMinutes, { min: number; max: number }> = {
    1: { min: 200, max: 400 },
    3: { min: 350, max: 600 },
    5: { min: 500, max: 800 },
  };
  const highPeakRam: Record<CameraRecordingMinutes, { min: number; max: number }> = {
    1: { min: 350, max: 600 },
    3: { min: 700, max: 1100 },
    5: { min: 1100, max: 1600 },
  };
  const standardFileSize: Record<CameraRecordingMinutes, number> = { 1: 39, 3: 116, 5: 193 };
  const videoBitrate = profile?.videoBitrate ?? 5_000_000;
  const audioBitrate = profile?.audioBitrate ?? 128_000;
  const estimatedFileMB = quality === 'high'
    ? Math.ceil((videoBitrate + audioBitrate) * minutes * 60 / 8 / 1_000_000)
    : standardFileSize[minutes];
  const estimatedStorageMB = Math.ceil(estimatedFileMB * 2 / 10) * 10;
  return {
    minutes,
    maxMs: minutes * 60_000,
    // Standard keeps its existing allowance. High allows 128 MiB/min but caps
    // at 500 MiB to remain below the app's 512 MiB file input ceiling.
    maxBytes: quality === 'high'
      ? Math.min(minutes * 128 * 1024 * 1024, 500 * 1024 * 1024)
      : minutes * 64 * 1024 * 1024,
    estimatedFileMB,
    estimatedPeakRamMB: quality === 'high' ? highPeakRam[minutes] : peakRam[minutes],
    // Estimate for the enhanced gallery file and its private app copy.
    estimatedStorageMB,
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === storageKey) {
      settings = loadSettings();
      listeners.forEach(listener => listener());
    }
  });
}
