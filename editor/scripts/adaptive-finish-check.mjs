import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const editorRoot = process.cwd();
const outputRoot = resolve(editorRoot, '../analysis/adaptive-finish');
const baseUrl = process.env.CHECK_URL ?? 'http://127.0.0.1:5173/';
const synthetic = process.env.CHECK_SYNTHETIC === '1';
const positiveLimit = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const fingerprintPaths = [
  'src/core/adaptive-finish.ts',
  'scripts/adaptive-finish/harness.ts',
  'scripts/adaptive-finish/index.html',
  'scripts/adaptive-finish-check.mjs'
];

async function codeProvenance() {
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: editorRoot, encoding: 'utf8' }).trim();
  const workingTree = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: editorRoot, encoding: 'utf8' });
  const sourceHashes = {};
  for (const relativePath of fingerprintPaths) {
    const contents = await readFile(resolve(editorRoot, relativePath));
    sourceHashes[relativePath] = createHash('sha256').update(contents).digest('hex');
  }
  const comparisonStatus = execFileSync('git', ['status', '--porcelain', '--', ...fingerprintPaths], { cwd: editorRoot, encoding: 'utf8' });
  return {
    methodId: 'adaptive-photo-finish-p1-isolated-v1',
    reportSchemaVersion: 1,
    gitHead,
    workingTreeDirty: workingTree.trim().length > 0,
    comparisonSourcesDirty: comparisonStatus.trim().length > 0,
    sourceSha256: sourceHashes,
    hashCapture: 'Hashes describe the source files present when this report was generated. The candidate transforms reuse one corrected 256x256 fit and one neural inference per sample/engine.'
  };
}

