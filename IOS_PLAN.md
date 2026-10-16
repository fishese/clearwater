# iOS native camera and sideloading plan

Status: implementation proposal, 14 October 2026. Android/web baseline: release 1.0.2, commit d9a0a06. Recheck the repository before implementation; newer fixes may exist. No iOS app or workflow has been created yet.

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
| `editor/src/Camera.tsx`, `editor/src/native-camera.ts` | Shared controls and native-camera contract; Android uses CameraX, web uses a stream |
| `editor/src/platform/capabilities.ts` | Explicit platform/capability detection; no assumption that non-Android means web |
| `editor/src/platform/ios-camera.ts` | iOS lifecycle/capability adapter if needed; reuse native-camera.ts rather than inventing a competing schema |
| `editor/src/platform/ios-media.ts` | Private native file access, import, export/share and recovery |
| `editor/ios/` | Generated Xcode/SPM project, Swift camera session/preview, Metal processing, media storage |
| `editor/scripts/ios-sync.mjs` | Root-relative web build and iOS-only Capacitor sync |
| `.github/workflows/ios-build.yml` | Manually dispatched macOS build, independent of Pages/Android signing |

Use matching Capacitor core/iOS versions and the generated Swift Package Manager setup. Never run a generic platform sync in an iOS script: explicitly sync iOS. Preserve Android Gradle, its version code, signing setup and existing `android:sync`. Native bundles use `/` asset paths; Pages retains its deployment-derived base path. Keep existing npm commands working on Windows without Xcode.

Introduce capabilities only where needed: native shell, native camera, native media save, Android linked capture, Android HDR conversion, web service-worker updates. iOS must not display web model-cache/download/update controls or claim Android gallery recovery. Bundled ONNX/WASM assets load locally. Keep the existing browser/Android paths as defaults when the iOS plugin is unavailable; never silently present the stream camera as native capture.

Commit shared changes separately from the Swift implementation where practical. Shared changes run unit/build and relevant web/Android regressions. iOS-only Swift changes run the iOS build/tests. Record bridge schema and native algorithm parity requirements here instead of creating a large collection of maintenance files. iOS prereleases must never replace the GitHub stable Android APK alias or become the latest stable release.

## Native capture architecture

Use a custom local Capacitor plugin backed by AVFoundation. Since the Android native-camera bridge now exists, prefer reusing Camera.tsx controls over a native MTKView underlay placed at the supplied preview bounds. Configure WKWebView transparency only while native camera mode is open, keep the rest of the screen opaque, and restore it on every close/error. A one-shot system camera picker is insufficient for persistent capture, corrected preview and recording controls. A full-screen native controller remains a fallback if underlay lifecycle or accessibility cannot be made reliable; it must preserve the shared contract.

AVCaptureSession owns the rear/front camera, AVCapturePhotoOutput captures stills, AVCaptureVideoDataOutput supplies pixel buffers, and AVCaptureAudioDataOutput supplies optional audio. Configure/start/stop on a serial session queue, not the main thread. UIKit updates stay on the main thread. Use one camera at a time; default to the rear wide camera, add supported lens selection later if needed.

Render corrected preview using Metal-backed Core Image or a small Metal shader into MTKView. AVCaptureVideoPreviewLayer alone cannot display the processed frames. Keep camera frames, rendering and video encoding native: never send full frames/base64 across the JavaScript bridge. Send only capture descriptors, error/status events and small settings changes.

Reuse the large photo shutter, smaller record/stop control, flip, reset, microphone toggle, strength and neutral-point picker from Camera.tsx. Stay open after successful capture; acknowledge saved shots with a counter. Close explicitly, then load the latest capture in the editor. Shared controls already use the active locale; localise iOS permission descriptions separately. If native controls become necessary, pass translated strings and accessibility labels through structured configuration. Controls must remain usable in landscape, safe areas and protective cases.

### Restoration and white balance

Start the first iOS acceptance milestone with Balanced only. Android now also offers sampled Five A+ assist; adopt it only after raw sampling and matrix parity work on iOS. Reuse shared analysis where practical through the bounded raw sample bridge, and port the per-pixel rendering operations from `core/engine.ts` and `camera-preview.ts` into a separately tested native module. TypeScript remains the reference for recipe meanings. Generate deterministic tiny image/recipe fixtures; compare native output with numeric tolerances for GPU/codec differences. This is a small native renderer, not a second editing engine.

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
## Camera follow-up contract (15 October 2026)

The Android camera is being moved to a native CameraX backend. The iOS implementation must provide its own AVFoundation backend; Android CameraX/Media3 code cannot be reused on iOS. Keep the shared HTML controls, recipe meanings and media-result contract where practical, with platform-specific view/permission/lifecycle implementations. The built-in Capacitor Camera plugin is suitable for a system-camera handoff, but does not itself provide ClearWater's persistent filtered preview and capture controls. Do not replace the planned native session with a web camera stream and call that native capture.

