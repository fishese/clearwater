import { analyse, makePhotoRecipe, makeRecipe, renderPixels, suggest } from '../../src/core/engine';
import { fitAdaptiveFinish, applyAdaptiveFinish, type AdaptiveFinishFit, type AdaptiveFinishVariant } from '../../src/core/adaptive-finish';
import { enhancePixels, suggestEnhancement } from '../../src/core/enhancement';
import { DEFAULT_MANUAL, type Hints, type Recipe } from '../../src/core/types';
import { prepareGuidedField, transferField, type GuidedField } from '../../src/core/neural-field';
import { decodePhoto } from '../../src/photo-decode';
import { BUNDLED_MODEL_IDS, type BundledModelId } from '../../src/core/bundled-models';
import { inferField } from '../../src/models';

type Candidate = AdaptiveFinishVariant;
type EngineId = 'balanced' | BundledModelId;
type SampleSpec = { name?: string; category?: string; hints?: Partial<Hints>; preserveRedCorrection?: boolean; crop?: { x?: number; y?: number; size?: number } };
type HarnessOptions = { samples: SampleSpec[]; engines: EngineId[]; synthetic: boolean };
type RuntimeResult = { sample: string; category: string; originalWidth: number; originalHeight: number; previewWidth: number; previewHeight: number; crop: { x: number; y: number; width: number; height: number }; records: unknown[]; errors: string[] };

const CANDIDATES: Candidate[] = ['tone', 'colour-tone', 'soft-water', 'vivid'];
const COLUMNS = ['Corrected', 'Auto enhance', 'Tone replaces auto', 'Colour + tone replaces auto', 'Soft water replaces auto', 'Vivid replaces auto'];
const TILE_W = 320, WHOLE_TILE_H = 232, WHOLE_IMAGE_H = 190;
let cropTileWidth = 524, cropTileHeight = 556;
const DEFAULT_HINTS: Hints = { scene: 'auto', water: 'auto', filter: 'auto', depth: null };
const now = () => performance.now();

declare global { interface Window { runAdaptiveSample: (spec: SampleSpec, index: number, synthetic: boolean, engines: EngineId[]) => Promise<RuntimeResult> } }

function readPixels(canvas: OffscreenCanvas | HTMLCanvasElement, width: number, height: number) {
  const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' } as CanvasRenderingContext2DSettings)! as CanvasRenderingContext2D;
  return context.getImageData(0, 0, width, height).data;
}

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width; element.height = height;
  return element;
}

function labelCell(target: HTMLCanvasElement, row: number, col: number, data: Uint8ClampedArray, width: number, height: number, title: string, tileWidth: number, tileHeight: number, imageHeight: number, square = false) {
  const context = target.getContext('2d')!;
  const x = col * tileWidth, y = row * tileHeight;
  context.fillStyle = '#142329'; context.fillRect(x, y, tileWidth, tileHeight);
  context.fillStyle = '#e6f2f4'; context.font = '13px system-ui, sans-serif'; context.fillText(title, x + 8, y + 19, tileWidth - 16);
  const image = canvas(width, height);
  image.getContext('2d')!.putImageData(new ImageData(data, width, height), 0, 0);
  const boxTop = y + 27, boxHeight = imageHeight, boxWidth = tileWidth - 12;
  const scale = Math.min(boxWidth / width, boxHeight / height, 1);
  const drawWidth = square ? Math.min(boxWidth, width) : width * scale;
  const drawHeight = square ? Math.min(boxHeight, height) : height * scale;
  const drawX = x + (tileWidth - drawWidth) / 2, drawY = boxTop + (boxHeight - drawHeight) / 2;
  context.drawImage(image, 0, 0, width, height, drawX, drawY, drawWidth, drawHeight);
}

function metrics(data: Uint8ClampedArray) {
  const lumaHistogram = new Uint32Array(256), channels = [0, 0, 0];
  let count = 0, clipped = 0, dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = Math.round(.2126 * r + .7152 * g + .0722 * b);
    channels[0] += r; channels[1] += g; channels[2] += b; lumaHistogram[y]++;
    count++; if (Math.max(r, g, b) >= 250) clipped++; if (y <= 12) dark++;
  }
  const percentile = (q: number) => {
    const target = Math.ceil(count * q); let sum = 0;
    for (let i = 0; i < lumaHistogram.length; i++) { sum += lumaHistogram[i]; if (sum >= target) return i; }
    return 255;
  };
  return { meanRgb: channels.map(value => +(value / Math.max(1, count)).toFixed(2)), lumaP01: percentile(.01), lumaP50: percentile(.5), lumaP99: percentile(.99), clippedFraction: +(clipped / Math.max(1, count)).toFixed(5), nearBlackFraction: +(dark / Math.max(1, count)).toFixed(5) };
}

