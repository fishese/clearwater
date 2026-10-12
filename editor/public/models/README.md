# Model provenance

Shallow-UWnet and FUnIE-GAN ONNX files are converted from author-published checkpoints. The adjacent MIT licence files must accompany redistribution. `manifest.json` records SHA-256 hashes, sizes and PyTorch/ONNX numerical parity. Both use fixed RGB NCHW `[1,3,256,256]` inputs.

| Model | Source | Input / output |
| --- | --- | --- |
| Shallow-UWnet | [Author repository](https://github.com/mkartik/Shallow-UWnet/tree/dfd4adfe3e5a5b41b65ac8047069bb155b6cc8e6), README-linked Drive checkpoint `1QmOR8Ar3LqS5Pj0GG3I-798Yyj9xswet` | `[0,1]` RGB; output clipped to `[0,1]` |
| FUnIE-GAN | [Author PyTorch sample](https://github.com/xahidbuffon/FUnIE-GAN/tree/8f934c834c94e007b00866186b9ee624dc2b7b69/PyTorch), `models/funie_generator.pth` | `[-1,1]` RGB; output mapped to `[0,1]` |

The PyTorch FUnIE sample is not the official TF-Keras paper-reproduction checkpoint. No claim of reproducing paper metrics is made. Browser high-quality canvas resizing approximates author resizing; it is not pixel-identical to Pillow's resampler.

## Deep WaveNet research adapter

[Deep WaveNet](https://github.com/pksvision/Deep-WaveNet-Underwater-Image-Restoration/tree/e6893b5782d22bb0ab0f58696fbc1ccda7f7b911) has CC BY-NC-ND 4.0 terms; its README also says academic use only. **No Deep WaveNet code, checkpoint or converted model is included in this directory or production assets.** The app now provides a generic local ONNX adapter, with a model-permission acknowledgement and configurable input/output ranges. This does not change any model licence or verify eligibility. User model bytes are held in worker memory, not persisted or cached. Recipes record file hash and normalization; the file must be loaded again on reload. The private Deep WaveNet export works with both ranges set to 0..1.

For this project's private evaluation, `model-tools/export_research.py` converts the author's `uie_uieb/ckpts/netG_295.pt`, using `uie_uieb/models.py`. It uses RGB `[0,1]` input and clipped `[0,1]` output. Local source, weights and converted output are Git-ignored under `model-tools/upstream/` and `model-tools/weights/`. Do not redistribute converted Deep WaveNet weights without appropriate permission.

## Local conversion tools

From the project root, create `.model-tools` with Python 3.12, install CPU PyTorch, onnx, onnxruntime, numpy and gdown. `model-tools/prepare_sources.py` downloads pinned author definitions and checksum-verified checkpoints. Add `--research` only for eligible private academic evaluation. Then run:

```powershell
.\.model-tools\Scripts\python.exe model-tools/prepare_sources.py
.\.model-tools\Scripts\python.exe model-tools/export_models.py
# Optional private research model; never copied to public/ or dist/
.\.model-tools\Scripts\python.exe model-tools/prepare_sources.py --research
.\.model-tools\Scripts\python.exe model-tools/export_research.py
```

Exports use opset 17 and restricted `torch.load(weights_only=True)` with a small explicit allowlist for the author Shallow-UWnet classes and standard Torch modules. Export scripts check ONNX/PyTorch maximum absolute error below `1e-4`. Development tool versions used: torch 2.14.1+cpu, onnx 1.23.2, onnxruntime 1.31.0, numpy 2.5.4. These Python tools are not needed to run the editor.
