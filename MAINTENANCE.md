# Maintenance

## Development and checks

Use Node.js 24. From `editor`: `npm ci`, `npm run dev`. Verify with `npm test` and `npm run build`. Production testing: `npm run preview -- --port 4176`, then `$env:CHECK_URL='http://127.0.0.1:4176/'`. PWA needs HTTPS or localhost. Integration scripts use Playwright and installed Edge. Avoid concurrent memory-heavy checks.

| Area | Script under editor/scripts |
| --- | --- |
| RAW / resolution | create-photo-fixtures.py (Python), then photo-check.mjs (Node) |
| Photo finishing | enhancement-check.mjs |
| Metadata | metadata-check.mjs |
| Navigation / saving | browsing-check.mjs |
| Async UI state | ui-state-check.mjs (synthetic fixtures) |
| Compact touch layout | touch-target-check.mjs (CHECK_URL and PLAYWRIGHT_CHANNEL supported) |
| Layered mobile controls | layered-controls-check.mjs (synthetic input; CHECK_URL and PLAYWRIGHT_CHANNEL supported) |
| Saved custom model | custom-model-check.mjs (bundled model as the test input) |
| Controls / adapter | controls-check.mjs |
| Video / AI video | video-check.mjs, video-ai-check.mjs |
| Guide | about-check.mjs |
| Languages | i18n-check.mjs |
| PWA / updates | pwa-check.mjs, update-check.mjs |

Some checks need ignored local fixtures: consult local notes and script input paths. Do not commit personal fixtures to make CI pass. Generated results belong in ignored analysis directories. CI runs unit tests/build; current baseline is 64 tests.

## Languages

Three catalogues live in `editor/src/locales`: en.json, zh-HK.json and ja.json. English source phrases are lookup keys. Use `t('English phrase')` in UI and `{0}`, `{1}` parameters for whole sentences containing filenames/counts; avoid concatenating translated fragments. Add each key to all three files. Tests enforce matching keys/placeholders and check literal UI lookups against the English catalogue. Keep product/model names, URLs, recipe identifiers and filenames unchanged. Save all files as UTF-8.

`i18n-core.ts` provides pure translation/detection and known-message matching; `i18n.tsx` owns the observable language preference. Components subscribe with useLanguage. The compact selector appears in the editor and About. Selection persists under clearwater-language; unavailable localStorage still permits in-memory selection. All Chinese browser locales currently default to Hong Kong Traditional Chinese, with English fallback for unsupported languages. No network translation or external font dependency is introduced.

Workers and stored recipe explanations stay in English; use message() at presentation for known errors/statuses. Unknown OS, codec and third-party diagnostics remain verbatim for troubleshooting, and original licence/source files remain authoritative English text. Do not pass locale changes through recipe or worker-load dependencies. Check 320/390-pixel layouts, radio groups, dialogs, live edits and reload persistence in all languages. Hong Kong vocabulary uses 相片、影片、解像度、資料夾 and standard written Chinese rather than Cantonese.

## Web release

Commit and push main. `.github/workflows/pages.yml` builds with `VITE_BASE_PATH=/clearwater/` and publishes `editor/dist`. Verify the exact commit's workflow before claiming deployment. Test nested workers/WASM/model URLs on Pages, not just localhost.

Service-worker lists are build-generated. Preserve optional-asset caching. The update icon saves the latest recipe, activates a new worker and reloads. Offline failure must retain files/edits; `update.html` recovers stale installs. Never clear IndexedDB to update.

## Android

Requires Android SDK and Android Studio JBR. From `editor`:

```powershell
npm run android:sync
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
cd android
.\gradlew.bat assembleDebug --console=plain
```

Output: `editor/android/app/build/outputs/apk/debug/app-debug.apk`. Current debug configuration is minified, resource-shrunk, debug-signed and not debuggable. Verify with SDK `apksigner verify --verbose`. Inspect new assets inside APK; Android rewrites `.gz` asset names, so corresponding-source archives use `.zip`. User installs manually; do not assume ADB or install without a request.

Project configuration explicitly uses the standard Android debug keystore, not production release signing. Follow user restricted-folder rules. Never search unrelated locations for signing credentials. Use only an exact keystore explicitly referenced in project configuration, only for that build; never copy, print, commit or alter keystores/secrets.

