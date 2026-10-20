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
  /** Missing means the original saved-fit renderer. */
  readonly algorithmVersion?: 2;
  readonly active: boolean;
  readonly reason: 'fit' | 'invalid-dimensions' | 'insufficient-evidence' | 'dark' | 'flat';
  /** Number of bounded-reference samples used to estimate the fit. */
  readonly sampleCount: number;
  readonly colourReason: 'fit' | 'protected-surface' | 'weak-channel';
  /** Per-channel linear-light multipliers. Always finite and bounded. */
  readonly colourGains: readonly [number, number, number];
  /** Optional bounded chroma expansion. Missing is identity for older saved fits. */
  readonly chromaGain?: number;
  /** V2 Vivid shift for supported green-dominant foreground colours. */
  readonly warmSeparation?: number;
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
const softenPositiveToneRatio = (targetRatio: number, headroom: number) => {
  if (targetRatio <= 1) return targetRatio;
  const room = Math.max(0, headroom - 1), delta = targetRatio - 1;
  return 1 + room * delta / Math.max(room + delta, 1e-8);
};
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
  p65: [number, number, number, number];
  p90: [number, number, number, number];
}

interface NeutralEvidence {
  count: number;
  p50: [number, number, number, number];
}

interface GreenSubjectEvidence {
  count: number;
  medianLead: number;
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

  if (!consideredCount) return { sampleCount, consideredCount, darkCount, p10: [0, 0, 0, 0], p50: [0, 0, 0, 0], p65: [0, 0, 0, 0], p90: [0, 0, 0, 0] };
  const read = (q: number) => histograms.map(histogram => percentile(histogram, consideredCount, q)) as [number, number, number, number];
  return { sampleCount, consideredCount, darkCount, p10: read(.1), p50: read(.5), p65: read(.65), p90: read(.9) };
}

/** Find pale, reasonably neutral pixels that can act as a weak cast anchor. */
function sampleNeutralEvidence(data: Uint8ClampedArray, width: number, height: number): NeutralEvidence | undefined {
  const step = Math.max(1, Math.ceil(width / MAX_REFERENCE_EDGE), Math.ceil(height / MAX_REFERENCE_EDGE));
  const histograms = Array.from({ length: 4 }, () => new Uint32Array(HISTOGRAM_BINS));
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const at = (y * width + x) * 4;
      if (data[at + 3] < 128) continue;
      const r8 = data[at], g8 = data[at + 1], b8 = data[at + 2];
      const peak8 = Math.max(r8, g8, b8);
      if (peak8 >= 251) continue;
      const r = toLinear(r8 / 255), g = toLinear(g8 / 255), b = toLinear(b8 / 255);
      const yLinear = luminance(r, g, b);
      if (yLinear < .22 || yLinear > .86) continue;
      // The generous ratio admits lightly cyan/green shaded sand while
      // rejecting strongly blue water and saturated subjects as cast anchors.
      const normalizedSpread = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(yLinear, .035);
      if (normalizedSpread > .42) continue;
      const values = [r, g, b, yLinear];
      for (let channel = 0; channel < 4; channel++) {
        histograms[channel][Math.round(clamp(values[channel]) * (HISTOGRAM_BINS - 1))]++;
      }
      count++;
    }
  }
  if (!count) return { count, p50: [0, 0, 0, 0] };
  return { count, p50: histograms.map(histogram => percentile(histogram, count, .5)) as [number, number, number, number] };
}

