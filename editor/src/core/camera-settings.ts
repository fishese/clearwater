export type CameraRecordingMinutes = 1 | 3 | 5;
export type CameraSettings = { minutes: CameraRecordingMinutes };
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
function loadSettings(): CameraSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (durations.includes(saved?.minutes)) return { minutes: saved.minutes };
  } catch { /* Keep the session default if storage is unavailable. */ }
  return { minutes: 1 };
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
  settings = { minutes };
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Session choice still applies. */ }
  listeners.forEach(listener => listener());
}

export function cameraRecordingBudget(minutes: CameraRecordingMinutes): CameraRecordingBudget {
  const peakRam: Record<CameraRecordingMinutes, { min: number; max: number }> = {
    1: { min: 200, max: 400 },
    3: { min: 350, max: 600 },
    5: { min: 500, max: 800 },
  };
  const fileSize: Record<CameraRecordingMinutes, number> = { 1: 39, 3: 116, 5: 193 };
  const storage: Record<CameraRecordingMinutes, number> = { 1: 80, 3: 240, 5: 400 };
  return {
    minutes,
    maxMs: minutes * 60_000,
    // 64 MiB per minute allows bitrate and container variation above the
    // roughly 39 MB/min expected at 5 Mbps video plus 128 kbps audio.
    maxBytes: minutes * 64 * 1024 * 1024,
    estimatedFileMB: fileSize[minutes],
    estimatedPeakRamMB: peakRam[minutes],
    // Estimate for the enhanced gallery file and its private app copy.
    estimatedStorageMB: storage[minutes],
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
