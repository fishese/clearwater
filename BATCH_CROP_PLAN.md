# Batch photos and crop — work in progress

Updated 8 November 2026. Source: user request and the existing editor implementation.

The user additionally requested a bug, race-condition and layout review, then a signed Android test APK and an attempted unsigned iOS test IPA if GitHub permits. Do not deploy or change the public website before the user has tested the apps.

The user wants batch processing without reviewing every photo: select a correction model, optional Auto enhance and dive conditions, then save results as a ZIP or to a chosen folder. They also want a photo crop tool. The batch must preserve originals and existing edits and report failures/cancellation. Do not merge or publish without separate authorization.

## Platform findings

- Android already has a native folder picker and collision-safe writes. Supported web browsers can use a directory picker where present.
- The iOS app currently exposes only a single-file share bridge and explicitly rejects ZIP; a native folder picker with security-scoped access and ZIP support would require implementation and physical testing. Apple's document picker supports folder access with file coordination and scoped-resource cleanup: https://developer.apple.com/documentation/uikit/providing-access-to-directories?changes=l_5&language=objc
- iPhone browser folder APIs cannot be assumed. Feature-detect any folder picker; provide ZIP handoff with a fresh tap after processing. ZIP file sharing must be tested, not assumed, because browser capabilities and share targets vary. WebKit user activation can expire during processing: https://webkit.org/blog/13862/the-user-activation-api/
- The existing iOS export/share validators allow only specific media/recipe types; add ZIP only through a bounded, separately tested path and do not weaken existing file validation.

## Work checklist

- [x] Read project and vault context; verified that Balanced restoration uses dive conditions and Auto enhance analyses each corrected photo.
- [x] Implemented isolated sequential processing and bounded stored-ZIP output, with per-photo failure reporting, cancellation and fresh-tap ZIP sharing on iOS browsers.
- [x] Added iOS-native ZIP sharing and selected-folder support with scoped access, coordinated non-overwriting writes, bounded staging and mocked bridge tests. Native compilation, Files providers and physical-device behavior remain unverified until hosted build/device testing.
- [x] Added non-destructive crop with undo/redo, preview, strip-based export and translated mobile/desktop controls. Synthetic Chromium tests cover off-centre crop, enhancement and pixel parity; EXIF orientation and real-device behavior remain to be checked.
- [x] Local checks: 278 shared tests; production build; 18 touch-layout cases; synthetic Chromium batch folder/collision/cancellation, editor-history preservation, iPhone-style mocked ZIP share, crop parity and comparison edge checks. These are automated, not physical-device evidence.
- [ ] Build a signed Android test APK using the existing project signing configuration; run Android tests and verify package/certificate. No version/signing changes or website deployment.
- [ ] Push only this feature branch and attempt the unsigned iOS workflow, including native tests and WebKit, if GitHub permits. Never deploy Pages or merge without further authorization.
- [ ] User phone testing: iPhone Safari/Chrome ZIP download/share and native iOS Files folder/share destinations; Android folder/ZIP, crop and cancellation. Browser folder output depends on actual API support; ZIP is limited to 128 MB, not a guarantee of memory availability.
- [ ] Continue verification of metadata/orientation, actual providers, accessibility and large batches; collect user feedback before release. Preserve originals and existing app data.
