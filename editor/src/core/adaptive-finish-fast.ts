import type { AdaptiveFinishFit, AdaptiveFinishVariant } from './adaptive-finish';

/**
 * A bounded, per-fit lookup kernel for the adaptive finish experiment.
 * The reference implementation remains the source of truth; this module only
 * replaces repeated transfer and smoothstep work with compiled tables.
 */
export interface AdaptiveFinishFastKernel {
  readonly valid: boolean;
  readonly identity: boolean;
  /** Tone-only fits use direct scalar math and no per-fit protection tables. */
  readonly toneOnly: boolean;
  readonly variant: AdaptiveFinishVariant;
  readonly algorithmVersion: 1 | 2;
  readonly colourGains: readonly [number, number, number];
  readonly chromaGain: number;
  readonly warmSeparation: number;
  readonly toneScale: number;
  readonly toneOffset: number;
  readonly linearByByte: Float32Array;
  readonly srgbByLinear: Float32Array;
  /** [shadow protection, tone amount before highlight protection, tone ratio] per luma bin. */
  readonly lumaTables: Float32Array;
  /** [colour highlight protection, tone highlight protection] per peak bin. */
  readonly peakTables: Float32Array;
  readonly waterTable: Float32Array;
}

const LUMA_BINS = 65_536;
const PEAK_BINS = 4_097;
const LINEAR_BINS = 4_097;
const DIFFERENCE_BINS = 16_385;
const MAX_COMPILED_FITS = 4;
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const smooth = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};
const decode = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const encode = (value: number) => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
const luminance = (r: number, g: number, b: number) => .2126 * r + .7152 * g + .0722 * b;
const softenPositiveToneRatio = (targetRatio: number, headroom: number) => {
  if (targetRatio <= 1) return targetRatio;
  const room = Math.max(0, headroom - 1), delta = targetRatio - 1;
  return 1 + room * delta / Math.max(room + delta, 1e-8);
};

const SHARED_TABLES = (() => {
  const linearByByte = new Float32Array(256);
  for (let value = 0; value < 256; value++) {
    const index = Math.round(value / 255 * 4096);
    linearByByte[value] = decode(index / 4096);
  }
  const srgbByLinear = Float32Array.from({ length: LINEAR_BINS }, (_, index) => encode(index / 4096));
  const waterTable = new Float32Array(DIFFERENCE_BINS);
  for (let index = 0; index < DIFFERENCE_BINS; index++) {
    const difference = index / 8192 - 1;
    waterTable[index] = clamp(difference);
  }
  return { linearByByte, srgbByLinear, waterTable };
})();
const compiledFits = new Map<string, AdaptiveFinishFastKernel>();

function isValidFit(fit: AdaptiveFinishFit): boolean {
  const v2 = !!fit && fit.algorithmVersion === 2;
  const hasWarm = fit?.warmSeparation !== undefined;
  return !!fit && typeof fit === 'object' && (fit.algorithmVersion === undefined || v2) && ['tone', 'colour-tone', 'soft-water', 'vivid'].includes(fit.variant) &&
    typeof fit.active === 'boolean' && Number.isInteger(fit.sampleCount) && fit.sampleCount >= 0 &&
    Array.isArray(fit.colourGains) && fit.colourGains.length === 3 &&
    ['fit', 'protected-surface', 'weak-channel'].includes(fit.colourReason) &&
    fit.colourGains.every(gain => Number.isFinite(gain) && gain >= (v2 ? .65 : .82) && gain <= (v2 ? 2.2 : 1.2)) &&
    (fit.chromaGain === undefined || (Number.isFinite(fit.chromaGain) && fit.chromaGain >= 1 && fit.chromaGain <= 1.15)) &&
    (!hasWarm || (v2 && fit.variant === 'vivid' && Number.isFinite(fit.warmSeparation) && fit.warmSeparation >= 0 && fit.warmSeparation <= .45)) &&
    (!hasWarm || fit.colourReason === 'fit') &&
    Number.isFinite(fit.toneScale) && fit.toneScale >= (v2 ? .78 : .88) && fit.toneScale <= (v2 ? 1.24 : 1.12) &&
    Number.isFinite(fit.toneOffset) && fit.toneOffset >= (v2 ? -.10 : -.045) && fit.toneOffset <= (v2 ? .06 : .045);
}

