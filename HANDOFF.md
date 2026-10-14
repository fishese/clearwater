# Handoff

## Current product

ClearWater is a local-first React/TypeScript/Vite editor with web/PWA and Capacitor Android builds. No server-side image processing or account system. Interface and guide support English, Hong Kong Traditional Chinese (standard written Chinese, not Cantonese) and Japanese. A compact EN / 中 / 日 selector in Settings switches language without restarting processing or changing edits. Browser language supplies the first default; a saved choice overrides it.

Photos: JPEG, PNG, HEIC/HEIF and compatible Android DNG / Apple ProRAW; JPEG/PNG export with supported EXIF/GPS retention enabled by default. RAW develops into 8-bit sRGB. JPEG-XL DNG and HDR photo tone mapping are unsupported.

Normal photos at or below 45 MP and 60 MiB have no resource prompt or automatic reduction. Larger photos use small previews and Auto / Full / Reduced options. Auto targets 24 MP on phones/low-memory devices, 45 MP with unknown memory, or 80 MP on desktops reporting at least 8 GB. RAW half-size development can yield 12 MP from 48 MP. Full attempts original dimensions; Reduced caps at 12 MP. Safety ceilings: 512 MiB, 200 MP, 32,768 pixels per side. These do not guarantee available memory. Reduced retry retains edits.

Video: SDR MP4/MOV, device-supported H.264/HEVC decoding. Input up to 10 minutes / 512 MiB / 34 MP per frame; H.264 MP4 output up to 1080p30 / 256 MiB with supported primary audio. Android 10+ devices with compatible decoding/OpenGL can tone-map supported HDR/Dolby Vision clips to an SDR working copy using Media3; web still requires an SDR copy. Both comparison sides and output are SDR, while the imported original remains unchanged. Scrubbing supported; playback/trimming not implemented. Classical engines use one recipe. AI samples colour every 2/5/10 seconds or uses a fixed reference; this transfers global colour, not temporal detail or dehazing.

## Source map (under editor/)