function sampleGreenSubjectEvidence(data: Uint8ClampedArray, width: number, height: number, consideredCount: number): GreenSubjectEvidence {
  const step = Math.max(1, Math.ceil(width / MAX_REFERENCE_EDGE), Math.ceil(height / MAX_REFERENCE_EDGE));
  const leadHistogram = new Uint32Array(HISTOGRAM_BINS);
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const at = (y * width + x) * 4;
      if (data[at + 3] < 128) continue;
      const r8 = data[at], g8 = data[at + 1], b8 = data[at + 2];
      const peak8 = Math.max(r8, g8, b8);
      if (peak8 >= 246) continue;
      const r = toLinear(r8 / 255), g = toLinear(g8 / 255), b = toLinear(b8 / 255);
      const yLinear = luminance(r, g, b);
      if (yLinear < .08 || yLinear > .86 || r < .025) continue;
      // Require green to lead both red and blue, so blue/cyan water and warm
      // subjects do not set this foreground-style estimate.
      if (g < r * 1.16 || g < b * 1.035) continue;
      const lead = clamp((g - r) / Math.max(g, .05));
      leadHistogram[Math.round(lead * (HISTOGRAM_BINS - 1))]++;
      count++;
    }
  }
  return { count: Math.min(count, consideredCount), medianLead: count ? percentile(leadHistogram, count, .5) : 0 };
}

function samplePurpleSubjectEvidence(data: Uint8ClampedArray, width: number, height: number): GreenSubjectEvidence {
  const step = Math.max(1, Math.ceil(width / MAX_REFERENCE_EDGE), Math.ceil(height / MAX_REFERENCE_EDGE));
  const leadHistogram = new Uint32Array(HISTOGRAM_BINS);
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const at = (y * width + x) * 4;
      if (data[at + 3] < 128) continue;
      const r8 = data[at], g8 = data[at + 1], b8 = data[at + 2];
      if (Math.max(r8, g8, b8) >= 246) continue;
      const r = toLinear(r8 / 255), g = toLinear(g8 / 255), b = toLinear(b8 / 255);
      const yLinear = luminance(r, g, b);
      if (yLinear < .08 || yLinear > .86 || Math.min(r, b) < .025) continue;
      const warmChannel = Math.min(r, b), coolChannel = Math.max(r, b);
      // Magenta foreground has red and blue support with a weaker green
      // channel. Red support excludes most blue water and cyan pixels.
      if (warmChannel < g * 1.16 || warmChannel / Math.max(coolChannel, .03) < .42) continue;
      const lead = clamp((warmChannel - g) / Math.max(warmChannel, .05));
      leadHistogram[Math.round(lead * (HISTOGRAM_BINS - 1))]++;
      count++;
    }
  }
  return { count, medianLead: count ? percentile(leadHistogram, count, .5) : 0 };
}

function sampleYellowSubjectEvidence(data: Uint8ClampedArray, width: number, height: number): GreenSubjectEvidence {
  const step = Math.max(1, Math.ceil(width / MAX_REFERENCE_EDGE), Math.ceil(height / MAX_REFERENCE_EDGE));
  const leadHistogram = new Uint32Array(HISTOGRAM_BINS);
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const at = (y * width + x) * 4;
      if (data[at + 3] < 128) continue;
      const r8 = data[at], g8 = data[at + 1], b8 = data[at + 2];
      if (Math.max(r8, g8, b8) >= 246) continue;
      const r = toLinear(r8 / 255), g = toLinear(g8 / 255), b = toLinear(b8 / 255);
      const yLinear = luminance(r, g, b), balanced = Math.min(r, g) / Math.max(r, g, .03);
      if (yLinear < .08 || yLinear > .86 || Math.min(r, g) < .035 || balanced < .45) continue;
      const lead = clamp((Math.min(r, g) - b) / Math.max(Math.min(r, g), .05));
      if (lead < .08) continue;
      leadHistogram[Math.round(lead * (HISTOGRAM_BINS - 1))]++;
      count++;
    }
  }
  return { count, medianLead: count ? percentile(leadHistogram, count, .5) : 0 };
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

/**
 * Fit a stronger optional look for new analyses. The renderer deliberately
 * selects version-specific protections and tone mapping. Saved v1 fits keep
 * their original rendering. New Natural fits combine restrained colour/tone;
 * Vivid adds an evidence-gated warm style with denser protected midtones.
 */
