# Model provenance

Shallow-UWnet and FUnIE-GAN ONNX files are converted from author-published checkpoints. The adjacent MIT licence files must accompany redistribution. `manifest.json` records SHA-256 hashes, sizes and PyTorch/ONNX numerical parity. Both use fixed RGB NCHW `[1,3,256,256]` inputs.

| Model | Source | Input / output |
| --- | --- | --- |
| Shallow-UWnet | [Author repository](https://github.com/mkartik/Shallow-UWnet/tree/dfd4adfe3e5a5b41b65ac8047069bb155b6cc8e6), README-linked Drive checkpoint `1QmOR8Ar3LqS5Pj0GG3I-798Yyj9xswet` | `[0,1]` RGB; output clipped to `[0,1]` |
| FUnIE-GAN | [Author PyTorch sample](https://github.com/xahidbuffon/FUnIE-GAN/tree/8f934c834c94e007b00866186b9ee624dc2b7b69/PyTorch), `models/funie_generator.pth` | `[-1,1]` RGB; output mapped to `[0,1]` |

The PyTorch FUnIE sample is not the official TF-Keras paper-reproduction checkpoint. No claim of reproducing paper metrics is made. Browser high-quality canvas resizing approximates author resizing; it is not pixel-identical to Pillow's resampler.

## Local conversion tools

From the project root, create `.model-tools` with Python 3.12, install CPU PyTorch, onnx, onnxruntime, numpy and gdown. `model-tools/prepare_sources.py` downloads pinned author definitions and checksum-verified checkpoints. Then run:

```powershell
.\.model-tools\Scripts\python.exe model-tools/prepare_sources.py
.\.model-tools\Scripts\python.exe model-tools/export_models.py
```

Exports use opset 17 and restricted `torch.load(weights_only=True)` with a small explicit allowlist for the author Shallow-UWnet classes and standard Torch modules. Export scripts check ONNX/PyTorch maximum absolute error below `1e-4`. Development tool versions used: torch 2.14.1+cpu, onnx 1.23.2, onnxruntime 1.31.0, numpy 2.5.4. These Python tools are not needed to run the editor.