function deltaMetrics(reference: Uint8ClampedArray, output: Uint8ClampedArray) {
  let sum = 0, max = 0;
  for (let i = 0; i < reference.length; i++) { const d = Math.abs(reference[i] - output[i]); sum += d; if (d > max) max = d; }
  return { meanAbsoluteChannelDelta: +(sum / Math.max(1, reference.length)).toFixed(3), maxChannelDelta: max };
}

function normalizeHints(spec: SampleSpec): Hints {
  return { ...DEFAULT_HINTS, ...(spec.hints ?? {}) };
}

function makeSyntheticBitmap() {
  const output = canvas(1024, 768), context = output.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 1024, 768);
  gradient.addColorStop(0, '#13546a'); gradient.addColorStop(.42, '#348b91'); gradient.addColorStop(1, '#dbc99d');
  context.fillStyle = gradient; context.fillRect(0, 0, output.width, output.height);
  for (let i = 0; i < 16; i++) {
    context.beginPath(); context.ellipse(100 + i * 57, 100 + (i % 5) * 110, 32 + (i % 4) * 8, 18 + (i % 3) * 10, i * .3, 0, Math.PI * 2);
    context.fillStyle = `rgba(${80 + i * 8},${80 + (i % 5) * 19},${40 + (i % 4) * 18},.75)`; context.fill();
  }
  const gradientPixels = context.getImageData(0, 0, output.width, output.height);
  // Deterministic low amplitude grain gives the mechanics sample a noise-rich shadow area.
  let seed = 29; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 520; y < output.height; y++) for (let x = 0; x < output.width; x++) {
    const i = (y * output.width + x) * 4, n = Math.round((random() - .5) * 14);
    for (let c = 0; c < 3; c++) gradientPixels.data[i + c] = Math.max(0, Math.min(255, gradientPixels.data[i + c] + n));
  }
  context.putImageData(gradientPixels, 0, 0);
  return output;
}

function squareCrop(bitmap: ImageBitmap | HTMLCanvasElement, x: number, y: number, size: number) {
  const output = canvas(size, size);
  output.getContext('2d')!.drawImage(bitmap, x, y, size, size, 0, 0, size, size);
  return readPixels(output, size, size);
}

function enhancedCrop(source: ImageBitmap | HTMLCanvasElement, cropX: number, cropY: number, size: number, width: number, height: number, settings: ReturnType<typeof suggestEnhancement>, recipe: Recipe, guided: GuidedField | undefined, followUp: ReturnType<typeof suggest> | undefined) {
  const longSide = Math.max(width, height), halo = Math.min(104, Math.ceil(Math.min(96, longSide * .009) + Math.min(8, longSide * .0008) + 2));
  const left = Math.max(0, cropX - halo), top = Math.max(0, cropY - halo), right = Math.min(width, cropX + size + halo), bottom = Math.min(height, cropY + size + halo);
  const stripWidth = right - left, stripHeight = bottom - top, strip = canvas(stripWidth, stripHeight);
  strip.getContext('2d')!.drawImage(source, left, top, stripWidth, stripHeight, 0, 0, stripWidth, stripHeight);
  const input = readPixels(strip, stripWidth, stripHeight);
  const base = guided ? transferField(input, stripWidth, stripHeight, guided, top, height, left, width) : undefined;
  const corrected = renderPixels(input, recipe, base, followUp);
  // Width stays equal to the full source, so enhancementRadii preserves the real 100% filter radius.
  const finished = enhancePixels(corrected, stripWidth, stripHeight, settings, stripWidth, longSide);
  const localX = cropX - left, localY = cropY - top, result = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) result.set(finished.subarray(((localY + y) * stripWidth + localX) * 4, ((localY + y) * stripWidth + localX + size) * 4), y * size * 4);
  return result;
}

async function loadInput(spec: SampleSpec, synthetic: boolean) {
  if (synthetic) {
    const bitmap = makeSyntheticBitmap();
    return { bitmap, file: undefined as File | undefined, originalWidth: bitmap.width, originalHeight: bitmap.height, decodedWidth: bitmap.width, decodedHeight: bitmap.height };
  }
  if (!spec.name) throw new Error('A sample name is required for real-photo mode.');
  const response = await fetch(`/__sample/${encodeURIComponent(spec.name)}`);
  if (!response.ok) throw new Error(`Local sample endpoint returned HTTP ${response.status}.`);
  const blob = await response.blob(), file = new File([blob], spec.name, { type: blob.type || (/\.png$/i.test(spec.name) ? 'image/png' : 'image/jpeg') });
  const decoded = await decodePhoto(file, { mode: 'full', device: { mobile: false, memory: 32 }, preview: false, onInfo: () => {} });
  return { bitmap: decoded.bitmap, file, originalWidth: decoded.info.sourceWidth, originalHeight: decoded.info.sourceHeight, decodedWidth: decoded.bitmap.width, decodedHeight: decoded.bitmap.height };
}

