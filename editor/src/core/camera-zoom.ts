export type ZoomRange = { min: number; max: number; step?: number };

/** Standard stops snapped to active-camera capabilities; the chooser slider retains the full range. */
export function cameraZoomPresets(range: ZoomRange | undefined): number[] {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min <= 0 || range.max < range.min) return [];
  const step = Number.isFinite(range.step) && (range.step ?? 0) > 0 ? range.step! : 0;
  const snap = (value: number) => {
    const clamped = Math.max(range.min, Math.min(range.max, value));
    const stepped = step ? range.min + Math.round((clamped - range.min) / step) * step : clamped;
    return Number(Math.max(range.min, Math.min(range.max, stepped)).toFixed(4));
  };
  const values = [range.min];
  if (range.min <= 1 && range.max >= 1) values.push(snap(1));
  for (const stop of [2, 3, 5, 10]) if (stop >= range.min && stop <= range.max) values.push(snap(stop));
  if (range.max > range.min && range.max <= 10) values.push(range.max);
  return [...new Set(values.map(snap))].sort((a, b) => a - b);
}

export function cameraZoomValue(value: number, range: ZoomRange | undefined): number | null {
  if (!range || !Number.isFinite(value) || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max < range.min) return null;
  const step = Number.isFinite(range.step) && (range.step ?? 0) > 0 ? range.step! : 0;
  const clamped = Math.max(range.min, Math.min(range.max, value));
  const snapped = step ? range.min + Math.round((clamped - range.min) / step) * step : clamped;
  return Number(Math.max(range.min, Math.min(range.max, snapped)).toFixed(4));
}

export function cameraNextZoomPreset(current: number, presets: number[]): number | null {
  if (!presets.length) return null;
  const index = presets.findIndex(value => Math.abs(value - current) < 0.001);
  if (index >= 0) return presets[(index + 1) % presets.length];
  return presets.find(value => value > current + 0.001) ?? presets[0];
}

/** Use the browser-provided rear-facing label and device ID as-is. */
export function labeledRearCameras(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  return devices.filter(device => device.kind === 'videoinput' && /\b(back|rear|environment)\b/i.test(device.label));
}
