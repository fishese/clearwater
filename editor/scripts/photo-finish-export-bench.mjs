import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

const editorRoot = resolve(import.meta.dirname, '..');
const projectRoot = resolve(editorRoot, '..');
const sampleDirectory = resolve(projectRoot, 'Sample photos');
const manifestPath = process.env.CHECK_MANIFEST?resolve(editorRoot,process.env.CHECK_MANIFEST):resolve(projectRoot, 'analysis/adaptive-finish/manifest.json');
const runName=process.env.CHECK_RUN_NAME??'export-benchmark';
if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runName))throw new Error('Invalid CHECK_RUN_NAME');
const outputDirectory = resolve(projectRoot, 'analysis/adaptive-finish',runName);
const baseUrl = process.env.CHECK_URL ?? 'http://127.0.0.1:4176/';
const sampleIndex = Number(process.env.CHECK_SAMPLE_INDEX ?? 5);
const repeatCount = Number(process.env.CHECK_EXPORT_REPEATS ?? 1);

if (!Number.isInteger(sampleIndex) || sampleIndex < 0) throw new Error('CHECK_SAMPLE_INDEX must be a non-negative manifest index.');
if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 3) throw new Error('CHECK_EXPORT_REPEATS must be an integer from 1 to 3.');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const samples = Array.isArray(manifest) ? manifest : manifest.samples;
if (!Array.isArray(samples) || !samples[sampleIndex]) throw new Error(`No manifest sample exists at index ${sampleIndex}.`);
const sample = samples[sampleIndex];
if (typeof sample.name !== 'string' || basename(sample.name) !== sample.name) throw new Error('The manifest sample must contain a basename only.');
const resolvedSamplePath = resolve(sampleDirectory, sample.name);
const sampleRelativePath = relative(sampleDirectory, resolvedSamplePath);
if (!sampleRelativePath || sampleRelativePath.startsWith(`..${sep}`) || sampleRelativePath === '..' || sampleRelativePath.includes(sep)) {
  throw new Error('The manifest sample must resolve directly inside Sample photos.');
}
const realSampleDirectory = await realpath(sampleDirectory);
const samplePath = await realpath(resolvedSamplePath);
const realSampleRelativePath = relative(realSampleDirectory, samplePath);
if (!realSampleRelativePath || realSampleRelativePath.startsWith(`..${sep}`) || realSampleRelativePath === '..' || realSampleRelativePath.includes(sep)) {
  throw new Error('The manifest sample must resolve to a file directly inside Sample photos.');
}
const sampleStat = await stat(samplePath);
if (!sampleStat.isFile()) throw new Error('The manifest sample is not a regular file.');

// Never replace evidence from an earlier run, even when a CHECK_RUN_NAME is reused.
await mkdir(outputDirectory);
const errors = [];
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  url: baseUrl,
  browserChannel: process.env.CHECK_BROWSER ?? 'msedge',
  mode: 'desktop source-resolution JPEG export timing',
  evidenceLimit: 'One authorized local sample and one desktop browser run. Timings are device- and browser-specific; no mobile/native or peak-memory claim is made.',
  sample: {
    manifestIndex: sampleIndex,
    category: typeof sample.category === 'string' ? sample.category : 'manifest sample',
    sourceBytes: sampleStat.size,
    width: null,
    height: null
  },
  recipe: {
    engine: 'wwe',
    balancedAfterAI: { strength: 0.3 },
    finishAmount: 100,
    enhancement: 'unchanged default; no Auto enhance action',
    export: 'JPEG high quality (0.95)',
    workerFieldCache: 'The WWE preview is awaited before finish fitting. The app does not expose worker inference counters, so request counts are not used as evidence of inference reuse.'
  },
  finishFits: [],
  exports: [],
  memory: {
    javascriptHeap: null,
    scope: 'performance.memory, when available, reports JavaScript heap diagnostics only. It excludes canvas/GPU storage, native decoder memory, and peak memory.'
  },
  workingBufferEstimate: null,
  errors
};

function assertImageReadyDimensions(dimensions, expected, label) {
  assert.equal(dimensions.width, expected.width, `${label} width must match the original source`);
  assert.equal(dimensions.height, expected.height, `${label} height must match the original source`);
}

