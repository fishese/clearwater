ClearWater video processing uses Mediabunny 1.61.3, Copyright (c) 2026-present Vanilagy and contributors.
Mediabunny is distributed under MPL-2.0; see LICENSE-Mediabunny.txt.
Unmodified Source Code Form for this exact package version is available at:
https://registry.npmjs.org/mediabunny/-/mediabunny-1.61.3.tgz
The source archive includes the src directory.
Project: https://github.com/Vanilagy/mediabunny

Photo EXIF processing uses exifr 7.1.3, Copyright (c) 2020 Mike Kovarik, Mutiny.cz (MIT).
See LICENSE-exifr.txt; project: https://github.com/MikeKovarik/exifr
EXIF writing uses Piexifjs 1.0.6, Copyright (c) 2014 Hiroaki Matoba (MIT).
See LICENSE-piexifjs.txt; project: https://github.com/hMatoba/piexifjs

DNG processing uses @colorhythm/libraw-wasm 1.1.1 (MIT bindings) by TOMIKAWA Sotaro and Colorhythm.
See LICENSE-LibRaw-wasm.txt. Wrapper/binding source, including the build script's C API additions:
LibRaw-wasm-source-9b0f59a.zip (shipped beside this notice), or
https://github.com/colorhythm/libraw-wasm/tree/9b0f59a5e0f6d3d12a8f6fa594015ef4f30a6e95
The included LibRaw 0.22.1 is distributed under CDDL 1.0 (chosen from its dual licence).
See LICENSE-LibRaw-CDDL.txt and COPYRIGHT-LibRaw.txt for notices and third-party credits.
Original LibRaw source for the pinned submodule is shipped beside this notice:
LibRaw-source-b860248.zip, or
https://github.com/LibRaw/LibRaw/tree/b860248a89d9082b8e0a1e202e516f46af9adb29
Rebuild with the pinned binding repository's packages/libraw.wasm/scripts/build.mjs;
the source archive's LibRaw submodule must be populated from the LibRaw source archive above.
ClearWater does not modify the distributed decoder binary or its sources.
Typed-cstruct 0.10.2 supports the bindings (MIT); see LICENSE-typed-cstruct.txt.

AndroidX Media3 Transformer: Android-only HDR-to-SDR working-copy conversion.
AndroidX CameraX and CameraX Media3 effect adapter: native Android still/video
capture and live correction. Apache License 2.0; the same licence text below applies.
CameraX source: https://android.googlesource.com/platform/frameworks/support/+/androidx-main/camera/
Unmodified AndroidX Media3 libraries, Apache License 2.0.
Source: https://github.com/androidx/media
Licence: LICENSE-AndroidX-Media3.txt

WWE-UIE: supplied underwater image enhancement model weights converted from the authors' published UIEB best_model.pth checkpoint.
Copyright the WWE-UIE authors. Source: https://github.com/chingheng0808/WWE-UIE/tree/fd0697558203f9f849800cc13b804116bb3f921c
The repository and checkpoint are distributed under Apache License 2.0; see LICENSE-WWE-UIE.txt.
The ONNX conversion provenance, checkpoint/model hashes and parity tolerances are recorded in ../models/manifest.json.

Five A+ Network (FA+Net, alpha-0.1 checkpoint): supplied non-commercial underwater enhancement weights.
Paper: arXiv:2305.08824 (BMVC 2023). Code: https://github.com/Owen718/FiveAPlus-Network
Authors: Jingxia Jiang, Tian Ye, Jinbin Bai, Sixiang Chen, Wenhao Chai, Shi Jun, Yun Liu and Erkang Chen.
Upstream has no licence file. Tian Ye permitted this non-commercial ClearWater use, including the ONNX conversion,
on condition of crediting the paper and linking the repository. Commercial use requires permission from Prof. Erkang Chen.
See ../models/NOTICE-FiveAPlus.txt.

Shallow-UWnet weights include the MIT notice in ../models/LICENSE-Shallow-UWnet.

HEIC/HEIF decoding uses unmodified heic-to 1.6.6 by Hopper Gee (LGPL-3.0-or-later),
including libheif 1.23.6 by the libheif contributors (LGPL-3.0).
See LICENSE-heic-to.txt and LICENSE-libheif.txt for the full notices.
Package: https://registry.npmjs.org/heic-to/-/heic-to-1.6.6.tgz
Wrapper source and decoder build instructions: https://github.com/hoppergee/heic-to
Decoder source: https://github.com/strukturag/libheif/tree/v1.23.6
The wrapper repository README documents the Emscripten decoder build changes.

React/React DOM, Capacitor core/Android, Lucide React and ONNX Runtime Web/Common:
runtime MIT/ISC notices and helper Apache/BSD notices are combined in LICENSE-Runtime.txt. React/React DOM and
Capacitor core/Android share their respective package copyright and licence text.
ONNX Runtime's pinned v1.30.0 upstream inventory is preserved in NOTICE-ONNX-Runtime.txt;
it includes upstream components beyond those used by the browser/WASM build.
Source: https://github.com/microsoft/onnxruntime/tree/v1.30.0

App icon artwork: Fish3 by Darius Dan and Coral (author unknown), from SVG Repo.
Both supplied source pages label the vectors CC0/public domain:
https://www.svgrepo.com/svg/317012/fish3
https://www.svgrepo.com/svg/2942/coral

LICENSE-Runtime.txt also retains notices for Scheduler and the bundled ONNX JavaScript helpers: FlatBuffers, Long, Platform.js, Protobuf.js and its @protobufjs helper packages.
