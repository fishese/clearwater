# ClearWater photo and video editor

A local-first photo and video editor built with React, TypeScript and Vite, available as a web/PWA app and a Capacitor Android app. Correction and video processing run in dedicated workers.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```powershell
cd D:\Projects\ClearWater\editor
npm install
npm run dev
```

Open http://127.0.0.1:5173. The server binds to loopback only. The local development server offers the nine original samples from the adjacent `Sample photos` directory, with thumbnails from `analysis/previews`. These files are not copied into the app or production build. You can also import files with Open files or drag and drop.

## Included

- JPEG, PNG, HEIC and HEIF import; multi-photo library and local IndexedDB persistence.
- Select multiple images in one file-picker operation; Previous/Next controls browse the imported library with a position counter and retain each photo's edits. Import order is preserved after reload (older library entries without timestamps fall back to filename order).
- Automatic, adjustable classical colour correction, including severe red deficiency, red/magenta filter casts and conservative haze/contrast treatment.
- Original RGB-average heuristic as an alternative engine for comparison.
- Shallow-UWnet and FUnIE-GAN local ONNX inference as independent alternatives, plus a generic ONNX adapter requiring the user's own compatible local model.
- Surface/underwater, red-filter, blue/green water and approximate-depth hints.
- Before/after divider, hold for original, zoom, undo, redo and reset.
- Warmth, green/magenta tint, signed red correction, vibrance, exposure, highlights, shadows, contrast and haze controls.
- Neutral-point eyedropper and versioned JSON recipe save/load.
- Full-resolution JPEG or PNG export from the decoded source, using the same deterministic processing function as the preview. Export is cancellable.
- Compact collapsible settings groups with vertical colour, light and clarity sliders; responsive mobile layout, installable PWA manifest, offline asset caching and file share target for supporting browsers.

Files and recipes remain in the browser profile. Remove a photo with the X on its library tile to delete that app copy. Clearing browser site data removes the library. Local storage can be evicted or run out of space; keep originals and export results you want to retain.

## Production / offline test

```powershell
npm run build
npm run preview -- --port 4173
```

Open http://127.0.0.1:4173. Offline support is enabled only in production builds. Let the first service-worker installation finish before going offline; it includes the lazy-loaded HEIC decoder. HTTPS or localhost is required for service workers. A phone cannot reach the computer's loopback address; phone testing needs a secure hosted/staged build or an Android package.

PWA share intake is implemented as a manifest share target and local service-worker multipart POST handler. Whether it appears in the system share menu depends on the browser, platform and installed-app status. Real Android OS share-menu testing remains to be done.

## Checks

```powershell
npm test
npm run build
```

Tests cover classical correction, neural strength/manual finishing, source-detail transfer, strip/full-buffer equivalence, recipe validation, transparent input and safe export naming/writing.

The scripts `scripts/browser-check.mjs` and `scripts/pwa-check.mjs` run integration checks against the local dev/production servers, using Playwright and installed Microsoft Edge. Browser checks use this project's private sample folder. Set `CLEARWATER_PROJECT_ROOT` to relocate the project or `CLEARWATER_BROWSER` to choose a Playwright browser channel (default `msedge`). Screenshots, exported checks and results are stored under `analysis/browser-check`, which is ignored by Git.

Verified on desktop Edge: all nine supplied photos decode and render; keyboard undo/redo/reset; strength-zero comparison; full-resolution 4284x5712 JPEG export; mobile-width layout without horizontal page overflow; photo-library restoration after reload; production sample exclusion; offline HEIC restoration; share-target POST intake and local persistence.

`node scripts/models-check.mjs` additionally checks all three models on all nine photos, the custom-model permission/file prompt and reloading the model after a page reload, manual edits, source-resolution neural export and offline Shallow-UWnet/FUnIE-GAN reuse. It requires the privately prepared Deep WaveNet ONNX file. All checks passed in desktop Edge with no external inference requests or page errors. Warm runs were roughly 0.6 s for FUnIE-GAN, 1.6 s for Shallow-UWnet and 2.6 s for Deep WaveNet on this computer; these are not mobile performance guarantees or image-quality scores.

## Processing contract and limits

With an output folder selected, exports use `[original stem].jpg` or `.png`. Without an output folder, exports default to the source folder and use `[original stem]-restore.jpg` or `.png`. Browser file inputs do not expose parent directories: choose the source folder once (or at first export). The app remembers it for other imported photos found there with the same name and file size. Folder access lasts for the current session. **Use source folder** clears the output-folder override.

