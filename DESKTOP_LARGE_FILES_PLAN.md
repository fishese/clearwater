# PC/Mac large-file edition — proposal, 14 November 2026

**Recommendation: conditional go for a small shared-code feasibility prototype, not a separate editor rewrite.** The strongest initial benefit is longer/larger video and disk-backed batches. Substantially larger photo dimensions need an additional decoder/encoder feasibility gate. No desktop implementation is authorized or included here.

## What would be reused

Keep the React/TypeScript editor, responsive controls, translations, recipe/history/crop representation, comparison UI, correction/enhancement math, small ONNX models, correction-field reuse, bounded previews and most worker protocol. Keep current web/Android/iOS backends and defaults. Add narrow desktop source/output adapters; do not fork correction algorithms or create a separate UI.

A wrapper alone does not solve memory pressure. Do not raise current guards merely because the app runs on a desktop or reports more RAM.

## Current bottlenecks verified in source

| Stage | Current desktop path | Required change / constraint |
|---|---|---|
| Import | 512 MiB per photo/video; photos 200 MP/32768 px side; video 600 s/34 MP frame | File-backed sources, header/range reads, measured job budgets before extending limits |
| Photo preview | Large raster preview bounded to 2.56 MP/1600 px; exports decode again | Reuse; decoder internal peak allocation still requires measurement |
| RAW | Whole compressed input ArrayBuffer, LibRaw development and developed-image canvas before resize | Separate RAW gate; small preview is not proof of small decode memory |
| Inference | WASM, 256×256 input; cached correction field used on full pixels | Keep initially; GPU inference alone does not remove image/video buffers |
| Photo export | Decoded bitmap + crop-sized output canvas + 256-row source-width strips/halos + final Blob | Incremental encoder removes final full canvas; true bounded memory also requires suitable decode |
| Video | Bounded 960×540 preview; export full frame canvas/readback; complete MP4 BufferTarget→Blob | Positioned disk output with backpressure; per-frame costs still remain |
| Library/batch | Files in IndexedDB; completed Blob save interfaces; ZIP collects parts, 128 MiB cap | File references, disk-backed result/ZIP and persisted job metadata |

Source: `editor/src/core/platform-limits.ts`, `core/photo-size.ts`, `photo-decode.ts`, `raw.worker.ts`, `models.ts`, `processor.worker.ts`, `video.worker.ts`, `file-save.ts`, `storage.ts`, `batch-zip.ts`.

One 200 MP RGBA surface is about 763 MiB; decoded source plus an uncropped output is about 1.49 GiB before strips, codec intermediates and encoder memory. A 34 MP frame canvas plus readback alone is about 259 MiB. These are allocation estimates, not measured peak memory. Auto photo export currently uses 24/45/80 MP budgets depending on device hints; Full attempts accepted source size. Available memory is not established by `navigator.deviceMemory`.

Current Source video preserves size/timing where supported but transcodes to H.264 8-bit SDR, up to 36 Mbps, subject to estimated output caps. No new HDR, lossless, ProRes or higher-bit-depth promise is included.

## Shell and platform boundary

Trial Electron first: Chromium aligns with the existing browser workers, while Node can own local files. This is a project-fit inference, not proof that every decoder/encoder will work. Use an isolated/sandboxed renderer and a narrow preload/IPC bridge; expose opaque selected-file/job tokens, not unrestricted filesystem access. Validate requested offsets/lengths and avoid moving whole media buffers through IPC. [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)

