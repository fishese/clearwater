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
- [x] Added non-destructive crop with undo/redo, preview, strip-based export and translated mobile/desktop controls. Synthetic Chromium tests cover off-centre crop, enhancement and pixel parity; synthetic EXIF orientation and cropped metadata tests pass; real-device behavior remains to be checked.
- [x] Local checks: 278 shared tests; production build; 18 touch-layout cases; synthetic Chromium batch folder/collision/cancellation, editor-history preservation, iPhone-style mocked ZIP share, crop parity and comparison edge checks. These are automated, not physical-device evidence.
- [x] Built signed Android test APK from source `cc6816c`: 11 Android unit tests, signature continuity with 1.0.14, ZIP integrity and 50 bundled asset hashes pass. Package remains 1.0.14/code 33; no signing changes or website deployment. Local ignored APK: `editor/android/build/batch-crop-test/ClearWater-batch-crop-test.apk`, SHA-256 `f728caf61acb5ce0df486cb266f530874a007d429c1d78a268a9863ecfdf8576`.
- [x] Pushed feature branch and started hosted iOS workflow 42402967583 from `cc6816c`. Unsigned IPA built and downloaded with matching SHA-256 `98b061581c408073c81e103f8b0b328f249ab25aed11802ca7a711ea23d94560`; local ignored file `editor/ios/App/output/batch-crop-test/ClearWater-unsigned.ipa`. Hosted WebKit regression job passed, including mocked iPhone batch ZIP sharing; 36 iOS simulator tests passed including native folder collision handling. WebKit mobile-scroll smoke had three skips; sharing APIs were mocked. Never deploy Pages or merge without further authorization.
- [ ] User phone testing: iPhone Safari/Chrome ZIP download/share and native iOS Files folder/share destinations; Android folder/ZIP, crop and cancellation. Browser folder output depends on actual API support; ZIP is limited to 128 MB, not a guarantee of memory availability.
- [ ] Continue verification of real-image metadata/orientation, actual providers, accessibility and large batches; collect user feedback before release. Preserve originals and existing app data.

A synthetic desktop Chromium batch processed two 4000×3000 JPEGs using Balanced plus Auto enhance in 1.31 s and 1.22 s respectively (simple gradient, encoded output about 240 KB each). This is not a representative mobile benchmark or peak-memory measurement; real photos, AI models, iOS and Android remain unmeasured.

## Follow-up, 8 November 2026

- [x] Batch selection now starts empty; editor collection is not automatically included. Production build, 278 shared tests, and synthetic batch/editor-history browser check pass.
- [ ] Android user reproduced a generic photo-read error on a connected Samsung phone. Release WebView/Capacitor logcat did not expose an underlying exception; whether failures were newly selected or previously listed collection items, and ZIP versus folder output, needs user confirmation. Do not claim the empty-selection change fixes the read error until verified on the affected files. No app data cleared.

- [x] Built and installed a signed diagnostic APK without clearing data; signature matches earlier test. It reports only a whitelisted failure phase/type for batch errors. Shared tests 279 pass; Android release build and unit task pass. SHA-256 `9cd27f1f92160f44c89061dd25505028b577ce6b41f9cbb72c6eb4d7de34da38`. Awaiting user reproduction and diagnostic code; do not claim the read issue fixed.

- [ ] On the diagnostic update, user reports selected JPEGs appeared to process successfully, with a metadata warning. Exact warning, ZIP contents and cause of original read errors remain unconfirmed. The diagnostic and empty-selection change cannot independently establish a fix; investigate metadata and retry on actual files without copying user media unless authorized.

- [x] User phone screen showed 10 photos processed and warning that some EXIF/GPS metadata could not be preserved; the image was exported. Found Android SAF ZIP creation incorrectly declared JPEG MIME, potentially hiding/renaming it. Changed ZIP saving on Android 10+ to MediaStore Downloads with correct MIME and pending-write cleanup; older Android retains SAF with ZIP MIME. 280 shared tests and Android release build/unit task pass; installed update with user approval while preserving app data. Physical Downloads/ZIP verification pending.

- [x] On the connected Android phone, reproduced `CW/load/header/NotReadableError` on several picked JPEGs after one succeeded; initial worker header reads fail. Android Downloads ZIP saved successfully for the one completed photo, and on-device `unzip -t` passed. Preparing an experimental one-photo-at-a-time Android picker-file materialization before worker transfer; adds one full-file allocation per photo and must be validated on the actual files and constrained devices. It does not prove the root cause or resolve EXIF warnings.

- [x] User reports Android picker materialization processed the previously affected batch; phone screen reported 10 processed. Verified the ten-file ZIP on-device with `unzip -t` and confirmed repeated saves retain prior ZIPs. This single successful retry does not prove the intermittent read issue is eliminated. Observed Android may rename the ZIP during publish after an initial name query; updated confirmation to use its final name and added a unit regression. Added the ordinary photo byte-size limit before materializing a batch file. EXIF/GPS warnings remain unresolved; assess on actual media before claiming preservation.

- [ ] User reproduced `CW/materialize/NotReadableError` on the main thread after the experimental per-file copy, so that workaround is not reliable. Replaced Android batch WebView file input with Android ACTION_OPEN_DOCUMENT multiple-selection URIs and bounded per-file streaming; access lasts for the current activity, no persistent grant requested. Shared tests 281 and Android build/unit task pass. Test APK installed with app data preserved; awaiting repeated physical-device tests. No claims about browser/iOS behavior or metadata resolution.

- [ ] User reported the native document picker processed photos but multi-select was difficult. Changed Add photos on Android 13+ to the native multi-select photo picker, with Browse files for document providers and an older-Android document fallback; both retain native URI access. 281 shared tests and Android release build/unit task pass. Installed test APK with user approval; await physical multi-select, repeat batch and Browse tests. Photo picker may expose a different subset of formats than Browse.
