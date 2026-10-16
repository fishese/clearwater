# Maintenance

## Active iOS catch-up checkpoint (16 October 2026)

The prior IPA/native test results below are historical. The user confirmed the iPhone editor and camera work, then reported missing automatic Photos copies and a private MP4 read failure. The catch-up integrates origin/main `3298d69` in the iOS feature worktree only. Run the shared suite/production browser regressions and full hosted native tests plus unsigned physical-device packaging after Swift changes. Keep Android physical tests paused and Android files identical to current origin/main.

Capacitor 8.5.3 serves media extensions through `URLResponse` without a range header, unlike JPEGs. Explicit `Range: bytes=0-` selects its HTTP 206 path for private MP4 reads. Verify bytes and size; do not accept arbitrary failed/empty responses. `NativeSceneBridgeTests` exercises the real WKWebView transport rather than inferring iOS behavior from a browser mock. Photos copies use add-only permission and never store asset IDs; private-save and Photos-save status remain independent.

## Development and checks

Use Node.js 24. From `editor`: `npm ci`, `npm run dev`. Verify with `npm test` and `npm run build`. Production testing: `npm run preview -- --port 4176`, then `$env:CHECK_URL='http://127.0.0.1:4176/'`. PWA needs HTTPS or localhost. Integration scripts use Playwright and installed Edge. Avoid concurrent memory-heavy checks.

| Area | Script under editor/scripts |
| --- | --- |
| RAW / resolution | create-photo-fixtures.py (Python), then photo-check.mjs (Node) |
| Photo finishing | enhancement-check.mjs |
| Metadata | metadata-check.mjs |
| Navigation / saving | browsing-check.mjs |
| Async UI state | ui-state-check.mjs (synthetic fixtures) |
| Mobile text / footer / desktop Effects inset | mobile-readability-check.mjs |
| Compact touch layout | touch-target-check.mjs (CHECK_URL and PLAYWRIGHT_CHANNEL supported) |
| Layered mobile controls | layered-controls-check.mjs (synthetic input; CHECK_URL and PLAYWRIGHT_CHANNEL supported) |
| Expanded fit and gestures | expanded-gesture-check.mjs (synthetic input; CHECK_URL supported) |
| Saved custom model | custom-model-check.mjs (bundled model as the test input) |
| Controls / adapter | controls-check.mjs |
| Video / AI video | video-check.mjs, video-ai-check.mjs |
| Android HDR import | hdr-import-check.mjs (synthetic tagged clip and mocked native bridge; device testing still required) |
| Collection clearing | clear-collection-check.mjs |
| WWE-UIE parity / editing | wwe-model-check.mjs (export parity fixture required) |
| Guide | about-check.mjs |
| Languages | i18n-check.mjs |
| PWA / updates | pwa-check.mjs, update-check.mjs |

Some checks need ignored local fixtures: consult local notes and script input paths. Do not commit personal fixtures to make CI pass. Generated results belong in ignored analysis directories. CI runs unit tests/build; current baseline is 113 tests.

## Languages

Three catalogues live in `editor/src/locales`: en.json, zh-HK.json and ja.json. English source phrases are lookup keys. Use `t('English phrase')` in UI and `{0}`, `{1}` parameters for whole sentences containing filenames/counts; avoid concatenating translated fragments. Add each key to all three files. Tests enforce matching keys/placeholders and check literal UI lookups against the English catalogue. Keep product/model names, URLs, recipe identifiers and filenames unchanged. Save all files as UTF-8.

`i18n-core.ts` provides pure translation/detection and known-message matching; `i18n.tsx` owns the observable language preference. Components subscribe with useLanguage. The compact selector appears in Settings, opened by the editor/About gear. Selection persists under clearwater-language; unavailable localStorage still permits in-memory selection. All Chinese browser locales currently default to Hong Kong Traditional Chinese, with English fallback for unsupported languages. No network translation or external font dependency is introduced.

Workers and stored recipe explanations stay in English; use message() at presentation for known errors/statuses. Unknown OS, codec and third-party diagnostics remain verbatim for troubleshooting, and original licence/source files remain authoritative English text. Do not pass locale changes through recipe or worker-load dependencies. Check 320/390-pixel layouts, radio groups, dialogs, live edits and reload persistence in all languages. Hong Kong vocabulary uses 相片、影片、解像度、資料夾 and standard written Chinese rather than Cantonese.