All app-managed folder saves, including **Save as…**, add ` (1)`, ` (2)` etc. when a filename exists. Save As uses an editable filename and a folder picker so the app can avoid overwriting existing files; it no longer uses the native save-file picker, which cannot choose a numbered sibling without parent-folder access. When directory pickers are unavailable, or when **Download instead** is chosen, the browser controls download location and disk-level collision handling. The app cannot inspect existing files in Downloads without folder access. Write failures fall back to downloading the rendered image. Picker cancellation stops before rendering.

`node scripts/browsing-check.mjs` verifies multi-file import, Previous/Next boundaries, per-photo edits and reload ordering, source-resolution exports, collision naming, Save As, cancellation and failed-write fallback. The test emulates native picker handles; real OS picker dialogs and Android storage still require device testing. Browser/OS support controls whether folder and Save As options appear. The Android host uses native Storage Access Framework document-tree handles for folder browsing and exports.

Choose a model under **Correction Engine**. Each model runs directly on the original, independently of classical correction. Inference runs once per photo/model in a worker using ONNX Runtime Web WASM; strength and manual changes reuse its result. Shallow-UWnet is about 0.9 MB, FUnIE-GAN 28.1 MB, and the shared WASM runtime 14.2 MB (uncompressed). Production caches these on first use, rather than during initial installation. Run each model once while online to make it available offline. No model or image requests go to third-party inference services.

AI currently predicts a 256×256 image. Its RGB residual is interpolated and added to the source, then strength blends in linear light before manual finishing. This preserves source resolution/detail but is an experimental colour-transfer approach, **not full-resolution neural dehazing, denoising or super-resolution**. Preview and striped export use the same field and coordinates. Dive hints affect Balanced restoration, not these pretrained networks. For surface red-filter photos, prefer Balanced restoration; underwater networks can worsen the cast.

**Load other ONNX model** accepts self-contained models up to 64 MB with one RGB float32 NCHW image input and output compatible with `[1,3,256,256]`. Symbolic dimensions are allowed, then validated by a trial run. Models using BGR, NHWC, mean/std normalization, extra inputs/outputs, external weight files, or different output sizes need additional adapters. Choose the author's documented input and output ranges independently (`0..1` or `-1..1`). Invalid shapes, types or non-finite output are rejected with an error in the loader. The loaded model filename, SHA-256 and range settings are stored in recipes; model bytes remain in worker memory and must be supplied again on reload. The historical `wave` recipe ID now denotes this custom slot, preserving compatibility with earlier recipes.

Users must have permission to use their chosen model and comply with its licence; a generic loader does not alter licence terms. The privately prepared Deep WaveNet model is compatible with both ranges set to `0..1`; it retains the authors' academic-only statement and CC BY-NC-ND restrictions. Its weights are still excluded from Git and builds. See [model provenance and local conversion instructions](public/models/README.md).

Dive conditions use compact radio buttons in two columns, plus a `0..100 m` depth slider and a Not sure reset. Correction Engine is first and collapsed; Auto restore sits beside strength. `node scripts/controls-check.mjs` checks these controls, undo, mobile overflow, incompatible files, generic loading with unit/signed model ranges, and prompting for the file after reload.

This is an SDR, 8-bit prototype, not a physically calibrated restoration tool. RGB correction is tuned in display-encoded sRGB; automatic strength blending and exposure use linear-light conversion. Preview and export share `src/core/engine.ts`. A reduced preview is used for analysis; the original decoded bitmap is retained for export. Exports use bounded strips for working pixels, but still need a full output canvas. Device memory matters for large images.

Native browser decoding requests normal orientation and colour-space conversion. Unsupported HEIC falls back to libheif through `heic-to/next` inside the worker. The seven supplied HEIC files have been tested; arbitrary HDR HEIC, gain maps, unusual profiles, RAW and multiple-image HEIF sequences have not. Explicit HDR tone mapping and full colour-profile conformance remain future work. JPEG/PNG exports do not preserve source EXIF/GPS metadata. Transparent PNG retains alpha; JPEG output has no alpha.

Photo import is limited to 60 MB per file and 45 MP after decoding. These are guards, not a promise that all devices can handle the maximum. Mobile memory, thermal behaviour, browser compatibility and quality require real-device testing.

Red reconstruction estimates plausible appearance from the remaining channels; it cannot recover physically missing colour information. Haze control is bounded global veil/contrast reduction, not depth-based Sea-Thru reconstruction or learned dehazing. Depth is a weak suggestion hint, not camera-to-subject range. Review the suggested edit visually, especially for sunsets, strobes and naturally red subjects.

## Next milestones

