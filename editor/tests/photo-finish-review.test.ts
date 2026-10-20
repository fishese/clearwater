import { describe, expect, it } from 'vitest';
import { applyAdaptiveFinish } from '../src/core/adaptive-finish';
import { applyAdaptiveFinishFast, prepareAdaptiveFinishFast } from '../src/core/adaptive-finish-fast';

describe('photo finish review edge cases', () => {
  it('does not form an early white plateau on V2 Natural or Vivid tone boosts', () => {
    const ramp = new Uint8ClampedArray(256 * 4);
    for (let value = 0; value < 256; value++) ramp.set([value, value, value, 255], value * 4);

    const fits = [
      { variant: 'tone' as const, algorithmVersion: 2 as const, active: true, reason: 'fit' as const, sampleCount: 64, colourReason: 'fit' as const, colourGains: [1, 1, 1] as const, toneScale: 1.174, toneOffset: -.06 },
      { variant: 'vivid' as const, algorithmVersion: 2 as const, active: true, reason: 'fit' as const, sampleCount: 64, colourReason: 'fit' as const, colourGains: [1, 1, 1] as const, chromaGain: 1, toneScale: 1.24, toneOffset: -.1, warmSeparation: 0 },
    ];

    for (const fit of fits) {
      const reference = applyAdaptiveFinish(ramp, 256, 1, fit);
      const fast = applyAdaptiveFinishFast(ramp, 256, 1, prepareAdaptiveFinishFast(fit));
      for (let value = 1; value < 256; value++) {
        expect(reference[value * 4]).toBeGreaterThanOrEqual(reference[(value - 1) * 4]);
        expect(fast[value * 4]).toBeGreaterThanOrEqual(fast[(value - 1) * 4]);
      }
      const firstWhiteReference = Array.from({ length: 256 }, (_, index) => reference[index * 4]).findIndex(value => value === 255);
      const firstWhiteFast = Array.from({ length: 256 }, (_, index) => fast[index * 4]).findIndex(value => value === 255);
      expect(firstWhiteReference).toBeGreaterThanOrEqual(254);
      expect(firstWhiteFast).toBeGreaterThanOrEqual(254);
    }
  });
});
