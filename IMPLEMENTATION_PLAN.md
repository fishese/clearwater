# Adaptive photo colour-and-tone finish plan

## Photo finish mobile layout and JPG switching fix (20 October 2026)

- [x] Add 12px above the optional photo-finish description, equally sized 40px look buttons matching Auto enhance, and right-aligned Update finish. Production mobile layout checks pass at 320/390px in EN/zh-HK/ja; screenshot inspected.
- [x] Close the selection-commit/passive-load stale-reply window by invalidating worker generations during the selection commit. JPG decode checks cancellation after header/decode/resize work, closes late bitmaps, and drops obsolete load errors. Export owns its full-resolution decoded bitmap per request, preventing an old cleanup from closing a newer export bitmap; cleanup also covers setup failures.
- [x] Photo decode and processing failures no longer pass through the video-specific MP4 advice. Preserve typed platform limits, memory errors and actionable RAW/custom-model diagnostics; add photo-specific wording using the glossary. Video messages and platform limits stay unchanged.
- [x] 262 shared tests across 39 files and production build pass, including bitmap ownership, late JPG cancellation and photo/video classification. Production finish lifecycle/all-engine/custom ONNX/strip parity/video exclusion/translated layouts and legacy enhancement, iPhone-browser Save/Share, output destinations and mocked iOS shell pass. Independent code review found no further actionable issue. The legacy broad limit-browser harness is inconclusive here: its hardcoded external fixtures are missing, and Windows WebKit reports worker origin failures; do not count it as passing.
- [x] Repeated-JPG production browser check passes: held old render bitmap and injected old MP4 error cannot overwrite the new photo or show a toast; switching back and forth completes. This validates stale-reply handling, not a physical-device reproduction.
- [x] Updated debug APK built from `b82d9dd2bbbcc499972f0dab85cddf893730a78a`: `editor/android/build/photo-finish-switch-fix-debug/clearwater-1.0.9-photo-finish-fix-debug.apk` (10,658,111 bytes), SHA-256 `13fd69082807d31e2a9a1ce857f6ccb8513fe0891ad2b31c7f2c5bbaef1bc753`. Signature matches the previous debug certificate; package/version remain unchanged. ZIP integrity, all 47 bundled production files, root-relative index and 9 unchanged native tests verify. APK/checksum/provenance remain ignored.
- [ ] Next action: Android hardware retest of the originally reported failure. Native bitmap decoding itself remains non-cancellable and can briefly overlap; late results are disposed. The exact physical-device failure has not been reproduced locally; stale-reply/cancellation and shared error-classification defects were identified by source review. Existing finish performance and iPhone hardware gates remain open. Keep version 1.0.9/code 28 and all release defaults; no merge, release publication or version bump.

## Photo-finish debug APK checkpoint (20 October 2026)

- [x] User accepted the stronger Vivid comparison visuals and requested an Android debug APK for device testing. Built from `097b37ffbb9072389b5f6d7f9d3354bbe805712a` on `codex/adaptive-finish-plan`; no runtime change in this checkpoint.
- [x] `npm run android:sync` production build and `testDebugUnitTest assembleDebug` succeed (9 native tests, cached unchanged results). APK signature, package identity, ZIP CRC and all 47 packaged production files verify. Debug certificate matches the previous 1.0.9 debug APK. Private samples/comparisons are absent.
- [x] Ignored artifact: `editor/android/build/photo-finish-debug/clearwater-1.0.9-photo-finish-debug.apk` (10,657,447 bytes); SHA-256 `147799170138e0c72d4b700d4bca64165daf161d14521148a1b5eba60ed4a466`. SHA-256 sidecar and provenance are alongside it. Package remains `com.fishese.clearwater`, version 1.0.9 / code 28; standard debug signing only. Existing debug configuration remains minified and non-debuggable. This can update a matching debug-signed install; release-signed installs have a different certificate. Preserve app data rather than suggesting an uninstall.
- [ ] Next action: user Android testing via Enhancement → Effects → Photo finish (Off / Natural / Vivid), including original versus finished preview/export, Auto enhance interaction, Save/Share destinations, responsiveness and larger-photo memory pressure. Desktop overhead remains +26.7% Natural / +48.4% Vivid, above the original 10% target; profiling and iPhone hardware acceptance remain open. No installation, release signing, publication, merge, iOS build or version bump occurred or is authorized by this request. Earlier pending visual-acceptance/build statements below are historical.

## P4 measured handoff (20 October 2026)

Core/style milestone: `1a74c62` on `codex/adaptive-finish-plan`. All 258 shared tests, production build, full production finish/legacy platform browser checks and 192 private visual treatments pass. The three selected choices are Off (existing result), Natural (restrained middle), and Vivid (stronger reference-inspired warm separation). New fits are V2; versionless recipes and old fitted results remain unchanged. Main/latest release remains 1.0.9; no feature publication, merge, version bump, native signing or installation occurred.