## Web release

Commit and push main. `.github/workflows/pages.yml` reads the deployment base path from `actions/configure-pages` before building (`/clearwater/` for the project URL, `/` for a custom domain) and publishes `editor/dist`. Custom-domain and project URLs have separate browser storage; imported libraries and user models do not migrate automatically. Changing the Pages custom domain requires rerunning this workflow; the previously built asset paths do not change automatically. Verify the exact commit's workflow before claiming deployment. Test nested workers/WASM/model URLs on Pages, not just localhost.

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

Debug builds use the standard Android test keystore. Release builds load only the four signing properties (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) from gitignored `editor/android/keystore.properties`; use forward slashes in the configured Windows path. Missing configuration fails a requested release build. Run `assembleRelease` after `android:sync` for a minified release-signed APK. Never publish the properties file. Follow user restricted-folder rules. Never search unrelated locations for signing credentials. Use only an exact keystore explicitly referenced in project configuration, only for that build; never copy, print, commit or alter keystores/secrets.

## Dependencies, licences and data

Use package-lock.json/npm ci. Review preprocessing, shape and parity before replacing model weights. Supplied Shallow-UWnet carries an MIT notice; WWE-UIE carries Apache-2.0; Five A+ is non-commercial only (see `editor/public/models/NOTICE-FiveAPlus.txt`). Quantised bundles use the `parity_tolerance` in `editor/public/models/manifest.json` rather than `1e-4`. Android HDR conversion uses unmodified Media3 1.11.1 (Apache-2.0). Custom ONNX contract: RGB float32 NCHW `[1,3,256,256]`, unit/signed ranges. Validated custom weights and ranges are saved on the user's device; they are never bundled or uploaded. Generic loading grants no licence rights. Preserve the previous saved model when validating or saving a replacement fails, and check the saved SHA-256 before reuse. Restoring a model must not switch an unrelated Balanced/AI recipe to the custom engine.

LibRaw bindings pinned at @colorhythm/libraw-wasm 1.1.1 / LibRaw 0.22.1. Keep MIT bindings, chosen CDDL notices, copyright and matching source archives. Mediabunny and HEIC/HEIF decoder (heic-to/libheif) source/licence notices are bundled too. Attribution is in About and public licence/model notes; do not remove source offerings to reduce size.

Metadata rebuilds supported EXIF/GPS and normalises orientation/dimensions/sRGB. MakerNotes, thumbnails, XMP/IPTC and source ICC are excluded. Failures leave a usable export plus warning. Do not promise metadata missing at import or copy RAW calibration tables into EXIF.

## Documentation and rollback

Keep public handoff/maintenance concise; editor README holds the detailed feature contract and public asset directories hold provenance. Private fixture/restricted-model notes go in gitignored root LOCAL_NOTES.md, outside public assets. Ignore rules do not remove information already in Git history; history rewriting is a separate decision.

Check git status/staged paths and diff whitespace before committing. Create checkpoints before major processing changes. Prefer revert commits for published regressions, rebuilding both platforms. Never discard unrelated edits or reset user data. Diagnose colour ranges, orientation, preview/export parity, generation IDs and buffer lifetime before changing algorithms.

Photo finishing: preserve old recipe defaults, global preview-derived tonal endpoints, luminance-based colour ratios, alpha weights and export halo rows. Never analyse black/white points independently per strip. Test portrait and landscape halo-strip parity, low-noise flat regions, transparent pixels and neural-engine finishing. Spatial finishing is deliberately unavailable for video pending temporal/performance work.

Responsive tabs change control visibility only: retain a single set of inputs, canvases, object URLs and workers. Test the 650px breakpoint in both directions, all tab groups, keyboard focus, expanded mode and the photo-to-video Effects fallback. Unknown depth is stored as null (Balanced extra-red depth factor 1.0), distinct from explicit zero metres (factor 0.75); its checkbox must be undoable. Effects brightness is optional in version-1 recipes, defaults to zero and uses the existing photo luminance pass. Keep its preview/export parity and old-recipe identity checks. Auto enhance uses optional `autoApplied` visual metadata; manual Effects edits clear the marker. Verify outlined/filled states through undo, redo and reload without adding visible status labels. Expanded preview gestures must preserve recipe/history: test pinch with the picker armed, pointer cancellation, comparison dragging, pan reachability and zoom controls above the mobile adjustment sheet.

