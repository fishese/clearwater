# Handoff

## Current product

ClearWater is a local-first React/TypeScript/Vite editor with web/PWA and Capacitor Android builds. No server-side image processing or account system. Interface and guide support English, Hong Kong Traditional Chinese (standard written Chinese, not Cantonese) and Japanese. A compact EN / 中 / 日 selector in Settings switches language without restarting processing or changing edits. Browser language supplies the first default; a saved choice overrides it.

Photos: JPEG, PNG, HEIC/HEIF and compatible Android DNG / Apple ProRAW; JPEG/PNG export with supported EXIF/GPS retention enabled by default. RAW develops into 8-bit sRGB. JPEG-XL DNG and HDR photo tone mapping are unsupported.

Normal photos at or below 45 MP and 60 MiB have no resource prompt or automatic reduction. Larger photos use small previews and Auto / Full / Reduced options. Auto targets 24 MP on phones/low-memory devices, 45 MP with unknown memory, or 80 MP on desktops reporting at least 8 GB. RAW half-size development can yield 12 MP from 48 MP. Full attempts original dimensions; Reduced caps at 12 MP. Safety ceilings: 512 MiB, 200 MP, 32,768 pixels per side. These do not guarantee available memory. Reduced retry retains edits.

Video: SDR MP4/MOV, device-supported H.264/HEVC decoding. Input up to 10 minutes / 512 MiB / 34 MP per frame; H.264 MP4 output defaults to Compact (up to 1080p30 / 256 MiB); optional Source preserves display dimensions/frame timing where encoding is supported, targets up to 36 Mbps and caps output at 512 MiB. Supported primary audio is retained. Android 10+ devices with compatible decoding/OpenGL can tone-map supported HDR/Dolby Vision clips to an SDR working copy using Media3; web still requires an SDR copy. Both comparison sides and output are SDR, while the imported original remains unchanged. Scrubbing and silent corrected-preview playback are supported; trimming is not implemented. Classical engines use one recipe. AI samples colour every 2/5/10 seconds or uses a fixed reference; this transfers global colour, not temporal detail or dehazing.

## Source map (under editor/)

| Area | Files |
| --- | --- |
| UI and state | src/App.tsx, src/styles.css |
| User guide and attribution | src/About.tsx |
| Custom ONNX specification | public/models/CUSTOM_MODELS.md (source asset; never edit only dist/) |
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
- Web models cache after first use; APK bundles WWE-UIE, Five A+ and Shallow-UWnet. All three are fixed 256×256 RGB NCHW float32 models with unit `[0,1]` ranges. Quantised weights use the per-file parity tolerance in `editor/public/models/manifest.json` (no longer `1e-4`). FUnIE-GAN is not bundled; a saved `funie` recipe opens on WWE-UIE. Never package locally supplied weights or personal fixtures.

Effects is an optional photo finishing pass after any engine: Auto enhance plus Brightness, Auto contrast, Local contrast and Sharpness. Existing edits remain unchanged until enabled. Settings use the optional version-1 recipe enhancement field; omitted brightness is zero for legacy recipes. Brightness adjusts midtones in the existing luminance pass. Photo export needs halo rows for spatial filters; video ignores this photo-only field. Auto restore and manual reset clear it. Auto enhance uses an outlined sparkle action before application and a filled check after a nonzero suggestion; optional `autoApplied` recipe metadata tracks this visual state and is cleared by manual Effects edits.

Narrow screens use Correction / Enhancement / Export tabs with one settings group visible at a time; the wide layout keeps collapsible groups and combined Light & clarity controls. Tab changes only change control visibility and do not recreate image/video workers. Analysis remains visible below Restoration strength. Unknown depth is distinct from zero in Balanced restoration and is selected with Unsure of depth beneath the slider. Fit leaves a small 2px inset per edge where the image aspect ratio allows. Expanded images align near the top of the stage instead of vertically centring in spare space. Expanded view resets to measured Fit and retains corner zoom controls. Zoomed previews support mouse/touch pan in both views, including comparison mode outside the handle-height comparison band. Expanded picker sampling waits for a stationary single-pointer release; multi-pointer gestures never sample white balance.