export function fitAdaptiveFinishV2(
  reference: Uint8ClampedArray,
  width: number,
  height: number,
  variant: 'tone' | 'vivid',
  options: AdaptiveFinishOptions = {},
): AdaptiveFinishFit {
  if (!['tone', 'vivid'].includes(variant)) throw new Error('Unknown adaptive finish variant.');
  const stats = sampleReference(reference, width, height);
  if (!stats) return { ...inactive(variant, 'invalid-dimensions'), algorithmVersion: 2 };
  if (stats.sampleCount >= MIN_SAMPLES && stats.darkCount / stats.sampleCount > .65) return { ...inactive(variant, 'dark', stats.consideredCount), algorithmVersion: 2 };
  if (stats.consideredCount < MIN_SAMPLES || stats.consideredCount < stats.sampleCount * .12) {
    return { ...inactive(variant, 'insufficient-evidence', stats.consideredCount), algorithmVersion: 2 };
  }
  const [low, mid, high] = [stats.p10[3], stats.p50[3], stats.p90[3]];
  if (mid < .055) return { ...inactive(variant, 'dark', stats.consideredCount), algorithmVersion: 2 };
  if (high - low < .11) return { ...inactive(variant, 'flat', stats.consideredCount), algorithmVersion: 2 };

  // Target a little more endpoint separation than v1, retaining the source
  // midtone and the per-pixel highlight/shadow rolloffs in the shared renderer.
  const slope = clamp(.70 / Math.max(high - low, .001), .72, 1.3);
  const toneScale = 1 + (slope - 1) * (variant === 'tone' ? .58 : .84);
  const toneOffset = mid * (1 - toneScale) - (variant === 'vivid' ? .04 : 0);
  const knownFilteredSurface = options.scene === 'surface' && options.filter === 'yes';
  const protectRedCorrection = options.preserveRedCorrection === true || knownFilteredSurface;
  const colour = protectRedCorrection
      ? { gains: [1, 1, 1] as [number, number, number], reason: 'protected-surface' as const }
      : variant === 'tone'
        ? (() => {
          const restrained = boundedColourGains(stats, 'vivid');
          return { gains: restrained.gains.map(gain => 1 + (gain - 1) * .4) as [number, number, number], reason: restrained.reason };
        })()
        : boundedColourGainsV2(reference, width, height, stats);
  const warmSeparation = variant === 'vivid' && !protectRedCorrection && colour.reason === 'fit'
    ? fitWarmSeparation(reference, width, height, stats.consideredCount)
    : 0;

  return {
    variant,
    algorithmVersion: 2,
    active: true,
    reason: 'fit',
    sampleCount: stats.consideredCount,
    colourReason: colour.reason,
    colourGains: colour.gains,
    ...(variant === 'vivid' ? { chromaGain: colour.reason === 'fit' ? 1.12 : 1 } : {}),
    ...(warmSeparation > 0 ? { warmSeparation } : {}),
    toneScale: clamp(toneScale, .78, 1.24),
    toneOffset: clamp(toneOffset, -.10, .06),
  };
}

function fitWarmSeparation(reference: Uint8ClampedArray, width: number, height: number, consideredCount: number): number {
  const green = sampleGreenSubjectEvidence(reference, width, height, consideredCount);
  const purple = samplePurpleSubjectEvidence(reference, width, height);
  const yellow = sampleYellowSubjectEvidence(reference, width, height);
  const count = green.count + purple.count + yellow.count;
  if (count < Math.max(MIN_SAMPLES, consideredCount * .025)) return 0;
  const share = count / Math.max(consideredCount, 1);
  const lead = Math.max(green.medianLead, purple.medianLead, yellow.medianLead);
  return clamp(.45 * smooth(.025, .16, share) * smooth(.08, .34, lead), 0, .45);
}

