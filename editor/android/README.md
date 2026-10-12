# Android app

Capacitor 8 app, package `com.fishese.clearwater`, Android 7.0/API 24 or newer. The editor and both bundled ONNX models are packaged locally, with no hosted website dependency.

Native features in this first build:

- Android gallery/document selection through Open photos, including multiple files.
- Open folder lists JPEG, PNG and HEIC/HEIF photos directly inside a selected folder, sorted by filename with natural numbering. Next/Previous opens each photo on demand. Subfolders and photos over 60 MB are excluded. The selected folder is automatically available for source-folder exports. Folder browsing lasts for the current session; opened photos and edits remain in the local library.
- Receive single/multiple images from other apps through Android Share.
- Select source/output folders with Android's Storage Access Framework; save copies without overwriting existing files. Large exports cross the bridge in 256 KB chunks.
- Same photo navigation, expanded view, manual adjustments and AI engines as the web editor.

Android photo providers do not automatically grant access to a photo's parent folder. Choose its source folder once when saving, or select an output folder. Folder selections are retained for the current editor session. Source folders must contain the original named photo.

## Build

Use Node 24, JDK 21, Android SDK 36 and Android Studio. Run `npm ci` and `npm run android:sync` from `editor`, then open this directory in Android Studio. Configure the SDK locally via `local.properties` or `ANDROID_HOME`.

For an **unsigned** APK, run `gradlew.bat assembleRelease` from this directory. Output: `app/build/outputs/apk/release/app-release-unsigned.apk`. An unsigned APK cannot be installed. No release keystore or signing credentials are configured; signing requires the project's explicit secure signing configuration. Never commit keystores or signing secrets.

For local phone testing, run `gradlew.bat assembleDebug`. This build disables debugger attachment to enable full R8 optimization, minification and resource shrinking and uses the standard Android debug keystore at `${user.home}/.android/debug.keystore`. It is installable with `adb install -r app/build/outputs/apk/debug/app-debug.apk`. Debug signing uses Android's public test credentials and is unsuitable for production distribution.

This first native integration still needs on-device verification of provider-specific folder access, gallery selection, sharing on cold/warm launch, large-photo memory use and exports. Video editing is not implemented.
