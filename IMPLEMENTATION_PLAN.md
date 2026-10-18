# ClearWater implementation plan

Prepared 12 October 2026. Updated 13 October after adding local Shallow-UWnet / FUnIE-GAN inference and a generic, user-loaded ONNX adapter. See editor/README.md for run instructions, verified behaviour and remaining milestones. AI currently transfers a 256×256 colour residual onto source-resolution pixels; full-resolution neural restoration remains future work.

## Active follow-up plan — 18 October 2026

Current task: fix SDR Display P3 MOV import on `codex/sdr-mov-import`. Regression coverage includes SDR HEVC with P3 primaries, full range and PCM audio. Replace gamut-based HDR classification with PQ/HLG/Dolby Vision, verify sRGB canvas conversion/full range, and harden Android HDR staging cleanup/container detection/errors. Lower-cost agents own shared video and Android staging respectively. Lens work remains paused.


Current priority (18 October, resumed after quota): lens work is explicitly PAUSED because the phone is off ADB. User reports the newly listed telephoto selections do not change field of view. Prior successful binding/live preview was not proof of optical switching; actual sensor routing remains unresolved. Preserve `codex/android-lens-discovery-fix` / PR #8 separately and do not include it in the next release. Resume with same-scene 1×/telephoto preview comparison, CameraX selector/stream physical-ID propagation and logical zoom-reset investigation. No completed corrective field-of-view test was recorded before quota interruption. The user's `.gitignore` stash is separate; do not reapply automatically.

Release review completed: user main `3c56b8a` iOS Chrome detection fix is preserved. PR #4 merged as `b2b4e1d` after lower-cost algorithm and browser/model reviews found no additional defect. 182 shared tests, production build, guided-strip tests, direct browser WASM inference and WebKit sharing checks passed. Android 1.0.7/code26 signed/debug packages and iOS 1.0.7/build5 package (run39116599851) passed integrity/model/version checks. Pages run39116597145 passed; live manifest exposes the 81,476-byte Five A+ model. v1.0.7 is published as latest; all five remote binary hashes matched before publication.

Review context: main `3c56b8a` contains the user's iOS Chrome detection fix. Review branch `codex/review-photo-upscale` merges PR #4 head `175d4aa` with main; validate photo-only guided residual upscaling and smaller Five A+ model, repair substantive issues, then merge and publish web plus signed Android/unsigned iOS packages. Lower-cost agents split algorithm review and web/model-contract review. Preserve user translations and unrelated IDE files.


Working branch: `codex/native-camera-followups`, starting after `5c82544` (About Other projects link; web deployment passed). v1.0.6 is now the published native release (source `7085d63`). This section is the resumable progress tracker; the older plan below is historical.

Commit each completed item separately, including its validation and remaining device checks. Use lower-cost capable agents for implementation. Preserve user `.gitignore`/IDE edits and corrected translations; consult `reference/i18n-glossary.md` for new wording. Android phone testing is authorized; preserve existing media and edits.

