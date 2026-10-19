import { applyAdaptiveFinishFast, prepareAdaptiveFinishFast, type AdaptiveFinishFastKernel } from './adaptive-finish-fast';
import { fitAdaptiveFinish, type AdaptiveFinishFit, type AdaptiveFinishOptions } from './adaptive-finish';
import type { AdaptivePhotoFinish, Recipe } from './types';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown, low: number, high: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const identityGains = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every(gain => gain === 1);
const preparedFitKeys = new WeakMap<AdaptiveFinishFastKernel, string>();

function validFit(value: unknown, expectedVariant: 'tone' | 'vivid'): value is AdaptiveFinishFit {
  if (!object(value) || !exactKeys(value, ['variant', 'active', 'reason', 'sampleCount', 'colourReason', 'colourGains', 'chromaGain', 'toneScale', 'toneOffset'])) return false;
  if (value.variant !== expectedVariant || typeof value.active !== 'boolean' ||
    typeof value.reason !== 'string' || !['fit', 'invalid-dimensions', 'insufficient-evidence', 'dark', 'flat'].includes(value.reason) ||
    !Number.isInteger(value.sampleCount) || !finite(value.sampleCount, 0, 65536) ||
    typeof value.colourReason !== 'string' || !['fit', 'protected-surface', 'weak-channel'].includes(value.colourReason) ||
    !Array.isArray(value.colourGains) || value.colourGains.length !== 3 || !value.colourGains.every(gain => finite(gain, .82, 1.2)) ||
    !finite(value.toneScale, .88, 1.12) || !finite(value.toneOffset, -.045, .045) ||
    (value.chromaGain !== undefined && !finite(value.chromaGain, 1, 1.15))) return false;

  if (value.active) {
    if (value.reason !== 'fit' || value.sampleCount < 48) return false;
    if (value.colourReason !== 'fit' && !identityGains(value.colourGains)) return false;
    if (value.variant === 'tone' && (!identityGains(value.colourGains) || value.chromaGain !== undefined)) return false;
    if (value.variant === 'vivid' && value.colourReason !== 'fit' && value.chromaGain !== undefined && value.chromaGain !== 1) return false;
    return true;
  }

  return value.reason !== 'fit' && identityGains(value.colourGains) && value.toneScale === 1 && value.toneOffset === 0 &&
    (value.chromaGain === undefined || value.chromaGain === 1);
}

/** Strict runtime check used for imported version-1 recipes and worker messages. */
export function isValidPhotoFinishSettings(value: unknown): value is AdaptivePhotoFinish {
  if (!object(value) || !exactKeys(value, ['look', 'amount', 'fit']) ||
    typeof value.look !== 'string' || !['natural', 'vivid'].includes(value.look) || !finite(value.amount, 0, 100)) return false;
  return validFit(value.fit, value.look === 'natural' ? 'tone' : 'vivid');
}

/** Fit the shared candidate math for the product-facing Natural/Vivid choice. */
export function fitPhotoFinish(
  reference: Uint8ClampedArray,
  width: number,
  height: number,
  look: AdaptivePhotoFinish['look'],
  options: AdaptiveFinishOptions = {},
): AdaptiveFinishFit {
  if (look !== 'natural' && look !== 'vivid') throw new Error('Unknown photo finish look.');
  return fitAdaptiveFinish(reference, width, height, look === 'natural' ? 'tone' : 'vivid', options);
}

/** Prepare once for a saved fit, then reuse the kernel for preview and export strips. */
export function preparePhotoFinish(settings: AdaptivePhotoFinish): AdaptiveFinishFastKernel {
  if (!isValidPhotoFinishSettings(settings)) throw new Error('Invalid adaptive photo finish settings.');
  const kernel = prepareAdaptiveFinishFast(settings.fit);
  preparedFitKeys.set(kernel, JSON.stringify(settings.fit));
  return kernel;
}

/** Apply the selected photo look and amount in one output pass. */
export function applyPhotoFinish(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  settings?: AdaptivePhotoFinish,
  preparedKernel?: AdaptiveFinishFastKernel,
): Uint8ClampedArray {
  if (!settings || !isValidPhotoFinishSettings(settings) || settings.amount === 0) return input;
  const fitKey = JSON.stringify(settings.fit);
  const kernel = preparedKernel && preparedFitKeys.get(preparedKernel) === fitKey ? preparedKernel : preparePhotoFinish(settings);
  return applyAdaptiveFinishFast(input, width, height, kernel, { amount: settings.amount / 100 });
}

/** Stable comparison key for changes that make a saved fit stale.
 * Source identity is owned by the caller because it is not stored on Recipe.
 */
export function recipeFinishContext(recipe: Recipe): string {
  return JSON.stringify({
    engine: recipe.engine,
    strength: recipe.strength,
    auto: recipe.auto,
    hints: recipe.hints,
    balancedAfterAI: recipe.balancedAfterAI ?? null,
    customModel: recipe.customModel ?? null,
    cameraColour: recipe.cameraColour ?? null,
    whiteBalance: {
      neutral: recipe.manual.neutral,
      warmth: recipe.manual.warmth,
      tint: recipe.manual.tint,
      red: recipe.manual.red,
    },
  });
}

/** Drop a frozen fit when its corrected-reference inputs changed. */
export function invalidatePhotoFinish(previous: Recipe, next: Recipe): Recipe {
  if (!previous.adaptiveFinish || !next.adaptiveFinish || recipeFinishContext(previous) === recipeFinishContext(next)) return next;
  const { adaptiveFinish: _discarded, ...withoutFinish } = next;
  return withoutFinish;
}
