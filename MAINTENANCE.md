# Maintenance

## Development and checks

Use Node.js 24. From `editor`: `npm ci`, `npm run dev`. Verify with `npm test` and `npm run build`. Production testing: `npm run preview -- --port 4176`, then `$env:CHECK_URL='http://127.0.0.1:4176/'`. PWA needs HTTPS or localhost. Integration scripts use Playwright and installed Edge. Avoid concurrent memory-heavy checks.

| Area | Script under editor/scripts |
| --- | --- |
| RAW / resolution | create-photo-fixtures.py (Python), then photo-check.mjs (Node) |
| Metadata | metadata-check.mjs |
| Navigation / saving | browsing-check.mjs |
| Controls / adapter | controls-check.mjs |
| Video / AI video | video-check.mjs, video-ai-check.mjs |
| Guide | about-check.mjs |
| PWA / updates | pwa-check.mjs, update-check.mjs |

Some checks need ignored local fixtures: consult local notes and script input paths. Do not commit personal fixtures to make CI pass. Generated results belong in ignored analysis directories. CI runs unit tests/build; baseline at this checkpoint is 44 tests.

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

Use package-lock.json/npm ci. Review preprocessing, shape and parity before replacing model weights. Supplied Shallow-UWnet/FUnIE-GAN carry MIT notices. Custom ONNX contract: RGB float32 NCHW `[1,3,256,256]`, unit/signed ranges. Custom weights are not persisted or redistributed; generic loading grants no licence rights.

LibRaw bindings pinned at @colorhythm/libraw-wasm 1.1.1 / LibRaw 0.22.1. Keep MIT bindings, chosen CDDL notices, copyright and matching source archives. Mediabunny source/licence material is bundled too. Attribution is in About and public licence/model notes; do not remove source offerings to reduce size.

Metadata rebuilds supported EXIF/GPS and normalises orientation/dimensions/sRGB. MakerNotes, thumbnails, XMP/IPTC and source ICC are excluded. Failures leave a usable export plus warning. Do not promise metadata missing at import or copy RAW calibration tables into EXIF.

## Documentation and rollback

Keep public handoff/maintenance concise; editor README holds the detailed feature contract and public asset directories hold provenance. Private fixture/restricted-model notes go in gitignored root LOCAL_NOTES.md, outside public assets. Ignore rules do not remove information already in Git history; history rewriting is a separate decision.

Check git status/staged paths and diff whitespace before committing. Create checkpoints before major processing changes. Prefer revert commits for published regressions, rebuilding both platforms. Never discard unrelated edits or reset user data. Diagnose colour ranges, orientation, preview/export parity, generation IDs and buffer lifetime before changing algorithms.