1. Review sample results and tune correction strength/foreground behaviour with the user.
2. Validate full-resolution colour/noise on representative Android hardware.
3. Validate Android folder and share workflows on additional devices.
4. Review the three model results, benchmark Android performance, and evaluate full-resolution/tiled inference or improved colour transfer. Consider ADCCA-GAN if verified artifacts become available.
5. Add HDR tone mapping, video playback, native/GPU processing and full temporal neural restoration.

The parent `IMPLEMENTATION_PLAN.md` and `analysis/ADCCA_GAN_REVIEW.md` contain the research and longer-term architecture.


## Video (first version)

Open MP4 or MOV from the file picker, Android folder browser, or Android share menu. Scrub the timeline to choose a frame, use Auto restore or manual adjustments, and export an MP4. Balanced and RGB use one fixed correction recipe across the clip. For these engines, use a representative frame for Auto restore. There is frame preview, but no continuous playback yet.

- SDR H.264 and HEVC input work when the browser/device has the matching WebCodecs decoder. MOV is a container; it does not guarantee codec support. iPhone rotation is baked into the exported pixels.
- HDR/PQ/HLG and Dolby Vision clips are rejected pending proper tone mapping. For now, record with iPhone HDR Video disabled or supply an SDR copy.
- Input: up to 10 minutes, 512 MB and 34 megapixels per frame. Output: H.264 MP4, up to 1080p (portrait or landscape) and 30 fps, maximum 256 MB. Bitrate is reduced for longer clips, reserving room for audio and encoder variation. Originals are preserved.
- Primary audio is retained as compatible AAC or converted when supported. Unsupported audio prompts the user to turn off Keep audio; it is never silently dropped. Additional audio tracks, subtitles and descriptive/GPS metadata are not exported.
- Balanced, RGB, Shallow-UWnet, FUnIE-GAN and compatible custom ONNX engines are supported. AI video uses sampled global colour fitting, described below; it does not run a spatial correction map over moving subjects. Long exports can take time; keep the app open. Export and sample analysis can be cancelled.
- All decoding/correction/encoding runs locally. Large clips are stored in the local library, and encoded output is buffered in memory. These limits do not guarantee every phone can process the largest clip.

Video uses unmodified Mediabunny (MPL-2.0); licence and corresponding source links are included under `public/licenses/`. To reproduce the integration check, install `imageio-ffmpeg` in an optional Python environment, run `python scripts/create-video-fixtures.py`, start the app, then run `node scripts/video-check.mjs`. Fixtures and exported test clips are ignored by Git. `CHECK_URL` selects a production/Pages preview. The check covers MP4/MOV, rotation, audio, seeking, correction, cancellation, HDR rejection, codec availability, mobile fit and returning to photos.

### Sampled AI video colour

Select Shallow-UWnet, FUnIE-GAN or a compatible custom ONNX model under Correction Engine. **Sampled AI colour** defaults to one sample every 5 seconds; 2 or 10 seconds are also available. Each sample runs the existing 256x256 model once. A regularized affine RGB transform is fitted between the original and the model result; per-pixel spatial residuals are not reused across moving video subjects. The fitted global transforms interpolate between sample times, followed by the same strength and manual adjustment renderer used for photos. This approximates model colour; it does not transfer local dehazing, denoising or reconstructed details.

Colour histograms flag strongly different sampled scenes. At those boundaries, each frame chooses the closer sampled scene's transform instead of blending the two. Brief scenes entirely between sample points can be missed; a shorter interval can help. This is a heuristic, not full shot detection or optical-flow tracking.

**Fixed selected frame** fits one AI transform from the selected frame and applies it throughout the clip. Use the current-frame button to change the reference. Balanced and RGB remain the original low-cost whole-clip alternatives. Mode, interval and reference time are saved in recipes and each file's edits.

Preview analyses only the surrounding samples. Export analyses the remaining samples first (0-20% progress), then renders all frames (20-95%). Completed analysis is cached for the active video/model and reused for manual edits, strength changes, seeking and repeated export. Caches are discarded when changing files; custom models still need to be loaded after an app reload. Inference is serialized to avoid concurrent sessions competing for memory. A 10-minute clip at 5-second spacing has 121 samples, so mobile export preparation can take significant time even though models do not run on every output frame.

`node scripts/video-ai-check.mjs` checks sampled and fixed Shallow correction, inference reuse, cancelling sample analysis, FUnIE and generic ONNX video exports, custom model handoff to photos, mobile layout, a complete 10-minute export, and rejection above 10 minutes. Generate fixtures with `python scripts/create-video-fixtures.py` first. Set `CHECK_URL` for a production/Pages build; `CHECK_OFFLINE=1` verifies cached Shallow inference and export offline after warming the model.
