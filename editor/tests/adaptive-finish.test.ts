import { describe, expect, it } from 'vitest';
import { applyAdaptiveFinish, fitAdaptiveFinish } from '../src/core/adaptive-finish';

function gradient(width = 32, height = 32, cast: 'red' | 'neutral' = 'red') {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const value = 48 + ((x * 5 + y * 3) % 150);
    pixels[at] = cast === 'red' ? Math.min(242, value + 16) : value;
    pixels[at + 1] = value;
    pixels[at + 2] = cast === 'red' ? Math.max(12, value - 8) : value;
    pixels[at + 3] = 255;
  }
  return pixels;
}

describe('adaptive finish candidate math', () => {
  it('fits bounded channel and luminance parameters and reuses them across buffers', () => {
    const reference = gradient(), before = reference.slice();
    const fit = fitAdaptiveFinish(reference, 32, 32, 'colour-tone');
    expect(fit.active).toBe(true);
    expect(fit.colourGains.every(gain => Number.isFinite(gain) && gain >= .82 && gain <= 1.2)).toBe(true);
    expect(fit.toneScale).toBeGreaterThanOrEqual(.88);
    expect(fit.toneScale).toBeLessThanOrEqual(1.12);
    expect(fit.colourGains[0]).toBeLessThan(1);
    expect(reference).toEqual(before);

    const full = applyAdaptiveFinish(reference, 32, 32, fit);
    const first = applyAdaptiveFinish(reference.slice(0, 16 * 32 * 4), 32, 16, fit);
    const second = applyAdaptiveFinish(reference.slice(16 * 32 * 4), 32, 16, fit);
    expect(full).toEqual(new Uint8ClampedArray([...first, ...second]));
    expect(full[3]).toBe(255);
  });

  it('applies tone in linear light while retaining a neutral ramp and alpha', () => {
    const ramp = new Uint8ClampedArray([32, 32, 32, 255, 96, 96, 96, 137, 180, 180, 180, 255]);
    const fit = fitAdaptiveFinish(gradient(32, 32, 'neutral'), 32, 32, 'tone');
    const out = applyAdaptiveFinish(ramp, 3, 1, fit);
    expect(out[4]).toBeLessThan(ramp[4]);
    expect(out[8]).toBeGreaterThan(ramp[8]);
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
    expect(out[7]).toBe(137);
  });

  it('keeps a dense neutral ramp ordered without large adjacent jumps', () => {
    const reference = gradient(32, 32, 'neutral');
    const fit = fitAdaptiveFinish(reference, 32, 32, 'tone');
    const ramp = new Uint8ClampedArray(256 * 4);
    for (let value = 0; value < 256; value++) ramp.set([value, value, value, 255], value * 4);
    const out = applyAdaptiveFinish(ramp, 256, 1, fit);
    let largestStep = 0;
    for (let i = 1; i < 256; i++) {
      expect(out[i * 4]).toBeGreaterThanOrEqual(out[(i - 1) * 4]);
      largestStep = Math.max(largestStep, out[i * 4] - out[(i - 1) * 4]);
      expect(out[i * 4]).toBe(out[i * 4 + 1]);
      expect(out[i * 4]).toBe(out[i * 4 + 2]);
    }
    expect(largestStep).toBeLessThanOrEqual(4);
  });

  it('protects likely cool water pixels in the soft-water candidate', () => {
    const reference = gradient();
    const colourFit = fitAdaptiveFinish(reference, 32, 32, 'colour-tone');
    const waterFit = fitAdaptiveFinish(reference, 32, 32, 'soft-water');
    const cyan = new Uint8ClampedArray([32, 145, 195, 255]);
    const ordinary = new Uint8ClampedArray([150, 130, 110, 255]);
    const colourWater = applyAdaptiveFinish(cyan, 1, 1, colourFit);
    const protectedWater = applyAdaptiveFinish(cyan, 1, 1, waterFit);
    const colourOrdinary = applyAdaptiveFinish(ordinary, 1, 1, colourFit);
    const protectedOrdinary = applyAdaptiveFinish(ordinary, 1, 1, waterFit);
    const distance = (a: Uint8ClampedArray, b: Uint8ClampedArray) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    expect(distance(cyan, protectedWater)).toBeLessThan(distance(cyan, colourWater));
    expect(distance(cyan, protectedWater) / Math.max(1, distance(ordinary, protectedOrdinary)))
      .toBeLessThan(distance(cyan, colourWater) / Math.max(1, distance(ordinary, colourOrdinary)));
  });

  it('keeps explicit physical red-filter surface colour correction off while retaining tone', () => {
    const fit = fitAdaptiveFinish(gradient(), 32, 32, 'colour-tone', { scene: 'surface', filter: 'yes' });
    expect(fit.active).toBe(true);
    expect(fit.colourReason).toBe('protected-surface');
    expect(fit.colourGains).toEqual([1, 1, 1]);
    expect(fit.toneScale).not.toBe(1);
  });

  it('falls back to identity for dark, flat, and insufficient evidence', () => {
    const dark = new Uint8ClampedArray(Array.from({ length: 64 }, () => [3, 4, 5, 255]).flat());
    const flat = new Uint8ClampedArray(Array.from({ length: 64 }, () => [100, 100, 100, 255]).flat());
    const transparent = new Uint8ClampedArray(64 * 4);
    for (const [pixels, reason] of [[dark, 'dark'], [flat, 'flat'], [transparent, 'insufficient-evidence']] as const) {
      const fit = fitAdaptiveFinish(pixels, 8, 8);
      expect(fit.active).toBe(false);
      expect(fit.reason).toBe(reason);
      expect(applyAdaptiveFinish(pixels, 8, 8, fit)).toBe(pixels);
    }
  });

  it('bounds sampling, preserves transparent pixels, and avoids weak-red shadow amplification', () => {
    const large = gradient(1024, 768);
    const fit = fitAdaptiveFinish(large, 1024, 768, 'colour-tone');
    expect(fit.sampleCount).toBeLessThanOrEqual(256 * 256);

    const weakRed = new Uint8ClampedArray(Array.from({ length: 64 }, (_, i) => [4 + i % 4, 90 + i % 75, 120 + i % 65, 255]).flat());
    const weakFit = fitAdaptiveFinish(weakRed, 8, 8, 'colour-tone');
    expect(weakFit.colourReason).toBe('weak-channel');
    expect(weakFit.colourGains).toEqual([1, 1, 1]);
    const transparent = new Uint8ClampedArray([220, 20, 30, 0]);
    expect(applyAdaptiveFinish(transparent, 1, 1, fit)).toEqual(transparent);

    const darkAndEdge = new Uint8ClampedArray([1, 2, 8, 255, 90, 150, 205, 127, 225, 205, 175, 255]);
    const protectedOutput = applyAdaptiveFinish(darkAndEdge, 3, 1, fit);
    expect(protectedOutput.slice(0, 3)).toEqual(darkAndEdge.slice(0, 3));
    expect(protectedOutput[7]).toBe(127);
    expect(protectedOutput[4]).not.toBe(darkAndEdge[4]);
    expect(Math.max(protectedOutput[8], protectedOutput[9], protectedOutput[10])).toBeLessThanOrEqual(255);
    expect(protectedOutput[8]).toBeGreaterThan(protectedOutput[9]);
    expect(protectedOutput[9]).toBeGreaterThan(protectedOutput[10]);
  });

  it('keeps deep shadows exact and returns the original buffer for an active identity fit', () => {
    const active = fitAdaptiveFinish(gradient(), 32, 32, 'colour-tone');
    const dark = new Uint8ClampedArray([1, 2, 8, 255]);
    expect(applyAdaptiveFinish(dark, 1, 1, active)).toEqual(dark);

    const identity = { ...active, colourGains: [1, 1, 1] as const, toneScale: 1, toneOffset: 0 };
    const source = new Uint8ClampedArray([29, 101, 190, 203]);
    expect(applyAdaptiveFinish(source, 1, 1, identity)).toBe(source);
  });

  it('does not clip new highlight channels or invert saturated channel order', () => {
    const fit = fitAdaptiveFinish(gradient(), 32, 32, 'colour-tone');
    const highlights = new Uint8ClampedArray([
      255, 220, 180, 255,
      248, 180, 105, 255,
      240, 238, 230, 255,
    ]);
    const out = applyAdaptiveFinish(highlights, 3, 1, fit);
    for (let at = 0; at < out.length; at += 4) {
      for (let channel = 0; channel < 3; channel++) {
        if (highlights[at + channel] < 255) expect(out[at + channel]).toBeLessThan(255);
      }
    }
    // A substantially red-dominant saturated highlight keeps its hue order.
    expect(out[4]).toBeGreaterThan(out[5]);
    expect(out[5]).toBeGreaterThan(out[6]);
    // A nearly neutral warm highlight may shift channel order slightly, but stays bounded.
    expect(Math.max(Math.abs(out[8] - highlights[8]), Math.abs(out[9] - highlights[9]), Math.abs(out[10] - highlights[10]))).toBeLessThanOrEqual(16);
  });

  it('treats partially transparent RGB consistently and leaves zero-alpha RGB untouched', () => {
    const fit = fitAdaptiveFinish(gradient(), 32, 32, 'colour-tone');
    const pixels = new Uint8ClampedArray([
      95, 145, 195, 127,
      95, 145, 195, 128,
      30, 170, 240, 0,
    ]);
    const out = applyAdaptiveFinish(pixels, 3, 1, fit);
    expect(out.slice(0, 3)).toEqual(out.slice(4, 7));
    expect(out[3]).toBe(127);
    expect(out[7]).toBe(128);
    expect(out.slice(8, 11)).toEqual(pixels.slice(8, 11));
    expect(out[11]).toBe(0);
  });

  it('preserves rendering through a JSON fit round-trip and falls back on invalid fit values', () => {
    const fit = fitAdaptiveFinish(gradient(), 32, 32, 'soft-water');
    const source = new Uint8ClampedArray([45, 130, 190, 255, 170, 140, 105, 189]);
    const restored = JSON.parse(JSON.stringify(fit)) as typeof fit;
    expect(applyAdaptiveFinish(source, 2, 1, restored)).toEqual(applyAdaptiveFinish(source, 2, 1, fit));

    const invalidFits = [
      { ...fit, toneScale: Number.POSITIVE_INFINITY },
      { ...fit, toneScale: 1.5 },
      { ...fit, toneOffset: -.2 },
      { ...fit, colourGains: [1, Number.NaN, 1] },
      { ...fit, colourGains: [1, 1, 1.5] },
    ];
    for (const invalid of invalidFits) {
      expect(applyAdaptiveFinish(source, 2, 1, invalid as unknown as typeof fit)).toBe(source);
    }
  });

  it('returns identity for malformed references or fits and rejects mismatched buffers', () => {
    const pixels = gradient();
    expect(fitAdaptiveFinish(pixels, Number.NaN, 32).active).toBe(false);
    expect(fitAdaptiveFinish(pixels, 31, 32).reason).toBe('invalid-dimensions');
    const valid = fitAdaptiveFinish(pixels, 32, 32);
    const malformed = { ...valid, toneScale: Number.NaN };
    expect(applyAdaptiveFinish(pixels, 32, 32, malformed)).toBe(pixels);
    expect(() => applyAdaptiveFinish(pixels, 31, 32, valid)).toThrow('Adaptive finish dimensions do not match');
  });
});