## Reliability review (October 2026)

The audit added regression coverage for superseded photo previews, disabled-enhancement processing, optional-cache quota failures, aborted share transactions, and Android temporary-share cleanup. UI fixes bind asynchronous recipe imports to their original photo, keep incoming shares from switching away during export/model loading, and unload processing when the last photo is removed. Keep these checks when refactoring state or workers.

Remaining improvements, in priority order:

- Touch accessibility: controls now use wider hit areas (44px sliders, mostly 40px icon actions, 36px toolbar widths on the narrowest layout), with wrapping for long folder counters. Include screen-reader, physical-keyboard and real-phone checks; avoid overlapping invisible hit boxes when changing the compact layout. Desktop mouse removal is a 24px action in a separate thumbnail filename row; touch layouts retain larger targets. Keep the collection heading/count separate from its clear action, and custom-model Load/Forget actions on one row.
- Extreme photo exports: benchmark peak memory on actual phones before changing strip sizing. At the maximum legal width, a 448-row enhancement strip contains 14.7 million pixels; each RGBA/Float32 buffer is 56 MiB, and several coexist. Smaller strips trade memory for repeated halo processing. Existing Auto/Reduced options remain the practical fallback; the Full ceiling is not a memory guarantee.
- Large libraries: profile hundreds of imports and folder visits, then consider a bounded thumbnail list and library storage usage/cleanup controls. Do not silently remove originals or recipes to reclaim space.

Browser checks and mocked Android bridges cannot verify real SAF provider dialogs, phone memory pressure or device-specific HEVC support. Keep those in the manual device smoke test. A clean dependency advisory scan is a point-in-time result, not a security audit.

Branding: supplied rounded SVG is `editor/public/icon.svg`; supplied 16/32/192/512 PNGs serve favicons/PWA, and 180px serves Apple touch icons. The square master is `editor/branding/icon-square-1024.png`. Android legacy launcher sizes are 48/72/96/144/192px; round variants use a circular alpha mask. Adaptive foreground canvases are 108/162/216/324/432px, with square artwork centred at two-thirds canvas width (72dp within 108dp) so launcher masks keep the fish visible. Splash PNGs retain their existing dimensions, with a centred icon at 30% of the shorter side on #101c20. Original supplied variants stay in the ignored reference folder. Review launcher masks on a device when replacing artwork.

HDR validation: native compilation and mocked bridge/protocol tests do not prove device tone-mapping quality. Test original iPhone MOV clips on an Android 10+ phone: bright highlights, dark water, rotated portrait, long clips, audio sync, cancel during staging/conversion, removal/reselection, and original file preservation. The comparison uses the converted SDR copy. Keep the web HDR rejection helpful, and never reinterpret HDR values as SDR.

Collection clearing must remove only app library records and recipes, preserve pending shares and independent settings/model storage, and leave external files untouched. Cover transaction failure, pending writes, reload and all three locale layouts. Generated IDE/release files and signing credentials are not release source files.

Recent regression coverage: new-photo WWE-UIE + 30% Balanced defaults, existing-recipe retention, top-aligned expanded Fit, zoom/pinch/pan/picker separation, About Back, root double-Back exit, and full ten-minute sampled AI export. Expanded/browser checks wait for asynchronous layout observers and open collapsed engine controls after viewport changes. Physical Android checks confirmed expanded positioning and About/expanded/root Back behaviour; HDR camera-format compatibility still requires separate device fixtures.

For each stable Android release, use a plain version name and increment versionCode above every previously distributed build. Build from a committed revision, verify APK signatures and embedded version metadata, and publish the APK with release notes against that exact Git tag. Debug and release signing keys differ; updating an existing installation requires matching signatures.

Camera checks: run `node scripts/camera-check.mjs` from `editor` against a production preview (CHECK_URL optional, default port 4176). Playwright Chromium uses synthetic camera/microphone devices: no real surroundings are captured. The check compares actual WebGL output with the CPU renderer, verifies locale layouts, raw JPEG import, MP4/audio corrected-canvas recording, zero-strength editor import and further export, and permission-denial recovery. Unit tests cover MP4-only MIME selection, capture limits, recipe smoothing and cleanup. Also manually test Android permission denial/retry, rotation, app switching, camera flip, recording cancel/Back, audio sync, thermal load and long recordings. Browser checks do not prove phone camera quality or hardware codec compatibility.

