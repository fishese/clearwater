# Model validation exports

`export_models.py` converts the available published checkpoints to full-precision ONNX, checks their outputs against PyTorch, and writes the validation artifacts under `.model-tools/generated-validation/`.

The generated directory is local and ignored by Git. These files are for validation only; they do not replace the optimized application models or `editor/public/models/manifest.json`.
