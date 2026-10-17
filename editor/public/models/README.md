# Model provenance

Shallow-UWnet, WWE-UIE and Five A+ ONNX files are converted from author-published checkpoints, then replaced with the optimised exports described below. The adjacent MIT licence for Shallow-UWnet, `NOTICE-FiveAPlus.txt`, and `../licenses/LICENSE-WWE-UIE.txt` (Apache-2.0) must accompany redistribution. `manifest.json` records SHA-256 hashes, sizes, tensor names and the parity tolerance for each bundled file.

All bundled models are self-contained ONNX, opset 17, float32 NCHW. Each file has one input and one output. The editor runs `inputNames[0]` and reads `outputNames[0]`. A 256×256 input produces a 256×256 output. Colour is RGB in `[0,1]`; the editor clips the output to `[0,1]`.

8-bit weight files no longer match the full-precision network within `1e-4`. Use each entry's `parity_tolerance`. For WWE-UIE and Shallow-UWnet, the recorded `max_abs_parity_error` is against the fp32 ONNX named in `parity_reference`, measured on 32 real underwater images plus one random image, all at 256×256. That fp32 ONNX itself stayed within `1e-4` of PyTorch. Five A+'s recorded error is against the previous bundled edge-fix file on the contract ramp `(i % 251) / 250`. These are not paper benchmark scores, and the timings below are from an x86 build machine, not a phone.

| Bundled file | Model | Bytes | Role |
| --- | --- | --- | --- |
| `wwe.onnx` | WWE-UIE, int8 weights, plain 256 export | 932,006 | Default for new photos |
| `fivea.onnx` | Five A+ slim, in-graph DFT, dynamic H/W, edge fix, fp32 | 81,476 | Default for new videos |
| `shallow.onnx` | Shallow-UWnet, reflect-pad 8 + int8 weights | 230,185 | Alternative photo model |