Repeated-camera checks must assert the camera remains open after photo and stopped video, saved originals/recipes survive reload, and manual exit loads the last shot. Native gallery writes use 256 KiB chunks and publish only completed pending rows; abort/error/destroy must remove incomplete entries without touching previous captures or SAF export files. Test real Android gallery visibility, storage-full behaviour and retention after Clear collection. Older Android app-specific copies are not public gallery files. Camera WB must not reset during the 500 ms analysis cycle; reset, flip and camera restart intentionally release the lock.

Run `node scripts/camera-save-check.mjs` for the mocked Android capture bridge: multi-chunk JPEG/MP4 byte integrity, commit/abort and invalid-input checks. This does not execute MediaStore itself; native compilation and real-device gallery tests remain separate.

## Offline settings regression checks

`node scripts/offline-models-check.mjs` verifies the actual worker with controlled model payloads: selection, stop/retry, SHA-256 rejection, offline fetch, reuse after UI updates, changed-model downloads and targeted deletion. `node scripts/settings-check.mjs` checks installed-PWA automatic defaults with real bundled assets, removing and restoring Five A+, manual download with auto disabled, language layouts, parent Back/Escape, saved preferences and cold offline WWE inference. `settings-helpers.mjs` keeps language-navigation setup shared by browser checks. Run browser scripts against production builds; CHECK_URL defaults to port 4176 where supported. Android packages skip web caching and already contain every supplied model.

Stable release publishing: verify the signed APK, copy it to `editor/android/build/clearwater-release.apk`, generate `clearwater-release.apk.sha256`, and attach both using `gh release upload <tag> ... --repo fishese/clearwater` alongside the versioned APK. Check the constant `releases/latest/download/clearwater-release.apk` URL returns the expected release. Never point that alias to a debug/experimental APK.

Linked camera regression checks: `camera-archive-check.mjs` exercises real IndexedDB v1 migration, original-byte preservation, metadata updates/filename aliasing, clear/recovery, pending shares and deletion. `linked-camera-check.mjs` uses a synthetic camera and mocked Android bridge: the gallery JPEG matches the CPU correction, Save updates one URI, clear/recover makes no duplicate, missing/unavailable/trashed states are handled conservatively, and confirmed delete removes both stores. `camera-save-check.mjs` covers chunked same-URI replacement and probes. Native Java compilation is separate; real gallery thumbnail refresh, trash/restore, storage failures and cloud-provider behaviour still need a phone check.

Keep service-worker share intake and storage.ts on the same database version (currently 2) and create both stores during upgrade. Never change existing ordinary imports into camera-owned records by guessing filenames. Preserve camera-originals in Clear collection, flush current camera edits first, and block delayed persistence while removing records. Missing-source cleanup must not treat permission/provider errors as deletion. Collection ordering and long-press selection suppression are covered by mobile-readability-check.mjs in all languages.

Camera recording settings are persisted separately from per-file recipes. Snapshot the selected duration/byte guard when recording starts; changing Settings cannot mutate a live recording. Encode the corrected canvas at capped preview resolution, retain optional microphone audio, and stop only canvas output tracks on recording completion (keep camera preview open). New video gallery and private source bytes must match; no extra raw video is stored. Legacy raw videos keep their prior editable recipes. Check 1/3/5-minute boundaries with unit tests and short synthetic recordings; manual long device tests cover thermal throttling, sound sync and low storage.
`camera-settings-check.mjs` verifies persistence and EN/Chinese/Japanese responsive option rows, then advances a synthetic recording clock to test the 3-minute automatic stop without waiting for a long recording. Real 3/5-minute phone recording remains the thermal/audio test.

Quality checks: Auto must resolve High on Android and Standard on web, while explicit overrides persist. Budget estimates/byte guards must reflect the selected profile and keep camera inputs below the 512 MiB import ceiling. Verify actual negotiated stream sizes and corrected-canvas caps rather than upscaling smaller cameras. Profile frame/bitrate targets are requests; phone codec, dropped frames and thermal behaviour require device testing. Preserve JPEG quality through both raw capture and visible gallery encoding.

