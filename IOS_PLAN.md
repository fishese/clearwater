# iOS native camera and sideloading plan

Status: milestone 1 shell built; physical-device acceptance pending, 14 October 2026, on codex/ios-native-camera. Android/web baseline: release 1.0.2, main d9a0a06. Shell build and device acceptance are tracked at the end of this plan; native camera milestones are pending.

## Outcome and scope

Build a personal-use iPhone app from the existing ClearWater editor, installed from Windows through Sideloadly. It must work offline with bundled models and offer a persistent native camera with live Balanced restoration, full-resolution still capture, and enhanced SDR video. Keep English, Hong Kong Traditional Chinese and Japanese support.

Do not implement Android-style gallery linking on iOS. Saving to Apple Photos creates an independent enhanced copy. Editing or removing an item in ClearWater does not update or delete its Photos copy. Keep original photos privately for later editing; retain only enhanced camera video, as on the current camera workflow. Clearing the collection must state whether private originals remain; preserve the existing recoverable-camera-archive behaviour rather than silently discarding them.

First release excludes RAW/ProRAW capture, Live Photos, HDR/Dolby Vision capture or preservation, 4K, live AI inference, an incoming Share extension, and synchronised Photos-library editing. These can be separate follow-ups. Imported HDR video needs an SDR copy initially; the Android converter does not transfer to iOS.

## Repository and release strategy

Use the SAME repository and shared TypeScript editor. Create a short-lived `codex/ios-native-camera` branch from current main in an isolated worktree. Keep main available for Android/web releases. Bring main into the feature branch regularly, preferably after each milestone; do not routinely cherry-pick shared fixes between permanent platform branches. Merge milestones only after their platform guards and regressions pass. A separate repository or permanently divergent iOS branch would duplicate the editor, translations, recipes and security fixes.

Suggested boundaries (new paths are proposals):

| Location | Ownership / purpose |
| --- | --- |
| `editor/src/core`, workers, locales | Shared algorithms, recipes, editing, translations and model contracts |
| `editor/src/Camera.tsx` | Existing web/Android stream camera; preserve this implementation |
| `editor/src/platform/capabilities.ts` | Explicit platform/capability detection; no assumption that non-Android means web |
| `editor/src/platform/ios-camera.ts` | Typed, versioned native-camera bridge and lifecycle adapter |
| `editor/src/platform/ios-media.ts` | Private native file access, import, export/share and recovery |
| `editor/ios/` | Generated Xcode/SPM project, Swift camera UI/session, Metal processing, media storage |
| `editor/scripts/ios-sync.mjs` | Root-relative web build and iOS-only Capacitor sync |
| `.github/workflows/ios-build.yml` | Manually dispatched macOS build, independent of Pages/Android signing |

Use matching Capacitor core/iOS versions and the generated Swift Package Manager setup. Never run a generic platform sync in an iOS script: explicitly sync iOS. Preserve Android Gradle, its version code, signing setup and existing `android:sync`. Native bundles use `/` asset paths; Pages retains its deployment-derived base path. Keep existing npm commands working on Windows without Xcode.

Introduce capabilities only where needed: native shell, native camera, native media save, Android linked capture, Android HDR conversion, web service-worker updates. iOS must not display web model-cache/download/update controls or claim Android gallery recovery. Bundled ONNX/WASM assets load locally. Keep the existing browser/Android paths as defaults when the iOS plugin is unavailable; never silently present the stream camera as native capture.

Commit shared changes separately from the Swift implementation where practical. Shared changes run unit/build and relevant web/Android regressions. iOS-only Swift changes run the iOS build/tests. Record bridge schema and native algorithm parity requirements here instead of creating a large collection of maintenance files. iOS prereleases must never replace the GitHub stable Android APK alias or become the latest stable release.

## Native capture architecture

