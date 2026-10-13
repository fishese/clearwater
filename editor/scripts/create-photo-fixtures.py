"""Create small synthetic DNGs and highly compressed large PNGs, outside shipped assets."""
import struct, zlib
from pathlib import Path
out=Path(__file__).resolve().parents[2]/'analysis'/'photo-check'
out.mkdir(parents=True,exist_ok=True)
def dng(path,linear=False):
    width,height=128,96
    def shorts(*v):return struct.pack('<'+'H'*len(v),*v)
    def longs(*v):return struct.pack('<'+'I'*len(v),*v)
    def rationals(*v):return b''.join(struct.pack('<ii',n,d) for n,d in v)
    channels=3 if linear else 1
    tags={254:(4,1,longs(0)),256:(4,1,longs(width)),257:(4,1,longs(height)),258:(3,channels,shorts(*([16]*channels))),259:(3,1,shorts(1)),262:(3,1,shorts(34892 if linear else 32803)),271:(2,12,b'Test Camera\0'),272:(2,14,b'Synthetic DNG\0'),273:(4,1,longs(0)),274:(3,1,shorts(6)),277:(3,1,shorts(channels)),278:(4,1,longs(height)),279:(4,1,longs(width*height*channels*2)),284:(3,1,shorts(1)),50706:(1,4,bytes([1,4,0,0])),50707:(1,4,bytes([1,1,0,0])),50708:(2,14,b'Synthetic DNG\0'),50714:(5,1,rationals((64,1))),50717:(4,1,longs(4095)),50721:(10,9,rationals(*[(1 if i%4==0 else 0,1) for i in range(9)])),50728:(5,3,rationals((1,1),(1,1),(1,1))),50778:(3,1,shorts(21))}
    if not linear:tags.update({33421:(3,2,shorts(2,2)),33422:(1,4,bytes([0,1,1,2]))})
    # Derive text counts from bytes (ASCII count includes the null terminator).
    tags={k:(t,len(v) if t in (1,2) else n,v) for k,(t,n,v) in tags.items()}
    start=8+2+12*len(tags)+4
    extra=bytearray();entries=[]
    for tag,(kind,count,value) in sorted(tags.items()):
        if len(value)<=4:field=value.ljust(4,b'\0')
        else:field=longs(start+len(extra));extra.extend(value);extra.extend(b'\0'*(len(extra)%2))
        entries.append((tag,kind,count,field))
    strip=start+len(extra)
    entries=[(t,k,n,longs(strip) if t==273 else v) for t,k,n,v in entries]
    pixels=bytearray()
    for y in range(height):
        for x in range(width):
            if linear:pixels.extend(shorts(700+x*8,1200+y*8,1900+x*4))
            else:pixels.extend(shorts(800+x*8+y*5))
    path.write_bytes(b'II'+shorts(42)+longs(8)+shorts(len(entries))+b''.join(shorts(t,k)+longs(n)+v for t,k,n,v in entries)+longs(0)+extra+pixels)
def png(path,width,height):
    def chunk(name,data):return struct.pack('>I',len(data))+name+data+struct.pack('>I',zlib.crc32(name+data))
    compressor=zlib.compressobj();parts=[];row=b'\0'+bytes([35,110,135])*width
    for _ in range(height):parts.append(compressor.compress(row))
    parts.append(compressor.flush())
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',b''.join(parts))+chunk(b'IEND',b''))
dng(out/'bayer.dng');dng(out/'linear.dng',True)
png(out/'large-48mp.png',8000,6000)
png(out/'normal-12mp.png',4000,3000)
print('Created synthetic Bayer/linear DNG and ordinary/large PNG fixtures.')
