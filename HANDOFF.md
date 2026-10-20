# Handoff

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

## P3 optional UI completed (20 October 2026)

Restored optional photo-only Off/Natural/Vivid Effects, amount, explicit update, three-language wording/guide and existing undo/reset/preset behavior. Full `photo-finish-check.mjs` passes: Balanced, all bundled engines and a compatible ONNX loaded through Custom; pending analysis locks Save/Export; recipe roundtrip, undo/redo, clear/reset, input invalidation, PNG parity, video exclusion, mobile translations and stale success/error. No model-specific UI gate is present. Shared tests/build and Save/Share/destination/iOS-shell checks pass. New stronger-fit visuals and source-resolution export timing remain the next P4 work; no release/default change is implied.


## Resumed photo finish (20 October 2026)

User resumed optional photo-only Natural/Vivid work after the 1.0.9 release and supplied three paired visual benchmarks. All six source/reference files and generated comparisons are gitignored; only general processing code and reusable tooling may be committed. The finish must be available for Balanced, every bundled neural engine and custom ONNX. No model-specific finish tuning or extra inference is intended.

- [x] Integrate main through 1.0.9 (`71d55a3`); preserve PR #11 platform limits, Save/Share and iOS navigation/recovery fixes. Restore only feature source and regression scripts from stash `9bd4ff0`, leaving the stash and unrelated IDE state intact.
- [x] Existing-fit baseline: three benchmark inputs × four engines × six treatments = 72 comparisons, zero engine/browser errors. Current colour fitting remains too subtle and sometimes falls back to tone-only. Baseline report is ignored under `analysis/adaptive-finish/benchmark-baseline/`. Restored shared suite: 244 tests and production build pass.
- [x] Add opt-in paired-reference harness mode with full preview outputs and explicit visual-reference limitations; default isolated comparisons remain available.
- [ ] Next: finish versioned stronger fitting while retaining old stored-fit rendering, then rerun paired comparisons and representative water/highlight/shadow/filter cases. Complete the restored P3 lifecycle/model-independence browser regression and P4 export timing. No merge, publish, version bump or native signing is authorized for this resumed feature.


Updated 19 October 2026. Read this first: it supersedes historical status paragraphs in other documents. Operating procedures and release history are in MAINTENANCE.md. The active feature checklist is in IMPLEMENTATION_PLAN.md. Older handoff revisions remain in Git history.

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

## Coordinated 1.0.5 published and licensed (17 October 2026)

## Current state

- Main includes PR #8 (native Auto lenses, merge 0eae50c) and PR #10 (Save/Share readiness, merge 206d080). Main documentation checkpoint: 0872138.
- Published native release: v1.0.8, Android versionCode 27, unsigned iOS build 6 (iOS 26+), source 0eae50c. Canonical assets: clearwater-release.apk and clearwater-unsigned.ipa. Android signing identity is unchanged.
- Web is newer than these binaries: Pages run 39188913154 deployed PR #10. Include this Save/Share fix in the next native build; do not claim native 1.0.8 contains it.
- PR #10 fixes indefinite busy state when a new preview supersedes Auto enhance, ignores stale enhancement errors and removes redundant post-export preview rendering. It does not establish that every reported iPhone saving issue has the same cause. Further user feedback may be needed.
- Latest shared checks: 193 tests, production build, iOS web prompt/cancel/retry and superseded enhancement/stale-error regressions pass. Desktop output-folder/collision/cancel, preview cancellation, native share wrapper and mocked iOS shell pass. WebKit share wrapper passes; full-photo processing in Windows Playwright WebKit is inconclusive.
- Native release checks: 9 Android unit tests, minified debug/release builds and signing continuity pass. All 31 hosted iOS tests passed on the same native implementation before the version bump. Merged-source packaging and all 14 uploaded hashes pass. S24 Ultra Auto/manual sensor choice and digital crop were verified. Actual iPhone Auto lens/white-balance acceptance remains open.

## Product and platform boundaries

Local React/TypeScript/Vite editor with web/PWA and Capacitor Android/iOS shells. English, Hong Kong Traditional Chinese (standard written Chinese) and Japanese. Consult reference/i18n-glossary.md for new wording; preserve user-corrected catalogues.

Photos default to WWE-UIE plus 30% Balanced after AI; video defaults to sampled Five A+ global colour. Shallow-UWnet and compatible custom ONNX are supported. Photo AI uses edge-aware colour transfer; video/live camera use global sampled colour and must not acquire the photo spatial pipeline. Effects is optional photo-only brightness/contrast/clarity/sharpness. Compatible DNG/HEIC develop to SDR; JPEG/PNG export preserves supported metadata. Detailed limits and quality modes are in editor/README.md.

Android uses CameraX, iOS uses AVFoundation, web uses camera streams. Native still dimensions differ from preview dimensions. GPU Balanced and optional sampled Five A+ live assistance remain supported, including white balance without AI. Auto selects reported optical modules plus digital crop; manual lens choice stays locked until Auto is selected again. No lens switching while recording.

