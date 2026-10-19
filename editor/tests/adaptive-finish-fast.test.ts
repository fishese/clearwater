import { describe, expect, it } from 'vitest';
import { applyAdaptiveFinish, fitAdaptiveFinish } from '../src/core/adaptive-finish';
import { applyAdaptiveFinishFast, prepareAdaptiveFinishFast } from '../src/core/adaptive-finish-fast';

function gradient(width = 48, height = 40, neutral = false) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const value = 28 + ((x * 7 + y * 11) % 210);
    pixels[at] = neutral ? value : Math.min(249, value + 17);
    pixels[at + 1] = value;
    pixels[at + 2] = neutral ? value : Math.max(8, value - 12);
    pixels[at + 3] = (x + y) % 19 === 0 ? 127 : 255;
  }
  return pixels;
}

function seededPixels(count: number, seed = 0x5eed1234) {
  const pixels = new Uint8ClampedArray(count * 4);
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state >>> 24;
  };
  for (let at = 0; at < pixels.length; at += 4) {
    pixels[at] = next(); pixels[at + 1] = next(); pixels[at + 2] = next(); pixels[at + 3] = next();
  }
  return pixels;
}

function expectCloseToReference(input: Uint8ClampedArray, width: number, height: number, variant: 'tone' | 'colour-tone' | 'soft-water' | 'vivid') {
  const fit = fitAdaptiveFinish(gradient(), 48, 40, variant);
  expect(fit.active).toBe(true);
  const expected = applyAdaptiveFinish(input, width, height, fit);
  const actual = applyAdaptiveFinishFast(input, width, height, prepareAdaptiveFinishFast(fit));
  let maximumDelta = 0;
  for (let at = 0; at < input.length; at++) {
    if (at % 4 === 3) expect(actual[at]).toBe(expected[at]);
    else maximumDelta = Math.max(maximumDelta, Math.abs(actual[at] - expected[at]));
  }
  expect(maximumDelta).toBeLessThanOrEqual(1);
}

