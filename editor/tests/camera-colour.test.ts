import { describe, expect, it } from 'vitest';
import { makeRecipe, analyse, parseRecipe, renderPixels } from '../src/core/engine';
import { pickCameraNeutral } from '../src/core/camera-capture';
import type { Recipe } from '../src/core/types';

const affine = [-2, 0, 0, .4, 0, 2, 0, -.4, 0, 0, 1, .1];

function cameraRecipe(matrix?: number[]): Recipe {
  const recipe = makeRecipe(analyse(new Uint8ClampedArray([100, 90, 80, 255]), 1, 1));
  recipe.auto = { gains: [1, 1, 1], redMix: 0, haze: 0, highlights: 0, mode: 'gentle', explanation: '' };
  recipe.strength = 1;
  if (matrix) recipe.cameraColour = { source: 'fivea', matrix };
  return recipe;
}

describe('camera sampled colour recipe', () => {
  it('keeps legacy recipes without a camera matrix valid and unchanged', () => {
    const legacy = cameraRecipe();
    const restored = parseRecipe(JSON.parse(JSON.stringify(legacy)));
    expect(restored.cameraColour).toBeUndefined();
    const input = new Uint8ClampedArray([16, 98, 244, 41]);
    legacy.strength = 0;
    expect(renderPixels(input, legacy)).toEqual(input);
  });

  it('serializes and validates bounded affine coefficients for Balanced and baseline recipes', () => {
    const recipe = cameraRecipe(affine);
    const saved = JSON.parse(JSON.stringify(recipe));
    expect(parseRecipe(saved).cameraColour).toEqual({ source: 'fivea', matrix: affine });
    saved.engine = 'baseline';
    expect(parseRecipe(saved).cameraColour?.source).toBe('fivea');
    expect(() => parseRecipe({ ...recipe, cameraColour: { source: 'other', matrix: affine } })).toThrow('Invalid camera AI colour settings.');
    expect(() => parseRecipe({ ...recipe, cameraColour: { source: 'fivea', matrix: affine.slice(1) } })).toThrow('Invalid camera AI colour settings.');
    expect(() => parseRecipe({ ...recipe, cameraColour: { source: 'fivea', matrix: [...affine.slice(0, 11), .401] } })).toThrow('Invalid camera AI colour settings.');
    expect(() => parseRecipe({ ...recipe, cameraColour: { source: 'fivea', matrix: [-2.01, ...affine.slice(1)] } })).toThrow('Invalid camera AI colour settings.');
    expect(() => parseRecipe({ ...recipe, cameraColour: { source: 'fivea', matrix: [...affine.slice(0, 3), -.401, ...affine.slice(4)] } })).toThrow('Invalid camera AI colour settings.');
    expect(() => parseRecipe({ ...recipe, cameraColour: { source: 'fivea', matrix: [NaN, ...affine.slice(1)] } })).toThrow('Invalid camera AI colour settings.');
    expect(() => parseRecipe({ ...recipe, engine: 'fivea' })).toThrow('Invalid camera AI colour settings.');
  });

  it('replays negative bounded coefficients, clips channels and preserves source alpha', () => {
    const input = new Uint8ClampedArray([100, 80, 200, 73]);
    const output = renderPixels(input, cameraRecipe(affine));
    expect(output[0]).toBe(0);
    expect(output[1]).toBeCloseTo(58, -1);
    expect(output[2]).toBeCloseTo(225, -1);
    expect(output[3]).toBe(73);
  });

  it('keeps strength zero identical to the original pixels even with a saved matrix', () => {
    const input = new Uint8ClampedArray([16, 98, 244, 41, 220, 36, 77, 189]);
    const recipe = cameraRecipe(affine);
    recipe.strength = 0;
    expect(renderPixels(input, recipe)).toEqual(input);
  });

  it('keeps the saved camera matrix and stable neutral gains through repeated white balance picks', () => {
    const pixels = new Uint8ClampedArray([
      90, 110, 130, 255,
      100, 120, 140, 255,
      110, 130, 150, 255,
    ]);
    const recipe = cameraRecipe([1.1, .1, 0, .03, 0, .9, .05, .02, .02, 0, 1.05, -.01]);
    const originalMatrix = [...recipe.cameraColour!.matrix];
    const first = pickCameraNeutral(pixels, recipe);
    expect(first).not.toBeNull();
    expect(first?.cameraColour?.matrix).toEqual(originalMatrix);
    expect(recipe.manual.neutral).toEqual([1, 1, 1]);
    const second = pickCameraNeutral(pixels, first!);
    expect(second?.cameraColour?.matrix).toEqual(originalMatrix);
    expect(second?.manual.neutral).toEqual(first?.manual.neutral);
  });
});