Use a custom local Capacitor plugin backed by AVFoundation, with a full-screen native camera view controller. A one-shot system camera picker is insufficient for persistent capture, corrected preview and recording controls. UIKit with an MTKView is a straightforward starting point; SwiftUI can wrap it if useful, but avoid two UI frameworks without a reason.

AVCaptureSession owns the rear/front camera, AVCapturePhotoOutput captures stills, AVCaptureVideoDataOutput supplies pixel buffers, and AVCaptureAudioDataOutput supplies optional audio. Configure/start/stop on a serial session queue, not the main thread. UIKit updates stay on the main thread. Use one camera at a time; default to the rear wide camera, add supported lens selection later if needed.

Render corrected preview using Metal-backed Core Image or a small Metal shader into MTKView. AVCaptureVideoPreviewLayer alone cannot display the processed frames. Keep camera frames, rendering and video encoding native: never send full frames/base64 across the JavaScript bridge. Send only capture descriptors, error/status events and small settings changes.

The native view contains the existing large photo shutter, smaller record/stop control, flip, reset, microphone toggle, restoration strength and neutral-point picker. Stay open after each successful capture; acknowledge saved shots with a counter. Close explicitly, then load the latest capture in the editor. Native strings come from the active shared locale through a structured configuration, including accessibility labels; localise iOS permission descriptions separately. Controls must remain usable in landscape, safe areas and protective cases.

### Restoration and white balance

Keep live capture on Balanced only. Port the small analysis and colour-rendering operations from `core/engine.ts`, `camera-capture.ts`, `white-balance.ts` and `camera-preview.ts` into a separately tested native module. TypeScript remains the reference for recipe meanings. Generate deterministic tiny image/recipe fixtures from the shared engine; compare native analysis and output against those fixtures. Define numeric tolerances for GPU/codec differences. This is an intentional small duplication, not a second editing engine.

Start with the existing 64x48 analysis sample about every 500 ms, smoothing results; render preview up to 30 fps. Cap preview resolution independently from still capture. Explicitly convert camera YUV/range/colour attachments to the agreed SDR RGB space; do not blindly apply the RGB shader to YUV or wide-gamut values. Match linear-light blending, transfer functions, orientation and mirrored preview coordinates.

The dropper samples the underlying source, computes replacement neutral gains, and shows a small magnifier. A second pick replaces the first, even after clipping. Preserve the existing reset/flip/restart lock behaviour. Distinguish software neutral correction from AVFoundation hardware auto-white-balance: when locking a selected neutral point, lock supported device WB gains to avoid subsequent hardware drift; release on reset/flip/restart. Validate this policy on a phone and report unsupported hardware controls. Freeze the correction recipe for a recording and at each shutter press.

### Native still photos

Capture with AVCapturePhotoOutput, not a preview screenshot. Negotiate supported photo dimensions before starting the session; start with a roughly 12 MP quality option where available and offer a higher supported size only after memory testing. Do not promise 24/48 MP on every device or camera. Native still capture uses the system photo pipeline but does not guarantee identical output to Apple's Camera app.

Request a compatible SDR JPEG for the first implementation. Store that uncorrected processed camera photo as the private original, plus the versioned recipe; it is not sensor RAW. Render an enhanced JPEG natively for optional Photos saving. Preserve available EXIF while correcting orientation/dimensions and colour profile after rendering. Do not request location solely to invent GPS; retain location metadata only when actually supplied and authorised. Later editor exports remain JPEG/PNG.

Bound still processing to one in-flight full-resolution capture initially. Avoid simultaneously retaining multiple decoded full-size images; release buffers after file finalisation. Re-enable the shutter after a durable save, not merely after taking the frame.

### Native enhanced video

Use AVCaptureVideoDataOutput -> GPU correction -> pooled pixel buffers -> AVAssetWriter, with hardware H.264 MP4 and optional AAC audio. Write incrementally to a private file, not an in-memory recording-length Blob. Start at SDR 1080p30, approximately 12 Mbps video / 192 kbps audio; offer 720p / 5 Mbps as Standard. Negotiate actual device support. Keep 1/3/5-minute settings and a compatible file-size ceiling initially; native capture is not a reason to remove existing editor input limits.

