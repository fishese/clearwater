# Custom ONNX models in ClearWater

How ClearWater loads, validates and runs a user-supplied ONNX model (engine id `wave`, "Load other ONNX model").
Everything below describes current code; file paths are relative to `editor/`.
Source location: `public/models/CUSTOM_MODELS.md`, linked from the custom ONNX loader and About & guide. Build output under `dist/` is generated and replaced on each build.

## TL;DR contract (for humans and agents)

| Item | Requirement | Source |
|---|---|---|
| Container | One self-contained `.onnx` file, ≤ 64 MiB (67,108,864 bytes). Loaded from a single `ArrayBuffer`; **external-data files are not loaded** — merge weights into the file. | `src/models.ts` (`loadCustomModel`, `registerCustomModel`), `src/custom-model-storage.ts` |
| Inputs / outputs | Exactly **one** input and **one** output. **Names are arbitrary** — the app uses `net.inputNames[0]` / `net.outputNames[0]`. | `src/models.ts` |
| Dtype | `float32` for both. | `src/core/model-contract.ts` |
| Layout | RGB, NCHW `[1, 3, 256, 256]`. Channel order R,G,B. No alpha. | `src/models.ts` (`inferField`), `model-contract.ts` |
| Shapes | Every *numeric positive* declared dim must equal `[1,3,256,256]`; symbolic/unknown dims (e.g. `batch`, `-1`) pass the metadata check, but the model is always run with `[1,3,256,256]` and the **actual output dims must be exactly `1,3,256,256`**. Rank must be 4. | `model-contract.ts` (`validateImageTensor`, `validateImageOutput`) |
| Value range | Chosen by the user per model: input `unit` (0…1) or `signed` (−1…1); output `unit` or `signed`, independently. | `src/App.tsx` dialog, `src/core/types.ts` (`CustomModel`) |
| Output values | Must all be finite (no NaN/Inf). Values are clamped to 0…1 after range conversion. | `model-contract.ts`, `models.ts` |
| Backend | `onnxruntime-web` (`^1.30.0`), **wasm EP only** (`ort-wasm-simd-threaded`), `numThreads=1`, `proxy=false`, `graphOptimizationLevel:'all'`. No WebGPU/WebGL. | `src/models.ts`, `package.json` |

## Loading and validation sequence (`src/models.ts`)

1. User must tick "I have permission to use this model and will follow its licence" (`permission===true`), else rejected.
2. Blob size must be ≤ 64 MiB ("Choose a self-contained ONNX model under 64 MB.").
3. `inputRange`/`outputRange` must be `unit` or `signed`.
4. SHA-256 of the bytes is computed; together with file name (≤255 chars) and ranges this forms the `CustomModel` config. Recipes record this config and refuse to run against a different model/ranges.
5. `ort.InferenceSession.create(bytes, {executionProviders:['wasm'], graphOptimizationLevel:'all'})` — any unsupported op, opset or external-data reference fails here.
6. Checks: one input, one output; both tensors pass `validateImageTensor` (float32, rank 4, compatible dims).
7. **Flat-grey smoke test**: runs one inference on a constant tensor — `0.5` everywhere for `unit` input, `0` for `signed` input (i.e. mid-grey either way). Output must be float32, dims exactly `1,3,256,256`, all finite (`validateImageOutput`). Make sure your model does not produce NaN/Inf on a perfectly flat image (watch per-image normalisation like `(x-min)/(max-min)` without an epsilon).
8. On success the model and config are stored (IndexedDB `clearwater-custom-model` on web; native storage on Android) and reloaded on later launches; a SHA mismatch on restore gives "Saved custom model is missing or damaged." (`src/custom-model-storage.ts`).

## What the app does around the model (`inferField` in `src/models.ts`, `src/core/neural-field.ts`)

Pre-processing (in the app, not your graph):
- The source (photo, or a sampled video frame) is drawn into a 256×256 `OffscreenCanvas` with `imageSmoothingQuality='high'`. **Aspect ratio is not preserved** (stretched to a square; no letterboxing/cropping).
- RGBA bytes → RGB float: `v/255`, then `v*2-1` if input range is `signed`. Packed planar NCHW. Alpha dropped.
- Nothing else: no white balance, mean/std normalisation, BGR swap or gamma. Bake any model-specific preprocessing into the graph.

