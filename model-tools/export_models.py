"""Convert the authors' checkpoints using restricted torch loading; verify ONNX parity.
Run from project root with .model-tools/Scripts/python.exe model-tools/export_models.py.
Upstream model sources belong in model-tools/upstream (see public/models/README.md).
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

torch.set_num_threads(4)
weights = ROOT / 'model-tools/weights'
out = ROOT / 'editor/public/models'
with torch.serialization.safe_globals([UWnet, ConvBlock, torch.nn.Conv2d,
        torch.nn.ReLU, torch.nn.Dropout2d, torch.nn.Sequential, set]):
    shallow = torch.load(weights / 'shallow.ckpt', map_location='cpu', weights_only=True)
funie = GeneratorFunieGAN()
funie.load_state_dict(torch.load(weights / 'funie_generator.pth', map_location='cpu', weights_only=True))
report = {}
torch.manual_seed(42)
for name, model in [('shallow', shallow), ('funie', funie)]:
    model.eval()
    sample = torch.rand(1, 3, 256, 256)
    if name == 'funie': sample = sample * 2 - 1
    path = out / f'{name}.onnx'
    torch.onnx.export(model, sample, str(path), input_names=['image'], output_names=['enhanced'],
                      opset_version=17, dynamo=False)
    onnx.checker.check_model(onnx.load(path))
    with torch.no_grad(): expected = model(sample).numpy()
    actual = ort.InferenceSession(str(path), providers=['CPUExecutionProvider']).run(None, {'image': sample.numpy()})[0]
    error = float(np.max(np.abs(expected - actual)))
    assert error < 1e-4, (name, error)
    report[name] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'bytes': path.stat().st_size, 'max_abs_parity_error': error,
                    'checkpoint_sha256': hashlib.sha256((weights / ('shallow.ckpt' if name=='shallow' else 'funie_generator.pth')).read_bytes()).hexdigest()}
    print(name, report[name], flush=True)
(out / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