| Item | Plan and acceptance criteria | Status |
| --- | --- | --- |
| Urgent iPhone Safari | Integrate `3d3d403`, fix repeated persistence warnings after removal, and audit related save/preset paths. Preserve native-platform storage behavior and user files. | `3d3d403` merged in `a0f6d51`; storage sidecar committed `0ab462d`, Safari save/preset flow `64df1fb`; Edge IndexedDB migration/delete/edit/reload and share regressions pass. Physical Safari confirmation pending |
| Android folder import | Trace enumeration and lazy loading; show all supported entries with selection/next/previous, without eagerly decoding every original. Test multiple files, existing imports and read failures. Verify on Android where possible. | Committed `e2c3ad7`; lazy listing, return-to-collection, reuse/edit retention and missing-file recovery browser checks pass. Physical SAF picker verification pending |
| iOS camera launch | Reuse `clearwater://camera` cold/warm routing; add long-press home-screen Camera action and discoverable Shortcuts launch support. Confirm ordinary editor launch, single delivery and busy-state handling. Assess a widget separately; prefer a Shortcuts widget using the launch action if a native extension adds disproportionate signing/build complexity. | Committed `c94bd74` / `d6e86cc`; home quick actions and App Shortcuts (also usable from Shortcuts widget). iOS CI passed; physical iPhone launch checks pending |
| Per-device lenses | Discover selectable cameras from Android CameraX/Camera2 and iOS AVFoundation, keeping front/back and physical lenses distinct from digital zoom stops. Preserve ultra-wide support, honest magnification labels, rollback and orientation. Avoid a device database unless native detection cannot supply the needed information. | Committed `7b0d8e4`; Android optics tests/compile and iOS CI passed. Device lens selection checks pending; phone off ADB on resume |
| Cross-platform media reliability | Review import, load, export, save/share readiness across Android web, Safari web and both native apps; fix confirmed issues with regressions. | Committed `9f03c4e` bounded/stale video loads, `64df1fb` consistent export gating and decode-only preview, `e6659d1` complete iOS HTTP 200 video responses. 177 shared tests pass |
| Integrated verification | Shared tests/build, targeted regressions, Android debug/device checks, iOS CI compile/native tests as available. Record exact results and device-only limitations. | iOS run 39041096683 passed: 30 native tests and unsigned device package. Android debug rebuild passed at `04bb6e8`; ADB has no connected device. Main hotfix PR #5 merged as `370ddf5`; Pages run 39079668206 passed and live site responds HTTP 200. Unsigned iOS package run 39079696983 passed; 30 native tests passed earlier on unchanged native sources |

Urgent web reliability fixes are deployed. Remaining acceptance work is physical Android folder/lens checks, physical iPhone launch/lens/Safari checks, with both debug Android and unsigned iOS packages now built. Debug APK: `editor/android/app/build/outputs/apk/debug/app-debug.apk`. User subsequently authorized publication: v1.0.6 published with signed APKs and unsigned IPA, all binary hashes verified. Connected S24 Ultra lens investigation is next.

Resume from this table and latest commits. Inspect current diff and live agents before restarting to avoid duplicate work. Signing credentials stay in the configured ignored source; never inspect unrelated keys. Stable publication was subsequently authorized and completed on 18 October.

Recovery checkpoint: prior uncommitted native work was saved in `stash@{0}` while the urgent Safari change was authored on main. It has been restored onto this branch after merging main; the backup stash is intentionally retained. Do not apply it a second time. User `.gitignore` and IDE changes remain unrelated. Lower-model agents completed the reliability fixes after quota reset. The native iOS launch tests passed. Windows Playwright WebKit cannot seed a File into IndexedDB and the synthetic full-photo fixture does not become ready; WebKit share-wrapper checks pass, but do not claim physical Safari reproduction. The collection remains available and existing originals are preserved.

## Recommendation (historical)

Build a local-first photo editor with a shared TypeScript web interface and processing recipe, packaged for Android using Capacitor. Use native Kotlin adapters for Android import, incoming shares, durable file storage, export, HEIC decoding, and eventually video. The web version can retain the main editing functions as a PWA. Do not make cloud inference or accounts a prerequisite.

Start with an explainable, deterministic correction engine. Evaluate Shallow-UWnet and FUnIE-GAN as competing optional enhancement paths. Do not automatically chain a strong colour correction, FUnIE-GAN and Shallow-UWnet: each may duplicate the other's work and encounter inputs outside its training distribution.


## User workflow

1. Open photos from the system picker or share photos into the Android app. Multiple imports create an edit queue.
2. Display the photo immediately, analyse a reduced preview in a worker, then suggest a conservative automatic edit.
3. Offer a draggable before/after divider, hold-to-view-original, zoom/pan and an overall restoration-strength slider. The comparison divider controls visibility only; it does not change edit strength.
4. Provide optional scene inputs: environment Auto/Underwater/Surface; red filter Auto/Yes/No; water Auto/Blue/Green; depth Unknown or approximate metres; artificial lighting Unknown/No/Strobe or torch.
5. Manual adjustments: warmth, green-magenta tint, exposure, highlights, shadows, contrast, haze, vibrance, signed red correction, and a neutral-point eyedropper. Advanced controls can include separate RGB gains, sharpening and denoise.
6. Undo, redo, reset, save recipe, export a new photo, or share the export. Preserve the original.