Use sample presentation timestamps, bounded buffer pools and writer backpressure. Drop late preview work rather than growing queues; recording overload must be handled explicitly without changing timestamps or silently losing audio sync. Freeze parameters for a clip. Use one enhanced video source, no raw copy; import at zero restoration strength to prevent double correction.

Native incremental encoding should reduce recording-duration-dependent RAM, but existing web import/editing can still materialise a large video. Reuse metadata-only descriptors and lazy file reads where possible. Measure peak memory for capture, finalisation AND later editing; do not publish assumed RAM savings. Record actual dimensions, duration, codec, byte count and nominal frame rate in the completion descriptor.

## Files, saving and privacy

The bridge returns an opaque capture ID plus metadata and scoped file URLs; validate paths inside the app's managed directories. Keep original photo files / enhanced video and recipes durably in Application Support with a small native manifest. Stage writes then atomically commit. Failed/partial capture cleanup must never remove earlier completed files. Queue completion events durably until acknowledged so a suspended WebView cannot lose the capture.

Integrate a native-file source descriptor into shared storage with backwards-compatible optional fields. Keep existing Android/browser Blob records untouched. Generate small thumbnails; load source bytes lazily only when editing/export needs them. A first milestone may read one selected photo into a File for the existing worker, but must not persist a second full original in IndexedDB as well. Keep file ownership/lifecycle behind an adapter.

Photos save is optional and independent: use add-only PhotoKit authorisation and request it on first save, with a Files/share fallback if denied. App-private save success and Photos save success are separate statuses; a Photos failure retains a retryable private capture. Exporting later creates a new copy. Do not track Photos asset IDs for replacement, deletion or existence probing. Import through the system Photos picker/Files picker; copy selected resources into the managed collection when needed. Do not request broad library access merely to import selected items.

Deleting a collection item or clearing the collection must not delete Apple Photos content. Retained private camera originals can be recovered through Settings; offer explicit confirmed private-source deletion separately. Document that uninstalling the app removes private originals and edits. No iCloud sync is implied.

## Lifecycle and failures

Use an explicit camera state machine: closed, requesting permission, starting, ready, capturing, recording, finalising, interrupted/error. Serialise actions; disable conflicting controls. Stop capture and release devices on backgrounding/interruption. Finalise a recording when possible; use only a bounded background task to finish writing, never promise background camera use. Handle audio interruptions, calls, route changes, thermal/system pressure, disk-full, permission changes and memory warnings. Reopen safely on foreground only when camera mode remains active.

Recover committed captures on launch. Quarantine or remove incomplete temporary files based on manifest state, without guessing from filenames. Preserve partial-save recovery and distinguish cancelled capture from failure. Native tests must inject interrupted writes, duplicate completion events and late callbacks.

## Build and Windows sideloading

Capacitor 8 needs Xcode 26+ and macOS. Start with a recent physical iPhone/iOS release; select the deployment target only after checking the shared worker/OffscreenCanvas/WebCodecs requirements. Capacitor's minimum is not a promise that every editor feature works on that minimum.

Create a manually dispatched GitHub Actions workflow on a pinned supported macOS/Xcode image. Install locked Node dependencies, build root-relative web assets, sync only iOS, resolve pinned Swift dependencies, compile for a physical arm64 iPhone with signing disabled, and package the resulting app as `Payload/ClearWater.app` inside an IPA. A simulator build is not an installable phone IPA. Upload the IPA, checksum and build-commit information as Actions artifacts; do not upload credentials or provisioning profiles. Verify structure, required assets, privacy strings and architecture. Validate the unsigned package through actual Sideloadly installation before calling the pipeline complete.

