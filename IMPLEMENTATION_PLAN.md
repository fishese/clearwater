# ClearWater implementation plan

Prepared 12 October 2026. Updated after implementation of the first local classical photo editor in editor/. See editor/README.md for run instructions, verified behaviour and remaining milestones. No neural model benchmark has been implemented.

## Recommendation

Build a local-first photo editor with a shared TypeScript web interface and processing recipe, packaged for Android using Capacitor. Use native Kotlin adapters for Android import, incoming shares, durable file storage, export, HEIC decoding, and eventually video. The web version can retain the main editing functions as a PWA. Do not make cloud inference or accounts a prerequisite.

Start with an explainable, deterministic correction engine. Evaluate Shallow-UWnet and FUnIE-GAN as competing optional enhancement paths. Do not automatically chain a strong colour correction, FUnIE-GAN and Shallow-UWnet: each may duplicate the other's work and encounter inputs outside its training distribution.

## Sample inspection

The project currently contains a Sample photos folder, with seven HEIC files and two JPEGs, and no existing app source at the project root. Images are approximately 12 or 24 megapixels. All nine decoded successfully using Pillow and pillow-heif. Originals were not modified or uploaded.

Analysis output: sample-contact-sheet.jpg, sample-statistics.json and inspect_samples.py in analysis/. HEIC analysis dependencies are isolated in .analysis-deps/; these are development tools, not proposed app dependencies.

Means below are rounded 8-bit RGB values from orientation-corrected, downscaled inspection images sampled every second pixel. They are diagnostic observations, not calibrated colour measurements or exact full-resolution clipping statistics. Embedded colour-profile conversion was not explicitly performed in this inspection; production processing must do it.

| Sample | Mean R/G/B | Observation and implementation implication |
| --- | --- | --- |
| IMG_6085-blue.HEIC | 2 / 136 / 178 | Almost no red signal. A 2x gain only produces an average near 4. Conservative red reconstruction and a confidence limit are needed. |
| IMG_6459-red filter.HEIC | 160 / 49 / 52 | Surface scene with a strong red cast. Proposed lower green/blue gain limits prevent adequate balancing; preserve genuine sunset warmth rather than force a neutral sunset. |
| IMG_6729-blue and hazy.HEIC | 34 / 101 / 149 | Blue scene with strong distance-dependent haze. Evaluate modest local contrast separately from white balance. |
| IMG_6730-blue.HEIC | 11 / 81 / 178 | Strong blue cast with dark divers and naturally blue open water. Avoid treating all water as a neutral reference. |
| IMG_6788-red filter.HEIC | 155 / 73 / 166 | Magenta cast, especially on paper and skin. A red-only removal operation misses the weak green channel. Good neutral-point test image. |
| IMG_6832-blue green and hazy.HEIC | 67 / 123 / 130 | Cyan-green cast with backscatter and a bright surface region. Haze handling must protect highlights. |
| IMG_7165-hazy.HEIC | 119 / 142 / 144 | Relatively modest colour cast but low contrast/veiling haze. Aggressive red restoration would address the wrong problem. |
| IMG_7386-green tint.JPG | 7 / 138 / 117 | Severe red deficiency and green cast. Test reef texture, noise amplification and green-water handling. |
| IMG_E7433-too bright.JPG | 118 / 106 / 94 | Local strong illumination on reef/subject, with a darker background. Overall mean does not diagnose local overexposure. Use highlight-aware analysis. |

Nine samples are a useful regression set, not enough to validate a general automatic mode. Add unfiltered surface photos, naturally red/orange subjects, strobes, dark/noisy deep shots and already-corrected images. Record approximate depth, filter and lighting when known. Keep unknown values genuinely unknown.

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
- Web: JPEG/PNG first, with HEIC decoding fallback validated against these actual samples. Browser HEIC decoding must not be assumed. Evaluate a lazy-loaded WASM decoder and its licensing, file size, memory use and colour handling.
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

Implement the user's exact heuristic as a named baseline, then a robust balanced variant. Build local comparison sheets and 100% crops for the nine samples. Add explicit filter mode, tint control and separate highlight/haze processing. Record human preference and artifacts. Goal: agree on desirable output before committing to a model or UI framework details.

### 1. Photo MVP

Import JPEG/PNG/HEIC on Android, and JPEG/PNG plus tested HEIC fallback on web. Deliver one-tap classical correction, before/after divider, strength/manual controls, undo/reset and full-resolution SDR export. Support Android gallery selection and share-in. Verify offline editing after assets are cached. No AI requirement for this milestone.

### 2. Optional AI enhancement

Benchmark both candidate networks and integrate the best measured option. Include independent AI strength, cancellation/progress, capability fallback and source-resolution export validation. Keep the classical path available. Do not select a default based solely on UIQM/UCIQE scores; inspect naturalness, water colour, faces, reef texture, noise and clipping. PSNR/SSIM require appropriate paired reference images and cannot establish restoration accuracy on these unpaired samples.

### 3. Batch workflow and polish

Edit queue, copy/paste recipe, saved presets, re-edit persistence, export metadata choices, crash recovery and device performance tuning. Reanalyse each image when applying a preset to changing lighting conditions.

### 4. Video

Begin on Android with Media3 Transformer and reusable colour shaders. Start with SDR MP4/H.264 and preserved audio/timestamps. Analyse sparse frames, detect scene cuts and smooth correction within each shot to prevent flicker. Avoid independent aggressive one-click decisions on every frame. Add trim, preview, cancellable export and storage/thermal handling. Add temporal AI only after stable classical video. Keep web photo parity while evaluating web video export separately; it need not block Android video.

Validation: all sample orientations and dimensions; no original modification; red-filter and magenta cases; severe red loss; green water; local highlights; neutral/no-op scenes; slider reversibility; preview/export agreement; portrait and landscape model inputs; full-resolution detail/seams; app cold/warm share entry; cloud-backed picker URIs; cancellation; offline mode; low storage and memory; representative midrange Android devices. Establish latency targets through profiling rather than promising model speed now.

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