function recipeFor(engine: EngineId, preview: Uint8ClampedArray, width: number, height: number, hints: Hints): Recipe {
  const analysis = analyse(preview, width, height);
  if (engine === 'balanced') return makeRecipe(analysis, hints);
  if (engine === 'wwe') return makePhotoRecipe(analysis, hints);
  return { ...makeRecipe(analysis, hints), engine, auto: suggest(analysis, hints, engine), strength: .8 };
}

async function fieldFor(engine: BundledModelId, bitmap: ImageBitmap | HTMLCanvasElement) {
  const input = new OffscreenCanvas(256, 256), context = input.getContext('2d')!;
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, 256, 256);
  const guide = new Uint8ClampedArray(256 * 256 * 4), started = now();
  const rawField = await inferField(engine, input, guide);
  const inferenceMs = now() - started, prepStarted = now(), guided = prepareGuidedField(guide, rawField);
  return { input, guide, guided, inferenceMs, prepareMs: now() - prepStarted };
}

function sourceCropPosition(spec: SampleSpec, width: number, height: number) {
  const size = Math.max(1, Math.min(Math.floor(spec.crop?.size ?? 512), 1024, width, height));
  const centerX = Math.max(0, Math.min(1, spec.crop?.x ?? .5)), centerY = Math.max(0, Math.min(1, spec.crop?.y ?? .5));
  const x = Math.max(0, Math.min(width - size, Math.round(centerX * width - size / 2)));
  const y = Math.max(0, Math.min(height - size, Math.round(centerY * height - size / 2)));
  return { x, y, width: size, height: size };
}

