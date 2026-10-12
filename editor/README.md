# ClearWater photo editor

A working local-first photo prototype built with React, TypeScript and Vite. The correction engine is independent of the UI and runs in a dedicated worker. This project has not been published or packaged as an Android APK.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```powershell
cd D:\Projects\ClearWater\editor
npm install
npm run dev
```

Open http://127.0.0.1:5173. The server binds to loopback only. The local development server offers the nine original samples from the adjacent `Sample photos` directory, with thumbnails from `analysis/previews`. These files are not copied into the app or production build. You can also import files with Open photos or drag and drop.

## Included

- JPEG, PNG, HEIC and HEIF import; multi-photo library and local IndexedDB persistence.
- Automatic, adjustable classical colour correction, including severe red deficiency, red/magenta filter casts and conservative haze/contrast treatment.
- Original RGB-average heuristic as an alternative engine for comparison.
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

Eleven engine tests cover missing red, red and magenta filter casts, surface override, green water, strength zero, manual exposure, strip/full-buffer equivalence, recipe validation, baseline bounds and transparent input.

The scripts `scripts/browser-check.mjs` and `scripts/pwa-check.mjs` run integration checks against the local dev/production servers, using Playwright and installed Microsoft Edge. Browser checks use this project's private sample folder. Set `CLEARWATER_PROJECT_ROOT` to relocate the project or `CLEARWATER_BROWSER` to choose a Playwright browser channel (default `msedge`). Screenshots, exported checks and results are stored under `analysis/browser-check`, which is ignored by Git.

Verified on desktop Edge: all nine supplied photos decode and render; keyboard undo/redo/reset; strength-zero comparison; full-resolution 4284x5712 JPEG export; mobile-width layout without horizontal page overflow; photo-library restoration after reload; production sample exclusion; offline HEIC restoration; share-target POST intake and local persistence.

## Processing contract and limits

This is an SDR, 8-bit prototype, not a physically calibrated restoration tool. RGB correction is tuned in display-encoded sRGB; automatic strength blending and exposure use linear-light conversion. Preview and export share `src/core/engine.ts`. A reduced preview is used for analysis; the original decoded bitmap is retained for export. Exports use bounded strips for working pixels, but still need a full output canvas. Device memory matters for large images.

Native browser decoding requests normal orientation and colour-space conversion. Unsupported HEIC falls back to libheif through `heic-to/next` inside the worker. The seven supplied HEIC files have been tested; arbitrary HDR HEIC, gain maps, unusual profiles, RAW and multiple-image HEIF sequences have not. Explicit HDR tone mapping and full colour-profile conformance remain future work. JPEG/PNG exports do not preserve source EXIF/GPS metadata. Transparent PNG retains alpha; JPEG output has no alpha.

Import is limited to 60 MB per file and 45 MP after decoding. These are guards, not a promise that all devices can handle the maximum. Mobile memory, thermal behaviour, browser compatibility and quality require real-device testing.

Red reconstruction estimates plausible appearance from the remaining channels; it cannot recover physically missing colour information. Haze control is bounded global veil/contrast reduction, not depth-based Sea-Thru reconstruction or learned dehazing. Depth is a weak suggestion hint, not camera-to-subject range. Review the suggested edit visually, especially for sunsets, strobes and naturally red subjects.

## Next milestones

1. Review sample results and tune correction strength/foreground behaviour with the user.
2. Validate full-resolution colour/noise on representative Android hardware.
3. Add the Capacitor Android host, native picker/share intents, durable content-URI handling and MediaStore export.
4. Benchmark licensed, reproducible Shallow-UWnet / FUnIE-GAN checkpoints independently; consider ADCCA-GAN if verified artifacts become available. No AI model is bundled or run here.
5. Add native video processing with temporal smoothing after the photo workflow is validated.

The parent `IMPLEMENTATION_PLAN.md` and `analysis/ADCCA_GAN_REVIEW.md` contain the research and longer-term architecture.