On Windows, the user downloads the IPA and signs/installs locally with Sideloadly, entering Apple credentials there. Free signing expires in seven days, not three; free accounts are also limited to three sideloaded apps. Refresh before a dive trip. Offline operation still stops being available after signing expiry. Use the same Apple account and resulting bundle ID when refreshing, and back up important originals. Developer Mode/trust steps may be required. Paid developer signing can be adopted later without changing the app architecture; keep the identity stable and test data retention when changing signing teams. No App Store, push notification, iCloud or other special entitlement is required for the initial scope.

## Milestones and acceptance gates

1. **Shell and install proof:** isolated branch/worktree, matching iOS package, native capability guards, bundled models, macOS workflow and unsigned device IPA. User installs from Windows; cold offline launch, photo import/edit/export and model inference pass. Stop to report installation/runtime blockers before expanding camera work.
2. **Native still camera:** persistent AVFoundation UI, true photo-output capture, Balanced preview, strength, replacement WB/loupe, reset/flip, private originals and optional independent Photos copy. Verify pixel dimensions exceed preview size on a supported phone, permissions/failures, repeat capture, colour parity and reload recovery.
3. **Native enhanced recording:** writer-based MP4/audio, Standard/High, duration/size guards, frozen recipe, zero-strength editor import. Validate actual 1/3/5-minute clips for audio sync, memory, heat and saved enhancement. Simulator tests do not satisfy this gate.
4. **Integration and release:** all three locales, safe areas/accessibility, failure recovery, app update/data retention, documentation and CI. Run shared unit/build plus web offline/update, camera, library, and relevant Android regressions; build Android without changing its signing/version. Merge only tested stages; keep iOS artifacts prerelease until phone acceptance.

Do not claim full iOS video editing merely because native recording works: WebKit codec/export support is a separate gate. If unsupported, keep native capture/save working and clearly disable the unavailable editor feature until a native export fallback is implemented.

## Sources

Checked 14 October 2026; implementation recommendations above are ClearWater-specific design choices.