Tauri can reuse the frontend too, but Windows WebView2 and macOS WKWebView require separate engine validation. Its smaller shell does not itself reduce working image/video buffers. Keep it an alternative only if packaging size justifies that additional compatibility work. [Tauri process model](https://v2.tauri.app/concept/process-model/)

Proposed shared contracts:

- Source: stable identity, size/type, range reads and explicit close; reopen/relink when an external file has moved or changed.
- Output: create app-owned temporary file, write at offset, bounded backpressure, finalize atomically where supported, cancel/clean up only that job's temporary files.
- Result: existing browser Blob or desktop output token; shared UI handles either without loading a completed desktop file into a Blob.
- Job: progress, cancellation, error classification and retry. Persist recipes/jobs, not extra copies of originals. Never overwrite user originals by default.

## Staged plan and stop conditions

1. **Baseline and compatibility spike.** Load the existing app in the desktop shell on Windows and macOS. Confirm workers, model assets, OffscreenCanvas, WebCodecs, files and custom models. Establish process-tree peak memory, preview latency and export time. Stop if normal editing requires another correction engine or widespread native porting.
2. **Video disk output first.** Keep Mediabunny Conversion and frame correction; replace BufferTarget with a positioned disk sink. Installed Mediabunny exposes StreamTarget/FilePathTarget. Its writes may revisit offsets, so concatenation is not valid. Backpressure must bound IPC and disk queues; audio/video scheduling must also avoid mux buffering. [Mediabunny output targets](https://mediabunny.dev/guide/writing-media-files)
3. **Finish the complete file-backed path.** Adapt import/library references and final save results; replace `patchMp4CreationDate` whole-buffer processing with bounded metadata patching or supported mux metadata. A streaming muxer followed by reading the whole output back into a Blob fails the objective. Handle disk full, disconnection, collision, cancellation and crash remnants without touching originals.
4. **Photo feasibility gate.** Prototype incremental JPEG/PNG encoding using existing processed strips/halos and crop coordinates. Check whether supported decoders can supply bounded strips/tiles or otherwise materially reduce peak memory. Preserve global analysis and colour-field coordinates; do not infer each tile independently. RAW/HEIC need separate evaluation. Stop the larger-photo scope if it requires rebuilding most of decode, correction and encoding in native code.
5. **Measured limits and desktop polish.** Only after gates pass, choose conservative per-job budgets using dimensions, codec, effects, disk capacity and actual measurements. Keep Reduced/fallback behavior and explicit user consent for quality reduction. Add native open/save dialogs, relink feedback and recoverable job states using the existing UI.
6. **Packaging proposal, later approval.** Windows x64 and macOS Apple Silicon first; Intel Mac only if supported/tested. Plan separate app packaging, macOS signing/notarization and updater responsibilities. Do not alter current mobile signing or deploy the website for this work.

## Proposed acceptance matrix

| Area | Workloads and evidence required |
|---|---|
| Reuse | Same recipe/correction modules; automated preview/export comparisons; new code concentrated in shell/I/O/codec adapters |
| Video capacity | 1–2 GiB inputs, outputs >512 MiB, then 30–60 minute 4K SDR with audio; compare 5/15/60 min at fixed frame settings for bounded memory growth |
| Photo capacity | 48/80/150–200 MP JPEG/PNG; panoramas; supported HEIC/DNG; move above current limits only after safe baseline and decode gate |
| Quality | Pixel/tolerance comparisons for supported shared paths, crop/orientation, strip seams and halos, metadata; video frame timing, A/V sync, playable finalized MP4 |
| Failure recovery | Cancel during read/process/write/finalize, worker failure, disk full, removed drive, changed source, name collision, retry and stale completion |
| Hardware | Windows x64 and real Apple Silicon Mac; both a constrained machine and a higher-memory machine; log native process-tree memory, not just JS heap |
| Compatibility | Model loading, offline operation, custom model permissions, supported codecs, package updates; browser/mobile regression suite remains intact |

Targets above are experiments, not supported-size claims. Define material improvement before implementation: success on previously blocked large inputs/outputs with bounded duration-dependent memory, unchanged processing semantics and mostly shared code. A shell that runs the same full-memory pipeline with bigger constants is a no-go.

## Tradeoffs and scope decision

- Disk output trades temporary disk usage and I/O latency for lower retained encoded-output memory; it does not reduce per-frame computation.
- Incremental encoding may change JPEG bytes even at similar quality. Validate visual/pixel tolerances and metadata, not just file size; do not silently lower quality.
- Smaller previews improve responsiveness but cannot show every full-resolution detail; retain clear zoom/export feedback.
- Keep sequential large jobs initially. Concurrency can multiply decode/canvas memory and defeat the benefit.
- Moving inference to a native runtime is deferred until measurement identifies inference as the bottleneck. Current models already operate on small images.

**Proceed only if the shared-code prototype proves useful.** Video appears promising without an algorithm rewrite. Much larger photos are conditional. If the photo gate fails, present a video-first desktop scope for approval or stop; do not quietly expand this project into a new native imaging engine.

The October timing report remains historical context, not new capacity evidence: its 4K clip was two seconds, 12 fps, no audio, with no peak-memory measurement. This review performed no new long-video or high-resolution memory benchmark and had no Mac hardware. Next action is user review of this plan, not implementation.