- [x] Source-resolution export benchmark: one authorized 4032×3024 (12.2 MP) JPEG, WWE at its unchanged photo default plus 30% Balanced follow-up, finish 100%, high-quality JPEG. All six downloads have JPEG signatures, decode to the source dimensions and raise no page errors. Full ignored report: `analysis/adaptive-finish/export-v2-checked-20261020-r5/report.json`. Earlier harness failures are retained separately and produced no accepted timing evidence; repaired stale heading, desktop navigation, and extensionless temporary-file MIME assumptions.
- [x] First/repeat export latency: Off 3460.6/3105.3 ms; Natural 3931.1/3933.5 ms; Vivid 4629.5/4607.8 ms. Repeat-2 overhead over Off is +828.2 ms (+26.7%) Natural and +1502.5 ms (+48.4%) Vivid. The initial 10% target is **not met**. These are one-photo, two-run desktop measurements, not mobile/native guarantees or broad benchmark statistics.
- [x] Fit latency 35.4 ms Natural /49.7 ms Vivid. One prepared kernel has 902,160 typed-array bytes (82,952 shared and 819,208 protection tables). One 4032×256 RGBA strip is 4,128,768 bytes; these exclude other intermediates, output/decoder/canvas/GPU storage and object overhead. Diagnostic JS heap is not peak-memory evidence. Worker-owned in-place finishing removes one extra RGBA copy; inference reuse remains covered by worker/browser checks.
- [x] Private local comparison viewer: `analysis/adaptive-finish/benchmark-checked/compare.html`, currently served at `http://127.0.0.1:5182/compare.html`. All three pairs, four engines and two looks load; mobile width and page-error checks pass. It provides a benchmark wipe plus full-resolution links and the Off contact sheet. Everything in this directory, including copied source/reference images, is gitignored. Reports are visual-style targets rather than true-colour evidence; cyan texture and model-induced clipping can still differ.
- [ ] Next action: user visual acceptance of the stronger Vivid (especially anemone/reef textures), followed by profiling the export-strip finish pass to reduce the measured cost while preserving rendering semantics. Record any revised speed/quality tradeoff honestly instead of claiming 10%. Real Android/iPhone performance, memory pressure and native share destinations remain hardware gates before feature release acceptance. Do not merge/publish/bump versions without separate authorization.

## Current optional photo-finish checkpoint (20 October 2026)

Branch `codex/adaptive-finish-plan` includes main through released 1.0.9. User selected **Off** for the existing restoration/edits, **Natural** as a restrained colour/tone middle ground, and **Vivid** for the stronger reference-inspired warm look. The feature stays opt-in and photo-only; all bundled engines and compatible custom ONNX use the same finish logic. Model defaults, recipes without a finish, inference reuse, video/live camera, Save/Share and platform-specific limits remain unchanged.

- [x] P3 controls/guide/lifecycle committed as `fd11cfb`; local benchmark tooling/checkpoint as `d751af4`; 1.0.9 integration as `71d55a3`. Original stash `9bd4ff0`, other stashes and unrelated IDE files remain intact.
- [x] New analyses store algorithmVersion 2. Natural combines mild estimated colour balance and restrained tone. Vivid uses bounded green/yellow/violet subject evidence, selective warm separation, denser midtones, protected shadows and a soft positive-tone highlight shoulder. Versionless stored fits retain V1 rendering; old candidate output hashes pass. Known physical-red-filter correction disables colour/chroma/warm shifts. Poor/weak-red evidence safely falls back.
- [x] Share active-effect detection between UI/worker, including warm-only saved fits. Apply only to worker-owned corrected preview/strip buffers in place, removing one extra RGBA copy. One persisted fit, bounded reference/kernels and cached model inference serve preview/export.
- [x] 258 shared tests across 38 files and production build pass. Independent review caught/fixed early-white highlight plateaus and a compiled/scalar water-guard mismatch; the new hue fixture and broader fast/reference checks retain the one-byte bound. No shadow-ramp reversal; alpha and legacy paths pass.
- [x] Final comparisons: three private pairs × four engines × four treatments = 48; nine earlier protection samples × four engines × four treatments = 144. All 192 complete without engine/browser errors. Reports/full-preview outputs/crops are ignored under `analysis/adaptive-finish/benchmark-checked/` and `protection-checked/`. Earlier attempts remain separate. No private samples, reference images, manifests or generated comparisons are versioned or shipped.
- [x] Production photo-finish regression: every bundled engine plus user-loaded compatible ONNX, pending-fit Save/Export locks, saved-fit JSON reuse, undo/redo/clear/reset/invalidation, exact opaque PNG strip parity, partial-alpha PNG within one RGB level/exact alpha, video exclusion, EN/zh-HK/ja mobile layouts and stale replies. Existing enhancement, iPhone browser Save/Share, output destination/collision/cancel and mocked iOS shell checks pass.
- [ ] Next action: finish source-resolution desktop export timing and record actual cost, then obtain user visual feedback and real-phone cost/memory acceptance. Vivid is an estimated style, not true-colour recovery or an exact replica; some cyan rock texture and model-induced clipping/colour differences remain. Off/Natural remain useful alternatives. No feature merge, version bump, publication, native signing or installation is authorized.

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
| P2 | Select candidate; store/reuse fit; integrate shared photo preview/export with legacy-safe validation | Complete: c1744a5 plus 20 Oct V2 styles. Versionless fits stay unchanged; shared effect gates and owned-buffer application. 258 tests/build pass; timing/human acceptance tracked in P4 |
| P3 | Minimal optional Effects UI, translations, guide and undo/reset/preset behavior | Complete, 20 Oct: optional Off/Natural/Vivid UI, EN/zh-HK/ja and full lifecycle regression pass, including all bundled engines/custom ONNX, pending Save locks, video exclusion and stale replies. Next: revised-fit paired visuals/P4 |
| P4 | Correctness, visual/performance checks, necessary native-shell acceptance and test handoff | Automated correctness/production regressions pass; 192 final comparisons have no errors. Desktop source export passes, with +26.7% Natural/+48.4% Vivid cost (10% target missed). User accepted the visuals; verified debug APK supplied for Android testing. Cost optimization, mobile memory and hardware acceptance remain open; no release acceptance claimed |

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
