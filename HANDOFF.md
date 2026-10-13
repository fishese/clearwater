# Handoff

## Current product

ClearWater is a local-first React/TypeScript/Vite editor with web/PWA and Capacitor Android builds. No server-side image processing or account system. Next authorised milestone: English, Hong Kong Traditional Chinese (standard written Chinese, not Cantonese) and Japanese. Keep labels compact and recipes intact when changing language.

Photos: JPEG, PNG, HEIC/HEIF and compatible Android DNG / Apple ProRAW; JPEG/PNG export with supported EXIF/GPS retention enabled by default. RAW develops into 8-bit sRGB. JPEG-XL DNG and HDR tone mapping are unsupported.

Normal photos at or below 45 MP and 60 MiB have no resource prompt or automatic reduction. Larger photos use small previews and Auto / Full / Reduced options. Auto targets 24 MP on phones/low-memory devices, 45 MP with unknown memory, or 80 MP on desktops reporting at least 8 GB. RAW half-size development can yield 12 MP from 48 MP. Full attempts original dimensions; Reduced caps at 12 MP. Safety ceilings: 512 MiB, 200 MP, 32,768 pixels per side. These do not guarantee available memory. Reduced retry retains edits.

Video: SDR MP4/MOV, device-supported H.264/HEVC decoding. Input up to 10 minutes / 512 MiB / 34 MP per frame; H.264 MP4 output up to 1080p30 / 256 MiB with supported primary audio. HDR/Dolby Vision rejected. Scrubbing supported; playback/trimming not implemented. Classical engines use one recipe. AI samples colour every 2/5/10 seconds or uses a fixed reference; this transfers global colour, not temporal detail or dehazing.

## Source map (under editor/)

| Area | Files |
| --- | --- |
| UI and state | src/App.tsx, src/styles.css |
| User guide and attribution | src/About.tsx |
| Correction / recipes | src/core/engine.ts, src/core/types.ts |
| Photo rendering / export | src/processor.worker.ts |
| Headers / resolution / DNG | src/photo-header.ts, src/photo-decode.ts, src/core/photo-size.ts, src/raw.worker.ts |
| EXIF/GPS | src/photo-metadata.ts |
| Neural models | src/models.ts, src/core/model-contract.ts, src/core/neural-field.ts |
| Video | src/video.worker.ts, src/core/video-*.ts |
| Persistence / files | src/storage.ts, src/file-save.ts, src/native.ts |
| Android bridge | android/app/src/main/java/com/fishese/clearwater/ |
| PWA lifecycle | scripts/sw.template.js, scripts/build-sw.mjs, src/update.ts, public/update.html |

## Contracts to preserve

- Engines start from the original; do not stack Balanced underneath AI. Photo AI predicts at 256×256 and transfers a residual onto source detail; preview/export share coordinates and finishing.
- Recipe keys are stable, including historical `wave` for the generic custom slot. Translate labels, never stored identifiers or asset filenames.
- Output folder selected: original stem. Otherwise add `-restore`. App-managed saves add numbered siblings; browser downloads control their own collisions.
- IndexedDB retains imported files/latest recipes. Undo history, folder handles, custom weights and resolution choices are session-only. Storage can be evicted.
- Preserve generation/request guards and buffer cleanup. RAW uses disposable workers; large export buffers are released after saving.
- Web models cache after first use; APK bundles supplied models. Never package locally supplied weights or personal fixtures.

## Gaps and priorities

Validate large RAW memory, long-video thermals/audio, cloud-provider folders and cold/warm sharing on phones. Desktop checks are not mobile performance guarantees. FUnIE-GAN quality varies; do not assume enhancement. Playback/trimming, HDR, full neural restoration and native GPU inference remain future work.

User prefers compact collapsible controls and minimal flavour text. Do not add prompts to routine files. Keep manual editing, one-click restoration and comparison. Update About when behaviour changes.

See [Maintenance](MAINTENANCE.md) for commands. [Editor reference](editor/README.md) covers details. IMPLEMENTATION_PLAN.md is historical design context. Private fixture/model notes belong only in the ignored local notes.