Post-processing:
- If output range is `signed`: `(v+1)/2`. Then clamp to [0,1].
- The app computes a **residual field** `output − input` at 256×256 and bilinearly upsamples that residual onto the original-resolution pixels (`transferField`). So the model controls colour/tone at 256×256 resolution; it **cannot add full-resolution detail** (denoising, sharpening, dehazing structure, super-resolution). Strength and manual adjustments are applied afterwards.
- Video (`src/video.worker.ts`): the same `inferField` runs on sampled frames; a global colour adjustment is fitted from each result and blended between samples.

## Op constraints

- Runs on onnxruntime-web's wasm (CPU) kernels, which cover the standard ONNX op set (Conv, BatchNormalization, InstanceNormalization, Resize, DepthToSpace/SpaceToDepth, Reduce*, Log/Exp, activations…). Custom ops / contrib-domain-only ops from other runtimes, and ops needing a GPU EP, will fail at step 5.
- Use a recent standard opset (bundled models use **opset 17**). Avoid deprecated attributes (e.g. tf2onnx's `Resize coordinate_transformation_mode="tf_half_pixel_for_nn"`; for integer 2× nearest upsampling, `asymmetric` is equivalent).
- Single thread, CPU: keep FLOPs modest for phones. Current bundled sizes: WWE-UIE ~0.9 MB, Five A+ ~0.9 MB and Shallow-UWnet ~230 KB. File size alone does not establish inference speed.

## Export examples

### PyTorch
```python
import torch, onnx
class Wrap(torch.nn.Module):            # bake pre/post so the loader can use unit/unit
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, x):                  # x: [1,3,256,256] RGB in 0..1
        return torch.clamp(s.m(x), 0, 1)
model = Wrap(net).eval()
torch.onnx.export(model, torch.rand(1,3,256,256), "model.onnx",
                  input_names=["input"], output_names=["output"],
                  opset_version=17, dynamo=False)          # no dynamic_axes: fixed shape
m = onnx.load("model.onnx", load_external_data=True)
onnx.save(m, "model.onnx", save_as_external_data=False)  # single file; ClearWater still limits it to 64 MiB
```

### TF / Keras (NHWC model) with tf2onnx
```python
import tensorflow as tf, tf2onnx, tf_keras as K   # tf_keras for legacy Keras-2 .h5/.json
gen = K.models.model_from_json(open("gen.json").read()); gen.load_weights("gen.h5")
x = K.layers.Input((3,256,256), batch_size=1, name="input")              # NCHW 0..1
h = K.layers.Lambda(lambda t: tf.transpose(t*2-1, [0,2,3,1]))(x)          # -> NHWC -1..1
y = gen(h)
y = K.layers.Lambda(lambda t: tf.clip_by_value(tf.transpose((t+1)/2,[0,3,1,2]),0,1), name="output")(y)
w = K.Model(x, y)
tf2onnx.convert.from_keras(w, input_signature=(tf.TensorSpec((1,3,256,256), tf.float32, name="input"),),
                           opset=17, output_path="model.onnx")
```
(Alternatively skip the range Lambdas and select `−1 to 1` for input/output in the loader; the transposes are still required.)

## Verification checklist

- [ ] `onnx.checker.check_model(onnx.load(path))` passes; file is a single file ≤ 64 MiB; no `.data` sidecar.
- [ ] One input, one output; float32; declared shape `[1,3,256,256]`.
- [ ] Compare `onnxruntime` (CPUExecutionProvider) with the framework on (a) random input, (b) a real underwater photo resized to 256×256 and (c) the flat-grey loader test input (0.5 for unit, 0 for signed). Aim for max abs diff ≲ 1e-4 for a float32 conversion. Quantised versions need separately documented tolerances; current bundled files use the per-file `parity_tolerance` in `manifest.json` (0.02 for WWE-UIE/Shallow-UWnet, 0.0001 for Five A+), rather than a universal 1e-4 threshold.
- [ ] Output on flat grey is finite.
- [ ] Ops are all default-domain ONNX ops; no deprecated attributes.
- [ ] Load in the app (web and Android) and compare against Balanced / bundled models; note inference time on a phone.
- [ ] Record the input/output range settings and SHA-256 alongside the file.

## Licensing

Loading a model does not grant rights to use or redistribute it (`src/About.tsx`). Check both:
- **Code/weights licence** (e.g. MIT/Apache-2.0 vs "academic only", CC BY-NC, or no licence = all rights reserved).
- **Training-data terms**: e.g. UIEB states "for non-commercial use only"; EUVP terms are not clearly stated; LSUI asks for citation. Weights trained on non-commercial data are not safe to ship commercially.
Bundled models ship their licence files next to the ONNX in `public/models/` with provenance in `public/models/README.md`; follow the same pattern.
