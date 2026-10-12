# Android app

Capacitor 8 app, package `com.fishese.clearwater`, Android 7.0/API 24 or newer. The editor and both bundled ONNX models are packaged locally, with no hosted website dependency.

Native features in this first build:

- Android gallery/document selection through Open files, including multiple files.
- Open folder lists JPEG, PNG, HEIC/HEIF, MP4 and MOV files directly inside a selected folder, sorted by filename with natural numbering. Next/Previous opens each file on demand. Subfolders, photos over 60 MB and videos over 512 MB are excluded. The selected folder is automatically available for source-folder exports. Folder browsing lasts for the current session; opened files and edits remain in the local library.
- Receive single/multiple images and videos from other apps through Android Share.
- Select source/output folders with Android's Storage Access Framework; save copies without overwriting existing files. Large exports cross the bridge in 256 KB chunks.
- Same photo navigation, expanded view, manual adjustments and AI engines as the web editor.

Android photo providers do not automatically grant access to a photo's parent folder. Choose its source folder once when saving, or select an output folder. Folder selections are retained for the current editor session. Source folders must contain the original named photo.

## Build

Use Node 24, JDK 21, Android SDK 36 and Android Studio. Run `npm ci` and `npm run android:sync` from `editor`, then open this directory in Android Studio. Configure the SDK locally via `local.properties` or `ANDROID_HOME`.

For an **unsigned** APK, run `gradlew.bat assembleRelease` from this directory. Output: `app/build/outputs/apk/release/app-release-unsigned.apk`. An unsigned APK cannot be installed. No release keystore or signing credentials are configured; signing requires the project's explicit secure signing configuration. Never commit keystores or signing secrets.

For local phone testing, run `gradlew.bat assembleDebug`. This build disables debugger attachment to enable full R8 optimization, minification and resource shrinking and uses the standard Android debug keystore at `${user.home}/.android/debug.keystore`. It is installable with `adb install -r app/build/outputs/apk/debug/app-debug.apk`. Debug signing uses Android's public test credentials and is unsuitable for production distribution.

Video uses the same local WebCodecs pipeline as the web editor: MP4/MOV frame scrubbing, Balanced/RGB correction and manual adjustments, H.264 MP4 export up to 1080p/30 fps, with primary audio when supported. Input is limited to 3 minutes and 512 MB. HEVC requires a compatible device/WebView; HDR/Dolby Vision and neural video correction are not yet supported. See the parent README for the full contract.

Provider-specific folder access, sharing on cold/warm launch, large-file memory use and video codec support still need verification across Android devices. Desktop browser codec availability does not guarantee the same support in a phone's WebView.