Depth and water type influence the suggested settings; changing them explicitly recomputes the suggestion while preserving a recoverable previous edit. Manual controls are applied after the suggested base. Do not silently overwrite user edits when an asynchronous AI result arrives.

## Automatic processing pipeline

Import -> orientation/profile normalization -> analysis preview -> scene/cast assessment -> suggested base -> user adjustments -> output tone/gamut mapping -> preview/export.

### Decode and colour management

- Android: use platform image decoding where supported, verify HEIC on target devices, and preserve orientation and source metadata deliberately.
- Web: JPEG/PNG first, with HEIC decoding fallback validated against representative files. Browser HEIC decoding must not be assumed. Evaluate a lazy-loaded WASM decoder and its licensing, file size, memory use and colour handling.
- Normalize to an explicit SDR sRGB working/output contract for the MVP, converting embedded profiles and tone-mapping HDR sources where needed. Do not merely relabel Display-P3 or HDR pixels as sRGB.
- Analyse a roughly 256-512 px preview. Render an approximately 1-2 MP interactive preview. Export from the original, not from the analysis image or neural-network thumbnail.
- A 24 MP RGBA8 buffer uses about 98 MB before extra copies, GPU textures or float tensors. Bound memory use; investigate region decoding and tiled export. Avoid bridging full images as base64 strings.

### Analysis

Compute channel means and robust percentiles, luminance distribution, channel clipping, chroma distribution, spatial tile statistics and confidence. Exclude very dark, clipped and strongly saturated samples from neutral estimation. Weight plausible neutral regions without assuming the ocean or a dominant reef colour is grey. Keep exposure analysis separate from white balance.

The proposed every-second-pixel approach is a reasonable fast baseline after downscaling. Treat red <60 as a benchmark heuristic, not a universal decision rule: a dark image can have low red without needing red synthesis. Use relative red deficiency, exposure, spatial agreement and available user hints together.

Use smooth strength curves rather than abrupt branches around thresholds. Start conservative when the image has few credible neutral pixels. Provide a manual override.

### Colour balance and red correction

- Keep the user's proposed gain ranges as a baseline experiment, not immutable production limits.
- Separate chromatic balance from brightness. Driving all channel averages to 128 unnecessarily changes exposure and may neutralize intentionally blue water or a sunset.
- For filter/surface mode, estimate both warmth and green-magenta tint; permit reduction of red and/or blue relative to green. Use a distinct safe parameter envelope from deep-water restoration.
- For severely depleted red, distinguish amplification of existing signal from synthesis using other channels. Synthesis may improve appearance, but cannot identify original colours from missing information.
- Gate synthesis using scene confidence and tonal/spatial masks. Protect highlights and naturally saturated objects, and limit amplification of noise in shadows.
- A matrix can represent global channel gains/cross-channel mixing. It cannot express nonlinear tone curves, local haze correction, masks or neural-model output. Store a versioned recipe, not just a suggested matrix.
- Use an explicit colour-space contract: analyse display-encoded values if thresholds are defined there; apply exposure and appropriate blending in linear light; match neural preprocessing to the model's training convention.

Suggested base matrix interpolation: M(strength) = I + strength * (M_auto - I). This only applies to the matrix component. For the full base output B, blend with the original in a defined colour space, then apply manual adjustments. Strength zero disables the automatic base; Reset clears manual adjustments too.

### Haze and exposure

Use conservative highlight/shadow tone curves and modest edge-aware local contrast. Treat haze estimation as uncertain in water: bright backscatter, light shafts, particles and genuine low-detail water can mislead generic dehazing. Make haze independently adjustable. Do not claim to reconstruct detail lost to clipping or opaque haze.

