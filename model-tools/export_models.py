"""Convert the authors' checkpoints using restricted torch loading; verify ONNX parity.
Run from project root with .model-tools/Scripts/python.exe model-tools/export_models.py.
Upstream model sources belong in model-tools/upstream (see public/models/README.md).

The committed bundles under editor/public/models are later optimised exports.
This script still checks full-precision ONNX against PyTorch below 1e-4.
It does not reproduce the int8 files or their looser parity_tolerance values.
"""
from pathlib import Path
import sys, hashlib, json
import numpy as np
import torch
import onnx
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'model-tools/upstream'))
from model import UWnet, ConvBlock
from funiegan import GeneratorFunieGAN
from wwe_model import myModel as WWEUIE

torch.set_num_threads(4)
weights = ROOT / 'model-tools/weights'
out = ROOT / 'editor/public/models'
with torch.serialization.safe_globals([UWnet, ConvBlock, torch.nn.Conv2d,
        torch.nn.ReLU, torch.nn.Dropout2d, torch.nn.Sequential, set]):
    shallow = torch.load(weights / 'shallow.ckpt', map_location='cpu', weights_only=True)
funie = GeneratorFunieGAN()
funie.load_state_dict(torch.load(weights / 'funie_generator.pth', map_location='cpu', weights_only=True))
with torch.serialization.safe_globals([WWEUIE]):
    wwe_state = torch.load(weights / 'wwe_uieb_best_model.pth', map_location='cpu', weights_only=True)
wwe = WWEUIE(in_channels=3, feature_channels=32, use_white_balance=True)
wwe.load_state_dict(wwe_state, strict=True)
report = {}
torch.manual_seed(42)
for name, model in [('shallow', shallow), ('funie', funie), ('wwe', wwe)]:
    model.eval()
    sample = torch.rand(1, 3, 256, 256)
    if name == 'funie': sample = sample * 2 - 1
    path = out / f'{name}.onnx'
    torch.onnx.export(model, sample, str(path), input_names=['image'], output_names=['enhanced'],
                      opset_version=17, dynamo=False)
    onnx.checker.check_model(onnx.load(path))
    session = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    samples = [sample]
    if name == 'wwe':
        # Match a browser canvas with exact integer RGB channel gradients.
        x = torch.arange(256, dtype=torch.float32).view(1, 1, 1, 256).expand(1, 1, 256, 256)
        y = torch.arange(256, dtype=torch.float32).view(1, 1, 256, 1).expand(1, 1, 256, 256)
        ramp = torch.cat([x, y, torch.floor((x + y) / 2)], dim=1) / 255
        # Also exercise hard edges and cast/clipped regions.
        blocks = torch.zeros(1, 3, 256, 256)
        blocks[:, 0, :, :128], blocks[:, 1, :128, 128:], blocks[:, 2, 128:, 128:] = 1, 1, 1
        samples.extend([ramp, blocks])
    errors=[]
    for parity_input in samples:
        with torch.no_grad(): expected = model(parity_input).numpy()
        actual = session.run(None, {'image': parity_input.numpy()})[0]
        errors.append(float(np.max(np.abs(expected - actual))))
    error = max(errors)
    assert error < 1e-4, (name, error)
    if name == 'wwe':
        with torch.no_grad():
            expected_field = (model(ramp).clamp(0, 1) - ramp).permute(0, 2, 3, 1).contiguous().numpy().astype('<f4')
        expected_field.tofile(weights / 'wwe_gradient_expected.bin')
    checkpoint_name = {'shallow':'shallow.ckpt','funie':'funie_generator.pth','wwe':'wwe_uieb_best_model.pth'}[name]
    report[name] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'bytes': path.stat().st_size, 'max_abs_parity_error': error,
                    'parity_samples': len(samples),
                    'checkpoint_sha256': hashlib.sha256((weights / checkpoint_name).read_bytes()).hexdigest()}
    print(name, report[name], flush=True)
(out / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
