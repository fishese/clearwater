# ClearWater

An underwater photo and video editor with local colour restoration, before/after comparison, manual adjustments, and optional ONNX models. Web/PWA, Android and iPhone versions process media on the device.

Web app: https://clearwater.fishese.cc/

The expanded photo button hides the gallery and header. Wide screens retain a narrow adjustment column; phones show a collapsible adjustment drawer.

## License

ClearWater-owned code and assets are source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). See [NOTICE](NOTICE) for its scope, third-party exclusions, and the permission needed to exercise LGPL rights in combined builds. Third-party software terms and source references are in the [software notices](editor/public/licenses/README.txt); bundled model terms and provenance are in the [model notices](editor/public/models/README.md). User-provided photos, videos, and other media remain under their owners' rights.

## Development

Use Node.js 24. In `editor`, run `npm ci`, then `npm run dev`. Run `npm test` and `npm run build` to verify changes. GitHub Actions builds and deploys the web editor on relevant pushes to main, deriving the base path from GitHub Pages configuration for the custom domain or project URL.

Personal samples, reference documents, research-only model weights, and conversion environments are excluded from Git. Bundled model licences and provenance are in `editor/public/models`.

The Android project is in `editor/android`. Run `npm run android:sync` from `editor`, then follow [Maintenance](MAINTENANCE.md) to build the minified debug-signed APK. Native sharing and folder access require on-device testing.

## Documentation

- [Handoff](HANDOFF.md): current capabilities, source map, contracts and remaining work.
- [Implementation plan](IMPLEMENTATION_PLAN.md): adaptive photo finishing experiment and resumable milestones.
- [Maintenance](MAINTENANCE.md): verification, release, dependencies and rollback.
- [Editor reference](editor/README.md): detailed behaviour and limits.

Private fixture and restricted-model context belongs in root `LOCAL_NOTES.md`, which is gitignored and excluded from builds. Historical design notes are not the current feature contract.