Treat `editor/src/native-camera.ts` as the evolving TypeScript contract; inspect the merged implementation before writing Swift. It currently defines startSession, setPreviewBounds, setCorrection, listLenses/setLens/setZoom, sampleFrame, capturePhoto, startRecording/stopRecording, releaseCapture and stopSession, with recordingFinished/cameraError events. Platform detection should recognise a registered native backend, not just Android, once iOS implements it. File results are scoped temporary URIs plus name/type/dimensions; copy to durable storage before releasing the temporary file. Preserve the iOS plan's independent Photos-copy behaviour rather than inheriting Android gallery linking.

Native photo output must use AVCapturePhotoOutput and report actual captured dimensions. Preview dimensions are not photo dimensions. For reference, 608x1080 is approximately 0.66 MP; 1080x1920 is 2.07 MP. The old web preview scaler constrained portrait height to a landscape short-side maximum, so a 1080x1920 source could display and record at only 608x1080 even when its saved stream photo was larger. Negotiate native still dimensions separately from video quality, show actual supported values, and never infer still resolution from the preview canvas. Start with a supported roughly 12 MP processed JPEG where available; do not promise a device's advertised sensor resolution or RAW quality. Keep the original JPEG before ClearWater correction privately, with correct EXIF orientation and metadata.

Both portrait and landscape saved files are required. Update native capture orientation from device/display orientation; freeze a clip's orientation when recording starts and write the appropriate track transform or rotated pixels. Correct front-camera preview mirroring separately from saved-file orientation. Keep controls in their current relative locations; rotating icons/text is optional if easy. Test all four rotations, recording while rotating the phone, EXIF-aware viewers, and re-import into ClearWater. Do not rotate pixels and then also write a conflicting rotation tag.

The optional AI camera button uses sampled Five A+ colour assistance, not full neural processing of every full-resolution frame. A small uncorrected 256x256 sample is analysed in a disposable worker about once per second or slower under load; the fitted affine transform updates the GPU preview. Native iOS sampling must supply uncorrected data in a documented SDR RGB space. Use the source sample, not the already-enhanced preview, to avoid feedback. Allow only one inference in flight, ignore stale session/lens results, and terminate/release on disable or close. Freeze the selected transform and correction parameters for each still or recording. AI errors must visibly return to Balanced rather than silently mark an unavailable AI result as applied.

`Recipe.cameraColour` is optional version-1 metadata: `{source:'fivea', matrix:number[12]}`. Coefficients are row-major RGB affine rows `[rR,rG,rB,rOffset, gR,gG,gB,gOffset, bR,bG,bB,bOffset]`, operating on display-encoded RGB in 0..1. Each row is clamped before the existing linear-light restoration-strength blend. This replaces the automatic Balanced channel-gain/red-reconstruction colour result; the shared tone/manual stages still apply. It is not an additional full model pass. Validate coefficient bounds using parseRecipe, and convert row-major layout correctly when uploading to Metal. The frozen field lets a saved original photo reproduce the camera look without model inference. New already-enhanced camera videos clear this field and start with strength zero, avoiding double correction. Shared engine/white-balance and CPU/GPU parity tests are the reference.

Balanced camera controls include an Auto/Yes/No physical red-filter hint and an optional depth slider. These must affect the automatic Balanced suggestion, not hardware sensor white balance. Explain or disable those hints while AI replaces the automatic colour stage. A fresh neutral-point pick replaces prior software gains. Keep native hardware WB locking policy and software neutral correction distinct, particularly with a physical red filter near the surface.

A compact zoom button cycles useful supported choices; long-press opens a larger chooser. iOS must enumerate supported AVCaptureDevice options, including ultra-wide/virtual multi-camera devices where available. Use device-reported optical/virtual switching factors and zoom bounds; do not assume every iPhone has 0.5x or label arbitrary device order as optical magnification. Disable unsafe lens changes while recording or saving; cancel long-press on pointer cancellation/movement, suppress its subsequent click, and provide an accessible ordinary-open action. Close chooser before handling camera exit/Back. Do not start both WebKit getUserMedia and AVFoundation on the same camera.

The preview footer should be concise: corrected video / no raw video, plus actual video dimensions. Show native photo dimensions separately where useful; avoid a misleading generic 'stream resolution' label. Standard iOS camera UI and native photo output should be tested on an actual iPhone before reporting readiness. Android native implementation and mocked browser tests do not validate iPhone lens availability, Metal colour transfer or orientation.

