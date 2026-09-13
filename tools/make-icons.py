"""Reproducible original app icons. SPDX-License-Identifier: GPL-3.0-or-later"""
from pathlib import Path
from PIL import Image, ImageDraw
import math
app = Path(__file__).resolve().parent.parent / 'app'
for name, size in [('icon.png', 80), ('largeIcon.png', 130)]:
    scale = 4
    n = size * scale
    image = Image.new('RGB', (n,n))
    pixels = image.load()
    for y in range(n):
        for x in range(n):
            glow = max(0, 1-math.hypot(x/n-.45,y/n-.6))
            pixels[x,y] = (int(5+13*glow),int(9+21*glow),int(17+43*glow))
    draw = ImageDraw.Draw(image)
    for j in range(5):
        points = [(x, n*(.67+.035*j)+math.sin(x/n*6+j*.25)*n*.035) for x in range(n)]
        draw.line(points, fill=(55+j*10,77+j*9,125+j*12), width=max(1,scale//2))
    points=[(n*.22,n*.43),(n*.5,n*.20),(n*.78,n*.43)]
    draw.line(points,fill=(224,234,255),width=int(n*.022))
    points=[(n*.30,n*.39),(n*.30,n*.72),(n*.70,n*.72),(n*.70,n*.39)]
    draw.line(points,fill=(224,234,255),width=int(n*.022))
    draw.line([(n*.45,n*.72),(n*.45,n*.52),(n*.55,n*.52),(n*.55,n*.72)],fill=(224,234,255),width=int(n*.02))
    image.resize((size,size),Image.Resampling.LANCZOS).save(app/name)
