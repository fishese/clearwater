"""Private local Deep WaveNet conversion. Do not redistribute the resulting model.
Upstream is CC BY-NC-ND 4.0; README additionally specifies academic use only.
"""
from pathlib import Path
import sys, argparse, hashlib, json
import torch
import numpy as np
import onnxruntime as ort

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'model-tools/upstream'))
from wavenet import CC_Module
torch.set_num_threads(4)
with torch.serialization.safe_globals([argparse.Namespace]):
    checkpoint=torch.load(root/'model-tools/weights/wave.pt',map_location='cpu',weights_only=True)
model=CC_Module()
model.load_state_dict(checkpoint['model_state_dict'])
model.eval()
torch.manual_seed(42)
sample=torch.rand(1,3,256,256)
path=root/'model-tools/weights/deep-wavenet-research.onnx'
torch.onnx.export(model,sample,str(path),input_names=['image'],output_names=['enhanced'],opset_version=17,dynamo=False)
with torch.no_grad(): expected=model(sample).numpy()
actual=ort.InferenceSession(str(path),providers=['CPUExecutionProvider']).run(None,{'image':sample.numpy()})[0]
error=float(np.max(np.abs(expected-actual)))
assert error<1e-4,error
report={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'max_abs_parity_error':error,
        'checkpoint_sha256':hashlib.sha256((root/'model-tools/weights/wave.pt').read_bytes()).hexdigest()}
(root/'model-tools/weights/wave-manifest.json').write_text(json.dumps(report,indent=2))
print(report)