## Release 1.0.2 review and iOS feasibility

The camera progress display updates only for visible whole seconds/percentages; exact references still enforce time/byte limits. Android bridge base64 encoding uses bounded 32 KiB batches inside existing 256 KiB writes, reducing transient string operations without changing the wire format. Settings camera radio groups have accessible names; guide index/release-note links have larger touch targets. The update browser check must open Enhancement / Colour before interacting with Warmth.

An iOS port is feasible but is not implemented or device-validated. Keep its work separate from the Android stable release. Capacitor 8 requires Xcode 26+ on macOS (iOS deployment minimum 15); the editor's actual supported iOS version must also be determined by OffscreenCanvas, WebCodecs, WASM and camera tests. GitHub's standard hosted macOS runners can build a device-targeted unsigned app for a sideloading IPA; this public repository qualifies for free standard runner usage under current GitHub rules. Windows Sideloadly handles local signing/install, not compilation. Free Apple Personal Team profiles expire after seven days; Sideloadly documents up to one year with a paid developer account. Refresh before travel; expiry is separate from offline editing support. Keep Apple credentials out of repository/CI when signing locally.

Suggested first milestone: add @capacitor/ios matching core, generate an iOS shell and manually dispatched macOS build workflow, package all bundled models, disable web service-worker update/cache UI on every native platform, and set camera/microphone privacy descriptions. Validate file import, workers/WASM, camera capture, MP4 encoder availability and foreground/background handling on a physical iPhone. Start with photo editing and export through native share/save. Android MediaStore/SAF, share intake, linked gallery updates/deletion, HDR conversion and Back plugins have no iOS implementations; an iOS Files/Photos bridge and permissions are separate work. Do not advertise Android gallery behavior on iOS until implemented. Prefer recent iOS for the first test build, and feature-detect unavailable video features.