async function writeReport() {
  await writeFile(resolve(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const browser = await chromium.launch({ channel: report.browserChannel, headless: true });
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window.__photoFinishExportBench = { messages: [], heap: [] };
    const originalPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...transfer) {
      if (message && typeof message === 'object' && ['finish', 'finish-ready'].includes(message.type)) {
        state.messages.push({ type: message.type, request: message.request, look: message.look, at: performance.now() });
      }
      return Reflect.apply(originalPostMessage, this, [message, ...transfer]);
    };
    const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage');
    if (descriptor?.get && descriptor?.set) Object.defineProperty(Worker.prototype, 'onmessage', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() { return descriptor.get.call(this); },
      set(handler) {
        if (typeof handler !== 'function') return descriptor.set.call(this, handler);
        descriptor.set.call(this, event => {
          if (event.data?.type === 'finish-ready') {
            state.messages.push({ type: event.data.type, request: event.data.request, look: event.data.look, at: performance.now(), fit: event.data.fit });
          }
          return handler.call(this, event);
        });
      }
    });
    state.heapSnapshot = label => {
      const memory = performance.memory;
      if (memory) state.heap.push({ label, at: performance.now(), usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit });
    };
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /photo(?: & video)? editor/i }).waitFor();
  const ready = () => page.waitForFunction(() => document.querySelector('.top-actions .primary')?.disabled === false, null, { timeout: 120_000 });

  await page.evaluate(() => {
    const input = document.createElement('input'); input.type = 'file'; input.id = 'photo-finish-bench-file'; input.style.display = 'none'; document.body.append(input);
  });
  await page.locator('#photo-finish-bench-file').setInputFiles(samplePath);
  const sourceDimensions = await page.evaluate(async () => {
    const file = document.querySelector('#photo-finish-bench-file').files[0];
    const bitmap = await createImageBitmap(file);
    const value = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return value;
  });
  report.sample.width = sourceDimensions.width;
  report.sample.height = sourceDimensions.height;
  await page.getByLabel('Choose photos', { exact: true }).setInputFiles(samplePath);
  await ready();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas[aria-label="Edited photo"]');
    return canvas && canvas.width > 0 && canvas.height > 0 && canvas.dataset.request;
  });

  const importedRecipe = await page.evaluate(() => ({
    engine: document.querySelector('[aria-label="Correction engine"]')?.value,
    balancedAfterAI: document.querySelector('[aria-label="Balanced after AI"]')?.checked,
    balancedAfterAIStrength: document.querySelector('[aria-label="Balanced after AI strength"]')?.value
  }));
  assert.equal(importedRecipe.engine, 'wwe', 'The imported photo must use the WWE recipe.');
  assert.equal(importedRecipe.balancedAfterAI, true, 'The imported photo must use Balanced after AI.');
  assert.equal(importedRecipe.balancedAfterAIStrength, '30', 'Balanced after AI must use strength 0.3.');

  const format = page.getByLabel('File format', { exact: true });
  await format.selectOption('jpg');
  assert.equal(await format.inputValue(), 'jpg', 'Baseline and finish exports must use high-quality JPEG.');
  const offButton = page.getByRole('button', { name: 'Off', exact: true });
  assert.equal(await offButton.getAttribute('aria-pressed'), 'true', 'A new photo must have finish Off before the baseline export.');
  const downloadButton = page.getByRole('button', { name: 'Download instead', exact: true });
  await downloadButton.waitFor({ state: 'visible' });

  const heapBefore = await page.evaluate(() => {
    window.__photoFinishExportBench.heapSnapshot('after-setup');
    return window.__photoFinishExportBench.heap.at(-1) ?? null;
  });
  async function waitForExportAvailable() {
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === 'Download instead');
      return !!button && !button.disabled;
    }, null, { timeout: 120_000 });
  }
  async function exportOne(treatment, repeat) {
    await waitForExportAvailable();
    const start = performance.now();
    const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
    await downloadButton.click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const completed = performance.now();
    assert.ok(downloadPath, `${treatment} export must produce a completed download.`);
    const bytes = await readFile(downloadPath);
    assert.ok(bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8, `${treatment} export must have a JPEG signature.`);
    await page.locator('#photo-finish-bench-file').setInputFiles(downloadPath);
    const dimensions = await page.evaluate(async () => {
      const file = document.querySelector('#photo-finish-bench-file').files[0];
      const bitmap = await createImageBitmap(file);
      const value = { width: bitmap.width, height: bitmap.height, type: file.type };
      bitmap.close();
      return value;
    });
    assertImageReadyDimensions(dimensions, sourceDimensions, `${treatment} export`);
    report.exports.push({
      treatment,
      repeat,
      runClass: repeat === 1 ? 'first-export' : 'same-recipe-repeat',
      runtimeMs: +(completed - start).toFixed(1),
      bytes: bytes.byteLength,
      detectedFormat: 'JPEG signature (FF D8), confirmed decodable',
      decodedDimensions: dimensions,
      matchesSourceDimensions: true
    });
    await page.evaluate(() => window.__photoFinishExportBench.heapSnapshot('after-export'));
    await waitForExportAvailable();
  }

  for (let repeat = 1; repeat <= repeatCount; repeat++) await exportOne('off', repeat);
  for (const look of ['natural', 'vivid']) {
    const messagesBefore = await page.evaluate(() => window.__photoFinishExportBench.messages.length);
    const analysisStart = performance.now();
    await page.getByRole('button', { name: look === 'natural' ? 'Natural' : 'Vivid', exact: true }).click();
    await page.waitForFunction(({ index }) => window.__photoFinishExportBench.messages.slice(index).some(message => message.type === 'finish-ready'), { index: messagesBefore }, { timeout: 120_000 });
    await waitForExportAvailable();
    const finishMessages = await page.evaluate(index => window.__photoFinishExportBench.messages.slice(index), messagesBefore);
    const request = finishMessages.find(message => message.type === 'finish');
    const response = finishMessages.find(message => message.type === 'finish-ready' && (!request || message.request === request.request));
    assert.ok(response?.fit, `${look} analysis must return a fit result.`);
    const fitDurationMs = request ? response.at - request.at : performance.now() - analysisStart;
    const fit = response.fit;
    assert.equal(await page.getByRole('slider', { name: 'Finish amount', exact: true }).inputValue(), '100', `${look} must use finish amount 100.`);
    const sharedKernelTypedArrayBytes = 256 * 4 + 4097 * 4 + 16385 * 4;
    const warmSeparation = fit.warmSeparation ?? 0;
    const toneOnly = fit.active && fit.colourGains.every(gain => gain === 1) && (fit.chromaGain ?? 1) === 1 && warmSeparation === 0 && (fit.toneScale !== 1 || fit.toneOffset !== 0);
    const hasCompiledProtectionTables = fit.active && fit.reason === 'fit' && !toneOnly && (fit.colourGains.some(gain => gain !== 1) || (fit.chromaGain ?? 1) !== 1 || warmSeparation > 0);
    report.finishFits.push({
      look,
      analysisMs: +fitDurationMs.toFixed(1),
      fit,
      kernelAlgorithmVersion: fit.algorithmVersion ?? 1,
      preparedKernelTypedArrayBytes: sharedKernelTypedArrayBytes + (hasCompiledProtectionTables ? (65536 * 3 + 4097 * 2) * 4 : 0),
      sharedKernelTypedArrayBytes,
      compiledProtectionTableBytes: hasCompiledProtectionTables ? (65536 * 3 + 4097 * 2) * 4 : 0,
      kernelNote: 'Typed-array byte counts are derived from the current bounded kernel tables. They exclude JavaScript object overhead and browser/worker runtime overhead.'
    });
    assert.ok(Number.isFinite(fitDurationMs) && fitDurationMs >= 0, `${look} analysis timing must be finite.`);
    for (let repeat = 1; repeat <= repeatCount; repeat++) await exportOne(look, repeat);
  }

  report.memory.javascriptHeap = await page.evaluate(() => {
    window.__photoFinishExportBench.heapSnapshot('complete');
    return { available: window.__photoFinishExportBench.heap.length > 0, snapshots: window.__photoFinishExportBench.heap };
  });
  const halo = 0; // Default recipe has no clarity or sharpness enhancement, so the export strips need no filter halo.
  const stripRows = Math.min(256 + 2 * halo, sourceDimensions.height);
  report.workingBufferEstimate = {
    sourceWidth: sourceDimensions.width,
    exportStripRows: stripRows,
    enhancementHalo: halo,
    rgbaStripBytes: sourceDimensions.width * stripRows * 4,
    compiledKernelTypedArrayBytes: report.finishFits.map(({ look, preparedKernelTypedArrayBytes }) => ({ look, bytes: preparedKernelTypedArrayBytes })),
    scope: 'The RGBA figure is one ImageData-equivalent strip sized from source width and the current export strip/halo rules. It excludes the strip canvas backing store, guided-field and renderer intermediates, the full output canvas, decoder/GPU storage, and JavaScript object overhead; it is not peak-memory usage.'
  };
  const warmOff = report.exports.find(item => item.treatment === 'off' && item.repeat === 2)?.runtimeMs;
  report.summary = Object.fromEntries(['off', 'natural', 'vivid'].map(treatment => {
    const runs = report.exports.filter(item => item.treatment === treatment);
    const firstRuntimeMs = runs.find(item => item.repeat === 1)?.runtimeMs ?? null;
    const warmRuntimeMs = runs.find(item => item.repeat === 2)?.runtimeMs ?? null;
    const warmOverheadMs = warmRuntimeMs !== null && warmOff !== undefined ? +(warmRuntimeMs - warmOff).toFixed(1) : null;
    return [treatment, {
      runs: runs.length,
      firstExportRuntimeMs: firstRuntimeMs,
      repeat2SameRecipeRuntimeMs: warmRuntimeMs,
      warmOverheadMs,
      warmOverheadPercentOfOff: warmOverheadMs !== null && warmOff ? +(warmOverheadMs / warmOff * 100).toFixed(1) : null
    }];
  }));
  report.pageErrors = [...errors];
  await writeReport();
  console.log(`Photo finish export benchmark report: ${resolve(outputDirectory, 'report.json')}`);
  console.log(JSON.stringify(report.summary));
  assert.deepEqual(errors, [], 'The editor must not raise uncaught page errors during the benchmark.');
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  report.pageErrors = [...errors];
  await writeReport();
  throw error;
} finally {
  await browser.close();
}
