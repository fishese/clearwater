# Handoff

Updated 19 October 2026. Read this first: it supersedes historical status paragraphs in other documents. Operating procedures and release history are in MAINTENANCE.md. The active feature checklist is in IMPLEMENTATION_PLAN.md. Older handoff revisions remain in Git history.

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

Planning branch: codex/adaptive-finish-plan. Research and this documentation task are complete; feature code has not started. When the user starts the implementation session, continue from the first unchecked milestone in IMPLEMENTATION_PLAN.md: an isolated adaptive photo colour-and-tone experiment. Preserve production defaults, video/live camera behavior and existing recipes. Unchecked planned milestones are not a quota-interrupted coding task to resume automatically in this chat.

## New-session prompt

Continue ClearWater in D:\Projects\ClearWater. Inspect Git status and use the existing codex/adaptive-finish-plan branch (or incorporate its documentation commits into a new codex/ feature branch without overwriting local changes). Read HANDOFF.md, IMPLEMENTATION_PLAN.md and the current sections of MAINTENANCE.md. Inspect existing agents; preserve unrelated changes and implement the adaptive photo colour-and-tone finish from its first unchecked milestone. Use lower-cost capable agents for involved coding, and commit/update the checklist after each milestone so quota interruptions are resumable. Start with an isolated quality experiment on a small representative comparison set, not another model or a production default change. Preserve legacy/no-op recipes, model inference reuse and shared preview/export parameters. Protect blue water, highlights, noise and red-filter surface shots; avoid forcing the whole scene neutral or stacking automatic contrast stretches. Photos only initially: keep video, live camera, Android gallery links and iOS Photos behavior separate. Use reference/i18n-glossary.md for new wording without re-auditing existing translations. Preserve the main-branch Save/Share readiness fix, which is newer than native v1.0.8. Keep private samples/reference comparisons and restricted-model notes gitignored; copy no proprietary code and obey private-folder/signing restrictions. Do not merge, publish or bump versions without authorization. Record exact commits, checks, next action and remaining hardware acceptance before stopping.
