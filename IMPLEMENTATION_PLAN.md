# Adaptive photo colour-and-tone finish plan

## Resumed photo finish (20 October 2026)

User resumed optional photo-only Natural/Vivid work after the 1.0.9 release and supplied three paired visual benchmarks. All six source/reference files and generated comparisons are gitignored; only general processing code and reusable tooling may be committed. The finish must be available for Balanced, every bundled neural engine and custom ONNX. No model-specific finish tuning or extra inference is intended.

- [x] Integrate main through 1.0.9 (`71d55a3`); preserve PR #11 platform limits, Save/Share and iOS navigation/recovery fixes. Restore only feature source and regression scripts from stash `9bd4ff0`, leaving the stash and unrelated IDE state intact.
- [x] Existing-fit baseline: three benchmark inputs × four engines × six treatments = 72 comparisons, zero engine/browser errors. Current colour fitting remains too subtle and sometimes falls back to tone-only. Baseline report is ignored under `analysis/adaptive-finish/benchmark-baseline/`. Restored shared suite: 244 tests and production build pass.
- [x] Add opt-in paired-reference harness mode with full preview outputs and explicit visual-reference limitations; default isolated comparisons remain available.
- [ ] Next: finish versioned stronger fitting while retaining old stored-fit rendering, then rerun paired comparisons and representative water/highlight/shadow/filter cases. P3 lifecycle/model-independence browser regression now passes; complete revised-fit visuals and P4 export timing. No merge, publish, version bump or native signing is authorized for this resumed feature.


Updated 19 October 2026. This is the active feature plan, replacing completed MVP/lens checklists. Current release and platform contracts are in HANDOFF.md; procedures/history are in MAINTENANCE.md. Earlier plan revisions remain in Git history.

## Release 1.0.9 completed (20 October 2026)

User authorized APK/IPA publication after merging PR #11. [v1.0.9](https://github.com/fishese/clearwater/releases/tag/v1.0.9) is published as latest from `96f6e59b9fd5c980231f48ccbdcfbb417e4000b2`, including PR #11 platform-specific error messages and PR #10 Save/Share readiness fixes. Android versionCode 28; unsigned physical-device arm64 IPA build 7, iOS 26+. Release review also repaired the iOS memory proxy's optional Capacitor delegate forwarding and duplicate reload, with two hosted regressions.