/** Compile the bounded fit once; kernels can be reused for preview and strips. */
export function prepareAdaptiveFinishFast(fit: AdaptiveFinishFit): AdaptiveFinishFastKernel {
  const valid = isValidFit(fit);
  const cacheKey = valid ? JSON.stringify(fit) : undefined;
  if (cacheKey) {
    const cached = compiledFits.get(cacheKey);
    if (cached) {
      compiledFits.delete(cacheKey);
      compiledFits.set(cacheKey, cached);
      return cached;
    }
  }
  const variant = valid ? fit.variant : 'tone';
  const algorithmVersion: 1 | 2 = valid && fit.algorithmVersion === 2 ? 2 : 1;
  const colourGains = valid ? [...fit.colourGains] as [number, number, number] : [1, 1, 1] as const;
  const chromaGain = valid && fit.variant === 'vivid' && fit.colourReason === 'fit' ? fit.chromaGain ?? 1 : 1;
  const warmSeparation = valid && fit.algorithmVersion === 2 && fit.variant === 'vivid' ? fit.warmSeparation ?? 0 : 0;
  const active = valid && fit.active;
  const identity = !active || (fit.toneScale === 1 && fit.toneOffset === 0 &&
    colourGains[0] === 1 && colourGains[1] === 1 && colourGains[2] === 1 && chromaGain === 1 && warmSeparation === 0);
  // Any candidate whose saved colour/chroma terms are neutral can use the
  // compact tone path; this also covers protected vivid fallback fits.
  const toneOnly = active && !identity &&
    colourGains[0] === 1 && colourGains[1] === 1 && colourGains[2] === 1 && chromaGain === 1 && warmSeparation === 0;
  const lumaTables = active && !identity && !toneOnly ? new Float32Array(LUMA_BINS * 3) : new Float32Array(0);
  const peakTables = active && !identity && !toneOnly ? new Float32Array(PEAK_BINS * 2) : new Float32Array(0);
  if (active && !identity && !toneOnly) {
    for (let index = 0; index < LUMA_BINS; index++) {
      const value = index / (LUMA_BINS - 1), at = index * 3;
      lumaTables[at] = smooth(.025, .15, value);
      lumaTables[at + 1] = smooth(.025, .14, value);
      const fittedLuma = clamp(value * fit.toneScale + fit.toneOffset);
      const targetLuma = algorithmVersion === 2 ? Math.max(value * .55, fittedLuma) : fittedLuma;
      lumaTables[at + 2] = targetLuma / Math.max(value, 1e-5);
    }
    for (let index = 0; index < PEAK_BINS; index++) {
      const value = index / 4096, at = index * 2;
      peakTables[at] = 1 - smooth(.82, .98, value);
      const toneHighlightProtection = algorithmVersion === 2 && variant === 'vivid' ? 0 : .45;
      peakTables[at + 1] = 1 - toneHighlightProtection * smooth(.86, .99, value);
    }
  }
  const toneScale = valid ? fit.toneScale : 1;
  const toneOffset = valid ? fit.toneOffset : 0;
  const kernel = { valid, identity, toneOnly, variant, algorithmVersion, colourGains, chromaGain, warmSeparation, toneScale, toneOffset, ...SHARED_TABLES, lumaTables, peakTables };
  if (cacheKey) {
    compiledFits.set(cacheKey, kernel);
    if (compiledFits.size > MAX_COMPILED_FITS) compiledFits.delete(compiledFits.keys().next().value!);
  }
  return kernel;
}

