# Large photo and video resource review — 23 October 2026

## Scope and evidence

This is a source-level review of the current import, preview, correction and export paths, plus a synthetic browser benchmark. No user media was used. A fresh local production preview at `http://127.0.0.1:4197` was exercised in sequential fresh Edge contexts. The only generated fixtures were synthetic raster gradients/shapes and FFmpeg `testsrc2` videos. All five workloads completed without page errors. These are desktop timings, not peak-memory or phone performance evidence. The fixtures are highly compressible and do not represent noisy camera photos or high-motion footage, so their compressed sizes are not realistic input/output size forecasts.

The formulas below are allocation estimates from source, not observed peak RSS. They exclude browser decoder/encoder internals, GPU surfaces, allocator slack and implementation-dependent canvas copies. Existing desktop 12.2 MP photo finish results (3.11 s Off, 3.93 s Natural, 4.61 s Vivid, warm repeat 2) measure a different microbenchmark.

## Synthetic desktop measurements

Times are one pass per workload. `ready` runs from file selection until the editor enables its primary action; `export` runs from clicking Download to receiving and saving the download. Photo source and output dimensions matched. The app selected WWE for photos and Five A+ for videos. Video fixtures are two seconds at 12 fps; the editor reports 12 fps output. All exports completed without page errors.

| Fixture | Input | Ready | Export | Output |
|---|---:|---:|---:|---:|
| Photo 4000 × 3000 (12 MP) | 175 KB | 1.78 s | 2.06 s | 12 MP, 518 KB |
| Photo 6000 × 4000 (24 MP) | 274 KB | 1.65 s | 3.71 s | 24 MP, 797 KB |
| Photo 8000 × 6000 (48 MP) | 477 KB | 1.73 s | 7.36 s | 48 MP, 1.40 MB |
| Video 1280 × 720, 2 s | 446 KB | 0.75 s | 3.23 s | 1.04 MB |
| Video 1920 × 1080, 2 s | 973 KB | 0.87 s | 5.95 s | 1.83 MB |

Photo export time scaled with output pixel count in this run: 24 MP took about 1.8× the 12 MP time and 48 MP about 3.6×. This is consistent with full-resolution decode, strip processing and full-canvas encoding, but one run is not a general performance model. Video export scaled with frame dimensions for a fixed two-second/12 fps clip. Timings include browser startup-independent app work, encoder/download handling and disk save; they do not isolate each stage. JS heap and browser-reported memory were not collected because neither would capture all native canvas/video surfaces.

The complete machine-readable result and generated fixtures are in `analysis/adaptive-finish/fresh-review-bench-2026-10-23T10-24-08-704Z/report.json` and its sibling files. The runner's esbuild resolution now uses `editor/` for the `mediabunny` browser bundle, and `FFMPEG_PATH` can supply an FFmpeg binary to generate synthetic video fixtures when WebCodecs is unavailable in the fixture browser.

## 4K Source-mode video measurement

An optional `BENCH_LARGE_VIDEO_ONLY=1` run generated one 3840 × 2160, two-second, 12 fps H.264 test-pattern clip with FFmpeg, selected **Source · Resolution & frame rate**, exported it and verified the exported display dimensions. On the benchmark host (Windows x64, AMD Ryzen 7 H 255 with Radeon 780M, 31.3 GiB reported total RAM), the clip was 3.28 MB; editor ready time was 1.35 s and Source export took 20.26 s. The output was 3840 × 2160, two seconds, 2.20 MB. The export succeeded with no page errors. The selected correction engine was Five A+.

This fixture has no audio track, so it does not cover audio decode/encode or mux memory. It is only two seconds at 12 fps and therefore exercises 24 4K output frames; it does not characterize 30/60 fps or long-clip behavior. Source dimensions and H.264 compatibility were verified, but the actual encoder acceleration/backend was not identified. Host RAM is total reported memory, not free memory during the run. Synthetic pattern compression, desktop Edge and the local machine make this a path/timing observation, not a phone limit or a memory-safety guarantee. The report is `analysis/adaptive-finish/fresh-review-bench-2026-10-23T10-28-53-009Z/report.json` with generated files alongside it.

## Confirmed paths

Photo headers are read before ordinary raster decoding. `createImageBitmap` uses the selected export dimensions for large photos; large previews are capped to 2.56 MP / 1600 px long edge. Orientation is requested during decode and HEIC can fall back to `heic-to`. RAW uses a dedicated LibRaw worker and may create full-size intermediates before resize; half-size LibRaw development is selected for reduced/Auto budgets where possible. Auto budgets are 24 MP on mobile/coarse pointer or reported memory at or below 4 GB, 45 MP when memory is unknown, and up to 80 MP for desktop reporting at least 8 GB. Reduced is 12 MP. Full can attempt source dimensions. The hard input guard is 512 MiB, 200 MP and 32768 px per side.

Photo preview retains the decoded preview bitmap, a 1600 px capped OffscreenCanvas readback (`ImageData`), and a transferred original preview bitmap. Correction inference is cached at 256 × 256; it does not run a neural model over every full-resolution pixel. Large export decodes again on demand, retaining the preview during that work. It renders into a full-resolution output OffscreenCanvas, reads 256-row strips plus spatial-effect halo rows, and encodes the complete canvas to a Blob. Strip processing avoids a full-size intermediate float array and crops halos to avoid seams, but it does not make the output canvas or final encoded Blob incremental.