## AI evaluation and integration

Evaluate on originals first, using each repository's expected channel order, scaling, size and normalization. Compare classical only, Shallow only, FUnIE only, classical then each model, and each model then light manual finishing. Keep both original and corrected inputs available during experiments. Ship a chain only if comparisons justify it.

| Resource | Proposed role |
| --- | --- |
| Shallow-UWnet | First lightweight model candidate. Repository has MIT code and a pretrained checkpoint link. Its supplied test script defaults to square 256x256 resizing, so full-resolution/aspect-ratio behaviour needs validation. |
| FUnIE-GAN | Alternative enhancement candidate. MIT repository; TensorFlow/Keras is the official implementation for reproducing paper results, while the PyTorch sample is convenient for export experiments. Published embedded GPU speeds are not Android performance guarantees. |
| Sea-Thru-Impl | Research comparison, outside the MVP. Requires a per-pixel depth map; diver depth is not camera-to-scene distance. Monocular estimates do not automatically supply calibrated underwater range. |
| UWEnhancement | Research benchmark harness/model zoo, including UIEC2-Net, UWCNN and WaterNet. Not a ready-made mobile engine. Verify each model's preprocessing and artifact terms separately. |
| EDGE-tronics Underwater-Processing | Algorithm reference for white-world balance, contrast, dehazing and fusion. Older C++/OpenCV code; README declares GPLv3. Prefer independently implementing selected published techniques unless adopting its distribution obligations intentionally. |
| TechRxiv ADCCA-GAN paper | Saved PDF reviewed locally. Add as a third optional model candidate: small reported parameter footprint and promising UIEB results, but 256x256 Tesla T4 benchmarks do not establish Android/full-resolution performance. Official code and weights remain unverified. See analysis/ADCCA_GAN_REVIEW.md. |

Before bundling a model: verify exact checkpoint provenance and redistribution terms, export compatibility, numerical parity, supported operators, package size, peak memory and real-device speed. Code licenses alone do not establish the terms of every linked weight/dataset artifact.

Prototype ONNX export and ONNX Runtime Web using WebGPU where available and WASM fallback. Keep models behind a lazy-loaded adapter. Test FP32 first; evaluate FP16/quantization against colour quality before adopting. Browser inference availability does not imply acceptable latency on every phone.

Do not resize a 256x256 neural output to 24 MP and call it full-quality restoration. Compare higher-resolution inference, overlapping tiles with context/feathering, and an edge-aware low-resolution correction field applied to full-resolution pixels. Tiling can produce seams or inconsistent colours; correction fields preserve source detail but cannot reproduce every learned spatial effect. Select based on measured results.

## Architecture

- apps/editor: React + TypeScript + Vite, responsive editor, PWA manifest and service worker.
- packages/core: versioned recipes, analysis, suggestion logic, deterministic CPU reference implementation and model adapter contracts.
- packages/render: WebGL2 preview renderer; capability checks and CPU fallback. Separate analysis, preview and export resolutions.
- android/: Capacitor host and Kotlin adapters for file access, incoming intents, HEIC/profile handling, MediaStore export and later Media3 video processing.
- tools/benchmarks: local Python model comparison harness and source-resolution visual crops.
- Local persistence: IndexedDB for web recipes/thumbnails; app-private files for durable Android imports and exports. Cache models separately, show download progress, and handle unavailable/offline models without breaking classical editing.
- No backend required for initial editing. Treat imported personal photos as local data; do not include samples in public builds or commits by default.

Android integration must handle ACTION_SEND and ACTION_SEND_MULTIPLE with image MIME types, content:// URIs, temporary read grants, cold starts, and new intents while running. Copy selected/shared input into app-private storage when needed for durable edits; do not assume every incoming URI supports persistable permission. Use the system Photo Picker rather than requesting unrestricted gallery access.

Installed PWAs can receive files through Web Share Target on supported browsers. Use a multipart POST share target handled locally by a service worker, persist the file, then route to the editor. This is a useful web enhancement; native Android intents provide the main Android share route. Feature-detect web import/export/share APIs.