function boundedColourGainsV2(
  reference: Uint8ClampedArray,
  width: number,
  height: number,
  stats: ReferenceStats,
): { gains: [number, number, number]; reason: AdaptiveFinishFit['colourReason'] } {
  const neutral = sampleNeutralEvidence(reference, width, height);
  const enoughNeutral = !!neutral && neutral.count >= Math.max(MIN_SAMPLES, stats.consideredCount * .005);
  const evidence = enoughNeutral ? neutral!.p50 : stats.p65;
  const anchor = evidence[3];
  if (anchor < .035) return { gains: [1, 1, 1], reason: 'weak-channel' };
  // A cast estimate cannot rescue a channel whose upper-middle support is
  // still at the noise floor; bright neutral evidence is the only exception.
  if (!enoughNeutral && evidence[0] < .035) return { gains: [1, 1, 1], reason: 'weak-channel' };

  // When the image contains pale neutral-ish areas, use them to estimate a
  // mild cast without asking the blue water or saturated coral to be neutral.
  // Otherwise use upper-middle channel support, which is less sensitive to
  // weak-red sensor noise than a scene-wide median.
  const chroma = (Math.max(evidence[0], evidence[1], evidence[2]) - Math.min(evidence[0], evidence[1], evidence[2])) / Math.max(anchor, .035);
  const amount = enoughNeutral ? .78 : .55 * (1 - .35 * smooth(.72, 1.2, chroma));
  const raw = [0, 1, 2].map(channel => clamp((anchor / Math.max(evidence[channel], .012)) ** amount, .65, 2.2));
  const before = luminance(stats.p50[0], stats.p50[1], stats.p50[2]);
  const after = luminance(stats.p50[0] * raw[0], stats.p50[1] * raw[1], stats.p50[2] * raw[2]);
  const normalise = clamp(before / Math.max(after, .001), .9, 1.1);
  const gains = raw.map(gain => clamp(gain * normalise, .65, 2.2)) as [number, number, number];
  // Vivid is intentionally warm: a blue-biased neutral estimate must not make
  // reef subjects pink. The local water guard preserves blue/cyan regions.
  gains[2] = Math.min(gains[2], gains[0]);
  return { gains, reason: 'fit' };
}

function waterLikelihood(r: number, g: number, b: number): number {
  const cyan = clamp((g - r - .025) / .22);
  const blue = clamp((b - r - .035) / .28);
  const cool = clamp((g + b - 2 * r - .06) / .34);
  return Math.max(cyan * .72, blue * .42, cool * .35);
}

