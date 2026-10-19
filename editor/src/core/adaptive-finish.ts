/**
 * Isolated adaptive photo finish candidates.
 *
 * The fit is derived once from a bounded corrected reference and can be reused
 * for preview/export buffers. It deliberately estimates only a modest global
 * colour balance and luminance curve; it cannot recover missing scene colour.
 */

export type AdaptiveFinishVariant = 'tone' | 'colour-tone' | 'soft-water' | 'vivid';

export interface AdaptiveFinishFit {
  readonly variant: AdaptiveFinishVariant;
  readonly active: boolean;
  readonly reason: 'fit' | 'invalid-dimensions' | 'insufficient-evidence' | 'dark' | 'flat';
  /** Number of bounded-reference samples used to estimate the fit. */
  readonly sampleCount: number;
  readonly colourReason: 'fit' | 'protected-surface' | 'weak-channel';
  /** Per-channel linear-light multipliers. Always finite and bounded. */
  readonly colourGains: readonly [number, number, number];
  /** Optional bounded chroma expansion. Missing is identity for older saved fits. */
  readonly chromaGain?: number;
  /** Linear-light luminance curve: output = input * toneScale + toneOffset. */
  readonly toneScale: number;
  readonly toneOffset: number;
}

export interface AdaptiveFinishOptions {
  /** A known surface shot with an intentional red filter keeps the existing red removal. */
  readonly scene?: 'surface' | 'underwater' | 'auto';
  readonly filter?: 'yes' | 'no' | 'auto';
  readonly preserveRedCorrection?: boolean;
}

const IDENTITY_GAINS = [1, 1, 1] as const;
const HISTOGRAM_BINS = 1024;
const MAX_REFERENCE_EDGE = 256;
const MIN_SAMPLES = 48;
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const smooth = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};
const luminance = (r: number, g: number, b: number) => .2126 * r + .7152 * g + .0722 * b;
const decode = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const encode = (value: number) => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
const linearLut = Float32Array.from({ length: 4097 }, (_, i) => decode(i / 4096));
const srgbLut = Float32Array.from({ length: 4097 }, (_, i) => encode(i / 4096));
const toLinear = (value: number) => linearLut[Math.round(clamp(value) * 4096)];
const toSrgb = (value: number) => srgbLut[Math.round(clamp(value) * 4096)];

interface ReferenceStats {
  sampleCount: number;
  consideredCount: number;
  darkCount: number;
  p10: [number, number, number, number];
  p50: [number, number, number, number];
  p90: [number, number, number, number];
}

function percentile(histogram: Uint32Array, count: number, quantile: number): number {
  const target = Math.max(1, Math.ceil(count * quantile));
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i];
    if (seen >= target) return i / (histogram.length - 1);
  }
  return 1;
}

function sampleReference(data: Uint8ClampedArray, width: number, height: number): ReferenceStats | undefined {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) return undefined;
  const step = Math.max(1, Math.ceil(width / MAX_REFERENCE_EDGE), Math.ceil(height / MAX_REFERENCE_EDGE));
  const histograms = Array.from({ length: 4 }, () => new Uint32Array(HISTOGRAM_BINS));
  let sampleCount = 0;
  let consideredCount = 0;
  let darkCount = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const at = (y * width + x) * 4;
      if (data[at + 3] < 128) continue;
      sampleCount++;
      const r8 = data[at], g8 = data[at + 1], b8 = data[at + 2];
      const peak = Math.max(r8, g8, b8);
      const r = toLinear(r8 / 255), g = toLinear(g8 / 255), b = toLinear(b8 / 255);
      const yLinear = luminance(r, g, b);
      if (yLinear < .035) darkCount++;
      // Very dark samples mostly describe sensor/backscatter noise; clipped
      // samples cannot tell us the missing channel relationships.
      if (yLinear < .035 || yLinear > .965 || peak >= 251) continue;
      consideredCount++;
      const values = [r, g, b, yLinear];
      for (let channel = 0; channel < 4; channel++) {
        histograms[channel][Math.round(clamp(values[channel]) * (HISTOGRAM_BINS - 1))]++;
      }
    }
  }

  if (!consideredCount) return { sampleCount, consideredCount, darkCount, p10: [0, 0, 0, 0], p50: [0, 0, 0, 0], p90: [0, 0, 0, 0] };
  const read = (q: number) => histograms.map(histogram => percentile(histogram, consideredCount, q)) as [number, number, number, number];
  return { sampleCount, consideredCount, darkCount, p10: read(.1), p50: read(.5), p90: read(.9) };
}

function inactive(variant: AdaptiveFinishVariant, reason: AdaptiveFinishFit['reason'], sampleCount = 0): AdaptiveFinishFit {
  return { variant, active: false, reason, sampleCount, colourReason: 'fit', colourGains: IDENTITY_GAINS, ...(variant === 'vivid' ? { chromaGain: 1 } : {}), toneScale: 1, toneOffset: 0 };
}