Sources checked 14 October 2026: [Capacitor 8 requirements](https://capacitorjs.com/docs/updating/8-0), [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Apple account limits](https://developer.apple.com/help/account/basics/about-your-developer-account), [Sideloadly FAQ](https://sideloadly.io/faq.html).

The detailed native-camera architecture, independent Photos-save semantics, repository strategy, milestones and implementation-session prompt are in [IOS_PLAN.md](IOS_PLAN.md). This supersedes the initial iOS gallery-linking suggestion above; gallery linking is excluded from the iOS scope.

## Experimental iOS milestone 1

From `editor`, use `npm ci`, `npm test`, `npm run ios:sync` (root-relative build and iOS-only sync). Windows can generate/sync web assets; Xcode compilation runs on macOS CI. Run `node scripts/ios-shell-check.mjs` against a production preview for mocked iOS guards/import/share/reload. This is a browser mock, not a WKWebView or Swift runtime test.

Initial branch-only dispatch: `gh workflow run pages.yml --ref codex/ios-native-camera --repo fishese/clearwater`. This branch routes that manual event to `ios-build.yml` and gates Pages deployment to main. The new workflow also supports direct manual dispatch once registered on the default branch; no main merge is authorized at this stage. Download the unsigned IPA/checksum/commit artifact from the successful exact-commit run. Never use a simulator app for Sideloadly. Sign/install only on the user's machine; see IOS_PLAN.md for phone acceptance and signing-expiry constraints. No stable release or Android signing/version change belongs to this milestone.

Shell target is currently iOS 26.0. Capacitor 8.5.3 emits a Swift tools 5.9 package with `.iOS(.v26)`; the iOS sync script upgrades that declaration to 6.2 before Xcode resolution. Successful build: run 38566623629 at bc107a1, Xcode 26.6. Downloaded artifacts are ignored under `editor/ios/App/output/milestone1`. IPA checksum/phone gate and test results are recorded in IOS_PLAN.md. Browser folder pickers are gated to the web; iOS uses native sharing. For the checksum sidecar compare the hash itself: CI's original sidecar records its runner path.

Native export regression: the shared App scheme now contains a hosted AppTests target. CI launches the actual iOS simulator app in Release with testability enabled, verifies the connected scene uses ClearWaterBridgeViewController, checks ClearWaterExport availability in its WKWebView, and executes begin/write/finish/discard. Test results are uploaded as a separate xcresult artifact. Physical-device packaging remains a separate unsigned arm64 build. This test does not validate the Photos/Files share destinations; the phone must still test those.

Native regression defaults on through the `ios_native_tests` dispatcher input. Device IPA packaging runs independently so a simulator delay does not hide a valid package. For a packaging-only rebuild of unchanged native code already verified by the hosted test, use `gh workflow run pages.yml --ref codex/ios-native-camera --repo fishese/clearwater -F ios_native_tests=false`. Cold runner test time was 719 seconds in the successful export-startup regression; the native job and step have explicit time limits.

## Native iOS camera implementation checkpoint (14 October 2026)

The user accepted the repaired shell export on a phone and accepted the current EXIF-preservation warning temporarily. Work proceeds on `codex/ios-native-camera` toward persistent AVFoundation still capture and enhanced MP4 recording. The first native camera build is not yet phone-validated.

Native implementation uses a local `ClearWaterCamera` plugin, a full-screen UIKit/MTKView camera, a small Metal Balanced kernel and CPU analysis/WB math. Synthetic fixtures generated from the shared TypeScript engine are included in hosted XCTest for numerical parity. `ClearWaterMovieWriter` writes H.264/AAC MP4 incrementally using bounded pixel buffers and original capture timestamps; no recording-length JavaScript Blob is used during capture. Camera photos use the photo output and a frozen recipe; camera videos contain the frozen correction and begin editor use with neutral manual adjustments and zero Balanced strength.

Capture descriptors use bridge schema 1 and recipe version 1. The private manifest plus per-capture records own original photo bytes, enhanced retry copies, enhanced video and small thumbnails. Collection hydration reads thumbnails first and loads a selected source only when needed. Clearing visibility keeps recovery sources; explicit private deletion never deletes Apple Photos copies. Interrupted staged writes and deletion commits need the native recovery regressions, while interruption/thermal/memory/audio behavior requires phone tests.

Continue using the manually dispatched feature-branch macOS workflow. Native tests now verify scene/plugin registration, shared-engine parity, storage recovery and the production MP4 writer. A successful simulator or unsigned build alone does not establish camera hardware quality, recording performance or Photos permissions. Record the exact commit, tests, IPA checksum and outstanding phone tests in IOS_PLAN.md and HANDOFF.md after CI completes.

Shared camera checks pass: 126 tests, production build and native-camera browser mock including delayed inventory/Close. The iOS dispatcher concurrency group is isolated from Pages. Physical-device package validation explicitly checks compiled native plugin classes and the Metal library, alongside offline assets/privacy/platform checks. Synthetic fixture tolerances are CPU byte error <=1, analysis/suggestion/WB <=1e-6 and GPU byte error <=3. Report actual hosted outcomes/skips; do not assume a GPU was available.

Run scripts/ios-camera-check.mjs against a production preview using CHECK_URL (task preview port 4186). This mocks Capacitor/native files, not hardware. Consult the native-camera phone gate in IOS_PLAN.md before interpreting sensor size, colour, audio, thermal or storage results.

## Model and export quality update (15 October 2026)

PR #1 is merged into main. Bundled weights are WWE-UIE (932,006 bytes), Five A+ (854,937) and Shallow-UWnet (230,185), total 2,017,128 bytes. Photos retain WWE-UIE + Balanced after AI; videos default to Five A+ sampled colour, while live camera stays Balanced. Removed-engine recipes migrate to WWE-UIE; old offline selections migrate the retired slot to Five A+. Model validation uses platform-correct file URLs. `model-tools/export_models.py` produces full-precision validation artifacts under ignored `.model-tools/generated-validation/`, never the optimised shipping files/manifest. Do not overwrite deployed weights by rerunning the old export workflow.

Video regression now includes a generated 1440p60 clip, AAC audio, title/comment and MP4 creation-date round trips, plus metadata opt-out. Header parsing is bounded and malformed/date cases have unit coverage.

The quality investigation confirmed the previous 1080p30 cap, at most 8 Mbps, duration-driven bitrate reduction, 8-bit SDR processing and metadata loss. Source export now requests original display dimensions and leaves frame-rate conversion unset to retain source timestamps (including VFR). Its target scales with pixel count/rate, bounded to 8–36 Mbps, with an explicit estimated-size refusal and a 512 MiB write guard. Compact retains the existing 256 MiB cap/1080p30/downward bitrate adjustment. Defaults remain Compact for memory compatibility. Output still uses BufferTarget and can need several times the encoded size in RAM; a 512 MiB ceiling is not a guarantee the phone can finish. Raising/removing this ceiling should follow a separate disk/streaming-target implementation across browser and native saving. Source mode has no effect on an HDR working copy's already reduced resolution/SDR data.

`videoExportPlan` is shared by UI and worker. Encoder capability checks must include dimensions, bitrate and observed source rate without imposing a new CFR on Source conversion. Estimates are approximate, include audio/headroom and must not silently lower Source quality. Keep exact source timestamps, portrait rotation, cancellation, metadata opt-out and canvas cleanup covered. Primary AAC can be copied when the conversion library deems it compatible; other audio needs a supported decoder and AAC encoder. If unavailable, retain the explicit error and user-selected silent export rather than silently removing sound. Audio support is device-dependent.

Maximum JPEG requests .99; default remains .95. Browser chroma subsampling is outside the quality setting. PNG stores the rendered 8-bit sRGB pixels losslessly, not the original RAW/P3 values. AI residual interpolation has image-size-dependent colour smoothing rather than a fixed 16px footprint. UserComment preservation reads bounded JPEG EXIF APP1 bytes through piexifjs to avoid exifr's lossy text conversion. Non-JPEG/malformed metadata remains best effort; do not assume all metadata blocks or proprietary fields survive.

Tests added for video plan/cap/metadata allowlist, Maximum/default JPEG quality and raw Unicode UserComment bytes. Run video-check (including its high-resolution round-trip), video-ai-check, metadata-check, About and multilingual mobile layout checks against a production preview. Physical 4K/60 encoding, memory and HDR compatibility require device tests; browser mocks are insufficient.

The quality preview APK is version 1.0.3-quality.1 (code 14), debug-signed for manual testing. It is not a stable release. Stable signed APK v1.0.2 remains the Settings install target until device acceptance of these changes.

Current-main merge validation (15 October): shared suite is now 142 tests / 25 files, with current model/export/metadata fixes. Native suite passed 17 tests with 0 failures/no skips in run 38731452603 at ee22678; all native sources/fixtures remain identical after merging main 233331d. Package validation now derives all required ONNX files from the shipping manifest and verifies size/SHA-256, excluding retired/unlisted weights. A packaging-only final run is valid for this unchanged tested native code.

Final delivery: unsigned arm64 iOS 26 camera IPA at 17d45e9, run 38733242340, artifact 11971123853; local editor/ios/App/output/native-camera/ClearWater-unsigned.ipa. SHA-256 bd30bcbe8948e941b9a10459f1d7d9e3913d4efee3e7f2df93b165f8dc099252 verified against CI. Final packaging ran 142 shared tests and current manifest checks; identical native code already passed 17 hosted tests at ee22678. Hardware acceptance is outstanding in IOS_PLAN.md. Preserve the worktree for follow-up; no main/stable/signing changes.
## Native camera and editor preview follow-up

The current prepared experimental debug build is 1.0.3-camera.5 (code 19). Native Android camera uses CameraX 1.6.2, Media3 1.11.1 and the CameraX Media3 adapter 1.0.0-alpha04. Keep the adapter version pinned and repeat physical-phone testing when updating it. Web capture remains independent of Android dependencies. iOS implementation requirements and the shared launch URL contract are in IOS_PLAN.md.

After the normal unit/build checks, run `camera-check.mjs`, `camera-controls-check.mjs`, `editor-preview-check.mjs` and `layered-controls-check.mjs` against a production preview (`CHECK_URL`). Camera browser checks use synthetic media; native camera tests must separately verify transparent preview placement, full still dimensions, upright portrait/landscape output, front mirroring, lens/zoom choices, visible correction in saved video, replacement white balance and background finalisation. Never remove an installed app to bypass a signing mismatch: preserve its private originals and edits.

Editor processed-preview playback is silent and single-flight. Completed frames advance a wall-clock playhead; slow devices skip preview frames instead of accumulating work. Source switches, exports, navigation and backgrounding stop it. Comparison input is restricted to the arrow-height band, leaving the rest of a zoomed image available for panning. Slider controls retain their touch area while reducing label gaps.

Export destinations are output folders, with no original-file membership check. The top Export action chooses an output folder if necessary, then reuses it for the session. A selected folder keeps the original filename stem; app-managed collisions get numbers. File save/download/share actions belong beside format controls. Edit presets have their own JSON save/load section and must never look like photo saving. Android shares stage bounded chunks in app-private cache and grant read-only access through FileProvider; expire staged files without removing originals or gallery files. Browser file sharing needs a fresh user gesture after rendering.

Focused follow-up scripts: `export-destination-check.mjs` and `browsing-check.mjs` cover output destinations/collisions/cancellation; `preview-queue-cancel-check.mjs` drops an in-flight worker result before switching clips to verify queue recovery. Generation changes must clear both queue slots because cancelled workers can return without a result. `native-camera-check.mjs` and `native-share-check.mjs` exercise mocked bridge contracts (the latter imports source modules from a Vite dev server); these do not replace physical camera/share tests. A real WebView preview also needs its native background made transparent and parent-compatible CoordinatorLayout layout parameters, which browser mocks cannot verify.

The user-supplied custom-model contract lives at `editor/public/models/CUSTOM_MODELS.md`, with links in the loader and guide. Edit that source file, never only `editor/dist/models/`: Vite replaces dist on each build. Keep bundled-model sizes/parity references aligned with `public/models/manifest.json`.

Native startup regression: `native-camera-check.mjs` also defers stop/start responses, emits duplicate resume events and tests a withheld-stop timeout. Preserve serialized teardown and generation ownership: a stale start completion must not stop the newer session. The 20-second watchdog includes teardown, not only CameraX startup. `preview-queue-cancel-check.mjs` must not wait for the export button while deliberately withholding its enabling render; wait for source tiles and switch to the actual unselected item.

The camera preview-first layout removes the heading and overlays its accessible close button. Keep the large underwater capture controls while reducing outer spacing. Temporary explicit WebView debugging must be absent from final minified debug and release APKs. Native startup was confirmed after the R8 permission metadata fix; saved-file and broader physical acceptance checks remain paused while the phone is off ADB.

Earlier debug builds were installed and native preview was confirmed. The current non-device follow-up prepares code 19 without installing it. Physical saved-file checks are paused by the user; stable APK v1.0.2 remains unchanged.


### Minified Capacitor permission metadata

Keep `com.getcapacitor.PluginHandle` and the Capacitor permission annotation interfaces in `android/app/proguard-rules.pro`. The camera startup investigation found that R8 removed `PluginHandle.pluginAnnotation` and its constructor assignment, then folded `Plugin.getPermissionStates()` into an empty map. The camera class still had a valid runtime annotation in DEX, so checking that annotation alone did not detect the regression. Android could grant CAMERA while Capacitor returned null and silently skipped requesting its missing alias.

After changing R8/AGP/Capacitor or these keep rules, inspect the minified APK to confirm the stored annotation field/getter and permission iteration survive, and test both already-granted startup and a fresh permission prompt on a physical device. Preserve normal OS permission checks and callbacks; a runtime-grant-only workaround leaves first-time permission requests broken. Debug builds intentionally exercise the same minification path as release builds.


### Layout and capture stability follow-up

On short landscape screens (651–900px wide, at most 540px high), the editor occupies the viewport and the collection follows in normal page scrolling. The previous fixed 136px collection row reduced usable editor space. The existing mobile-readability check covers the page-scroll behavior in all three languages and existing portrait/wide/expanded layouts.

Never rebuild CameraX use cases for ordinary preview DOM bounds changes: this interrupted captures and caused release-timeout errors. Keep the shared viewport stable and map the native picker using cover fit after resizes. Both picker modes reject off-preview releases. Every Media3Effect error callback, including the video rebind path, must check its effect generation and active session. The installed alpha adapter requires close() on the main thread and can synchronously wait up to 500ms; invalidate the retired effect and defer its close until after the current unbind/lifecycle callback. Do not move close to a worker thread or suppress failures from the active effect.

Code 19 non-device validation passed: 140 unit tests; production build/Android sync; multilingual mobile-readability (including landscape collection scrolling); native-camera mock; minified assembleDebug; APK signature and version checks. Artifact: `android/build/clearwater-1.0.3-camera.5-debug.apk`, with adjacent SHA-256 sidecar. No ADB connection or installation was attempted during the user-requested device pause.