Android camera photos link enhanced gallery output to private originals/edits; camera video keeps enhanced output. iOS private app captures and independent Photos copies do not use Android gallery links. Preserve lifecycle, orientation, ownership and platform gates. Mocks do not establish device acceptance.

## Source map under editor/

| Area | Sources |
| --- | --- |
| UI/save state | src/App.tsx, src/export-share.ts, src/file-save.ts |
| Colour/recipes | src/core/engine.ts, src/core/types.ts |
| Effects | src/core/enhancement.ts |
| Photo rendering | src/processor.worker.ts, src/core/neural-field.ts |
| Models | src/models.ts, src/core/model-contract.ts, public/models/manifest.json |
| Video | src/video.worker.ts, src/core/video-*.ts, src/hdr-import.ts |
| Camera | src/Camera.tsx, src/native-camera.ts, android/app/src/main/java/com/fishese/clearwater/, ios/App/App/ |
| Files/storage | src/storage.ts, src/custom-model-storage.ts, src/native.ts, src/platform/ |
| Guide/languages | src/About.tsx, src/locales/*.json, src/i18n.tsx |

## Contracts and working rules

- AI starts from the original; Balanced after AI is optional and photo-only. Strength/finishing changes reuse inference. Existing recipe version 1 and stable stored engine IDs remain compatible. New optional fields mean identity/off when absent.
- Preview and export must reuse the same fitted parameters and coordinates. Spatial export filters need halo rows. Preserve generation/request guards, stale-result disposal and PR #10's enhancement request tracking.
- Output-folder saves use the original stem; otherwise add -restore. App-managed writes number collisions. iOS web saving needs a fresh share-sheet tap after rendering; do not replace it with an asynchronous automatic share.
- Models can be cached selectively in the installed PWA; supplied models are bundled in APK/IPA. Never package personal fixtures or user-supplied weights.
- Never access D:\PrivateData or D:\Private. Use only the exact project-configured signing key when necessary; never enumerate D:\keystores or expose signing secrets. Signing properties remain ignored.
- Preserve untracked editor/.idea/ and editor/android/.idea/, existing stashes and unrelated user changes. Private sample/device/restricted-model context belongs only in gitignored LOCAL_NOTES.md or ignored output. Do not mention the research-only model in public documents.
- Use lower-cost capable agents for involved coding, with explicit file ownership; inspect existing agents first. Commit milestones and update the progress checklist. Do not rerun unrelated expensive builds.
- Use a codex/ branch for the next feature. This planning task does not authorize a stable release, version bump or main merge.

## Next action

Active branch: codex/adaptive-finish-plan. P1 checkpoints: 72295d2 baseline and 7557c4b bounded Vivid follow-up (216 local comparisons, zero engine/browser errors). User selected Natural and Vivid choices. P2 is c1744a5: optional validated saved fit, shared photo preview/export, inference reuse and stale-analysis guards. All 234 shared tests/build pass; legacy Effects/PNG parity, iOS web Save/Share, destinations and mocked iOS shell checks pass. P3 UI/wording is implemented in the working tree; next action is its finish-specific browser regression and commit. P4 still needs performance work, human visual feedback and physical-device acceptance: desktop synthetic extra-pass cost remains about 29% Natural / 77% Vivid against Balanced renderer-only time, exceeding the initial 10% target. Defaults, legacy recipes, video/live camera and native ownership remain intact. See IMPLEMENTATION_PLAN.md for exact results and remaining gates.

## New-session prompt

Continue ClearWater in D:\Projects\ClearWater. Inspect Git status and use the existing codex/adaptive-finish-plan branch (or incorporate its documentation commits into a new codex/ feature branch without overwriting local changes). Read HANDOFF.md, IMPLEMENTATION_PLAN.md and the current sections of MAINTENANCE.md. Inspect existing agents; preserve unrelated changes and implement the adaptive photo colour-and-tone finish from its first unchecked milestone. Use lower-cost capable agents for involved coding, and commit/update the checklist after each milestone so quota interruptions are resumable. Start with an isolated quality experiment on a small representative comparison set, not another model or a production default change. Preserve legacy/no-op recipes, model inference reuse and shared preview/export parameters. Protect blue water, highlights, noise and red-filter surface shots; avoid forcing the whole scene neutral or stacking automatic contrast stretches. Photos only initially: keep video, live camera, Android gallery links and iOS Photos behavior separate. Use reference/i18n-glossary.md for new wording without re-auditing existing translations. Preserve the main-branch Save/Share readiness fix, which is newer than native v1.0.8. Keep private samples/reference comparisons and restricted-model notes gitignored; copy no proprietary code and obey private-folder/signing restrictions. Do not merge, publish or bump versions without authorization. Record exact commits, checks, next action and remaining hardware acceptance before stopping.