window.runAdaptiveSample = async (spec, index, synthetic, engines) => {
  const status = document.querySelector<HTMLElement>('#status')!;
  const sampleId = `sample-${String(index + 1).padStart(2, '0')}`, category = spec.category ?? (synthetic ? 'synthetic mechanics' : 'uncategorized');
  status.textContent = `Processing ${sampleId} (${category})…`;
  const loaded = await loadInput(spec, synthetic), bitmap = loaded.bitmap;
  const originalWidth = loaded.originalWidth, originalHeight = loaded.originalHeight;
  const previewScale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height), Math.sqrt(2_560_000 / (bitmap.width * bitmap.height)));
  const previewWidth = Math.max(1, Math.round(bitmap.width * previewScale)), previewHeight = Math.max(1, Math.round(bitmap.height * previewScale));
  const previewCanvas = canvas(previewWidth, previewHeight);
  const previewContext = previewCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' } as CanvasRenderingContext2DSettings)!;
  previewContext.imageSmoothingEnabled = true; previewContext.imageSmoothingQuality = 'high'; previewContext.drawImage(bitmap, 0, 0, previewWidth, previewHeight);
  const previewPixels = readPixels(previewCanvas, previewWidth, previewHeight);
  const crop = sourceCropPosition(spec, bitmap.width, bitmap.height), cropSource = squareCrop(bitmap, crop.x, crop.y, crop.width);
  const hints = normalizeHints(spec), records: Record<string, unknown>[] = [], errors: string[] = [];
  const wholeSheet = document.querySelector<HTMLCanvasElement>('#whole')!, cropSheet = document.querySelector<HTMLCanvasElement>('#crop')!;
  wholeSheet.width = TILE_W * COLUMNS.length; wholeSheet.height = 8 + engines.length * WHOLE_TILE_H;
  cropTileWidth = crop.width + 12; cropTileHeight = crop.height + 32;
  cropSheet.width = cropTileWidth * COLUMNS.length; cropSheet.height = 8 + engines.length * cropTileHeight;
  for (const target of [wholeSheet, cropSheet]) { const context = target.getContext('2d')!; context.fillStyle = '#101a20'; context.fillRect(0, 0, target.width, target.height); }
  const sampleTitle = `${sampleId} · ${category}`;
  const wholeTitle = wholeSheet.getContext('2d')!; wholeTitle.fillStyle = '#e8f0f2'; wholeTitle.font = 'bold 15px system-ui, sans-serif'; wholeTitle.fillText(`Whole image preview · ${sampleTitle}`, 8, 18);
  const cropTitle = cropSheet.getContext('2d')!; cropTitle.fillStyle = '#e8f0f2'; cropTitle.font = 'bold 15px system-ui, sans-serif'; cropTitle.fillText(`100% source crop (${crop.width}×${crop.height}) · ${sampleTitle}`, 8, 18);
  const cropBaseSource = cropSource;
  for (let row = 0; row < engines.length; row++) {
    const engine = engines[row], engineTitle = engine === 'balanced' ? 'Balanced default' : engine === 'wwe' ? 'WWE-UIE + 30% Balanced' : engine === 'fivea' ? 'Five A+' : 'Shallow-UWnet';
    try {
      let guided: GuidedField | undefined, inferenceMs: number | undefined, prepareMs: number | undefined;
      const referenceCanvas = new OffscreenCanvas(256, 256), referenceContext = referenceCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })!;
      referenceContext.imageSmoothingEnabled = true; referenceContext.imageSmoothingQuality = 'high'; referenceContext.drawImage(bitmap, 0, 0, 256, 256);
      const referenceInput = referenceContext.getImageData(0, 0, 256, 256).data;
      if (engine !== 'balanced') {
        const field = await fieldFor(engine, bitmap); guided = field.guided; inferenceMs = field.inferenceMs; prepareMs = field.prepareMs;
      }
      const recipe = recipeFor(engine, previewPixels, previewWidth, previewHeight, hints);
      const guideReference = guided ? transferField(referenceInput, 256, 256, guided) : undefined;
      let followUp: ReturnType<typeof suggest> | undefined;
      if (engine === 'wwe' && recipe.balancedAfterAI && guideReference) {
        const beforeFollowUp = renderPixels(referenceInput, { ...recipe, balancedAfterAI: undefined, manual: structuredClone(DEFAULT_MANUAL) }, guideReference);
        followUp = suggest(analyse(beforeFollowUp, 256, 256), hints, 'balanced');
      }
      const correctedReference = renderPixels(referenceInput, recipe, guideReference, followUp);
      const previewTransferStart = now();
      const previewBase = guided ? transferField(previewPixels, previewWidth, previewHeight, guided) : undefined;
      const previewTransferMs = now() - previewTransferStart, previewRenderStart = now();
      const correctedPreview = renderPixels(previewPixels, recipe, previewBase, followUp);
      const previewRendererMs = now() - previewRenderStart, warmPreviewRenderStart = now();
      renderPixels(previewPixels, recipe, previewBase, followUp);
      const warmPreviewRendererMs = now() - warmPreviewRenderStart, cropRenderStart = now();
      const correctedCropSource = guided ? transferField(cropBaseSource, crop.width, crop.height, guided, crop.y, bitmap.height, crop.x, bitmap.width) : undefined;
      const correctedCrop = renderPixels(cropBaseSource, recipe, correctedCropSource, followUp);
      const cropRendererMs = now() - cropRenderStart;
      labelCell(wholeSheet, row, 0, correctedPreview, previewWidth, previewHeight, `${engineTitle} · corrected`, TILE_W, WHOLE_TILE_H, WHOLE_IMAGE_H);
      labelCell(cropSheet, row, 0, correctedCrop, crop.width, crop.height, `${engineTitle} · corrected`, cropTileWidth, cropTileHeight, crop.height);
      const baseMetrics = metrics(correctedPreview);
      records.push({ sample: sampleId, category, engine, treatment: 'corrected baseline', inferenceCount: engine === 'balanced' ? 0 : 1, modelInferenceMs: inferenceMs, guidedFieldPreparationMs: prepareMs, previewTransferMs, previewRendererMs, warmPreviewRendererMs, cropRendererMs, preview: baseMetrics, crop: metrics(correctedCrop) });

      const autoSettings = suggestEnhancement(correctedPreview), autoStart = now();
      const autoPreview = enhancePixels(correctedPreview, previewWidth, previewHeight, autoSettings, bitmap.width, bitmap.height);
      const autoMs = now() - autoStart, autoWarmStart = now();
      enhancePixels(correctedPreview, previewWidth, previewHeight, autoSettings, bitmap.width, bitmap.height);
      const autoWarmMs = now() - autoWarmStart;
      const autoCrop = enhancedCrop(bitmap, crop.x, crop.y, crop.width, bitmap.width, bitmap.height, autoSettings, recipe, guided, followUp);
      labelCell(wholeSheet, row, 1, autoPreview, previewWidth, previewHeight, `${engineTitle} · Auto enhance`, TILE_W, WHOLE_TILE_H, WHOLE_IMAGE_H);
      labelCell(cropSheet, row, 1, autoCrop, crop.width, crop.height, `${engineTitle} · Auto enhance`, cropTileWidth, cropTileHeight, crop.height);
      records.push({ sample: sampleId, category, engine, treatment: 'current Auto enhance baseline', settings: autoSettings, inferenceCount: 0, previewApplyMs: autoMs, previewWarmApplyMs: autoWarmMs, preview: metrics(autoPreview), crop: metrics(autoCrop), previewDeltaFromCorrected: deltaMetrics(correctedPreview, autoPreview) });

      for (let candidateIndex = 0; candidateIndex < CANDIDATES.length; candidateIndex++) {
        const variant = CANDIDATES[candidateIndex], fitStart = now();
        const fit: AdaptiveFinishFit = fitAdaptiveFinish(correctedReference, 256, 256, variant, { scene: hints.scene, filter: hints.filter, preserveRedCorrection: spec.preserveRedCorrection === true || hints.filter === 'yes' });
        const fitMs = now() - fitStart, applyStart = now();
        const applyFittedCandidate = (input: Uint8ClampedArray, width: number, height: number) => applyAdaptiveFinish(input, width, height, fit);
        const candidatePreview = applyFittedCandidate(correctedPreview, previewWidth, previewHeight);
        const previewApplyMs = now() - applyStart, warmStart = now();
        applyFittedCandidate(correctedPreview, previewWidth, previewHeight);
        const previewWarmApplyMs = now() - warmStart, cropApplyStart = now();
        const candidateCrop = applyFittedCandidate(correctedCrop, crop.width, crop.height);
        const cropApplyMs = now() - cropApplyStart;
        labelCell(wholeSheet, row, candidateIndex + 2, candidatePreview, previewWidth, previewHeight, `${engineTitle} · ${COLUMNS[candidateIndex + 2]}`, TILE_W, WHOLE_TILE_H, WHOLE_IMAGE_H);
        labelCell(cropSheet, row, candidateIndex + 2, candidateCrop, crop.width, crop.height, `${engineTitle} · ${COLUMNS[candidateIndex + 2]}`, cropTileWidth, cropTileHeight, crop.height);
        records.push({ sample: sampleId, category, engine, treatment: variant, replaces: 'Auto enhance tone; no clarity or sharpness stacked', experimental: variant === 'vivid', qualityClaim: variant === 'vivid' ? 'none; visual comparison required' : undefined, inferenceCount: 0, fitObjectReusedForPreviewAndCrop: true, fit: { active: fit.active, reason: fit.reason, colourReason: fit.colourReason, sampleCount: fit.sampleCount, colourGains: fit.colourGains, chromaGain: fit.chromaGain ?? 1, toneScale: fit.toneScale, toneOffset: fit.toneOffset }, fitMs, previewApplyMs, previewWarmApplyMs, cropApplyMs, warmApplyPercentOfWarmRenderer: +(previewWarmApplyMs / Math.max(.001, warmPreviewRendererMs) * 100).toFixed(2), preview: metrics(candidatePreview), crop: metrics(candidateCrop), previewDeltaFromCorrected: deltaMetrics(correctedPreview, candidatePreview), previewDeltaFromAutoEnhance: deltaMetrics(autoPreview, candidatePreview) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); errors.push(`${engine}: ${message}`);
      const context = wholeSheet.getContext('2d')!; context.fillStyle = '#ffb4a6'; context.font = '14px system-ui, sans-serif'; context.fillText(`${engineTitle} failed: ${message.slice(0, 120)}`, 8, 8 + row * WHOLE_TILE_H + 48, wholeSheet.width - 16);
    }
  }
  for (const record of records) {
    if (CANDIDATES.includes(record.treatment as Candidate) && (record.inferenceCount !== 0 || record.fitObjectReusedForPreviewAndCrop !== true)) {
      errors.push(`${String(record.engine)}: candidate did not reuse its fit or triggered an unexpected inference.`);
    }
  }
  for (const engine of engines) {
    const baseline = records.find(record => record.engine === engine && record.treatment === 'corrected baseline');
    if (baseline && baseline.inferenceCount !== (engine === 'balanced' ? 0 : 1)) errors.push(`${engine}: expected one AI inference for the baseline and none for Balanced.`);
  }
  status.textContent = `Ready · ${sampleId} · ${engines.length} configured engines · ${errors.length} engine errors`;
  if (bitmap instanceof ImageBitmap) bitmap.close();
  return { sample: sampleId, category, originalWidth, originalHeight, decodedWidth: loaded.decodedWidth, decodedHeight: loaded.decodedHeight, previewWidth, previewHeight, crop, records, errors };
};

export type { HarnessOptions };
