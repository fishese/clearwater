import { describe, expect, it } from 'vitest';
import { analyse, makeRecipe, parseRecipe } from '../src/core/engine';
import type { AdaptivePhotoFinish, Recipe } from '../src/core/types';
import {
  applyPhotoFinish,
  fitPhotoFinish,
  hasPhotoFinishEffect,
  invalidatePhotoFinish,
  isValidPhotoFinishSettings,
  preparePhotoFinish,
  recipeFinishContext,
} from '../src/core/photo-finish';
import { applyAdaptiveFinishFast } from '../src/core/adaptive-finish-fast';
import { fitAdaptiveFinish } from '../src/core/adaptive-finish';

function gradient(width = 24, height = 24) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4, value = 48 + (x * 5 + y * 3) % 150;
    pixels.set([Math.min(242, value + 16), value, Math.max(12, value - 8), 255], at);
  }
  return pixels;
}

function settings(look: AdaptivePhotoFinish['look'] = 'natural', amount = 100): AdaptivePhotoFinish {
  const reference = gradient();
  return { look, amount, fit: fitPhotoFinish(reference, 24, 24, look) };
}

function recipe(): Recipe {
  const input = gradient();
  return { ...makeRecipe(analyse(input, 24, 24)), adaptiveFinish: settings() };
}

