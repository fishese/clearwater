"""Create synthetic, non-private MP4/MOV fixtures (requires imageio-ffmpeg)."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / '.analysis-deps'))
import imageio_ffmpeg

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
folder = root / 'analysis/video-check'
folder.mkdir(parents=True, exist_ok=True)

def run(*args):
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)], check=True)

source = folder / 'h264-audio.mp4'
run('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=12', '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt',
    'yuv420p', '-c:a', 'aac', source)
run('-display_rotation:v:0', '90', '-i', source, '-c', 'copy', folder / 'rotated.mov')
run('-i', source, '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error',
    '-tag:v', 'hvc1', '-c:a', 'copy', folder / 'hevc.mov')
run('-i', source, '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error',
    '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084',
    '-colorspace', 'bt2020nc', '-tag:v', 'hvc1', '-c:a', 'copy', folder / 'hdr.mov')
print(f'Created fixtures in {folder}')
run('-f','lavfi','-i','testsrc2=size=320x240:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
    '-t','8','-vf','colorchannelmixer=rr=0.5:gg=0.85:bb=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',folder/'sampled.mp4')
run('-f','lavfi','-i','testsrc2=size=2560x1440:rate=60','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
    '-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-metadata','title=ClearWater source-mode fixture',
    '-metadata','comment=Metadata round-trip check','-metadata','creation_time=2024-03-04T05:06:07Z',folder/'source-60fps.mp4')
for seconds,name in [(600,'ten-minutes.mp4'),(601,'too-long.mp4')]:
    run('-f','lavfi','-i','testsrc2=size=64x48:rate=1','-t',seconds,'-c:v','libx264','-preset','ultrafast',
        '-pix_fmt','yuv420p',folder/name)