describe('compiled adaptive finish experiment', () => {
  it('matches the reference within one byte over dense neutral ramps for every variant', () => {
    const ramp = new Uint8ClampedArray(256 * 4);
    for (let value = 0; value < 256; value++) ramp.set([value, value, value, value], value * 4);
    for (const variant of ['tone', 'colour-tone', 'soft-water', 'vivid'] as const) expectCloseToReference(ramp, 256, 1, variant);
  });

  it('matches seeded random RGB, alpha edges, noisy shadows and highlights', () => {
    const random = seededPixels(25_000);
    const edgeAndNoise = new Uint8ClampedArray(6_000 * 4);
    for (let pixel = 0; pixel < 6_000; pixel++) {
      const at = pixel * 4;
      const block = pixel % 6;
      const noise = (pixel * 73) & 31;
      if (block === 0) edgeAndNoise.set([noise, noise >> 1, noise >> 2, 0], at);
      else if (block === 1) edgeAndNoise.set([2 + noise, 4 + noise, 9 + noise, 1], at);
      else if (block === 2) edgeAndNoise.set([245 + (noise % 11), 220 + (noise % 30), 180 + (noise % 50), 127], at);
      else if (block === 3) edgeAndNoise.set([30 + noise, 110 + noise, 170 + noise, 255], at);
      else if (block === 4) edgeAndNoise.set([120 + noise, 121 + noise, 119 + noise, 254], at);
      else edgeAndNoise.set([noise * 3, noise * 6, noise * 8, 255], at);
    }
    for (const variant of ['tone', 'colour-tone', 'soft-water', 'vivid'] as const) {
      expectCloseToReference(random, 250, 100, variant);
      expectCloseToReference(edgeAndNoise, 100, 60, variant);
    }
  });

  it('keeps absent, inactive, malformed, and active-identity fits byte-identical', () => {
    const input = seededPixels(512);
    const fit = fitAdaptiveFinish(gradient(), 48, 40, 'colour-tone');
    const identity = { ...fit, colourGains: [1, 1, 1] as const, toneScale: 1, toneOffset: 0 };
    for (const candidate of [
      { ...fit, active: false }, identity,
      { ...fit, toneScale: Number.NaN }, { ...fit, chromaGain: 1.2 },
    ]) {
      const kernel = prepareAdaptiveFinishFast(candidate);
      expect(applyAdaptiveFinishFast(input, 32, 16, kernel)).toBe(input);
    }
  });

  it('compiles Natural and protected colour-fallback fits to the compact tone-only path', () => {
    const source = seededPixels(8_192, 0xf17e), tone = fitAdaptiveFinish(gradient(), 48, 40, 'tone');
    const toneKernel = prepareAdaptiveFinishFast(tone);
    expect(toneKernel.toneOnly).toBe(true);
    expect(toneKernel.lumaTables.byteLength).toBe(0);
    expect(toneKernel.peakTables.byteLength).toBe(0);
    const fallback = fitAdaptiveFinish(gradient(), 48, 40, 'vivid', { scene: 'surface', filter: 'yes' });
    expect(fallback.colourReason).toBe('protected-surface');
    expect(fallback.chromaGain).toBe(1);
    const fallbackKernel = prepareAdaptiveFinishFast(fallback);
    expect(fallbackKernel.toneOnly).toBe(true);
    expect(fallbackKernel.lumaTables.byteLength).toBe(0);
    expect(fallbackKernel.peakTables.byteLength).toBe(0);
    for (const fit of [tone, fallback]) {
      const expected = applyAdaptiveFinish(source, 128, 64, fit);
      const actual = applyAdaptiveFinishFast(source, 128, 64, prepareAdaptiveFinishFast(fit));
      expect(actual).toEqual(expected);
    }
  });

  it('blends Natural amounts from byte-quantized output in copy and in-place modes', () => {
    const fit = fitAdaptiveFinish(gradient(), 48, 40, 'tone');
    const kernel = prepareAdaptiveFinishFast(fit), source = seededPixels(4_096, 0x50a7e);
    for (let at = 3; at < source.length; at += 4) source[at] = [0, 1, 127, 128, 255][(at / 4) % 5];
    const full = applyAdaptiveFinishFast(source, 64, 64, kernel);
    const expected = new Uint8ClampedArray(source.length), amount = .5;
    for (let at = 0; at < source.length; at += 4) {
      for (let channel = 0; channel < 3; channel++) expected[at + channel] = source[at + channel] + (full[at + channel] - source[at + channel]) * amount;
      expected[at + 3] = source[at + 3];
    }
    const copied = applyAdaptiveFinishFast(source, 64, 64, kernel, { amount });
    expect(copied).toEqual(expected);
    const inPlace = source.slice();
    expect(applyAdaptiveFinishFast(inPlace, 64, 64, kernel, { amount, inPlace: true })).toBe(inPlace);
    expect(inPlace).toEqual(expected);
  });

  it('does not mutate by default and supports an explicit in-place pass', () => {
    const fit = fitAdaptiveFinish(gradient(), 48, 40, 'soft-water');
    const kernel = prepareAdaptiveFinishFast(fit);
    const source = seededPixels(800), before = source.slice();
    const copied = applyAdaptiveFinishFast(source, 40, 20, kernel);
    expect(source).toEqual(before);
    const inPlace = source.slice();
    expect(applyAdaptiveFinishFast(inPlace, 40, 20, kernel, { inPlace: true })).toBe(inPlace);
    expect(inPlace).toEqual(copied);
  });

  it('mixes from the byte-quantized finished pixel in the same pass', () => {
    const fit = fitAdaptiveFinish(gradient(), 48, 40, 'vivid');
    const kernel = prepareAdaptiveFinishFast(fit), source = seededPixels(1_200, 0xa11ce);
    const before = source.slice(), finished = applyAdaptiveFinish(source, 40, 30, fit);
    const expected = new Uint8ClampedArray(source.length), amount = .37;
    for (let at = 0; at < source.length; at += 4) {
      for (let channel = 0; channel < 3; channel++) expected[at + channel] = source[at + channel] + (finished[at + channel] - source[at + channel]) * amount;
      expected[at + 3] = source[at + 3];
    }
    const actual = applyAdaptiveFinishFast(source, 40, 30, kernel, { amount });
    expect(source).toEqual(before);
    let maximumDelta = 0;
    for (let at = 0; at < source.length; at++) if (at % 4 !== 3) maximumDelta = Math.max(maximumDelta, Math.abs(actual[at] - expected[at]));
    expect(maximumDelta).toBeLessThanOrEqual(1);
    expect(applyAdaptiveFinishFast(source, 40, 30, kernel, { amount: 0 })).toBe(source);
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
      expect(() => applyAdaptiveFinishFast(source, 40, 30, kernel, { amount: invalid })).toThrow('Adaptive finish amount must be between 0 and 1');
    }
  });

  it('matches vivid chroma expansion and ignores forged gains on protected fits', () => {
    const fit = fitAdaptiveFinish(gradient(), 48, 40, 'vivid');
    expect(fit.chromaGain).toBe(1.12);
    expectCloseToReference(seededPixels(1_200, 0xdecafbad), 40, 30, 'vivid');
    for (const colourReason of ['weak-channel', 'protected-surface'] as const) {
      const protectedFit = { ...fit, colourReason, colourGains: [1, 1, 1] as const, chromaGain: 1.12 };
      const source = seededPixels(1_200, colourReason === 'weak-channel' ? 31 : 32);
      const expected = applyAdaptiveFinish(source, 40, 30, protectedFit);
      const actual = applyAdaptiveFinishFast(source, 40, 30, prepareAdaptiveFinishFast(protectedFit));
      const withoutExpansion = applyAdaptiveFinish(source, 40, 30, { ...protectedFit, chromaGain: 1 });
      expect(expected).toEqual(withoutExpansion);
      let maximumDelta = 0;
      for (let at = 0; at < source.length; at++) if (at % 4 !== 3) maximumDelta = Math.max(maximumDelta, Math.abs(actual[at] - expected[at]));
      expect(maximumDelta).toBeLessThanOrEqual(1);
    }
  });

  it('uses the same error for mismatched dimensions and reuses a kernel across strips', () => {
    const fit = fitAdaptiveFinish(gradient(), 48, 40, 'colour-tone');
    const kernel = prepareAdaptiveFinishFast(fit), source = seededPixels(1_024);
    expect(prepareAdaptiveFinishFast({ ...fit })).toBe(kernel);
    expect(() => applyAdaptiveFinishFast(source, 31, 32, kernel)).toThrow('Adaptive finish dimensions do not match');
    const full = applyAdaptiveFinishFast(source, 32, 32, kernel);
    const top = applyAdaptiveFinishFast(source.slice(0, 16 * 32 * 4), 32, 16, kernel);
    const bottom = applyAdaptiveFinishFast(source.slice(16 * 32 * 4), 32, 16, kernel);
    expect(full).toEqual(new Uint8ClampedArray([...top, ...bottom]));
  });
});