function boundedColourGains(stats: ReferenceStats, variant: AdaptiveFinishVariant): { gains: [number, number, number]; reason: AdaptiveFinishFit['colourReason'] } {
  if (variant === 'tone') return { gains: [1, 1, 1], reason: 'fit' };
  const mid = stats.p50;
  // Strongly chromatic frames can be a blue/red subject or water itself.
  // Leave colour alone unless their channel medians provide usable evidence.
  const chroma = (Math.max(mid[0], mid[1], mid[2]) - Math.min(mid[0], mid[1], mid[2])) / Math.max(mid[3], .035);
  if (chroma > .72) return { gains: [1, 1, 1], reason: 'weak-channel' };
  // The luminance median is the brightness anchor; percentile spans add a
  // restrained channel-contrast estimate without forcing channel means to grey.
  const anchor = mid[3];
  if (Math.min(mid[0], mid[1], mid[2]) < .035) return { gains: [1, 1, 1], reason: 'weak-channel' };
  const amount = variant === 'soft-water' ? .17 : .22;
  const luminanceRange = Math.max(.04, stats.p90[3] - stats.p10[3]);
  const raw = [0, 1, 2].map(channel => {
    const medianGain = (anchor / Math.max(mid[channel], .02)) ** amount;
    const channelRange = Math.max(.04, stats.p90[channel] - stats.p10[channel]);
    const rangeGain = (luminanceRange / channelRange) ** (amount * .25);
    return clamp(medianGain * rangeGain, .84, 1.18);
  });
  const before = luminance(mid[0], mid[1], mid[2]);
  const after = luminance(mid[0] * raw[0], mid[1] * raw[1], mid[2] * raw[2]);
  const normalise = clamp(before / Math.max(after, .001), .96, 1.04);
  return { gains: raw.map(gain => clamp(gain * normalise, .82, 1.2)) as [number, number, number], reason: 'fit' };
}

/** Fit one photo reference. Sampling is spatially bounded to at most 256×256 locations. */
export function fitAdaptiveFinish(
  reference: Uint8ClampedArray,
  width: number,
  height: number,
  variant: AdaptiveFinishVariant = 'colour-tone',
  options: AdaptiveFinishOptions = {},
): AdaptiveFinishFit {
  if (!['tone', 'colour-tone', 'soft-water', 'vivid'].includes(variant)) throw new Error('Unknown adaptive finish variant.');
  const stats = sampleReference(reference, width, height);
  if (!stats) return inactive(variant, 'invalid-dimensions');
  if (stats.sampleCount >= MIN_SAMPLES && stats.darkCount / stats.sampleCount > .65) return inactive(variant, 'dark', stats.consideredCount);
  if (stats.consideredCount < MIN_SAMPLES || stats.consideredCount < stats.sampleCount * .12) {
    return inactive(variant, 'insufficient-evidence', stats.consideredCount);
  }

  const [low, mid, high] = [stats.p10[3], stats.p50[3], stats.p90[3]];
  if (mid < .055) return inactive(variant, 'dark', stats.consideredCount);
  if (high - low < .11) return inactive(variant, 'flat', stats.consideredCount);

  // Stretch a little toward useful endpoints while keeping the midtone fixed.
  // The slope cap avoids an aggressive auto-contrast pass on already graded AI output.
  const slope = clamp(.78 / Math.max(high - low, .001), .82, 1.2);
  const toneScale = 1 + (slope - 1) * .62;
  const toneOffset = mid * (1 - toneScale);
  const knownFilteredSurface = options.scene === 'surface' && options.filter === 'yes';
  const protectRedCorrection = options.preserveRedCorrection === true || knownFilteredSurface;
  const colour = protectRedCorrection ? { gains: [1, 1, 1] as [number, number, number], reason: 'protected-surface' as const } : boundedColourGains(stats, variant);
  return {
    variant,
    active: true,
    reason: 'fit',
    sampleCount: stats.consideredCount,
    colourReason: colour.reason,
    colourGains: colour.gains,
    ...(variant === 'vivid' ? { chromaGain: colour.reason === 'fit' ? 1.12 : 1 } : {}),
    toneScale: clamp(toneScale, .88, 1.12),
    toneOffset: clamp(toneOffset, -.045, .045),
  };
}

function waterLikelihood(r: number, g: number, b: number): number {
  const cyan = clamp((g - r - .025) / .22);
  const blue = clamp((b - r - .035) / .28);
  const cool = clamp((g + b - 2 * r - .06) / .34);
  return Math.max(cyan * .72, blue * .42, cool * .35);
}