async function saveCheckpoint(report, { preserveExistingErrors = false } = {}) {
  if (!preserveExistingErrors) report.pageErrors = errors;
  const reportPath = resolve(outputRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const sections = report.samples.map(sample => {
    const rows = sample.records.map(record => {
      const fit = record.fit ? `${record.fit.active ? 'active' : 'identity'} · ${record.fit.reason}` : '—';
      const timings = [
        record.modelInferenceMs !== undefined ? `model ${record.modelInferenceCacheState ?? 'n/a'} ${record.modelInferenceMs.toFixed(1)} ms` : null,
        record.warmPreviewRendererMs !== undefined ? `warm render ${record.warmPreviewRendererMs.toFixed(1)} ms` : null,
        record.fitMs !== undefined ? `fit ${record.fitMs.toFixed(1)} ms` : null,
        record.previewWarmApplyMs !== undefined ? `warm apply ${record.previewWarmApplyMs.toFixed(1)} ms` : null,
        record.cropApplyMs !== undefined ? `crop apply ${record.cropApplyMs.toFixed(1)} ms` : null
      ].filter(Boolean).join(' · ');
      return `<tr><td>${escapeHtml(record.engine)}</td><td>${escapeHtml(record.treatment)}</td><td>${escapeHtml(fit)}</td><td>${escapeHtml(timings || '—')}</td></tr>`;
    }).join('');
    return `<section><h2>${escapeHtml(sample.sample)} · ${escapeHtml(sample.category)}</h2><p>Original ${sample.originalWidth} × ${sample.originalHeight}; preview ${sample.previewWidth} × ${sample.previewHeight}; crop ${sample.crop.width} × ${sample.crop.height} at (${sample.crop.x}, ${sample.crop.y}). Errors: ${sample.errors.length ? escapeHtml(sample.errors.join('; ')) : 'none'}.</p><div class="images"><a href="${sample.contactSheets.whole}"><img src="${sample.contactSheets.whole}" alt="Whole image comparison for ${escapeHtml(sample.sample)}"></a><a href="${sample.contactSheets.crops}"><img src="${sample.contactSheets.crops}" alt="Source resolution crop comparison for ${escapeHtml(sample.sample)}"></a></div><table><thead><tr><th>Engine</th><th>Treatment</th><th>Fit</th><th>Timings</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join('');
  const provenanceInfo = {
    comparisonRun: report.provenance ?? report.comparisonProvenance ?? null,
    reportGenerator: report.reportGeneratorProvenance ?? null
  };
  const provenance = provenanceInfo.comparisonRun || provenanceInfo.reportGenerator ? `<details><summary>Method and source version</summary><pre>${escapeHtml(JSON.stringify(provenanceInfo, null, 2))}</pre></details>` : '';
  const perf = report.performance?.scope ? `<p>${escapeHtml(report.performance.scope)}</p>` : '';
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Adaptive finish local comparison</title><style>body{font:14px system-ui,sans-serif;background:#101a20;color:#e7eff1;margin:24px}h1{font-size:24px}h2{font-size:18px;margin-bottom:4px}p{color:#b5c6ca}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin:12px 0}.images img{width:100%;height:auto;border:1px solid #38515a}section{padding:8px 0 24px;border-bottom:1px solid #38515a}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;vertical-align:top;padding:6px;border:1px solid #38515a}th{background:#1b2c33}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Adaptive finish local comparison</h1><p>Mode: ${escapeHtml(report.mode)}. ${escapeHtml(report.evidenceLimit)}</p><p>Completed samples: ${report.samples.length} / ${report.sampleLimit}. Engines: ${escapeHtml(report.engines.join(', '))}. JSON: <a href="report.json">report.json</a>.</p>${perf}${provenance}${sections || '<p>No completed samples yet.</p>'}</html>`;
  await Promise.all([
    writeFile(resolve(outputRoot, 'report.html'), html, 'utf8'),
    writeFile(resolve(outputRoot, 'index.html'), html, 'utf8')
  ]);
}

await mkdir(outputRoot, { recursive: true });
const errors = [];
if (process.env.CHECK_REPORT_ONLY === '1') {
  const reportPath = resolve(outputRoot, 'report.json');
  if (!existsSync(reportPath)) throw new Error(`Saved report not found: ${reportPath}`);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.reportRebuiltAt = new Date().toISOString();
  if (report.provenance && report.provenance.capturePhase !== 'comparison-run') {
    report.reportGeneratorProvenance = report.provenance;
    delete report.provenance;
  }
  report.reportGeneratorProvenance = { ...await codeProvenance(), capturePhase: 'report-regeneration' };
  if (!report.provenance && !report.comparisonProvenance) {
    report.comparisonProvenance = {
      methodId: 'adaptive-photo-finish-p1-isolated-v1',
      reportSchemaVersion: report.schemaVersion,
      capturePhase: 'not-captured-at-comparison-run',
      gitHead: null,
      workingTreeDirty: null,
      sourceSha256: null,
      note: 'The comparison was completed before run-time source fingerprints were added. Do not treat report-regeneration hashes as measurement-source hashes.'
    };
  }
  report.performance = {
    ...(report.performance ?? {}),
    scope: 'Measured costs cover preview rendering, preview fit application, and the selected source crop. No full-resolution export timing was measured. The preview renderer timing records renderPixels separately from neural field transfer, so candidate apply percentages are a partial preview-render comparison, not the full warm-render or export overhead.'
  };
  await saveCheckpoint(report, { preserveExistingErrors: true });
  process.stdout.write(`Report rebuilt without model inference: ${resolve(outputRoot, 'report.html')}\nJSON: ${reportPath}\n`);
  process.exit(0);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1400 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/scripts/adaptive-finish/index.html', baseUrl).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.runAdaptiveSample === 'function');

  let samples;
  if (synthetic) {
    samples = [{ category: 'synthetic mechanics' }];
  } else {
    const manifestPath = resolve(editorRoot, process.env.CHECK_MANIFEST ?? '../analysis/adaptive-finish/manifest.json');
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
      samples = Array.isArray(parsed) ? parsed : parsed.samples;
      if (!Array.isArray(samples)) throw new Error('CHECK_MANIFEST must be an array or an object with a samples array.');
    } else {
      const names = await page.evaluate(async () => {
        const response = await fetch('/__samples');
        if (!response.ok) throw new Error(`Local sample list returned HTTP ${response.status}.`);
        return response.json();
      });
      samples = names.map(name => ({ name, category: 'local sample' }));
    }
  }

  const defaultEngineList = synthetic ? ['balanced'] : ['balanced', 'wwe', 'fivea', 'shallow'];
  const requestedEngines = process.env.CHECK_ENGINES?.split(',').map(value => value.trim()).filter(Boolean) ?? defaultEngineList;
  const supportedEngines = new Set(['balanced', 'wwe', 'fivea', 'shallow']);
  const engines = requestedEngines.filter((engine, index) => supportedEngines.has(engine) && requestedEngines.indexOf(engine) === index).slice(0, positiveLimit(process.env.CHECK_ENGINE_LIMIT, requestedEngines.length));
  if (!engines.length) throw new Error('No supported engines were selected.');
  samples = samples.slice(0, positiveLimit(process.env.CHECK_SAMPLE_LIMIT, samples.length));
  if (!samples.length) throw new Error('No samples were selected.');

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: synthetic ? 'synthetic mechanics only' : 'authorized local photos',
    evidenceLimit: synthetic ? 'Synthetic output checks mechanics only and is not evidence of photo quality.' : 'Model outputs and finish estimates are not ground truth; inspect the whole-image previews and source-resolution crops.',
    comparison: {
      candidates: ['tone', 'colour-tone', 'soft-water'],
      candidateOrder: 'Each candidate replaces Auto enhance tone. Current Auto enhance is shown as a separate baseline. Candidate results do not stack clarity or sharpness.',
      reference: 'One renderer-corrected 256x256 reference per sample and engine; each fitted candidate is reused for preview and crop.',
      reuseVerification: 'Each candidate closure passes the identical fit object to preview and crop application. The candidate path performs no model inference; each successful AI engine baseline records one inference and Balanced records zero.',
      crop: 'Source-resolution square crop. Current Auto enhance uses a source strip with sufficient filter halo and full-source filter radii before the square is extracted.',
      timings: 'The first sample per AI engine measures cold model load plus inference; later samples measure warm inference. Each sample/engine uses one inference; finish candidates reuse it. Warm preview renderer and candidate application timings are reported separately. No full-resolution export timing is measured.'
    },
    performance: {
      scope: 'Measured costs cover preview rendering, preview fit application, and the selected source crop. No full-resolution export timing was measured. The preview renderer timing records renderPixels separately from neural field transfer, so candidate apply percentages are a partial preview-render comparison, not the full warm-render or export overhead.'
    },
    provenance: { ...await codeProvenance(), capturePhase: 'comparison-run' },
    engines,
    sampleLimit: samples.length,
    samples: [],
    pageErrors: errors,
    engineErrors: []
  };
  const modelCacheSeen = new Set(), engineErrors = [];
  for (let index = 0; index < samples.length; index++) {
    const spec = samples[index];
    const result = await page.evaluate(async args => window.runAdaptiveSample(args.spec, args.index, args.synthetic, args.engines), { spec, index, synthetic, engines });
    for (const record of result.records) {
      if (record.treatment === 'corrected baseline' && record.inferenceCount === 1) {
        record.modelInferenceCacheState = modelCacheSeen.has(record.engine) ? 'warm' : 'cold';
        modelCacheSeen.add(record.engine);
      }
    }
    for (const error of result.errors) engineErrors.push({ sample: result.sample, error });
    const stem = result.sample;
    const wholeImage = `${stem}-whole.png`, cropImage = `${stem}-crops.png`;
    await page.locator('#whole').screenshot({ path: resolve(outputRoot, wholeImage) });
    await page.locator('#crop').screenshot({ path: resolve(outputRoot, cropImage) });
    report.samples.push({ ...result, contactSheets: { whole: wholeImage, crops: cropImage } });
    process.stdout.write(`${stem}: ${result.originalWidth}x${result.originalHeight}, ${result.records.length} comparisons, ${result.errors.length} engine errors\n`);
    report.engineErrors = [...engineErrors];
    await saveCheckpoint(report);
  }
  report.pageErrors = errors;
  report.engineErrors = engineErrors;
  await saveCheckpoint(report);
  process.stdout.write(`Report: ${resolve(outputRoot, 'index.html')}\nJSON: ${resolve(outputRoot, 'report.json')}\n`);
  if (errors.length || engineErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
