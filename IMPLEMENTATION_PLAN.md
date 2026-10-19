# Adaptive photo colour-and-tone finish plan

Updated 19 October 2026. This is the active feature plan, replacing completed MVP/lens checklists. Current release and platform contracts are in HANDOFF.md; procedures/history are in MAINTENANCE.md. Earlier plan revisions remain in Git history.

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
| P3 | Minimal optional Effects UI, translations, guide and undo/reset/preset behavior | Implemented in working tree; browser regression and wording review in progress |
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