Relevant primary references: [Capacitor Camera API](https://capacitorjs.com/docs/apis/camera), [Apple AVCamFilter native filtered preview](https://developer.apple.com/documentation/avfoundation/avcamfilter-applying-filters-to-a-capture-stream), and [AVCapturePhotoOutput dimensions](https://developer.apple.com/documentation/avfoundation/avcapturephotooutput/maxphotodimensions).
### Launcher URL contract (16 October 2026)

Camera-specific device behaviour: keep the screen awake only while capture mode is active (`UIApplication.isIdleTimerDisabled` on iOS, restoring its previous value on close/interruption). Android uses a scoped window flag. Treat capture orientation separately from UI/display orientation so files stay upright even when system auto-rotate is locked. Freeze video orientation at recording start; raw sampling for the picker follows the displayed preview. Android restores the WebView's native background as well as CSS transparency when removing its preview underlay; iOS must similarly restore WKWebView opacity/background on every exit. File sharing uses a separate bounded native bridge on Android; an iOS port should use UIActivityViewController and temporary read-only exports, without Android gallery-linking semantics.

Android now exposes static Edit/Camera shortcuts and consumes 'clearwater://edit' / 'clearwater://camera' on cold and warm launches. The shared 'use-launch-mode.ts' hook consumes web '?mode=camera|edit' and native 'getLaunchMode()' / 'launchMode' events; active saves/exports are left alone. For iOS, register the same scheme in CFBundleURLTypes, forward URL opens through the native plugin once, and support Shortcuts' Open URLs action. This is a routing contract, not a completed iOS camera. Implement AVFoundation behind 'native-camera.ts' and extend the capability guard only after that implementation exists. A browser/PWA cannot expose iPhone native photo output merely by sharing a TS interface.

References: [Apple custom URL schemes](https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app), [AVCapturePhotoOutput](https://developer.apple.com/documentation/avfoundation/avcapturephotooutput), [CameraX video architecture](https://developer.android.com/media/camera/camerax/video-capture).


Camera layout follow-up (16 October): the Android native camera keeps its control layout in portrait while capture mode is open, restoring the previous Activity orientation policy on exit. Physical sensor orientation still determines the saved photo/video orientation independently. Mirror this separation on iOS: keep the capture controls in their portrait positions rather than reflowing them into a short landscape viewport; handle media orientation in AVFoundation. Rotating individual icons/short labels is optional and must not move the controls or shrink the preview. Do not apply the camera orientation policy to the whole editor or force browser orientation through unsupported APIs.


## Camera UI catch-up prompt

Capture-resolution follow-up: preview bounds must crop only the display, not the saved native photo/video frame. Android no longer attaches the preview ViewPort to its capture group; retain the selected still resolution and video quality independently on iOS too. Photo results report actual JPEG dimensions after EXIF orientation. The shared bridge now includes `sessionGeneration` in session info and a `cameraInfoChanged` event carrying that generation plus `photoWidth`/`photoHeight`, so sensor rotation updates the resolution chip without moving controls or rebinding capture. Ignore old-session events and freeze video orientation at recording start.

Lifecycle follow-up: retire the native renderer before stopping/unbinding a preview session. Queued correction updates must retain the next recipe without reaching a released renderer. Resume with a fresh renderer, preserve pending startup ownership, and report active rendering failures rather than crashing. Verify background/return with AI enabled and the first microphone-permission transition on a real iPhone.

Use this for an iOS agent that has already started work:

```text
Continue the existing ClearWater iOS branch/worktree. Read the current AGENTS instructions, HANDOFF.md, MAINTENANCE.md and IOS_PLAN.md, inspect Git status, and preserve existing iOS work. Review current origin/main and integrate the shared camera/editor changes with a reviewed merge or selective commits. Keep Android signing, versioning and platform implementation unchanged. Use lower-cost agents capable of any involved coding.

Bring the AVFoundation camera into sync with the current React camera UI: preview first, no Camera heading, tight outer spacing, large underwater shutter/record/WB/reset/mic/flip controls, icon-only actions, and persistent capture mode. Keep controls in portrait positions while physical orientation determines saved media; freeze orientation when video starts. Rotating individual icons/short labels is optional. Restore the prior orientation, idle-timer and WKWebView background policies on close/interruption.

Support optional sampled Five A+ assist, Balanced red-filter/depth hints, and replacement neutral-point picking from uncorrected frames with a small loupe. Native picker coordinates use cover fit and reject releases outside the preview; browser picking remains contain fit. Keep capture sessions stable during layout/bounds changes, ignore retired-renderer callbacks, and release native resources using the platform's required threading contract.

Zoom tap cycles supported choices; long press opens actual lens/zoom options. Label front-facing lenses explicitly, including 1x choices. Preserve accurate photo/video dimensions, serialised startup/teardown, cancellation, permissions and recovery. Use the native-camera.ts contract and the recipe.cameraColour format documented in this plan. Keep iOS Photos saves independent; Android gallery linking is excluded.

Include the shared landscape editor change that lets the collection scroll off screen. Preserve English, Hong Kong written Traditional Chinese and Japanese. Run shared checks and the isolated iOS build, then report what still needs a real iPhone. Android device checks are currently paused; preserve that boundary and do not claim iPhone validation from browser or Android results.
```

About now shows iOS (IPA) as Coming soon. Replace that state with an actual platform-specific download URL only after an IPA exists. Avoid promoting an iOS-only GitHub release to latest while Android uses releases/latest/download/clearwater-release.apk; use an iOS-specific release link or coordinate assets across platforms.