Clear collection confirms removal of thumbnails, app copies and saved edits; external originals and exports, custom models and preferences remain intact. Its button is highlighted at 100 imported items. Library writes are ordered; pending service-worker shares are kept through clearing and promoted afterward.

Android HDR conversion stages bounded chunks to a private cache, limits input to the normal video ceilings, and creates a working copy up to 1080p30 / 256 MiB. Only one converted copy is held in the session. Cancellation, generation guards and orphan cleanup must prevent stale loads and accumulated temporary data.

## Gaps and priorities

Validate large RAW memory, long-video thermals/audio, cloud-provider folders and cold/warm sharing on phones. Desktop checks are not mobile performance guarantees. Trimming, HDR-preserving export, full neural restoration and native GPU inference remain future work.

User prefers compact collapsible controls and minimal flavour text. Do not add prompts to routine files. Keep manual editing, one-click restoration and comparison. Update About when behaviour changes.

See [Maintenance](MAINTENANCE.md) for commands. [Editor reference](editor/README.md) covers details. IMPLEMENTATION_PLAN.md is historical design context. Private fixture/model notes belong only in the ignored local notes.

Android system Back uses the local ClearWaterBack plugin: dismiss safe dialogs and picker, return About to editor, collapse expanded controls/view, return narrow tabs to Correction/engine, and leave folder browsing before exit. Active jobs remain open. At the editor root, two Back presses within two seconds are required to exit; navigation or new work resets the confirmation. About close removes its hash without adding another history entry.

Photo pipeline: new photos use `makePhotoRecipe`, selecting WWE-UIE with `recipe.balancedAfterAI: {strength: .3}`. Existing stored recipes remain unchanged, except a retired `funie` engine is opened as WWE-UIE. New videos use `makeVideoRecipe`, selecting Five A+ sampled colour every 5 seconds. Reset all follows the respective photo/video default. The live camera starts with Balanced; optional Five A+ assist samples raw frames off-thread and saves a fitted `cameraColour` affine matrix. The follow-up can be disabled. On an AI engine, a 256px reference of the current AI-strength blend is analysed before manual edits; a cached Balanced suggestion uses dive hints. Sixteen recent suggestions are retained per source. The same suggestion is reused for all full-resolution export strips. Gains/red reconstruction are fused into the existing display-encoded RGB pass; manual controls and Effects still run once. Changing follow-up strength or manual edits does not refit or rerun inference. Switching to a classical engine clears the field. Video rejects a photo-only recipe containing the field and presents a localized explanation. Tests cover alpha, older/malformed recipes, inference reuse, and strip consistency. A desktop Node benchmark at 786,432 pixels measured about 169ms without and 209ms with follow-up; this is renderer CPU only, not Android end-to-end timing. This option can overcorrect models that already balance white; compare before/after, starting at 30%.

Mobile controls use slightly larger text (main tabs/selects 13px, most labels 12px, supporting text 11px) with compact radio text at the narrowest widths. Expand sits beside the bottom zoom controls in normal and expanded views. Resolution and megapixels appear together in a non-interactive overlay at the normal preview’s bottom edge; the mobile footer is one unwrapped control row. The normal mobile preview is 36dvh (210–380px), while expanded Fit remains top-aligned and uses the full stage. Desktop Effects headings have an inset inside their outline. `mobile-readability-check.mjs` checks supported languages at 320–650px and the desktop Effects inset at 901–1920px.

Narrow tab navigation preserves scroll position by retaining the tallest settings region seen for the current photo and viewport width. Keyboard focus uses preventScroll, and expanded adjustments preserve their internal scroll position. This may leave unused settings space after switching to a shorter panel; it prevents the page height from collapsing beneath the reader.