| Area | Files |
| --- | --- |
| UI and state | src/App.tsx, src/styles.css |
| User guide and attribution | src/About.tsx |
| Languages | src/i18n.tsx, src/i18n-core.ts, src/locales/*.json |
| Correction / recipes | src/core/engine.ts, src/core/types.ts |
| Optional photo contrast/detail finishing | src/core/enhancement.ts |
| Photo rendering / export | src/processor.worker.ts |
| Headers / resolution / DNG | src/photo-header.ts, src/photo-decode.ts, src/core/photo-size.ts, src/raw.worker.ts |
| EXIF/GPS | src/photo-metadata.ts |
| Neural models | src/models.ts, src/core/model-contract.ts, src/core/neural-field.ts |
| Video | src/video.worker.ts, src/core/video-*.ts, src/hdr-import.ts |
| Persistence / files | src/storage.ts, src/custom-model-storage.ts, src/file-save.ts, src/native.ts |
| Android bridge | android/app/src/main/java/com/fishese/clearwater/ |
| PWA lifecycle | scripts/sw.template.js, scripts/build-sw.mjs, src/update.ts, public/update.html |

## Contracts to preserve

- Engines start from the original; do not stack Balanced underneath AI. Photo AI predicts at 256×256 and transfers a residual onto source detail; preview/export share coordinates and finishing.
- Recipe keys are stable, including historical `wave` for the generic custom slot. Translate labels, never stored identifiers or asset filenames.
- Output folder selected: original stem. Otherwise add `-restore`. App-managed saves add numbered siblings; browser downloads control their own collisions.
- IndexedDB retains imported files/latest recipes. A validated custom model and its range settings are saved locally (browser IndexedDB or Android app storage), checked on reuse, and can be removed. Missing/unreadable copies require reselection. Undo history, folder handles and resolution choices are session-only. Browser storage can be evicted.
- Preserve generation/request guards and buffer cleanup. RAW uses disposable workers; large export buffers are released after saving.
- Web models cache after first use; APK bundles supplied Shallow-UWnet, FUnIE-GAN and WWE-UIE models. WWE-UIE uses the published UIEB checkpoint, RGB unit ranges and a fixed 256×256 ONNX export with numerical parity checks. Never package locally supplied weights or personal fixtures.

Effects is an optional photo finishing pass after any engine: Auto enhance plus Brightness, Auto contrast, Local contrast and Sharpness. Existing edits remain unchanged until enabled. Settings use the optional version-1 recipe enhancement field; omitted brightness is zero for legacy recipes. Brightness adjusts midtones in the existing luminance pass. Photo export needs halo rows for spatial filters; video ignores this photo-only field. Auto restore and manual reset clear it. Auto enhance uses an outlined sparkle action before application and a filled check after a nonzero suggestion; optional `autoApplied` recipe metadata tracks this visual state and is cleared by manual Effects edits.

Narrow screens use Correction / Enhancement / Export tabs with one settings group visible at a time; the wide layout keeps collapsible groups and combined Light & clarity controls. Tab changes only change control visibility and do not recreate image/video workers. Analysis remains visible below Restoration strength. Unknown depth is distinct from zero in Balanced restoration and is selected with Unsure of depth beneath the slider. Fit leaves a 6px inset per edge where the image aspect ratio allows. Expanded images align near the top of the stage instead of vertically centring in spare space. Expanded view resets to a measured Fit, retains corner zoom controls, and supports pinch zoom and drag-pan with comparison off. Expanded picker sampling waits for a stationary single-pointer release; multi-pointer gestures never sample white balance.

Clear collection confirms removal of thumbnails, app copies and saved edits; external originals and exports, custom models and preferences remain intact. Its button is highlighted at 100 imported items. Library writes are ordered; pending service-worker shares are kept through clearing and promoted afterward.

Android HDR conversion stages bounded chunks to a private cache, limits input to the normal video ceilings, and creates a working copy up to 1080p30 / 256 MiB. Only one converted copy is held in the session. Cancellation, generation guards and orphan cleanup must prevent stale loads and accumulated temporary data.

## Gaps and priorities

Validate large RAW memory, long-video thermals/audio, cloud-provider folders and cold/warm sharing on phones. Desktop checks are not mobile performance guarantees. FUnIE-GAN quality varies; do not assume enhancement. Playback/trimming, HDR-preserving export, full neural restoration and native GPU inference remain future work.

User prefers compact collapsible controls and minimal flavour text. Do not add prompts to routine files. Keep manual editing, one-click restoration and comparison. Update About when behaviour changes.

See [Maintenance](MAINTENANCE.md) for commands. [Editor reference](editor/README.md) covers details. IMPLEMENTATION_PLAN.md is historical design context. Private fixture/model notes belong only in the ignored local notes.

Android system Back uses the local ClearWaterBack plugin: dismiss safe dialogs and picker, return About to editor, collapse expanded controls/view, return narrow tabs to Correction/engine, and leave folder browsing before exit. Active jobs remain open. At the editor root, two Back presses within two seconds are required to exit; navigation or new work resets the confirmation. About close removes its hash without adding another history entry.

Photo pipeline: new photos use `makePhotoRecipe`, selecting WWE-UIE with `recipe.balancedAfterAI: {strength: .3}`. Existing stored recipes remain unchanged; new videos retain the classical Balanced default. Reset all follows the respective photo/video default. The follow-up can be disabled. On an AI engine, a 256px reference of the current AI-strength blend is analysed before manual edits; a cached Balanced suggestion uses dive hints. Sixteen recent suggestions are retained per source. The same suggestion is reused for all full-resolution export strips. Gains/red reconstruction are fused into the existing display-encoded RGB pass; manual controls and Effects still run once. Changing follow-up strength or manual edits does not refit or rerun inference. Switching to a classical engine clears the field. Video rejects a photo-only recipe containing the field and presents a localized explanation. Tests cover alpha, older/malformed recipes, inference reuse, and strip consistency. A desktop Node benchmark at 786,432 pixels measured about 169ms without and 209ms with follow-up; this is renderer CPU only, not Android end-to-end timing. This option can overcorrect models that already balance white; compare before/after, starting at 30%.

Mobile controls use slightly larger text (main tabs/selects 13px, most labels 12px, supporting text 11px) with compact radio text at the narrowest widths. Expand sits beside the bottom zoom controls in normal and expanded views. Resolution and megapixels appear together in a non-interactive overlay at the normal preview’s bottom edge; the mobile footer is one unwrapped control row. The normal mobile preview is 36dvh (210–380px), while expanded Fit remains top-aligned and uses the full stage. Desktop Effects headings have an inset inside their outline. `mobile-readability-check.mjs` checks supported languages at 320–650px and the desktop Effects inset at 901–1920px.

Narrow tab navigation preserves scroll position by retaining the tallest settings region seen for the current photo and viewport width. Keyboard focus uses preventScroll, and expanded adjustments preserve their internal scroll position. This may leave unused settings space after switching to a shorter panel; it prevents the page height from collapsing beneath the reader.

`editor/src/use-stable-tab-scroll.ts` owns the narrow tab height reservation and scroll restoration; layout is remeasured when settings content grows, and reservations reset for a new photo, viewport width or expanded mode. The layered controls browser check covers main/subtab switching, document-bottom scroll and expanded internal scroll.

## Camera experiment (codex/camera-prototype)

The camera branch adds `src/Camera.tsx`, `core/camera-capture.ts` and `core/camera-preview.ts`. Browser/Android WebView getUserMedia supplies a rear-camera stream (ideal 720p, maximum 1080p30). A WebGL Balanced preview uses a 64x48 analysis sample every 500 ms, smoothed between samples; drawing is capped at 30 fps. No neural inference runs during capture. JPEG photos and hardware-encoded MP4 clips retain raw capture pixels plus a Balanced recipe in the normal library. Export applies correction once. Video freezes the recipe at recording start. Microphone is optional and off initially. Recording is capped at 60 seconds / 64 MiB; unsupported MP4 disables video only. These are stream captures, without full-sensor still quality, RAW, HDR or GPS/EXIF.

The manifest declares optional camera hardware and camera/audio permissions; Capacitor's existing WebChromeClient handles requests. Close/Back stops tracks, backgrounding stops the camera and completes a recording, and returning reacquires the camera. Keep this experimental branch separate from stable web/main until real-device quality and lifecycle testing are complete.

Camera follow-up: captures stay in camera mode until Close/Back. The app saves originals/recipes to IndexedDB without activating the editor or running AI between shots. Android additionally writes enhanced JPEGs and original video streams through `saveAndroidCameraCapture` and native `createCapture`: Android 10+ uses pending MediaStore rows in Pictures/ClearWater or Movies/ClearWater, publishing after completion; Android 7-9 uses persisted app-specific storage. These phone copies survive collection clearing (legacy app-specific files do not survive uninstall). Saved counters acknowledge completed writes; partial failures identify the remaining saved copy. The white balance picker samples a 9x9 raw patch, evaluates the current correction, and retains manual neutral gains while locking scene analysis until reset/flip/restart. Capture/export retains the same recipe.

## Settings and installed-PWA offline models

Settings opens from the gear near the brand (also in About), returns to its logical parent with Back/Escape, and holds language plus web offline preferences. `src/offline-models.ts` stores preferences in `clearwater-offline-settings`; installed/Home Screen detection enables automatic downloads by default, selecting WWE-UIE and Shallow-UWnet. FUnIE-GAN is unchecked initially. Selected models plus shared WASM dependencies total about 19 MB by default, 47 MB with all models. Android bundles all supplied models and skips the web download controls. Custom-model files and per-photo engine choices retain their existing persistence rules.

`build-sw.mjs` generates optional-asset SHA-256 digests. The worker stores verified ONNX/WASM responses in a stable cache scoped to the app base path, migrates matching legacy cached files, reuses unchanged assets after UI updates and prunes outdated hashes. Required app install remains small and independent. Downloads run sequentially, preserve finished files on interruption and retry missing files on foreground/connectivity events; a partial file is restarted. Deselecting removes that model cache only; on-demand editor use can fetch/cache it again. Automatic download can be disabled; manual download and readiness remain in Settings. Custom weights, user photos and third-party files are excluded from this model cache.

Web Settings offers the signed stable APK at `https://github.com/fishese/clearwater/releases/latest/download/clearwater-release.apk`. Every stable release must attach this constant-name copy and its SHA-256 sidecar, in addition to any versioned APK, so the link follows GitHub's latest release. This points to stable releases, not experimental debug builds.

## Linked camera captures and collection cleanup

New Android captures use `StoredPhoto.cameraCapture` to link their gallery URI/name to a private original. JPEG gallery images receive the selected Balanced/WB correction at capture; videos remain original until Save to gallery renders them. The main save action updates the same owned gallery URI; Save as still exports a copy, and Export original copies untouched camera bytes. Existing captures lack recorded gallery URIs and remain unlinked.

Library IndexedDB is version 2: `photos` stores collection metadata, `camera-originals` stores each original once with recipe/capture metadata. Re-saves keep original bytes. Clear collection removes visible entries, retaining these camera originals/edits; Settings > Restore camera collection recovers them without another gallery file. Explicit camera deletion confirms removal of owned gallery + private original; imported entries keep collection-only removal. Native successful writes persist ownership. Replacement stages data and keeps a rollback copy before updating that same URI. App uninstall/data clearing removes private originals; use Export original for backup.

Known camera and Android folder URIs are checked in batches on load/resume/idle using metadata only. Confirmed missing sources remove library/recipe/archive data. Android 11+ queries include trash rows: trashed items hide from the collection but retain recovery data. Unavailable providers/permission loss keep data. Generic browser/file-picker imports provide no usable source URI. `removedPhotoIds` blocks delayed recipe writes from resurrecting removed items. `newestPhotos` orders collection merges/reloads newest-first. Preview/toolbars/footer suppress user selection and touch callouts; hold-original resets on cancel/blur.