/** Apply a compiled fit without per-pixel auxiliary buffers; optional amount blends byte-quantized output. */
export function applyAdaptiveFinishFast(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  kernel: AdaptiveFinishFastKernel,
  options: { inPlace?: boolean; amount?: number } = {},
): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || input.length !== width * height * 4) {
    throw new Error('Adaptive finish dimensions do not match.');
  }
  const amount = options.amount ?? 1;
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error('Adaptive finish amount must be between 0 and 1.');
  if (amount === 0) return input;
  if (!kernel.valid || kernel.identity) return input;
  const out = options.inPlace ? input : new Uint8ClampedArray(input);
  const [redGain, greenGain, blueGain] = kernel.colourGains;
  const warmSeparation = kernel.algorithmVersion === 2 && kernel.variant === 'vivid' ? kernel.warmSeparation : 0;
  const useCoolWater = kernel.variant === 'soft-water' || kernel.variant === 'vivid' ||
    (kernel.algorithmVersion === 2 && kernel.variant === 'tone' && kernel.colourGains.some(gain => gain !== 1));
  const { linearByByte, srgbByLinear, lumaTables, peakTables, waterTable, toneScale, toneOffset } = kernel;
  if (kernel.toneOnly) {
    for (let at = 0; at < input.length; at += 4) {
      const alpha = input[at + 3];
      if (alpha === 0) continue;
      const sourceR = input[at], sourceG = input[at + 1], sourceB = input[at + 2];
      const r = linearByByte[sourceR], g = linearByByte[sourceG], b = linearByByte[sourceB];
      const y = luminance(r, g, b);
      if (y <= 1e-5) continue;
      const peak = Math.max(r, g, b);
      const toneHighlightProtection = kernel.algorithmVersion === 2 && kernel.variant === 'vivid' ? 0 : .45;
      const toneAmount = smooth(.025, .14, y) * (1 - toneHighlightProtection * smooth(.86, .99, peak));
      const fittedLuma = clamp(y * toneScale + toneOffset);
      const targetLuma = kernel.algorithmVersion === 2 ? Math.max(y * .55, fittedLuma) : fittedLuma;
      const headroom = 1 / Math.max(peak, 1e-5), targetRatio = targetLuma / y;
      const ratio = kernel.algorithmVersion === 2
        ? 1 + (softenPositiveToneRatio(targetRatio, headroom) - 1) * toneAmount
        : Math.min(headroom, 1 + (targetRatio - 1) * toneAmount);
      if (ratio === 1) continue;
      out[at] = srgbByLinear[Math.round(clamp(r * ratio) * 4096)] * 255;
      out[at + 1] = srgbByLinear[Math.round(clamp(g * ratio) * 4096)] * 255;
      out[at + 2] = srgbByLinear[Math.round(clamp(b * ratio) * 4096)] * 255;
      if (amount < 1) {
        out[at] = sourceR + (out[at] - sourceR) * amount;
        out[at + 1] = sourceG + (out[at + 1] - sourceG) * amount;
        out[at + 2] = sourceB + (out[at + 2] - sourceB) * amount;
      }
      out[at + 3] = alpha;
    }
    return out;
  }
  for (let at = 0; at < input.length; at += 4) {
    const alpha = input[at + 3];
    if (alpha === 0) continue;
    const sourceR = input[at], sourceG = input[at + 1], sourceB = input[at + 2];
    let r = linearByByte[sourceR], g = linearByByte[sourceG], b = linearByByte[sourceB];
    const originalLuma = luminance(r, g, b);
    if (originalLuma <= 1e-5) continue;
    const lumaIndex = Math.min(LUMA_BINS - 1, Math.round(originalLuma * (LUMA_BINS - 1)));
    const peakIndex = Math.min(PEAK_BINS - 1, Math.round(Math.max(r, g, b) * 4096));
    const lumaAt = lumaIndex * 3, peakAt = peakIndex * 2;
    let coolWater = 0;
    if (useCoolWater) {
      if (kernel.algorithmVersion === 2) {
        coolWater = clamp(smooth(.06, .3, b - r) * (1 - .8 * smooth(.015, .18, g - b)));
      } else {
        const cyan = waterTable[Math.min(DIFFERENCE_BINS - 1, Math.max(0, Math.round((g - r - .025) / .22 * 8192 + 8192)))];
        const blue = waterTable[Math.min(DIFFERENCE_BINS - 1, Math.max(0, Math.round((b - r - .035) / .28 * 8192 + 8192)))];
        const cool = waterTable[Math.min(DIFFERENCE_BINS - 1, Math.max(0, Math.round((g + b - 2 * r - .06) / .34 * 8192 + 8192)))];
        coolWater = Math.max(cyan * .72, blue * .42, cool * .35);
      }
    }
    let colourAmount = lumaTables[lumaAt] * peakTables[peakAt];
    if (useCoolWater) colourAmount *= 1 - .68 * coolWater;
    const toneAmount = lumaTables[lumaAt + 1] * peakTables[peakAt + 1];
    if (colourAmount === 0 && toneAmount === 0) continue;
    r *= 1 + (redGain - 1) * colourAmount;
    g *= 1 + (greenGain - 1) * colourAmount;
    b *= 1 + (blueGain - 1) * colourAmount;
    if (kernel.variant === 'vivid' && kernel.chromaGain > 1) {
      const y = luminance(r, g, b), chromaPeak = Math.max(r, g, b);
      const yIndex = Math.min(LUMA_BINS - 1, Math.round(y * (LUMA_BINS - 1)));
      const chromaPeakIndex = Math.min(PEAK_BINS - 1, Math.round(chromaPeak * 4096));
      const protection = lumaTables[yIndex * 3 + 1] * peakTables[chromaPeakIndex * 2] * (1 - .85 * coolWater);
      let gain = 1 + (kernel.chromaGain - 1) * protection;
      if (r > y + 1e-6) gain = Math.min(gain, (1 - y) / (r - y));
      else if (r < y - 1e-6) gain = Math.min(gain, y / (y - r));
      if (g > y + 1e-6) gain = Math.min(gain, (1 - y) / (g - y));
      else if (g < y - 1e-6) gain = Math.min(gain, y / (y - g));
      if (b > y + 1e-6) gain = Math.min(gain, (1 - y) / (b - y));
      else if (b < y - 1e-6) gain = Math.min(gain, y / (y - b));
      r = y + (r - y) * gain; g = y + (g - y) * gain; b = y + (b - y) * gain;
    }
    if (warmSeparation > 0) {
      const warmLuma = luminance(r, g, b), warmPeak = Math.max(r, g, b);
      const protection = smooth(.025, .14, warmLuma) * (1 - smooth(.82, .98, warmPeak)) * (1 - .8 * coolWater);
      const strength = Math.min(.9, warmSeparation * 2) * protection;
      const greenLead = smooth(.03, .3, (g - r) / Math.max(g, .03));
      const nonBlueSubject = 1 - smooth(-.18, .03, (b - g) / Math.max(g, .03));
      const greenAmount = strength * greenLead * nonBlueSubject;
      const supportedRed = smooth(.65, .95, r / Math.max(g, .03));
      const redOverBlue = smooth(.22, .55, r / Math.max(b, .03));
      const violetBlue = smooth(.05, .35, (b - g) / Math.max(b, .03));
      const purpleLead = supportedRed * redOverBlue * violetBlue;
      const purpleAmount = strength * purpleLead;
      const yellowLead = smooth(.08, .4, (Math.min(r, g) - b) / Math.max(Math.min(r, g), .03));
      const balancedYellow = smooth(.45, .9, Math.min(r, g) / Math.max(r, g, .03));
      const yellowAmount = strength * yellowLead * balancedYellow;
      if (greenAmount > 0) {
        const warmRed = Math.min(1, g * 1.6);
        const warmBlue = Math.min(b, Math.min(warmRed, g) * .52);
        r += (warmRed - r) * greenAmount;
        b += (warmBlue - b) * greenAmount;
      }
      if (purpleAmount > 0) {
        const warmRed = Math.min(1, Math.max(r, b * 1.75));
        const warmBlue = Math.min(b, warmRed * .4);
        r += (warmRed - r) * purpleAmount;
        b += (warmBlue - b) * purpleAmount;
      }
      if (yellowAmount > 0) {
        r += (Math.min(1, Math.max(r, g * 1.6)) - r) * yellowAmount;
        b *= 1 - .8 * yellowAmount;
      }
    }
    const changedLuma = luminance(r, g, b);
    const colourRatio = originalLuma / Math.max(changedLuma, 1e-5);
    const targetRatio = lumaTables[lumaAt + 2];
    r *= colourRatio; g *= colourRatio; b *= colourRatio;
    const headroom = 1 / Math.max(r, g, b, 1e-5);
    const ratio = kernel.algorithmVersion === 2
      ? 1 + (softenPositiveToneRatio(targetRatio, headroom) - 1) * toneAmount
      : Math.min(headroom, 1 + (targetRatio - 1) * toneAmount);
    r *= ratio; g *= ratio; b *= ratio;
    out[at] = srgbByLinear[Math.round(clamp(r) * 4096)] * 255;
    out[at + 1] = srgbByLinear[Math.round(clamp(g) * 4096)] * 255;
    out[at + 2] = srgbByLinear[Math.round(clamp(b) * 4096)] * 255;
    if (amount < 1) {
      const finishedR = out[at], finishedG = out[at + 1], finishedB = out[at + 2];
      out[at] = sourceR + (finishedR - sourceR) * amount;
      out[at + 1] = sourceG + (finishedG - sourceG) * amount;
      out[at + 2] = sourceB + (finishedB - sourceB) * amount;
    }
    out[at + 3] = alpha;
  }
  return out;
}
