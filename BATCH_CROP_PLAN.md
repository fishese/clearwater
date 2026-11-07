# Batch photos and crop — work in progress

Updated 8 November 2026. Source: user request and the existing editor implementation.

The user wants batch processing without reviewing every photo: select a correction model, optional Auto enhance and dive conditions, then save results as a ZIP or to a chosen folder. They also want a photo crop tool. The batch must preserve originals and existing edits and report failures/cancellation. Do not merge or publish without separate authorization.

## Platform findings

- Android already has a native folder picker and collision-safe writes. Supported web browsers can use a directory picker where present.
- The iOS app currently exposes only a single-file share bridge and explicitly rejects ZIP; a native folder picker with security-scoped access and ZIP support would require implementation and physical testing. Apple's document picker supports folder access with file coordination and scoped-resource cleanup: https://developer.apple.com/documentation/uikit/providing-access-to-directories?changes=l_5&language=objc
- iPhone browser folder APIs cannot be assumed. Feature-detect any folder picker; provide ZIP handoff with a fresh tap after processing. ZIP file sharing must be tested, not assumed, because browser capabilities and share targets vary. WebKit user activation can expire during processing: https://webkit.org/blog/13862/the-user-activation-api/
- The existing iOS export/share validators allow only specific media/recipe types; add ZIP only through a bounded, separately tested path and do not weaken existing file validation.

## Work checklist

- [x] Read vault/project context and verify that Balanced restoration uses dive conditions; Auto enhance analyses the corrected preview.
- [x] Added isolated sequential worker orchestration and unit tests for per-photo recipes, Auto enhance and cancellation. It is not yet connected to the UI; integration, per-item failure handling, real worker tests and resource cleanup still need validation.
- [x] Added bounded stored-ZIP assembly with UTF-8 filenames, collision handling, CRC and cancellation; unit tests and Python zipfile interoperability pass. Batch output/UI and platform delivery are not implemented yet.
- [x] Added bounded iOS-native ZIP staging and browser ZIP share validation, with mocked bridge/share tests; these functions are not yet connected to a batch UI and physical iOS behavior is unverified.
- [ ] Add selected-folder save flows and connect ZIP output to the batch UI, preserving existing single-photo export and Safari user activation. Native iOS folder access needs an explicit design and tests; browser ZIP needs a fallback when sharing is unavailable.
- [ ] Implement non-destructive photo crop with correct orientation, preview/export geometry, metadata and undo/redo; no video changes.
- [ ] Localize wording using the glossary; verify mobile/desktop and meaningful browser/native tests. Physical iPhone Safari/Chrome, Files/Photos and native app checks remain necessary.
- [ ] Save checkpoint commits, including what is unfinished, before any interruption.
