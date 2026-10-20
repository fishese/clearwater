# Adaptive finish comparison harness

This local Vite page compares the current corrected output, current Auto enhance, and bounded adaptive finish candidates. Candidate finishes replace Auto enhance tone and do not stack its clarity or sharpness. The experimental `vivid` candidate is included for visual comparison only; the harness makes no quality claim.

The default manifest is `analysis/adaptive-finish/manifest.json`. It stays at the shared base output root when a named run is selected. The runner reads authorized local samples through Vite's `__samples` and `__sample` endpoints and never copies them into versioned or public assets.

Run from `editor/` with the existing Vite server available:

```powershell
$env:CHECK_RUN_NAME = 'vivid'
$env:CHECK_REPORT_ONLY = '0'
node scripts/adaptive-finish-check.mjs
```

Outputs go to `analysis/adaptive-finish/vivid/`. The report JSON and HTML are checkpointed after each completed sample. The default run name writes to `analysis/adaptive-finish/`.

To regenerate HTML from a saved run without opening the browser or rerunning models:

```powershell
$env:CHECK_RUN_NAME = 'vivid'
$env:CHECK_REPORT_ONLY = '1'
node scripts/adaptive-finish-check.mjs
```

`CHECK_SAMPLE_LIMIT` and `CHECK_ENGINE_LIMIT` bound the run. `CHECK_ENGINES` can select explicit engines. `CHECK_MANIFEST` overrides the default manifest path. `CHECK_SYNTHETIC=1` runs Balanced mechanics on a generated image and is not visual quality evidence.

Reports record the source revision, dirty state, and hashes of the math module, harness page and runner at the start of a comparison run. Cold model inference is reported for the first sample per engine; later samples use warm sessions. Each candidate reuses one corrected 256 × 256 fit and performs no model inference. Timings cover preview and the selected source crop; full-resolution export timing is not measured.

## Selected editor path and acceptance

7557c4b records the bounded vivid follow-up (216 local treatments without engine/browser errors). c1744a5 uses the selected Natural (tone) and Vivid fits in an optional photo-only editor path; Off/default/zero amount and legacy recipes retain their old rendering. The comparison page remains separate and makes no general image-quality claim. Compiled application is tested within one byte of the reference math; preview/export use the same compiled fit. Actual human visual and phone acceptance remain open.

The saved fit is reused when amount changes; Update finish explicitly analyses the corrected reference again. See the main editor README for invalidation, pass order and platform boundaries. scripts/photo-finish-check.mjs checks the editing lifecycle, saved fit, automatic-contrast interaction and stale replies. Opaque PNG parity is exact; partially transparent PNGs have an observed one-byte RGB round-trip difference with exact alpha, also present with the finish Off.

For a local source-resolution timing check, scripts/photo-finish-export-bench.mjs reads one manifest entry and writes ignored reports. CHECK_SAMPLE_INDEX selects its entry; CHECK_EXPORT_REPEATS (1-3) selects repetitions. This measures desktop exported JPEG latency and source dimensions. JS heap diagnostics and derived strip/kernel byte sizes are explicitly not native/canvas/GPU peak-memory measurements. It does not establish mobile or native performance acceptance.

## Private paired benchmarks

A local manifest can set `productFinish: true` and `benchmark` to an authorized sample basename. This compares the current product Natural/Vivid fit and compiled application beside the input and reference; the original isolated candidates remain available when the flag is absent. Each engine uses one inference and all treatments share its corrected reference. The runner also writes full preview PNGs for Natural/Vivid into the ignored run folder. Reference dimensions must match the input. Never commit these manifests, samples, reference outputs or generated comparisons.

Other-app outputs are visual targets rather than true-colour evidence. Descriptive pixel deltas do not establish perceptual quality, and automatic restoration may differ between engines. The optional finish itself is independent of model identity, including custom ONNX; existing engine inference remains cached.

## Current style contract (20 October 2026)

Off keeps the selected restoration and edits; Natural is the restrained colour/tone middle ground; Vivid is the stronger warm style, including yellow and violet separation with denser protected tone. New product fits carry algorithmVersion 2, while versionless fits and all original isolated candidates retain their rendering. The V2 compiled application agrees with its reference within one RGB level; both photo worker paths use the same compiled kernel.

The checked private runs are `benchmark-checked` (three supplied pairs, 48 treatments) and `protection-checked` (nine prior samples, 144 treatments), with no engine/browser errors. Earlier attempts are exploratory history and must not be presented as the final result. Source hashes in each report describe the files at run start; later comment/documentation-only edits do not alter the measured pixel logic. The reference outputs remain visual targets rather than a ground truth or a promise of identical results across restoration models.

The 20 October source-resolution check uses `scripts/photo-finish-export-bench.mjs`. `CHECK_RUN_NAME` must be a fresh lowercase/hyphen name (existing report directories are never overwritten), `CHECK_MANIFEST` can point to an ignored local manifest, and `CHECK_SAMPLE_INDEX`/`CHECK_EXPORT_REPEATS` select its input/repetitions. The current 12.2 MP desktop report measured repeat-2 Off/Natural/Vivid at 3.11/3.93/4.61 seconds. Both looks exceed the initial 10% overhead target; phone memory/cost and output destination acceptance remain open. No peak-memory claim follows from strip/table sizes or JS heap.
