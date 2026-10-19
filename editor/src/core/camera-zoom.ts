export type ZoomRange = { min: number; max: number; step?: number };

export type NativeZoomLens = { id: string; facing: 'environment' | 'user'; intrinsicZoom?: number; minZoom?: number; maxZoom?: number };
export type NativeZoomChoice = { lensId: string; localZoom: number; actualZoom: number };
export type NativeZoomInfo = { lenses: NativeZoomLens[]; lensId: string; zoom: number; minZoom: number; maxZoom: number };

/** Translate a wide-relative zoom request into the best physical lens and its local crop. */
export function cameraNativeZoomChoice(lenses: NativeZoomLens[], activeId: string, facing: 'environment' | 'user', requested: number, activeRange: ZoomRange): NativeZoomChoice | null {
  if (!Number.isFinite(requested) || requested <= 0) return null;
  const choices = lenses.flatMap(lens => {
    const intrinsic = lens.intrinsicZoom;
    if (lens.facing !== facing || !intrinsic || !Number.isFinite(intrinsic) || intrinsic <= 0 || intrinsic > requested * 1.03) return [];
    const min = lens.id === activeId ? activeRange.min : lens.minZoom;
    const max = lens.id === activeId ? activeRange.max : lens.maxZoom;
    if (!min || !max || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return [];
    if (requested > intrinsic * max * 1.03 || requested < intrinsic * min / 1.03) return [];
    const localZoom = cameraZoomValue(requested / intrinsic, { min, max });
    return localZoom === null ? [] : [{ lensId: lens.id, localZoom, actualZoom: intrinsic * localZoom, intrinsic }];
  });
  choices.sort((a, b) => facing === 'user'
    ? Number(b.lensId === activeId) - Number(a.lensId === activeId) || b.intrinsic - a.intrinsic
    : b.intrinsic - a.intrinsic || Number(b.lensId === activeId) - Number(a.lensId === activeId));
  const best = choices[0];
  return best ? { lensId: best.lensId, localZoom: best.localZoom, actualZoom: best.actualZoom } : null;
}

/** One serialized native transaction; callbacks let the UI guard capture and retain partial state on error. */
export async function cameraApplyNativeAutoZoom<T extends NativeZoomInfo>(
  info: T,
  requested: number,
  facing: 'environment' | 'user',
  operations: {
    setLens: (lensId: string) => Promise<T>;
    setZoom: (ratio: number) => Promise<{ zoom: number }>;
    beforeSwitch?: () => void | Promise<void>;
    lensChanged?: (info: T) => void;
  },
): Promise<T> {
  const choice = cameraNativeZoomChoice(info.lenses, info.lensId, facing, requested, { min: info.minZoom, max: info.maxZoom });
  if (!choice) {
    const activeIntrinsic = info.lenses.find(lens => lens.id === info.lensId)?.intrinsicZoom;
    if (activeIntrinsic && Number.isFinite(activeIntrinsic)) return info;
    const localZoom = cameraZoomValue(requested, { min: info.minZoom, max: info.maxZoom });
    return localZoom === null ? info : { ...info, zoom: (await operations.setZoom(localZoom)).zoom };
  }
  let current = info;
  let localZoom = choice.localZoom;
  if (choice.lensId !== info.lensId) {
    await operations.beforeSwitch?.();
    try {
      current = await operations.setLens(choice.lensId);
    } catch {
      // The native bridge rolls a failed bind back to the original camera.
      const originalIntrinsic = info.lenses.find(lens => lens.id === info.lensId)?.intrinsicZoom ?? 1;
      const fallbackZoom = cameraZoomValue(requested / originalIntrinsic, { min: info.minZoom, max: info.maxZoom });
      if (fallbackZoom === null) throw new Error('Could not restore camera zoom.');
      return { ...info, zoom: (await operations.setZoom(fallbackZoom)).zoom };
    }
    operations.lensChanged?.(current);
    const intrinsic = current.lenses.find(lens => lens.id === current.lensId)?.intrinsicZoom ?? 1;
    localZoom = cameraZoomValue(requested / intrinsic, { min: current.minZoom, max: current.maxZoom }) ?? current.zoom;
  }
  const result = await operations.setZoom(localZoom);
  return { ...current, zoom: result.zoom };
}

export function cameraNativeAutoRange(lenses: NativeZoomLens[], activeId: string, facing: 'environment' | 'user', activeRange: ZoomRange): ZoomRange | undefined {
  const bounds = lenses.flatMap(lens => {
    const intrinsic = lens.intrinsicZoom;
    const min = lens.id === activeId ? activeRange.min : lens.minZoom;
    const max = lens.id === activeId ? activeRange.max : lens.maxZoom;
    return lens.facing === facing && intrinsic && Number.isFinite(intrinsic) && intrinsic > 0 && min && max && Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min
      ? [{ min: intrinsic * min, max: intrinsic * max }] : [];
  });
  return bounds.length ? { min: Math.min(...bounds.map(bound => bound.min)), max: Math.max(...bounds.map(bound => bound.max)) } : undefined;
}

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