`editor/src/use-stable-tab-scroll.ts` owns the narrow tab height reservation and scroll restoration; layout is remeasured when settings content grows, and reservations reset for a new photo, viewport width or expanded mode. The layered controls browser check covers main/subtab switching, document-bottom scroll and expanded internal scroll.

## Camera capture

Android uses CameraX 1.6.2 via 'src/native-camera.ts' / 'ClearWaterCameraPlugin.java', not the WebView stream. Native preview and video use 'CameraRecipeEffect.java' through the CameraX Media3 adapter (1.0.0-alpha04; Media3 1.11.1). Idle binds Preview + ImageCapture + raw ImageAnalysis; recording rebinds Preview + VideoCapture to avoid unsupported four-stream combinations. ImageCapture produces the untouched JPEG at negotiated still resolution (not preview dimensions). The enhanced gallery JPEG uses the same persisted recipe and attempts EXIF retention. Native videos are enhanced directly; no raw video is kept. Standard targets HD, High FHD; CameraX negotiates codec/frame rate/bitrate. CameraX hardware/shader validation is still required on a physical phone; compilation is not a parity guarantee.

Web capture remains getUserMedia + WebGL + corrected-canvas MediaRecorder: Standard up to 720p30 / 5 Mbps, High up to 1080p30 / 12 Mbps. Portrait caps use swapped long/short edges. Browser stills use actual stream dimensions, while video uses the corrected canvas. Neither path preserves RAW/HDR. Camera mode stays open after saving. Its preview-first layout has an overlaid close button and compact surrounding spacing, retaining large underwater capture controls. Original photos/recipes stay private; gallery photos show enhancement. Already-enhanced video imports start at zero restoration strength. Existing linked-gallery deletion/recovery contracts remain unchanged.

Optional Five A+ assist uses a disposable worker, one request at a time, at least one second between raw 256px samples. It fits the existing bounded RGB affine colour transform; this is not spatial neural restoration every frame. 'recipe.cameraColour' stores 12 row-major coefficients for later photo edits; legacy recipes have no field. CPU, WebGL and native shaders must share display-encoded RGB matrix, clamping, linear-light strength blend and manual white balance semantics. Red-filter/depth hints affect Balanced and are disabled while AI assist is enabled. Recording freezes the complete recipe. White balance samples the uncorrected source and replaces its previous gains; native raw samples follow viewport crop, upright orientation and front mirroring.

Zoom tap cycles actual reported ratios, long press opens the supported zoom/lens chooser. Native lens display magnification is camera-relative ratio × intrinsic lens ratio. Do not invent ultra-wide choices when the platform does not expose them. Permission/start/lens callbacks use generation guards; closing cancels pending starts. Native temporary captures are URI-owned and released only after durable save. Background recording finalisation completes before session teardown. Recording guards are native file-size limit plus duration timer; a valid size-limit Finalize is retained. Camera and microphone permissions are requested when needed.

Android launcher shortcuts and 'clearwater://camera' / 'clearwater://edit' enter the corresponding mode; ordinary startup remains the editor. Web manifest shortcuts use '?mode=camera|edit'. 'use-launch-mode.ts' consumes initial actions and warm native events once; it leaves active jobs alone. iOS needs its own AVFoundation implementation and URL registration, documented in IOS_PLAN.md.

Editor playback is a silent, bounded processed-frame preview driven by completed render messages, skipping ahead when processing is slow. It is not export-speed or real-time playback assurance. Pause on seek, modal/navigation, export, background and source switch. Comparison drag input occupies only the 44px arrow-height band; the visible full-height line does not capture input. Keep stationary WB taps distinct from pans/pinches.

## Settings and installed-PWA offline models

Settings opens from the gear near the brand (also in About), returns to its logical parent with Back/Escape, and holds language plus web offline preferences. `src/offline-models.ts` stores preferences in `clearwater-offline-settings`; installed/Home Screen detection enables automatic downloads by default, selecting WWE-UIE, Five A+ and Shallow-UWnet. Those models plus the shared WASM runtime are about 16 MB. Android bundles all supplied models and skips the web download controls. Custom-model files and per-photo engine choices retain their existing persistence rules.