describe('optional saved photo finish', () => {
  it('keeps old recipes and absent/off/zero-amount finishes identity', () => {
    const input = gradient(3, 2), old = makeRecipe(analyse(input, 3, 2));
    expect(parseRecipe(JSON.parse(JSON.stringify(old)))).toEqual(old);
    expect(parseRecipe(JSON.parse(JSON.stringify(old))).adaptiveFinish).toBeUndefined();
    expect(applyPhotoFinish(input, 3, 2)).toBe(input);
    expect(applyPhotoFinish(input, 3, 2, { ...settings(), amount: 0 })).toBe(input);
  });

  it('validates and round-trips both Natural and Vivid choices with their matching fits', () => {
    for (const look of ['natural', 'vivid'] as const) {
      const source = recipe(), selected = settings(look, 63);
      const restored = parseRecipe(JSON.parse(JSON.stringify({ ...source, adaptiveFinish: selected })));
      expect(restored.adaptiveFinish).toEqual(selected);
      expect(isValidPhotoFinishSettings(restored.adaptiveFinish)).toBe(true);
      expect(restored.adaptiveFinish?.fit.variant).toBe(look === 'natural' ? 'tone' : 'vivid');
      expect(restored.adaptiveFinish?.fit.algorithmVersion).toBe(2);
    }
  });

  it('accepts versionless saved fits with their original tighter bounds', () => {
    const current = settings('vivid');
    const savedV1Fit = fitAdaptiveFinish(gradient(), 24, 24, 'vivid');
    const legacy: AdaptivePhotoFinish = { ...current, fit: savedV1Fit };
    expect(isValidPhotoFinishSettings(legacy)).toBe(true);
    expect(parseRecipe(JSON.parse(JSON.stringify({ ...recipe(), adaptiveFinish: legacy }))).adaptiveFinish).toEqual(legacy);
    expect(isValidPhotoFinishSettings({ ...legacy, fit: { ...savedV1Fit, colourGains: [1.3, 1, 1] } })).toBe(false);
  });

  it('mixes amount in the fast output pass and reuses a prepared kernel', () => {
    const input = new Uint8ClampedArray([55, 118, 174, 127, 125, 155, 188, 255]);
    const fullSettings = settings('vivid', 100), halfSettings = { ...fullSettings, amount: 50 };
    const kernel = preparePhotoFinish(fullSettings);
    const full = applyPhotoFinish(input, 2, 1, fullSettings, kernel);
    const expectedFull = applyAdaptiveFinishFast(input, 2, 1, kernel);
    expect(full).toEqual(expectedFull);
    const half = applyPhotoFinish(input, 2, 1, halfSettings, kernel);
    for (const at of [0, 4]) for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs(half[at + channel] - (input[at + channel] + full[at + channel]) / 2)).toBeLessThanOrEqual(1);
    }
    expect(half[3]).toBe(127);
    expect(half[7]).toBe(255);
  });

  it('reports active V2 effects and supports explicit in-place application', () => {
    const fullSettings = settings('vivid', 100), input = new Uint8ClampedArray([82, 145, 112, 255, 20, 92, 190, 255]);
    expect(hasPhotoFinishEffect(fullSettings)).toBe(true);
    expect(hasPhotoFinishEffect({ ...fullSettings, amount: 0 })).toBe(false);
    const copied = applyPhotoFinish(input, 2, 1, fullSettings);
    const owned = input.slice();
    expect(applyPhotoFinish(owned, 2, 1, fullSettings, undefined, { inPlace: true })).toBe(owned);
    expect(owned).toEqual(copied);
    expect(input).not.toEqual(copied);
  });

  it('rejects invalid look, amount, fit range, and mismatched fit variants', () => {
    const valid = settings();
    const invalid = [
      null,
      { ...valid, look: 'auto' },
      { ...valid, look: ['vivid'] },
      { ...valid, amount: Number.NaN },
      { ...valid, amount: -1 },
      { ...valid, amount: 100.01 },
      { ...valid, fit: { ...valid.fit, toneScale: Infinity } },
      { ...valid, fit: { ...valid.fit, colourGains: [1, 2.3, 1] } },
      { ...valid, fit: { ...valid.fit, sampleCount: 65_537 } },
      { ...valid, fit: { ...valid.fit, variant: 'vivid' } },
      { ...valid, fit: { ...valid.fit, reason: ['fit'] } },
      { ...valid, fit: { ...valid.fit, colourReason: ['fit'] } },
      { ...valid, fit: { ...valid.fit, colourGains: [2.21, 1, 1] } },
    ];
    for (const candidate of invalid) {
      expect(isValidPhotoFinishSettings(candidate)).toBe(false);
      expect(() => parseRecipe({ ...recipe(), adaptiveFinish: candidate })).toThrow('Invalid adaptive photo finish settings');
    }
  });

  it('ignores a prepared kernel that belongs to a different saved fit', () => {
    const input = new Uint8ClampedArray([65, 125, 185, 255]);
    const natural = settings('natural', 100), vivid = settings('vivid', 100);
    const wrongKernel = preparePhotoFinish(natural);
    expect(applyPhotoFinish(input, 1, 1, vivid, wrongKernel)).toEqual(applyPhotoFinish(input, 1, 1, vivid));
  });

  it('preserves the frozen fit for ordinary manual tone/detail edits and look or amount changes', () => {
    const original = recipe();
    const edited: Recipe = {
      ...original,
      adaptiveFinish: { ...original.adaptiveFinish!, look: 'vivid', amount: 45 },
      manual: { ...original.manual, exposure: .5, highlights: 20, shadows: -15, contrast: 10, haze: 5, vibrance: 25 },
      enhancement: { contrast: 40, clarity: 20, sharpness: 10, black: .05, white: .95 },
    };
    expect(recipeFinishContext(edited)).toBe(recipeFinishContext(original));
    expect(invalidatePhotoFinish(original, edited).adaptiveFinish).toEqual(edited.adaptiveFinish);
  });

  it('clears a stored fit when corrected-reference context changes', () => {
    const original = recipe();
    const changes: Recipe[] = [
      { ...original, engine: 'baseline' },
      { ...original, strength: .4 },
      { ...original, auto: { ...original.auto, haze: original.auto.haze + .01 } },
      { ...original, hints: { ...original.hints, water: 'green' } },
      { ...original, balancedAfterAI: { strength: .3 } },
      { ...original, customModel: { sha256: 'a'.repeat(64), name: 'custom', inputRange: 'unit', outputRange: 'unit' } },
      { ...original, cameraColour: { source: 'fivea', matrix: Array(12).fill(0) } },
      { ...original, manual: { ...original.manual, neutral: [1.1, 1, 1] } },
      { ...original, manual: { ...original.manual, warmth: 5 } },
      { ...original, manual: { ...original.manual, tint: 5 } },
      { ...original, manual: { ...original.manual, red: 5 } },
    ];
    for (const changed of changes) {
      expect(recipeFinishContext(changed)).not.toBe(recipeFinishContext(original));
      expect(invalidatePhotoFinish(original, changed).adaptiveFinish).toBeUndefined();
    }
  });
});