/** Apply a saved fit to a full buffer or any matching export strip. */
export function applyAdaptiveFinish(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  fit: AdaptiveFinishFit,
): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || input.length !== width * height * 4) {
    throw new Error('Adaptive finish dimensions do not match.');
  }
  if (!fit || typeof fit !== 'object' || !['tone', 'colour-tone', 'soft-water', 'vivid'].includes(fit.variant) || typeof fit.active !== 'boolean' ||
    !Number.isInteger(fit.sampleCount) || fit.sampleCount < 0 || !Array.isArray(fit.colourGains) || fit.colourGains.length !== 3 ||
    !['fit', 'protected-surface', 'weak-channel'].includes(fit.colourReason) ||
    fit.colourGains.some(gain => !Number.isFinite(gain) || gain < .82 || gain > 1.2) ||
    (fit.chromaGain !== undefined && (!Number.isFinite(fit.chromaGain) || fit.chromaGain < 1 || fit.chromaGain > 1.15)) ||
    !Number.isFinite(fit.toneScale) || fit.toneScale < .88 || fit.toneScale > 1.12 ||
    !Number.isFinite(fit.toneOffset) || fit.toneOffset < -.045 || fit.toneOffset > .045) return input;
  if (!fit.active) return input;
  const chromaGain = fit.variant === 'vivid' && fit.colourReason === 'fit' ? fit.chromaGain ?? 1 : 1;
  if (fit.toneScale === 1 && fit.toneOffset === 0 && fit.colourGains[0] === 1 && fit.colourGains[1] === 1 && fit.colourGains[2] === 1 && chromaGain === 1) return input;
  const out = new Uint8ClampedArray(input);
  const [redGain, greenGain, blueGain] = fit.colourGains;

  for (let at = 0; at < input.length; at += 4) {
    const alpha = input[at + 3];
    if (alpha === 0) continue;
    let r = toLinear(input[at] / 255);
    let g = toLinear(input[at + 1] / 255);
    let b = toLinear(input[at + 2] / 255);
    const originalLuma = luminance(r, g, b);
    if (originalLuma <= 1e-5) continue;

    const coolWater = fit.variant === 'soft-water' || fit.variant === 'vivid' ? waterLikelihood(r, g, b) : 0;
    let colourAmount = 1;
    if (fit.variant === 'soft-water' || fit.variant === 'vivid') colourAmount -= .68 * coolWater;
    const peak = Math.max(r, g, b);
    const shadowProtection = smooth(.025, .15, originalLuma);
    const highlightProtection = 1 - smooth(.82, .98, peak);
    colourAmount *= shadowProtection * highlightProtection;
    const toneAmount = smooth(.025, .14, originalLuma) * (1 - .45 * smooth(.86, .99, peak));
    if (colourAmount === 0 && toneAmount === 0) continue;
    const effectiveRed = 1 + (redGain - 1) * colourAmount;
    const effectiveGreen = 1 + (greenGain - 1) * colourAmount;
    const effectiveBlue = 1 + (blueGain - 1) * colourAmount;
    r *= effectiveRed;
    g *= effectiveGreen;
    b *= effectiveBlue;

    if (fit.variant === 'vivid' && chromaGain > 1) {
      const y = luminance(r, g, b);
      const chromaPeak = Math.max(r, g, b);
      const protection = smooth(.025, .14, y) * (1 - smooth(.82, .98, chromaPeak)) * (1 - .85 * coolWater);
      let gain = 1 + (chromaGain - 1) * protection;
      // Expanding chroma around luminance can otherwise push one channel past
      // the SDR gamut. Limit the shared expansion before applying any clipping.
      for (const channel of [r, g, b]) {
        if (channel > y + 1e-6) gain = Math.min(gain, (1 - y) / (channel - y));
        else if (channel < y - 1e-6) gain = Math.min(gain, y / (y - channel));
      }
      r = y + (r - y) * gain;
      g = y + (g - y) * gain;
      b = y + (b - y) * gain;
    }

    const changedLuma = luminance(r, g, b);
    // First preserve luminance while changing colour, then apply the tone curve.
    // Both operations stay in linear light and the smooth rolloff protects highlights.
    const colourRatio = originalLuma / Math.max(changedLuma, 1e-5);
    const targetLuma = clamp(originalLuma * fit.toneScale + fit.toneOffset);
    const targetRatio = targetLuma / Math.max(originalLuma, 1e-5);
    r *= colourRatio;
    g *= colourRatio;
    b *= colourRatio;
    const headroom = 1 / Math.max(r, g, b, 1e-5);
    const ratio = Math.min(headroom, 1 + (targetRatio - 1) * toneAmount);
    r *= ratio;
    g *= ratio;
    b *= ratio;

    out[at] = toSrgb(r) * 255;
    out[at + 1] = toSrgb(g) * 255;
    out[at + 2] = toSrgb(b) * 255;
    out[at + 3] = alpha;
  }
  return out;
}