`build-sw.mjs` generates optional-asset SHA-256 digests. The worker stores verified ONNX/WASM responses in a stable cache scoped to the app base path, migrates matching legacy cached files, reuses unchanged assets after UI updates and prunes outdated hashes. Required app install remains small and independent. Downloads run sequentially, preserve finished files on interruption and retry missing files on foreground/connectivity events; a partial file is restarted. Deselecting removes that model cache only; on-demand editor use can fetch/cache it again. Automatic download can be disabled; manual download and readiness remain in Settings. Custom weights, user photos and third-party files are excluded from this model cache.

Web Settings offers the signed stable APK at `https://github.com/fishese/clearwater/releases/latest/download/clearwater-release.apk`. Every stable release must attach this constant-name copy and its SHA-256 sidecar, in addition to any versioned APK, so the link follows GitHub's latest release. This points to stable releases, not experimental debug builds.

## Linked camera captures and collection cleanup

New Android captures use `StoredPhoto.cameraCapture` to link their gallery URI/name to a private original. JPEG gallery images receive the selected Balanced/WB correction at capture; new videos contain the visible correction immediately. Their private source is the enhanced video, with no raw counterpart; the enhancedVideo metadata flag distinguishes it from legacy raw captures. The main save action updates the same owned gallery URI; Save as still exports a copy, and Export original copies untouched photo bytes; Export captured video copies the enhanced video source. Existing captures lack recorded gallery URIs and remain unlinked.

Library IndexedDB is version 2: `photos` stores collection metadata, `camera-originals` stores each original once with recipe/capture metadata. Re-saves keep original bytes. Clear collection removes visible entries, retaining these camera originals/edits; Settings > Restore camera collection recovers them without another gallery file. Explicit camera deletion confirms removal of owned gallery + private original; imported entries keep collection-only removal. Native successful writes persist ownership. Replacement stages data and keeps a rollback copy before updating that same URI. App uninstall/data clearing removes private originals; use Export original for backup.

Known camera and Android folder URIs are checked in batches on load/resume/idle using metadata only. Confirmed missing sources remove library/recipe/archive data. Android 11+ queries include trash rows: trashed items hide from the collection but retain recovery data. Unavailable providers/permission loss keep data. Generic browser/file-picker imports provide no usable source URI. `removedPhotoIds` blocks delayed recipe writes from resurrecting removed items. `newestPhotos` orders collection merges/reloads newest-first. Preview/toolbars/footer suppress user selection and touch callouts; hold-original resets on cancel/blur.

Camera test update: enlarged icon controls (88px photo shutter, 68px record, 60px WB/reset/mic/flip), press-and-drag WB magnifier, and replacement WB picking in camera/editor. A fresh neutral pick must be independent of prior neutral gains, including clipped prior previews; regression tests cover replacement.

Browser recording estimates use 5 Mbps video plus up to 128 kbps audio (~39/116/193 MB for 1/3/5 minutes). Browser High requests 12 Mbps video and 192 kbps audio (~92/275/458 MB). Native CameraX chooses its own bitrate; these are planning estimates, while the duration and byte guards remain enforced. Android retains gallery + one private editing source; Settings estimates combined space from the selected quality. RAM ranges in Settings are conservative buffer/finalisation estimates, not measured device requirements; OS/browser may spill blobs to disk. Skip SHA-256 full-file readback for camera videos to avoid another large allocation.

Camera quality profiles are in core/camera-quality.ts. Auto resolves by platform, with High on Android and Standard on web; explicit choices survive upgrades from older minutes-only settings. Stream negotiation uses ideal resolution with bounded maxima, gracefully allowing a lower actual resolution. WebGL output uses the profile cap without upscaling. High photo JPEG encoding targets 97% versus Standard 94%. Those JPEG percentages describe the browser stream path. Android instead uses native ImageCapture at JPEG quality 98 and negotiated still dimensions, followed by the enhanced gallery render.