For a 200 MP image, one RGBA surface is about 800 MB (762.9 MiB); at the 80 MP Auto budget it is about 320 MB (305.2 MiB). A 32768-wide strip with 256 rows is 32 MiB before halos; the export simultaneously has a decoded bitmap and full output canvas, each roughly one RGBA surface. Input bytes, preview state, strip readback/processing arrays, encoder backing, final Blob and metadata work increase the peak. Thus the hard 200 MP guard is an acceptance ceiling, not evidence that every supported device can export it. Even 80 MP can require several hundred MB for the two principal surfaces before strip and encoder overhead.

Video import checks compressed bytes (512 MiB desktop/Android; 256 MiB iOS), duration (10 minutes), display-frame pixels (34 MP), codec, HDR and decoder support. The first preview frame is bounded to 960 × 540 and `CanvasSink` uses pool size 1. Export either fits to a compatible mode (up to 1080p/30 fps) or retains source dimensions/rate subject to codec checks; estimated output is capped at 256 MiB Compact and 512 MiB Source on desktop/Android, with iOS Source at 256 MiB. The worker transcodes through one full-size OffscreenCanvas and per-frame ImageData, then retains all MP4 bytes in Mediabunny `BufferTarget`. It wraps that buffer in a Blob at completion. Chunked native bridge transport does not bound this worker-side output buffer.

An uncompressed RGBA working frame at the 34 MP limit is about 136 MB (129.7 MiB). The canvas and a `getImageData` copy alone can account for about 272 MB per frame; decoder, encoder and color processing add more. A 512 MiB output held in `BufferTarget`, then exposed through a Blob, can approach another 1 GiB if the backing storage is copied. The exact copy behavior is runtime-specific; the code does explicitly retain `target.buffer` through Blob construction. Input is retained as a Blob during editing. This makes Source export on a low-memory device the clearest known pressure point.

## Practical interpretation and proposals

Keep the current Auto / Reduced / Full choices and the hard file, dimension, frame and duration guards until representative device measurements exist. The current Auto caps are risk controls rather than measured safe limits. Reported `navigator.deviceMemory` is optional/coarse and cannot represent available memory at the time of export. Keep the existing reduced retry after recoverable failures; a process killed by the OS cannot show that retry. Do not dynamically probe allocation limits by repeatedly allocating large surfaces.

For photo export, a useful adaptive policy should estimate the dominant surfaces before work begins, serialize large operations, and lower the chosen output budget after a recoverable decode/canvas/encode allocation error. A large width increases strip cost even when pixel count is moderate, so include dimensions as well as MP. A tiled or strip-backed final encoder could remove the full output canvas, but requires an encoder that accepts ordered pixel strips and preserves global enhancement math. Blur/sharpen halos, coordinate-dependent guided color transfer, metadata insertion, cancellation and PNG/JPEG quality all need parity checks. The current 256-row strip implementation is only a working-buffer optimization; it does not by itself support incremental final encoding.

For video, the strongest memory reduction is an output target that accepts streamed/chunked encoded bytes and a destination API that can consume them without rematerializing a Blob. It must preserve MP4 muxer seek/finalization requirements, cancellation cleanup, audio, metadata and the browser download / Android folder / iOS share routes. Lowering bitrate/resolution reduces the output buffer but is a quality change; current Compact/Source choices already express that tradeoff. Lowering frame rate or dimensions adaptively should be shown as a user-visible quality decision, never silently applied to Source. Avoid claiming a streaming implementation is feasible until the muxer/storage API contract is verified.

The benchmarks should be repeated in a browser process that can start reliably, first on desktop with 12, 24, 48 and 80 MP synthetic photo files and 720p/1080p video, then on representative iOS and Android hardware. Record time-to-preview, export time, output dimensions/size, recoverable errors and process-level peak working set where the OS can provide it. `performance.memory`/JS heap is not a substitute for bitmap, canvas, decoder, encoder or worker memory. Synthetic fixtures establish code-path behavior and rough scaling, not camera codec/RAW compatibility or phone acceptance.

## Benchmark status

`editor/scripts/large-media-bench.mjs` generates synthetic JPEG and MP4 inputs, imports them into a fresh app context, exports the result and records dimensions, compressed sizes, timings, page errors and host CPU/RAM metadata. Its video fixture uses WebCodecs when available or an explicitly supplied `FFMPEG_PATH`, producing a two-second 12 fps H.264 clip. `BENCH_LARGE_VIDEO_ONLY=1` runs just one 4K clip and selects Source mode. It does not measure peak process memory, so its report text limits claims to desktop latency. Default workloads test 12, 24 and 48 MP photos plus 720p and 1080p video. To extend to 80 MP later, update the photo case list after confirming available memory. Initial sandboxed Edge attempts failed to start; the successful reruns used the approved outside-sandbox browser and fresh preview at port 4197.

## References

- `editor/src/photo-decode.ts`, `editor/src/core/photo-size.ts`, `editor/src/core/platform-limits.ts`
- `editor/src/processor.worker.ts`, especially `load` and `export`
- `editor/src/video.worker.ts`, especially `load` and `export`
- `editor/src/core/media.ts` (`videoExportPlan` and output bitrate estimate)
- `editor/README.md`, “DNG and large photos” and video export sections
- `REVIEW_2026-10-23.md`, baseline findings and existing adaptive-limit proposal