| Model | Source | Input / output |
| --- | --- | --- |
| Shallow-UWnet | [Author repository](https://github.com/mkartik/Shallow-UWnet/tree/dfd4adfe3e5a5b41b65ac8047069bb155b6cc8e6), README-linked Drive checkpoint `1QmOR8Ar3LqS5Pj0GG3I-798Yyj9xswet` | `[0,1]` RGB. Tensor names `input_256` / `output_256`. |
| WWE-UIE | [Author repository](https://github.com/chingheng0808/WWE-UIE/tree/fd0697558203f9f849800cc13b804116bb3f921c), README-linked UIEB checkpoint `1c80kkDbgpLD1MtqVLql1Y1NQVD7IzxiO`. Paper: [arXiv:2511.16321](https://arxiv.org/abs/2511.16321). | `[0,1]` RGB. Tensor names `input` / `output`. |
| Five A+ | [Author repository](https://github.com/Owen718/FiveAPlus-Network). Paper: [arXiv:2305.08824](https://arxiv.org/abs/2305.08824) (BMVC 2023). Checkpoint SHA-256 `e2dfc7df5fb4df44a1ba7be38744b5a6b34fad48a210c06df164bd610cd6d495` (alpha-0.1). | `[0,1]` RGB. Tensor names `input` / `output`. |

## Five A+ permission

Upstream has no licence file. Tian Ye permitted this non-commercial ClearWater use, including the ONNX conversion, on condition of crediting the paper and linking the repository. Commercial use requires permission from Prof. Erkang Chen. Authors: Jingxia Jiang, Tian Ye, Jinbin Bai, Sixiang Chen, Wenhao Chai, Shi Jun, Yun Liu and Erkang Chen. See `NOTICE-FiveAPlus.txt`.

The bundled file keeps the edge fix: reflect padding on the two 3×3 convolutions, and the inverse-DFT origin pixel `(0,0)` replaced by `(1,1)`. The cosine and sine DFT tables are computed in the graph with `Range`, `Sin` and `Cos` instead of stored as constants. The pyramid pools follow the input size: each stage divides H and W by 2, 4 or 8 and reduces with `ReduceMean`, rather than using fixed 128/64/32 average-pool kernels. The graph was simplified with dynamic spatial dimensions. The editor still feeds 256×256, and a run returns `[1, 3, 256, 256]`.

Against the previous bundled edge-fix file (`sha256 157a81b40235f4130563fa8b196407d40a0966fa95a02dc0fdb39fe0e3b1df48`, 854,937 bytes), one-thread WASM maximum absolute error is 2.58e-5 on the contract ramp and about 1.7e-5 on real photos. The corner replacement stays exact. A flat 0.4 input can differ by 3.87e-4, and only on the border; that is the float32 in-graph DFT, and it is outside the recorded ramp tolerance. On this machine the new file takes about 141 ms at one WASM thread, against about 140 ms for the previous file. Four-thread timing was not remeasured.

It is the default for new videos opened in the editor. The live camera preview stays on Balanced restoration because that path is a WebGL shader and does not run ONNX. Video and camera AI still fit a global colour matrix from 256×256 samples; they do not use the photo guided upsample.

## WWE-UIE and Shallow-UWnet

WWE-UIE combines adaptive white balance, Haar wavelet decomposition and gradient-aware edge guidance. ClearWater uses the published UIEB `myModel(3,32,use_white_balance=True)` checkpoint with the author’s 256×256 test size. New photos start with this model. Its full-resolution application remains ClearWater’s residual colour-transfer workflow. The bundled file is the plain int8 export (932,006 bytes), not the reflect-pad 16 alternative.

Shallow-UWnet is the reflect-pad 8 export with int8 weights (230,185 bytes; the previous bundle was 882,093 bytes).

## Not bundled

These exports were prepared with the same measurements and are intentionally absent from the app. Hashes are recorded here so a later port can find them; they are not in `manifest.json`.

| Export | Bytes | SHA-256 | Parity tolerance | Notes |
| --- | --- | --- | --- | --- |
| WWE-UIE reflect-pad 16 | 929,527 | `d0a6dec6cb81be7c0f76d30443fefd800cac2101fd59ab3a3bd80cbcdab5f827` | 0.03 (max abs 0.0146) | About 27% slower than the bundled plain export in the x86 WASM timing. |
| Five A+ slim, authors' padding | 849,956 | `89ec1e70c9eb871e956ffbd7943325fa63e069d33d0fc3626b6ebfa0b919b95e` | 0.0001 (max abs 3.4e-5) | fp32, no edge fix. The app ships the edge-fix file instead. |
| FUnIE-GAN mixed int8/fp16 | 8,287,010 | `b90fd386bb3082b5e1427da121d7c18a2b4b0a80f24b4d96ece9f76f7ec34c38` | 0.1 (max abs 0.0675) | Input and output `[-1,1]`. Not bundled. An archival copy is kept outside this repository. |
| FUnIE-GAN reflect-pad 32 | 8,287,386 | `f4ecd1d177e4f5eda00f5f1d51e4490ffe8ccd483d2427cfff46b0c0a84d868d` | 0.1 (max abs 0.0678) | Same mixed storage, with a 32 px reflect pad. Not bundled. |

Saved recipes that still name the removed `funie` engine open on WWE-UIE. FUnIE-GAN can be loaded later through **Load other ONNX model** if a signed-range (`-1…1`) copy is supplied by the user.

## Build-machine timings

Median WASM, one thread, from the machine that prepared the files. Not a phone measurement.

| File | 1 thread | 4 threads |
| --- | --- | --- |
| Shallow-UWnet int8 | ~1.8 s | not measured |
| WWE-UIE plain int8 | 0.74 s | 0.23 s |
| WWE-UIE pad 16 | 0.94 s | 0.29 s |
| Five A+ edge fix, in-graph DFT | 0.141 s | not remeasured |
| Five A+ edge fix, stored DFT tables (previous bundle) | 0.140 s | 0.052 s |
| Five A+ authors' padding | 0.145 s | 0.052 s |

The two Five A+ edge-fix one-thread figures were measured together when the in-graph DFT file replaced the stored-table file. The 0.052 s four-thread figure is the earlier measurement of that stored-table file.

## Local conversion tools

From the project root, create `.model-tools` with Python 3.12, install CPU PyTorch, onnx, onnxruntime, numpy and gdown. `model-tools/prepare_sources.py` downloads pinned author definitions and checksum-verified checkpoints. Then run:

```powershell
.\.model-tools\Scripts\python.exe model-tools/prepare_sources.py
.\.model-tools\Scripts\python.exe model-tools/export_models.py
```

`export_models.py` still writes full-precision opset 17 exports and checks ONNX/PyTorch maximum absolute error below `1e-4`. The files in this directory are the later optimised exports; regenerating with that script does not reproduce the int8 bundles or their looser tolerances. Development tool versions used for the original full-precision export: torch 2.14.1+cpu, onnx 1.23.2, onnxruntime 1.31.0, numpy 2.5.4. These Python tools are not needed to run the editor.