Release 1.0.2 review: camera progress state is quantized to visible seconds/percentages while limits remain precise; Android file chunks use batched base64 encoding. Settings radio groups and guide links have improved accessibility/touch targets. See Maintenance for the iOS sideloading feasibility findings; no native iOS implementation exists yet.


Export quality update (15 October 2026): JPEG defaults to .95; Maximum requests .99, while PNG remains lossless relative to rendered 8-bit sRGB pixels. Browser colour subsampling is not configurable. JPEG UserComment is copied as raw EXIF bytes to preserve Unicode. Video exports offer Compact and Source; Source never reduces bitrate to fit its ceiling, reports an estimate and refuses oversized output. Full HDR/10-bit/P3 preservation, disk-streamed exports and native HDR double-encode elimination remain separate work. Video metadata retention is an allowlist (title/description/comment/date), not a complete container copy. See Maintenance for tests and remaining limits.

## Current validation checkpoint (16 October 2026)

Debug 1.0.3 (code 22) is installed on the Samsung test phone with the final About copy, verified by the installed APK checksum. Native camera behaviour is unchanged from the device-tested 1.0.3-camera.7 (code 21). Native startup, first-use camera/microphone prompts, repeated captures, photo capture after recording, sampled Five A+ assist, front-lens labels, white-balance pick/reset, and two AI-on Home/return cycles were exercised. The final background cycles kept the same process and produced no ClearWater camera errors. The camera was closed after testing; user data was preserved.

Device testing found and fixed preview-dependent capture cropping. CameraX capture groups no longer inherit the preview ViewPort: the display still fills the preview box, while saved media keeps its selected native frame. Portrait photos saved at 3060 x 4080 and landscape photos at 4080 x 3060 (12.5 MP). Native photo results now report JPEG bounds after EXIF orientation. A generation-tagged cameraInfoChanged event updates the resolution chip after physical rotation and idle rebinds. Controls stay in portrait positions; media orientation follows the sensor independently.

Portrait video was verified at display 1080 x 1920; landscape at display 1920 x 1080 with a 270-degree track transform. Short test clips were approximately 30 fps and 17-18 Mbps H.264, with an AAC audio track when enabled. These are measured results for this device, not guaranteed quality on every camera. No raw video is retained.

The same test exposed a background crash: pause unbound CameraX but left a released Media3Effect available to queued correction updates. Pause now invalidates pending binds and retires/nulls the effect before unbinding; resume preserves any pending bind call. Active effect-update failures reject their plugin call instead of crashing. Preserve the main-thread deferred-close and generation guards. Do not rebind for ordinary preview bounds changes.

Native picker/loupe coordinates use cover fit; web uses contain fit, and both reject off-preview releases. Compact landscape editor screens let the collection scroll below the editor. IOS_PLAN.md includes the existing iOS agent catch-up prompt and updated native event/capture contract.

Validation: 140 unit tests; production build/Android sync; native-camera mock including current/stale session dimension events; minified debug assemble; APK signature; real-device capture, permissions and lifecycle checks above. Longer recordings, all four physical rotations, rotation during recording, front-camera mirroring and interruption during an active capture still need broader device acceptance. The user approved v1.0.3 (code 22) as the latest release and default APK download on 16 October. The canonical clearwater-release.apk asset contains the verified signed release above; debug testers use the separate debug APK.

Prepared artifacts: editor/android/build/clearwater-1.0.3-debug.apk (SHA-256 f3808f6cf19353e80c3b47a78b92879cf73a28f5ffefcde3c0a2d622643ac8e9) and clearwater-1.0.3-release.apk (SHA-256 b9e0e1bb48702a58ceef41125c1c1406c4516db4e63c120509918474f8e67072), with adjacent checksum files. Both signatures verify; the release certificate matches v1.0.2. Release permission metadata/iteration survived R8 and final DEX matches that audit. About layout, links and contact obfuscation pass production checks in all three languages. Device-test copies remain ignored; do not commit or publish test media.
