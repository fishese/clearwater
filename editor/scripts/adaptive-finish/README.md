# Adaptive finish comparison harness

This local Vite page compares the current corrected output, current Auto enhance, and bounded adaptive finish candidates. Candidate finishes replace Auto enhance tone and do not stack its clarity or sharpness. The experimental `vivid` candidate is included for visual comparison only; the harness makes no quality claim.

The default manifest is `analysis/adaptive-finish/manifest.json`. It stays at the shared base output root when a named run is selected. The runner reads authorized local samples through Vite's `__samples` and `__sample` endpoints and never copies them into the repository.

Run from `editor/` with the existing Vite server available:

```powershell
$env:CHECK_RUN_NAME = 'vivid'
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
