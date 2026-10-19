# Isolated adaptive photo finish experiment

This development harness does not change the editor, its default recipes, video, live camera, or native capture processing. The candidate module is not imported by production code.

From `editor`, start `npm run dev`, then run `node scripts/adaptive-finish-check.mjs`. Edge/Playwright and the existing bundled models are used locally. The runner defaults to the authorized local sample endpoint; it never copies samples into public assets. It writes only ignored `analysis/adaptive-finish/` outputs. Keep original images and all generated comparisons out of Git.

Optional PowerShell environment settings:

- `CHECK_URL`: local Vite origin (default `http://127.0.0.1:5173/`).
- `CHECK_MANIFEST`: local JSON array, or an object with a `samples` array. Entries contain `name`, `category`, optional recipe `hints`, optional `preserveRedCorrection`, and optional `crop: {x,y,size}`. Coordinates are normalized crop centers; size is source pixels. Do not commit private manifests.
- `CHECK_SAMPLE_LIMIT`, `CHECK_ENGINE_LIMIT`: positive integer limits.
- `CHECK_ENGINES`: comma-separated `balanced,wwe,fivea,shallow`.
- `CHECK_SYNTHETIC=1`: generated mechanics fixture only; this is not aesthetic evidence.
- `CHECK_REPORT_ONLY=1`: regenerate HTML from the saved report without inference. Current generator hashes are distinguished from measurement-time provenance.

Each sample/engine compares the corrected result, current Auto enhance, and three candidates: tone, colour-tone, and soft-water. Fit each candidate from the same corrected 256x256 reference, before any new finish. Reuse one guided neural field across all treatments; only WWE-UIE has the production 30% Balanced follow-up. Candidates replace the Auto enhance treatment and do not add its clarity/sharpness, so their detail appearance is not an isolated colour-only comparison.

The report includes whole-image contact sheets, true source-pixel crops, fit/fallback reasons, output statistics, and cold/warm timings. Open a crop image at native size to inspect 100%; the HTML overview scales images for browsing. Crop neural transfer uses the original coordinates; current spatial enhancement receives neighbouring pixels and full-source filter radii. Real inputs decode at full resolution sequentially on this desktop; this is not a phone memory benchmark. Timings cover preview and crop processing, not full-resolution export. The recorded renderer-only overhead percentage excludes neural field transfer; the report makes that denominator explicit. One timing repetition is exploratory, not a stable performance benchmark.

## P1 outcome, 19 October 2026

Implementation checkpoint: `72295d2`. Nine authorized photos, four engines and five treatments produced 180 comparisons without engine or browser errors. Whole images and selected source crops were inspected. Twelve new synthetic math tests cover no-op/JSON/strip parity, alpha, ramps, evidence fallback, shadows, highlights and validation; all 205 shared tests and the production build pass.

Keep tone-only as a natural-look experiment. Do not promote any candidate to the editor yet: colour changes are modest and unreliable as a useful distinction; the standalone pass is too expensive. Mean absolute RGBA byte changes from the corrected result were 1.74 (tone), 1.92 (colour-tone), and 1.82 (soft-water). Active-pass mean overhead including recorded transfer plus renderer was about 38%, 38%, and 42%; full-resolution export and mobile cost remain unmeasured. Most colour fits either fall back or remain conservative. Explicit physical-filter context prevents a second channel rebalance. A heuristic based on cool pixels does not identify background or establish true subject colour.

Next experiment: one bounded vivid candidate with modest chroma separation and the same noise/highlight/water/filter protections. Evaluate it against this retained baseline, then seek human visual feedback. Select a candidate and demonstrate a practical route to the 10% warm-render target before P2. If chosen, fuse application into the existing enhancement pass and persist one validated fit; do not stack two automatic stretches. Production integration has not started. No native build, version bump, merge or publication was performed; merge/release still require separate authorization.