## Dependencies, licences and data

Use package-lock.json/npm ci. Review preprocessing, shape and parity before replacing model weights. Supplied Shallow-UWnet/FUnIE-GAN carry MIT notices. Custom ONNX contract: RGB float32 NCHW `[1,3,256,256]`, unit/signed ranges. Validated custom weights and ranges are saved on the user's device; they are never bundled or uploaded. Generic loading grants no licence rights. Preserve the previous saved model when validating or saving a replacement fails, and check the saved SHA-256 before reuse. Restoring a model must not switch an unrelated Balanced/AI recipe to the custom engine.

LibRaw bindings pinned at @colorhythm/libraw-wasm 1.1.1 / LibRaw 0.22.1. Keep MIT bindings, chosen CDDL notices, copyright and matching source archives. Mediabunny source/licence material is bundled too. Attribution is in About and public licence/model notes; do not remove source offerings to reduce size.

Metadata rebuilds supported EXIF/GPS and normalises orientation/dimensions/sRGB. MakerNotes, thumbnails, XMP/IPTC and source ICC are excluded. Failures leave a usable export plus warning. Do not promise metadata missing at import or copy RAW calibration tables into EXIF.

## Documentation and rollback

Keep public handoff/maintenance concise; editor README holds the detailed feature contract and public asset directories hold provenance. Private fixture/restricted-model notes go in gitignored root LOCAL_NOTES.md, outside public assets. Ignore rules do not remove information already in Git history; history rewriting is a separate decision.

Check git status/staged paths and diff whitespace before committing. Create checkpoints before major processing changes. Prefer revert commits for published regressions, rebuilding both platforms. Never discard unrelated edits or reset user data. Diagnose colour ranges, orientation, preview/export parity, generation IDs and buffer lifetime before changing algorithms.

Photo finishing: preserve old recipe defaults, global preview-derived tonal endpoints, luminance-based colour ratios, alpha weights and export halo rows. Never analyse black/white points independently per strip. Test portrait and landscape halo-strip parity, low-noise flat regions, transparent pixels and neural-engine finishing. Spatial finishing is deliberately unavailable for video pending temporal/performance work.

Responsive tabs change control visibility only: retain a single set of inputs, canvases, object URLs and workers. Test the 650px breakpoint in both directions, all tab groups, keyboard focus, expanded mode and the photo-to-video Effects fallback. Unknown depth is stored as null (Balanced extra-red depth factor 1.0), distinct from explicit zero metres (factor 0.75); its checkbox must be undoable. Effects brightness is optional in version-1 recipes, defaults to zero and uses the existing photo luminance pass. Keep its preview/export parity and old-recipe identity checks.

## Reliability review (October 2026)

The audit added regression coverage for superseded photo previews, disabled-enhancement processing, optional-cache quota failures, aborted share transactions, and Android temporary-share cleanup. UI fixes bind asynchronous recipe imports to their original photo, keep incoming shares from switching away during export/model loading, and unload processing when the last photo is removed. Keep these checks when refactoring state or workers.

Remaining improvements, in priority order:

- Touch accessibility: controls now use wider hit areas (44px sliders, mostly 40px icon actions, 36px toolbar widths on the narrowest layout), with wrapping for long folder counters. Include screen-reader, physical-keyboard and real-phone checks; avoid overlapping invisible hit boxes when changing the compact layout.
- Extreme photo exports: benchmark peak memory on actual phones before changing strip sizing. At the maximum legal width, a 448-row enhancement strip contains 14.7 million pixels; each RGBA/Float32 buffer is 56 MiB, and several coexist. Smaller strips trade memory for repeated halo processing. Existing Auto/Reduced options remain the practical fallback; the Full ceiling is not a memory guarantee.
- Large libraries: profile hundreds of imports and folder visits, then consider a bounded thumbnail list and library storage usage/cleanup controls. Do not silently remove originals or recipes to reclaim space.

Browser checks and mocked Android bridges cannot verify real SAF provider dialogs, phone memory pressure or device-specific HEVC support. Keep those in the manual device smoke test. A clean dependency advisory scan is a point-in-time result, not a security audit.
