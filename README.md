# ClearWater

An underwater photo editor with local colour restoration, before/after comparison, manual adjustments, and optional ONNX models. Photos stay on the device.

Web app: https://fishese.github.io/clearwater/

The expanded photo button hides the gallery and header. Wide screens retain a narrow adjustment column; phones show a collapsible adjustment drawer.

## Development

Use Node.js 24. In `editor`, run `npm ci`, then `npm run dev`. Run `npm test` and `npm run build` to verify changes. GitHub Actions builds and deploys the web editor on pushes to main, using `/clearwater/` as the base path.

Personal samples, reference documents, research-only model weights, and conversion environments are excluded from Git. Bundled model licences and provenance are in `editor/public/models`.