- [x] Preserve photo finish: branch `codex/adaptive-finish-plan` at `43d3d3b`; unfinished UI/tests in stash `9bd4ff0`. Natural and Vivid remain the selected future choices. Other stashes, unrelated `editor/.idea/`, private samples and comparisons are untouched. Local `.git/info/exclude` keeps `analysis/adaptive-finish/` ignored on main. No adaptive finish is shipped.
- [x] Review merged PR #11 and run 203 shared tests; production build passes. Android's 9 native tests and minified debug/release builds pass.
- [x] Verify 36 localized error cases: byte size, duration, photo dimensions and corrupt video across desktop/Android/iPhone browser profiles in EN/zh-HK/ja. This is Chromium profile coverage, not physical Safari memory-pressure acceptance. Production output-folder/collision/cancel, iPhone browser export readiness/cancel/retry/recipe sharing/superseded enhancement, and mocked native iOS shell regressions pass.
- [x] [iOS run 39385092860](https://github.com/fishese/clearwater/actions/runs/39385092860): all 33 hosted native tests and unsigned physical-device packaging pass on the exact release source. [Pages run 39385091752](https://github.com/fishese/clearwater/actions/runs/39385091752) passed and deployed it.
- [x] APK signature verifies and matches 1.0.8 certificate SHA-256 `0af8355d7d93be664de03099c7b3d9c38d12845bdb6a77c36c4860410dddd7e8`. App identity, versions, ZIP integrity and every bundled model hash pass. APK/IPA bundled web bytes match the production build, allowing only static-text Windows/macOS line endings. IPA is unsigned; CI verifies physical iOS arm64, native plugins and compiled Metal library.
- [x] Publish all 14 assets with canonical APK/IPA names, SHA-256 sidecars, provenance, LICENSE and NOTICE; every uploaded GitHub asset digest matches local bytes.
- [ ] Next action: user device acceptance of iPhone memory recovery and existing automatic/manual lens transitions. Keep adaptive finish deferred until explicitly resumed; then restore its branch/stash carefully and continue the documented P2/P3 checkpoint without losing the selected Natural/Vivid direction.

Release APK SHA-256: `21a231e3a30c3f9f6d268c434eb19e6d7f6858f558730cef93adf750da456dad`; debug APK: `a0ff6ffbbdc6d9dedeb04d3f3672b4a3ad9ea9b3986a65c4063e737716005f14`; unsigned IPA: `a66f50d521dc21c4fb55e09b5114bb10778099ed933343ab5cca7cbf0b4dba9d`. Verification evidence and staged assets are ignored under `editor/android/build/release-1.0.9`; CI IPA/provenance under `editor/ios/App/output/release-1.0.9`. Historical checkpoints below describe earlier states.

Prepared 12 October 2026. Updated 13 October after adding local Shallow-UWnet / FUnIE-GAN inference and a generic, user-loaded ONNX adapter. See editor/README.md for run instructions, verified behaviour and remaining milestones. AI currently transfers a 256×256 colour residual onto source-resolution pixels; full-resolution neural restoration remains future work.

## Goal and evidence

Explore a more vivid underwater restoration with a natural option and predictable manual edits. Public before/after examples suggested stronger cyan/green cast removal, warm-colour separation and firmer black levels. Two displayed before images were compared in an isolated ClearWater browser session at preview resolution: exploratory evidence, not a full-resolution benchmark or proof of the competitor's automatic settings. No proprietary code was accessed or copied.

Current photos default to WWE-UIE at 80% restoration plus a 30% Balanced follow-up. Optional Auto enhance changes luminance contrast, local contrast and sharpness, not independent channel balance. Balanced uses bounded channel gains/red mixing and a conservative veil estimate. Start with explainable finishing improvements rather than another neural model.

Public inspiration: https://deepcolors.app/ describes hue adjustment, channel stretching and black-point correction. These are general processing ideas; do not reproduce source code, assets or branding, or adopt unverified marketing claims. Reference images/comparisons stay out of Git and production assets.

## Scope

- Initially opt-in and photo-only on a codex/ branch. No production changes or default changes during the experiment.
- Evaluate Balanced, WWE-UIE, Five A+ and Shallow-UWnet output; custom ONNX follows the same shared contract. Do not rerun inference for finish adjustments.
- Reuse Effects if a candidate proves useful. Prefer one amount/look choice over many sliders. Decide exact labels and whether it belongs in Auto enhance after comparison.
- Existing recipes must render identically with the new field absent/off. No silent re-grading of collections or changed default engine/strength.
- Video, live camera/native shaders, HDR/RAW colour management, weights and gallery ownership are out of scope. Segmentation models, physical dehazing, local masks and LUT export are separate projects.

## Progress and commit checkpoints

| ID | Deliverable and acceptance | Status |
| --- | --- | --- |
| P0 | Review public examples/current renderer; record hypothesis, limits and baseline | Complete, 19 Oct; research only |
| P1 | Isolated candidate transforms and comparison harness; compare current default and Auto enhance | Complete: 72295d2 baseline; 7557c4b adds bounded Vivid. Follow-up: 9 photos x 4 engines x 6 treatments, no engine/browser errors. Natural/Vivid selected as optional experiments |
| P2 | Select candidate; store/reuse fit; integrate shared photo preview/export with legacy-safe validation | Complete: c1744a5; validated saved fits, shared preview/export, cached kernels/inference, legacy off path. 234 tests/build pass; performance target remains open in P4 |
| P3 | Minimal optional Effects UI, translations, guide and undo/reset/preset behavior | Complete, 20 Oct: optional Off/Natural/Vivid UI, EN/zh-HK/ja and full lifecycle regression pass, including all bundled engines/custom ONNX, pending Save locks, video exclusion and stale replies. Next: revised-fit paired visuals/P4 |
| P4 | Correctness, visual/performance checks, necessary native-shell acceptance and test handoff | In progress: legacy Effects, iOS web Save/Share, destination/cancel and mocked iOS shell checks pass. New finish regression, visual feedback, export/mobile cost and hardware gates remain |

After each row, commit and replace its status with the commit, checks and precise next step. Record partial work/failures if quota interrupts. Numerical tests do not establish visual acceptance.

## P1: isolated experiment

1. Select a small authorized comparison set: blue water, green water, naturally warm/yellow subjects, pale sand/highlights, low-red/noisy shadows, naturally red subjects and physical-red-filter surface shots. Synthetic images test math, not aesthetics. Keep private filenames/device observations in ignored notes.
2. Record current Balanced and WWE-UIE + Balanced-after-AI results, with and without current Auto enhance. Compare the same inputs/recipes and inspect whole images plus 100% crops. Marketing screenshots and original files are not equivalent quality references.
3. Try constrained per-channel percentile fitting plus a stronger luminance black/white-point or gentle curve finish. Estimate from a bounded corrected reference (initial target 256x256), excluding alpha-zero, clipped and very dark samples. Use confidence checks, bounded gains and identity fallback for flat/empty/poor evidence. Do not force RGB means to grey.
4. If global fitting damages water colours, test cheap soft water-likelihood weighting for analysis or application. Cyan/blue alone does not establish background: blue subjects must remain valid. Add spatial complexity only if simpler fitting fails and quality gains justify measured cost.
5. Protect red-deficient shadow noise, use smooth highlight handling and preserve red-removal behavior near the surface with physical filters. Avoid forcing all greens yellow or describing guessed colour as ground truth.
6. Compare a few bounded parameter sets, not an open-ended tuning search. Keep/reject each with concise reasons and cold/warm timings. P1 may establish that only tone or only colour fitting is useful.

Deliverable: ignored local comparison report/contact sheet plus committed reusable math/harness/tests. Do not commit personal images, competitor examples or generated galleries.

## P2: integration gates

- Audit recipe readers/writers, parseRecipe, reset/undo/presets, photo workers, iOS capture recipe storage and export paths before choosing schema. New fields must be optional, finite, bounded and identity when absent; retain version-1 compatibility.
- Explicitly decide pass order. Current engine/strength, optional Balanced follow-up and manual edits produce the fitting reference; do not recursively fit a result already containing the new finish. Store the chosen fit rather than refitting on every manual slider movement; re-analysis is explicit. Verify neutral picking and subsequent manual refinements remain predictable.
- Apply adaptive colour/tone before spatial detail finishing. Use a single automatic contrast fit, avoiding a second automatic stretch over an already stretched result. Intentional manual contrast remains available. Document/test any different order before integration.
- Reuse one bounded-reference fit across preview and all export strips. No strip-local colour/black-point fitting. Preserve alpha and source detail, linear work per pixel and bounded strip memory; reuse existing halos for spatial detail.
- Cache against corrected reference/relevant settings and model identity. Invalidate on source/model/strength/white-balance changes as appropriate, not tab switches. Preserve inference reuse, bounded caches and saved-fit reproducibility.
- Test shared imported-photo editing in web/Android/iOS. Native capture quick-sharing and camera shaders must not silently ignore a finish displayed in the editor. Gate to the supported shared photo path and check capture-to-editor transitions.

## P3: UI/language

Expose only a useful candidate. Keep it opt-in and separate from restoration through the existing Effects treatment. Preserve applied-state design, undo/redo, clear, Auto restore and Reset semantics. Keep EN/zh-HK/ja labels concise and follow reference/i18n-glossary.md without re-auditing user wording. Explain estimated colour/contrast and possible noise amplification, not physical recovery of missing information.

## P4: acceptance/performance

- Legacy/no-op recipes stay pixel-identical. Reject invalid parameters and preserve fitted results through JSON round-trips.
- Check ramps, flat fields, alpha edges, clipped highlights, saturated colours and noisy shadows for banding, halos, clipping or colour inversion. Inadequate statistics fall back safely.
- Check preview/export parity at equal dimensions and strip/full-buffer equivalence, including coordinates/halos. No per-strip colour changes.
- Repeated finish edits reuse ONNX inference. Bounded analysis sample, no new model download and no full-resolution auxiliary image. Initial target: at most 10% additional warm render/export time over the same recipe; measure/report actual time and memory rather than promising it. Reconsider complexity if materially slower.
- Run npm test and npm run build after meaningful changes. Focused scripts include enhancement-check.mjs, ios-web-export-check.mjs, export-destination-check.mjs and ios-shell-check.mjs. Add meaningful tests for new math/state; avoid unrelated native builds during the isolated experiment.
- Seek human feedback over the representative set and report both gains/failures. Two public demos cannot establish general superiority. Physical iPhone browser memory/saving acceptance differs from mocks.
- Finish with committed progress, limitations and test artifact locations. Next native build must include the already-merged Save/Share fix. Merge/version bump/publication require separate authorization.

## P1 result and next action (19 October 2026)

Code checkpoint: 72295d2. Isolated tone, colour-tone and soft-water candidates, bounded corrected-reference fitting, reusable application, explicit filtered-surface protection and a local comparison runner are implemented. All 205 shared tests and production build pass. Nine authorized local photos across Balanced, WWE-UIE + 30% Balanced, Five A+ and Shallow-UWnet produced 180 comparisons with zero engine/browser errors. Inspectable private reports/contact sheets/source-pixel crops are gitignored under analysis/adaptive-finish/. Reproduction and limits: editor/scripts/adaptive-finish/README.md.

Initial baseline finding (72295d2, superseded by the following follow-up): no candidate was selected for production. The natural tone result is subtle; colour fitting frequently falls back and did not show a consistent useful gain. Standalone active application averaged about 38%/38%/42% of measured transfer-plus-render time for tone/colour-tone/soft-water, above the initial 10% target; these are exploratory desktop preview timings, not export/mobile measurements. Preserve the first report before revising. Next action: one bounded vivid/chroma-separation experiment with the same protections, followed by human visual feedback and a feasible fused-pass performance check before P2. P2-P4, native hardware acceptance, merge and release remain incomplete.

## Bounded follow-up and P2 checkpoint (19 October 2026)

7557c4b adds one protected Vivid candidate; all three earlier candidate outputs remain byte-identical in hash regressions. The same nine local photos across four engines and six treatments produced 216 comparisons without engine/browser errors. User preference is Natural and Vivid choices. Natural uses the restrained tone fit; Vivid uses bounded colour/chroma separation with weak-channel, water, shadow, highlight and filter protection. These are optional editing choices, not a claim of true-colour recovery or general superiority. Private reports remain under analysis/adaptive-finish/ (baseline and vivid runs separated).

c1744a5 completes P2: optional version-1 settings with strict bounds, one persisted fit reused by preview/export strips, amount changes without inference, bounded kernels, explicit re-analysis protocol and stale-request handling. The selected finish replaces automatically applied Auto enhance contrast; intentional manual contrast and brightness/detail finishing remain. Inactive/identity/zero-amount fits preserve the old path. Fit-context changes clear it; ordinary tone/detail edits retain it. No video/live-camera spatial pipeline or native source ownership changes.

234 shared tests and production build pass. Existing enhancement/PNG parity, iOS web prompt/cancel/retry and superseded enhancement, desktop destination/collision/cancel, and mocked iOS shell checks pass. An existing brightness browser check now waits for its actual render rather than racing Save readiness. P3 UI/wording is in review; next action is its finish-specific lifecycle, preset, preview/export and stale-result browser check, then commit P3.

P4 performance remains unresolved: the warmed synthetic 1.92 MP desktop microbenchmark measured about 40 ms Natural and 106 ms Vivid versus a 138 ms Balanced renderer (about 29%/77% extra renderer time). Neural transfer, encoding, full export and mobile memory are outside that measurement. Natural/fallback kernels avoid large per-fit tables; colour kernels remain bounded. No 10% performance acceptance is claimed; keep optional/off defaults and investigate fusion or simpler math before release acceptance.
