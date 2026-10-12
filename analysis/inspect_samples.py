import sys,json
sys.path.insert(0, r'D:\Projects\ClearWater\.analysis-deps')
from PIL import Image,ImageOps,ImageDraw
import pillow_heif
import numpy as np
from pathlib import Path
pillow_heif.register_heif_opener()
root=Path(r'D:\Projects\ClearWater')
files=sorted((root/'Sample photos').iterdir())
sheet=Image.new('RGB',(1200,1020),(24,28,32)); draw=ImageDraw.Draw(sheet)
rows=[]
for i,p in enumerate(files):
 im=ImageOps.exif_transpose(Image.open(p)).convert('RGB'); size=im.size
 im.thumbnail((384,280)); a=np.asarray(im,dtype=np.float32); avg=a[::2,::2].mean(axis=(0,1))
 row={'file':p.name,'size':size,'sample_mean_rgb':avg.round(1).tolist(),'red_relative_to_gb':round(float(avg[0]/max(1,(avg[1]+avg[2])/2)),2),'near_white_all_channels_pct':round(float((a.min(axis=2)>=250).mean()*100),2),'any_channel_near_clip_pct':round(float((a.max(axis=2)>=250).mean()*100),2)}
 rows.append(row)
 x=(i%3)*400+8; y=(i//3)*340+8
 sheet.paste(im,(x+(384-im.width)//2,y));draw.text((x,y+286),p.name,fill='white');draw.text((x,y+308),str(size)+' RGB '+str(row['sample_mean_rgb']),fill='white')
sheet.save(root/'analysis'/'sample-contact-sheet.jpg',quality=90)
(root/'analysis'/'sample-statistics.json').write_text(json.dumps(rows,indent=2))
print(json.dumps(rows,indent=2))