function waterLikelihoodV2(r: number, g: number, b: number): number {
  // Preserve blue/cyan pixels while allowing green-dominant reef subjects to
  // receive the fit. This remains a colour heuristic, not segmentation.
  const cool = smooth(.06, .3, b - r);
  const blueDominance = 1 - .8 * smooth(.015, .18, g - b);
  return clamp(cool * blueDominance);
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
  const v2 = !!fit && fit.algorithmVersion === 2;
  if (!fit || typeof fit !== 'object' || (fit.algorithmVersion !== undefined && !v2) || !['tone', 'colour-tone', 'soft-water', 'vivid'].includes(fit.variant) || typeof fit.active !== 'boolean' ||
    !Number.isInteger(fit.sampleCount) || fit.sampleCount < 0 || !Array.isArray(fit.colourGains) || fit.colourGains.length !== 3 ||
    !['fit', 'protected-surface', 'weak-channel'].includes(fit.colourReason) ||
    fit.colourGains.some(gain => !Number.isFinite(gain) || gain < (v2 ? .65 : .82) || gain > (v2 ? 2.2 : 1.2)) ||
    (fit.warmSeparation !== undefined && (!v2 || fit.variant !== 'vivid' || fit.colourReason !== 'fit' || !Number.isFinite(fit.warmSeparation) || fit.warmSeparation < 0 || fit.warmSeparation > .45)) ||
    (fit.chromaGain !== undefined && (!Number.isFinite(fit.chromaGain) || fit.chromaGain < 1 || fit.chromaGain > 1.15)) ||
    !Number.isFinite(fit.toneScale) || fit.toneScale < (v2 ? .78 : .88) || fit.toneScale > (v2 ? 1.24 : 1.12) ||
    !Number.isFinite(fit.toneOffset) || fit.toneOffset < (v2 ? -.10 : -.045) || fit.toneOffset > (v2 ? .06 : .045)) return input;
  if (!fit.active) return input;
  const chromaGain = fit.variant === 'vivid' && fit.colourReason === 'fit' ? fit.chromaGain ?? 1 : 1;
  const warmSeparation = v2 && fit.variant === 'vivid' ? fit.warmSeparation ?? 0 : 0;
  if (fit.toneScale === 1 && fit.toneOffset === 0 && fit.colourGains[0] === 1 && fit.colourGains[1] === 1 && fit.colourGains[2] === 1 && chromaGain === 1 && warmSeparation === 0) return input;
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

    const useWaterGuard = fit.variant === 'soft-water' || fit.variant === 'vivid' ||
      (v2 && fit.variant === 'tone' && fit.colourGains.some(gain => gain !== 1));
    const coolWater = useWaterGuard
      ? (v2 ? waterLikelihoodV2(r, g, b) : waterLikelihood(r, g, b)) : 0;
    let colourAmount = 1;
    if (useWaterGuard) colourAmount -= .68 * coolWater;
    const peak = Math.max(r, g, b);
    const shadowProtection = smooth(.025, .15, originalLuma);
    const highlightProtection = 1 - smooth(.82, .98, peak);
    colourAmount *= shadowProtection * highlightProtection;
    const toneHighlightProtection = v2 && fit.variant === 'vivid' ? 0 : .45;
    const toneAmount = smooth(.025, .14, originalLuma) * (1 - toneHighlightProtection * smooth(.86, .99, peak));
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

    if (warmSeparation > 0) {
      const warmLuma = luminance(r, g, b), warmPeak = Math.max(r, g, b);
      const greenLead = smooth(.03, .3, (g - r) / Math.max(g, .03));
      const nonBlueSubject = 1 - smooth(-.18, .03, (b - g) / Math.max(g, .03));
      const protection = smooth(.025, .14, warmLuma) * (1 - smooth(.82, .98, warmPeak)) * (1 - .8 * coolWater);
      const greenAmount = Math.min(.9, warmSeparation * 2) * greenLead * nonBlueSubject * protection;
      const supportedRed = smooth(.65, .95, r / Math.max(g, .03));
      const redOverBlue = smooth(.22, .55, r / Math.max(b, .03));
      const violetBlue = smooth(.05, .35, (b - g) / Math.max(b, .03));
      const purpleLead = supportedRed * redOverBlue * violetBlue;
      const purpleAmount = Math.min(.9, warmSeparation * 2) * purpleLead * protection;
      const yellowLead = smooth(.08, .4, (Math.min(r, g) - b) / Math.max(Math.min(r, g), .03));
      const balancedYellow = smooth(.45, .9, Math.min(r, g) / Math.max(r, g, .03));
      const yellowAmount = Math.min(.9, warmSeparation * 2) * yellowLead * balancedYellow * protection;
      if (greenAmount > 0) {
        // Move supported green foreground toward a bounded warm target while
        // leaving cool pixels outside the local hue mask unchanged.
        const warmRed = Math.min(1, g * 1.6);
        const warmBlue = Math.min(b, Math.min(warmRed, g) * .52);
        r += (warmRed - r) * greenAmount;
        b += (warmBlue - b) * greenAmount;
      }
      if (purpleAmount > 0) {
        // Lift supported magenta subjects toward pink without touching blue
        // water, which lacks the red support required by this mask.
        const warmRed = Math.min(1, Math.max(r, b * 1.75));
        // Preserve the subject's luma later, while moving its hue from blue
        // violet toward red magenta by reducing blue relative to supported red.
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
    // First preserve luminance while changing colour, then apply the tone curve.
    // Both operations stay in linear light and the smooth rolloff protects highlights.
    const colourRatio = originalLuma / Math.max(changedLuma, 1e-5);
    const fittedLuma = clamp(originalLuma * fit.toneScale + fit.toneOffset);
    const targetLuma = v2 ? Math.max(originalLuma * .55, fittedLuma) : fittedLuma;
    const targetRatio = targetLuma / Math.max(originalLuma, 1e-5);
    r *= colourRatio;
    g *= colourRatio;
    b *= colourRatio;
    const headroom = 1 / Math.max(r, g, b, 1e-5);
    const ratio = v2
      ? 1 + (softenPositiveToneRatio(targetRatio, headroom) - 1) * toneAmount
      : Math.min(headroom, 1 + (targetRatio - 1) * toneAmount);
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
