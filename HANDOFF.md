# Handoff

## Current product

ClearWater is a local-first React/TypeScript/Vite editor with web/PWA and Capacitor Android builds. No server-side image processing or account system. Interface and guide support English, Hong Kong Traditional Chinese (standard written Chinese, not Cantonese) and Japanese. A compact header selector switches language without restarting processing or changing edits. Browser language supplies the first default; a saved choice overrides it.

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

Narrow screens use Correction / Enhancement / Export tabs with one settings group visible at a time; the wide layout keeps collapsible groups and combined Light & clarity controls. Tab changes only change control visibility and do not recreate image/video workers. Analysis remains visible below Restoration strength. Unknown depth is distinct from zero in Balanced restoration and is selected with Unsure of depth beneath the slider. Fit leaves a 6px inset per edge where the image aspect ratio allows. Expanded view resets to a measured Fit, retains corner zoom controls, and supports pinch zoom and drag-pan with comparison off. Expanded picker sampling waits for a stationary single-pointer release; multi-pointer gestures never sample white balance.

Clear collection confirms removal of thumbnails, app copies and saved edits; external originals and exports, custom models and preferences remain intact. Its button is highlighted at 100 imported items. Library writes are ordered; pending service-worker shares are kept through clearing and promoted afterward.

Android HDR conversion stages bounded chunks to a private cache, limits input to the normal video ceilings, and creates a working copy up to 1080p30 / 256 MiB. Only one converted copy is held in the session. Cancellation, generation guards and orphan cleanup must prevent stale loads and accumulated temporary data.

## Gaps and priorities

Validate large RAW memory, long-video thermals/audio, cloud-provider folders and cold/warm sharing on phones. Desktop checks are not mobile performance guarantees. FUnIE-GAN quality varies; do not assume enhancement. Playback/trimming, HDR-preserving export, full neural restoration and native GPU inference remain future work.

User prefers compact collapsible controls and minimal flavour text. Do not add prompts to routine files. Keep manual editing, one-click restoration and comparison. Update About when behaviour changes.

See [Maintenance](MAINTENANCE.md) for commands. [Editor reference](editor/README.md) covers details. IMPLEMENTATION_PLAN.md is historical design context. Private fixture/model notes belong only in the ignored local notes.

Android system Back uses the local ClearWaterBack plugin: dismiss safe dialogs and picker, return About to editor, collapse expanded controls/view, return narrow tabs to Correction/engine, and leave folder browsing before exit. Active jobs remain open. At the editor root, two Back presses within two seconds are required to exit; navigation or new work resets the confirmation. About close removes its hash without adding another history entry.