- [Capacitor iOS plugins](https://capacitorjs.com/docs/plugins/ios) and [environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup).
- [Apple AVCamFilter](https://developer.apple.com/documentation/AVFoundation/avcamfilter-applying-filters-to-a-capture-stream): processed native preview using Metal/Core Image.
- [Apple photo dimensions](https://developer.apple.com/documentation/avfoundation/avcapturephotooutput/maxphotodimensions): supported capture dimensions must be negotiated.
- [Apple audio/video capture](https://developer.apple.com/documentation/avfoundation/audio-and-video-capture).
- [Apple Photos add-only example](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-on-ios): permission/saving pattern only, not a camera architecture reference.
- [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners): standard runners are free for public repositories under current rules.
- [Sideloadly FAQ](https://sideloadly.io/faq.html) and [Apple account limits](https://developer.apple.com/help/account/basics/about-your-developer-account).

## Prompt for the implementation session

```text
Implement the ClearWater iOS port described in IOS_PLAN.md in D:\Projects\ClearWater. First read the current AGENTS instructions, HANDOFF.md, MAINTENANCE.md and IOS_PLAN.md, inspect git status, and preserve unrelated local edits. Use a separate worktree on codex/ios-native-camera based on current main; do not modify the working Android/web checkout. Use lower-cost agents capable of the task for involved coding.

Follow the plan in milestones. Start with the Capacitor iOS shell, platform capability guards, bundled offline models and a manually dispatched macOS GitHub Actions build that produces an unsigned physical-device IPA for Windows Sideloadly. You may push the feature branch and run its build workflow. Do not merge to main, publish a stable release, change Android signing/versioning, or ask for Apple credentials in chat. I will sign/install locally and provide phone test results.

Then implement the persistent native AVFoundation camera: true photo-output still capture, Metal/Core Image Balanced preview, large controls, replacement white-balance picker/loupe, optional audio and native enhanced MP4 written incrementally to disk. Do not substitute getUserMedia or a preview screenshot. Keep photos' originals privately for editing; video needs only the enhanced source. Apple Photos saves are independent copies; no gallery linking, replacement or deletion sync. Keep EN/zh-HK/ja translations and existing Android/web behaviour.

Run automated shared regressions and iOS build checks, document native colour parity and file-lifecycle contracts, and separate verified results from physical-device tests still needed. If install or camera validation requires my phone, leave a build and concise test instructions, preserving progress so the next session can continue. Keep updates in the existing plan/handoff/maintenance files rather than proliferating documents. Follow all private-folder/signing restrictions and never commit credentials, personal fixtures or locally supplied model weights. Keep private research-model notes out of public-facing files.
```
## iOS milestone 1 implementation (14 October 2026)

Work is isolated on `codex/ios-native-camera`, based on main `d9a0a06`. The first gate is an unsigned physical-device shell with bundled models, native photo/file sharing, and explicit capability guards. Camera remains unavailable in this shell: no iOS stream-camera substitution. Milestones 2–4 remain pending the installation/offline editor phone gate below; no native capture or encoding performance is claimed.

The iOS build uses root-relative assets and syncs iOS only. `ios-build.yml` is manually dispatched and also callable. Because GitHub only registers a new manual workflow from the default branch, this feature branch's existing `pages.yml` has a manual-only iOS call for this exact branch; its Pages deployment job only runs on main. Dispatch `pages.yml` at `codex/ios-native-camera` for the initial IPA. This does not change main or publish a release.

### Physical-device gate (partial user feedback; export retest pending)

Install the unsigned device IPA using Windows Sideloadly and sign locally. Start with iOS 26 for this experimental build. Keep credentials in Sideloadly. Verify launch, import of a disposable JPEG/PNG through Photos/Files, all three languages, Balanced editing and each supplied AI model, then export through the native share sheet to Files/Photos. Check cancellation and retry. Force quit, enable Airplane Mode, reopen, and repeat inference/export without network access. Check collection/edit retention after backgrounding and restart. Photos exports must remain independent after Clear collection. Record phone/iOS version and failures; include screenshots/errors but no credentials. Actual camera and long-video tests follow in their own milestones.

Verified build: commit `bc107a10737b45cfd0deb693a3d1adee1dde1d0f`, [Actions run 38566623629](https://github.com/fishese/clearwater/actions/runs/38566623629), Xcode 26.6 (17F113). The unsigned arm64 device IPA passed bundle/archive, model/WASM, root-path and localized privacy checks. Artifact ID `11896506307`; SHA-256 `a128c5f05f17e11b2d5a16b4dac234b4b820aaddfdf1f9161d68f9ee69a27bfa`. Local download matches that checksum. GitHub did not sign the app. Compilation and browser mocks do not validate WKWebView inference, system pickers, signing/install, phone memory, or Photos behavior.

Verified shared regressions: 118 unit tests; production build; mocked iOS shell import/WWE inference/share/reload; web camera GPU parity, repeated stills, MP4/audio and lifecycle; IndexedDB camera archive migration/recovery; linked Android gallery save/delete/trash; optional offline model caching, Settings cold-offline inference; update retention; all-language mobile readability; About navigation. Android `assembleDebug` and APK v2 signature verification passed with existing version 1.0.2 / code 13. No Android source/signing/version changes were committed. Fixture-dependent clear-collection and HDR suites were not completed because this isolated checkout has no local fixtures; archive/linked tests cover collection retention, and unit coverage remains intact.

The initial CI run failed because Capacitor generated `.iOS(.v26)` with Swift tools 5.9. `ios-sync.mjs` now upgrades this generated manifest to tools 6.2 after sync; the rerun verified it. The mocked iOS export test found browser directory detection taking precedence; folder selection is now explicitly web/Android-only. Native `ClearWaterExport` schema is beginExport(name,type,size) -> bounded writeExportChunk(id,data) -> finishExport(id,abort) -> shareExport(id) returning completed/activityType -> discardExport(id). IDs scope temporary directories; no arbitrary path or Photos asset ID crosses this bridge. It handles JPEG/PNG, supported original media and recipe JSON up to the existing 512 MiB ceiling. This shell import retains the existing IndexedDB original; the later native-camera file manifest/lazy-source adapter is still unimplemented.

Milestone 1 gate remains OPEN: Sideloadly signing/install, cold offline WKWebView inference, import/share UI, Photos independence, phone memory and update retention need a physical phone. Milestones 2 and 3 are NOT implemented: no AVFoundation session/photo output, native GPU preview/WB, camera original manifest or AVAssetWriter recording exists yet. Follow the acceptance gates above before expanding capture work. Native colour-parity fixtures/tests belong to milestone 2, not this shell. No merge or stable release has occurred.

### Phone report and export startup repair

User report: the photo editor preview works, but Export/share displays “Photo export is unavailable in this iOS build.” No device/iOS details or cold-offline/all-model results have been reported yet. Inspection found that SceneDelegate instantiated the base CAPBridgeViewController, bypassing ClearWaterBridgeViewController and its ClearWaterExport registration. The capability guard correctly refused sharing when the plugin was absent. Repair the actual scene startup, retain the availability guard, and verify active native startup/plugin calls in a hosted simulator test before rebuilding. Simulator sharing cannot replace the remaining phone Photos/Files/cancel/update tests.

Further inspection confirmed a second wiring defect in the first IPA: the controller/plugin Swift build files were in PBXResourcesBuildPhase, while localized InfoPlist.strings was in PBXSourcesBuildPhase. The native export code was therefore not compiled. The repair moves Swift files to Sources and permission strings to Resources, alongside the custom scene controller. The initial compilation/package and browser-mock checks did not detect this omission; native startup/bridge execution is now required in CI.

The first live native regression passed on `ecb0cd8` in run 38578249998 (1 test, 0 failures; visible scene, plugin availability and begin/write/finish/discard). Its cold Xcode/simulator run took 719 seconds. Cancellation arrived after the test passed and prevented device packaging; xcresult artifact ID 11902194462 remains available. The build workflow now packages the device IPA independently of the simulator job. Native tests default on; skip them only when repackaging unchanged native code that has already passed (branch dispatcher input `ios_native_tests=false`). Native code/testing sources are unchanged from that verified revision in the replacement packaging run. Actual share-sheet destinations remain a phone test.

Export repair package verified: commit `c942f6ce94693674eb901261c589dd847d9cccb4`, [run 38581002400](https://github.com/fishese/clearwater/actions/runs/38581002400), unsigned arm64 device build. IPA artifact ID `11903940351`; SHA-256 `60ddddf4d1fd579747bc900e4c5b7c76fdf54a19b195b0aaf7bd521c1577c03a`; local download matches. Local replacement: ignored `editor/ios/App/output/export-fix/ClearWater-unsigned.ipa`. Shared 118-test/build and device bundle/privacy/model checks passed. Native sources are identical to the `ecb0cd8` simulator-tested revision; hosted tests were deliberately skipped for this packaging-only run. The earlier run's test step passed, although its overall conclusion is cancelled because cancellation occurred afterward.

Phone retest: install this replacement over the initial app using the same Sideloadly signing account/resulting bundle ID; verify existing collection/edits remain. Export JPEG and PNG to Files and Photos, cancel the share sheet then retry, and save a recipe JSON. Confirm exported Photos copies remain independent after collection removal. Actual share destinations, permission-denial/cancellation, offline/model coverage and update retention remain unverified on the phone; preview editing is the only user-reported success so far. Native camera milestones remain pending this acceptance gate.