## Delivery phases and acceptance criteria

### 0. Image-quality prototype

Implement the user's exact heuristic as a named baseline, then a robust balanced variant. Build local comparison sheets and 100% crops for a local regression set. Add explicit filter mode, tint control and separate highlight/haze processing. Record human preference and artifacts. Goal: agree on desirable output before committing to a model or UI framework details.

### 1. Photo MVP

Import JPEG/PNG/HEIC on Android, and JPEG/PNG plus tested HEIC fallback on web. Deliver one-tap classical correction, before/after divider, strength/manual controls, undo/reset and full-resolution SDR export. Support Android gallery selection and share-in. Verify offline editing after assets are cached. No AI requirement for this milestone.

### 2. Optional AI enhancement

Benchmark both candidate networks and integrate the best measured option. Include independent AI strength, cancellation/progress, capability fallback and source-resolution export validation. Keep the classical path available. Do not select a default based solely on UIQM/UCIQE scores; inspect naturalness, water colour, faces, reef texture, noise and clipping. PSNR/SSIM require appropriate paired reference images and cannot establish restoration accuracy on these unpaired samples.

### 3. Batch workflow and polish

Edit queue, copy/paste recipe, saved presets, re-edit persistence, export metadata choices, crash recovery and device performance tuning. Reanalyse each image when applying a preset to changing lighting conditions.

### 4. Video

Begin on Android with Media3 Transformer and reusable colour shaders. Start with SDR MP4/H.264 and preserved audio/timestamps. Analyse sparse frames, detect scene cuts and smooth correction within each shot to prevent flicker. Avoid independent aggressive one-click decisions on every frame. Add trim, preview, cancellable export and storage/thermal handling. Add temporal AI only after stable classical video. Keep web photo parity while evaluating web video export separately; it need not block Android video.

Validation: supported orientations and dimensions; no original modification; red-filter and magenta cases; severe red loss; green water; local highlights; neutral/no-op scenes; slider reversibility; preview/export agreement; portrait and landscape model inputs; full-resolution detail/seams; app cold/warm share entry; cloud-backed picker URIs; cancellation; offline mode; low storage and memory; representative midrange Android devices. Establish latency targets through profiling rather than promising model speed now.

## Sources reviewed

- https://diverout.com/en/underwater-color-restoration (product behaviour claims, not an algorithm specification)
- https://github.com/mkartik/Shallow-UWnet
- https://github.com/mkartik/Shallow-UWnet/blob/main/test.py
- https://github.com/xahidbuffon/FUnIE-GAN
- https://github.com/xahidbuffon/FUnIE-GAN/tree/master/PyTorch
- https://github.com/Teragion/Sea-Thru-Impl
- https://github.com/BIGWangYuDong/UWEnhancement
- https://github.com/EDGE-tronics/Underwater-Processing
- https://capacitorjs.com/docs
- https://developer.android.com/training/data-storage/shared/photo-picker
- https://developer.android.com/training/sharing/receive
- https://developer.chrome.com/docs/capabilities/web-apis/web-share-target
- https://onnxruntime.ai/docs/tutorials/web/
- https://developer.android.com/media/media3/transformer

## Saved-paper review update

The user supplied the TechRxiv PDF locally after the initial review. All seven pages have now been read, including visual comparisons and tables. ADCCA-GAN is added as an optional evaluation candidate, pending reproducible code/weights and licensing. The photo MVP, filter/surface handling, manual controls and separate-model evaluation remain the recommended first steps. Detailed findings and reported metrics are in analysis/ADCCA_GAN_REVIEW.md. No neural inference has been run.


Resume checkpoint (18 October): main Safari hotfix is incorporated; native feature commits are pushed to `codex/native-camera-followups`. Safari fixes are still uncommitted. WebKit 2370 is installed, but the Windows runner rejects the first File/Blob IndexedDB write before application code; record that limitation separately from Chromium persistence tests. No native follow-up is published. Phone is currently not connected; continue non-device work.
