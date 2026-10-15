# Android app

Capacitor 8 app, package `com.fishese.clearwater`, Android 7.0/API 24 or newer. The editor and the supplied ONNX models (WWE-UIE, Five A+ and Shallow-UWnet) are packaged locally, with no hosted website dependency.

Native features:

- Android gallery/document selection through Open files, including multiple files.
- Open folder lists JPEG, PNG, HEIC/HEIF, DNG, MP4 and MOV files directly inside a selected folder, sorted by filename with natural numbering. Next/Previous opens each file on demand. Subfolders and files over 512 MiB are excluded; photo resolution checks still apply when opening a file. Folder browsing lasts for the current session; opened files and edits remain in the local library.
- Receive single/multiple images and videos from other apps through Android Share.
- Select output folders with Android's Storage Access Framework; save copies without overwriting existing files. Large exports cross the bridge in 256 KB chunks.
- Same photo navigation, expanded view, manual adjustments and AI engines as the web editor.
- Native CameraX still/video capture with a Balanced GPU preview, optional sampled Five A+ colour assist, actual lens/zoom controls, red-filter/depth hints, microphone audio and configurable 1, 3 or 5 minute recording limits. Android saves linked camera captures to the gallery and keeps untouched photo originals or the enhanced video source plus edit settings in app storage; Settings can restore the collection after it is cleared. See About & guide for capture limits and retention details.
- On Android 10+ devices with compatible decoding and OpenGL support, supported HDR and iPhone Dolby Vision clips are converted to an SDR working copy before editing. The source stays unchanged; the editor preview and exports are SDR. Web builds still require an SDR copy.

Export chooses an output folder once and reuses it for the current session; it does not require access to the original photo's parent folder. The chosen destination keeps the original filename stem, adding a number if needed. Save as chooses a separate destination, and Share opens Android's chooser.

Android launcher long-press shortcuts offer Edit and Camera. External actions can use `clearwater://edit` or `clearwater://camera`. Still capture uses negotiated ImageCapture resolution independently of preview size; native Standard/High video targets HD/FHD. CameraX 1.6.2 and its Media3 effect adapter (1.0.0-alpha04) share correction with preview and recording. A native camera build needs physical-phone checks for effect parity, orientation and lens compatibility before release.

## Build

Use Node 24, JDK 21, Android SDK 36 and Android Studio. Run `npm ci` and `npm run android:sync` from `editor`, then open this directory in Android Studio. Configure the SDK locally via `local.properties` or `ANDROID_HOME`.

Release APKs require all four signing values in `android/keystore.properties` (`storeFile`, `storePassword`, `keyAlias` and `keyPassword`), supplied from the project's approved secure source. Gradle stops the release build if any value is missing. With signing configured, run `gradlew.bat assembleRelease`; output: `app/build/outputs/apk/release/app-release.apk`. Never commit keystores or signing secrets.

For local phone testing, run `gradlew.bat assembleDebug`. This build disables debugger attachment to enable full R8 optimization, minification and resource shrinking and uses the standard Android debug keystore at `${user.home}/.android/debug.keystore`. It is installable with `adb install -r app/build/outputs/apk/debug/app-debug.apk`. Debug signing is for local testing and cannot update an app signed with the production key.

Video uses the local WebCodecs pipeline for MP4/MOV frame scrubbing, Balanced/RGB correction, sampled or fixed AI colour, manual adjustments and H.264 MP4 export with primary audio when supported. Compact defaults to up to 1080p/30 fps / 256 MiB; Source retains source dimensions and frame timing where encoding is supported, up to a 36 Mbps target and 512 MiB output ceiling. Higher-quality output still uses 8-bit SDR. Input is limited to 10 minutes and 512 MB. HEVC decoding depends on the device/WebView. Android HDR support is limited to compatible Android 10+ devices and supported clips; HDR is converted to an SDR working copy and cannot be exported as HDR. Full spatial or temporal neural video restoration is not implemented. AI sample spacing is 2, 5 (default) or 10 seconds; Fixed selected frame uses one AI transform for the entire clip. See the parent README for the full contract.

Provider-specific folder access, sharing on cold/warm launch, large-file memory use and video codec support still need verification across Android devices. Desktop browser codec availability does not guarantee the same support in a phone's WebView.


Export quality: JPEG High requests .95, Maximum .99; PNG is lossless for the rendered 8-bit sRGB result. UserComment bytes in JPEG EXIF are retained where readable. Optional video metadata preserves supported title/description/comment/date fields and source MP4 creation headers; it is not a complete metadata copy. Source export does not recover detail/range already lost during HDR working-copy conversion.
