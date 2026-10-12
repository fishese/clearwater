"""Fetch author artifacts to ignored local directories. No private photos leave disk."""
from pathlib import Path
import argparse, hashlib, urllib.request
import gdown

root=Path(__file__).resolve().parent
sources=root/'upstream'; weights=root/'weights'
sources.mkdir(exist_ok=True);weights.mkdir(exist_ok=True)
parser=argparse.ArgumentParser()
parser.add_argument('--research',action='store_true',help='Prepare private academic-only Deep WaveNet artifacts')
args=parser.parse_args()
def fetch(url,path,sha=None):
    urllib.request.urlretrieve(url,path)
    if sha and hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
        raise ValueError(f'Checkpoint hash mismatch: {path.name}')

shallow='https://raw.githubusercontent.com/mkartik/Shallow-UWnet/dfd4adfe3e5a5b41b65ac8047069bb155b6cc8e6/'
funie='https://raw.githubusercontent.com/xahidbuffon/FUnIE-GAN/8f934c834c94e007b00866186b9ee624dc2b7b69/'
fetch(shallow+'model.py',sources/'model.py')
fetch(funie+'PyTorch/nets/funiegan.py',sources/'funiegan.py')
fetch(funie+'PyTorch/models/funie_generator.pth',weights/'funie_generator.pth','e4fcb50e03868f1683c244b1c125def30df335ec43d9bb001b8700c03b8f2bd6')
gdown.download(id='1QmOR8Ar3LqS5Pj0GG3I-798Yyj9xswet',output=str(weights/'shallow.ckpt'))
assert hashlib.sha256((weights/'shallow.ckpt').read_bytes()).hexdigest()=='16c090a847e990bfd56a6466fd36f5595cc3a4c514a5ce941caa1a1806441835'
if args.research:
    wave='https://raw.githubusercontent.com/pksvision/Deep-WaveNet-Underwater-Image-Restoration/e6893b5782d22bb0ab0f58696fbc1ccda7f7b911/'
    fetch(wave+'uie_uieb/models.py',sources/'wavenet.py')
    fetch(wave+'uie_uieb/ckpts/netG_295.pt',weights/'wave.pt','ad99395a60addf02db93079613dcdeb4d5fd02a259eaf4027e773cc377cba703')
    fetch(wave+'License.md',sources/'LICENSE-Deep-WaveNet.md')
print('Sources prepared. Research artifacts remain local and must not be redistributed.')
