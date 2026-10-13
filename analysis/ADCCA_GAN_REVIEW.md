# ADCCA-GAN paper review

Source: reference/techrxiv.176739819.90941183_v2.pdf, saved locally by the user. Read all seven PDF pages and visually inspected the architecture (PDF page 3), comparison images (page 5), and results/complexity tables (page 6). The cover identifies this as a 2 February 2026 preprint that has not been peer reviewed.

## Useful findings

The paper proposes ADCCA-GAN: a U-shaped generator using axial depthwise convolutions, channel attention and skip connections, trained with a conditional PatchGAN discriminator. Axial depthwise convolution aims to increase the receptive field efficiently; channel attention reweights learned feature channels. This attention is not a direct user-adjustable RGB gain or depth estimate.

Training combines adversarial, RGB mean-squared-error and VGG perceptual losses, with a composite-loss multiplier of 10. Inputs are resized to 256x256 and normalized to [-1,1]. The generator is the inference component; the discriminator and VGG training-loss network do not need to ship in the editor.

The paper reports 0.484 million parameters, 1.94 MB parameter memory and 6.34 GFLOPs, compared with 7.02 million parameters and 10.23 GFLOPs for its FUnIE-GAN baseline. Small parameter storage is attractive for downloadable models, but does not establish low activation memory or fast mobile execution. High-resolution operation scales compute and intermediate storage substantially.

Reported quantitative results (Table I, PDF page 6):

| Model | PSNR | SSIM | UIQM | UCIQE |
| --- | ---: | ---: | ---: | ---: |
| FUnIE-GAN | 15.635 | 0.738 | 3.222 | 0.518 |
| UIEC2-Net | 23.493 | 0.883 | 3.249 | 0.548 |
| Shallow-UWnet | 15.913 | 0.747 | 2.936 | 0.469 |
| ADCCA-GAN | 22.236 | 0.905 | 3.316 | 0.554 |

ADCCA-GAN leads the reported SSIM/UIQM/UCIQE results; UIEC2-Net leads PSNR. These are the authors' results on their particular evaluation, not our benchmarks. Visual examples show substantial differences between models and reinforce checking natural colour rather than selecting on metrics alone. Benchmark reference images represent target enhancements; agreement does not by itself demonstrate recovery of physically true scene colours.

## Limits relevant to ClearWater

- Experiments use UIEB, with a reported 90-image test set. The paper describes an 80/10/10 division of 890 paired images but later reports 710 training and 90 test images, so exact split files and baseline training details are needed for reproduction.
- Timing is 9.922 seconds for 90 test images on a Tesla T4, about 0.11 seconds/image or 9 images/second. This can be useful for a photo preview, but does not demonstrate 30 fps video, Android performance, or 12-24 MP export speed. End-to-end timing scope is not sufficiently specified for app estimates.
- No explicit evaluation of red-filter surface photos, magenta casts, user-specified depth, blue/green-water conditioning, strobe scenes or temporal video consistency is presented. Do not assume those capabilities.
- No code or pretrained-weight URL was found in the saved paper. A targeted web search did not verify an official release. Availability remains unknown; do not substitute a similarly named unrelated repository.
- The paper's CC-BY 4.0 notice does not establish licensing for a future code or checkpoint release.
- Full-resolution generalization, aspect-ratio handling, export operators and tiled inference are untested here. Global/channel attention can cause tile-dependent colour changes, so seamless tiled output requires specific validation.

## Changes to the implementation plan

1. Add ADCCA-GAN as a third optional model candidate, pending verifiable code, weights and redistribution terms. Do not make implementing or training it a prerequisite for the photo MVP.
2. Keep classical correction, Shallow-UWnet and FUnIE-GAN comparisons as planned; add ADCCA-GAN if reproducible artifacts become available. UIEC2-Net is also useful as a quality comparison because it has the best reported PSNR in this paper.
3. Feed each pretrained network its expected original-image representation first. This paper trains on normalized degraded inputs, not on our channel-balanced outputs; chaining remains an experiment rather than the default.
4. Keep depth/water/filter hints and signed manual correction in the deterministic editor, independent of neural-model availability.
5. If future benchmarks justify custom training, consider lightweight axial depthwise/channel-attention blocks and colour-plus-perceptual losses. Use properly licensed paired data that includes the target surface/filter and underwater cases. Compare preservation, noise and oversaturation, not merely sharper-looking output.

Decision: useful architecture and benchmark evidence, but insufficient deployment evidence to replace the current MVP plan. No model was run or trained during this review.
