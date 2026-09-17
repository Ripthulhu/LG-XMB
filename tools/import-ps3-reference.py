#!/usr/bin/env python3
"""Build a LOCAL data-only seed pack from the supplied analysis ZIPs.
No executables or whole memory images are imported. Do not commit the output.
Requires Python 3.10+, standard library only.
"""
import argparse
import base64
import hashlib
import json
import struct
import zipfile
from pathlib import Path


def b64(data):
    return base64.b64encode(data).decode('ascii')


def tga(raw):
    if len(raw) < 18:
        raise ValueError('Truncated TGA header')
    ident, cmap, kind = raw[:3]
    w, h, depth, flags = struct.unpack_from('<HHBB', raw, 12)
    if cmap or kind not in (2, 10) or depth not in (24, 32) or not 0 < w*h <= 1048576:
        raise ValueError('Expected small RGB/RGBA true-color TGA')
    stride, at, pixels = depth//8, 18+ident, bytearray()
    while len(pixels) < w*h*stride:
        if kind == 2:
            pixels.extend(raw[at:at+w*h*stride]); break
        if at >= len(raw):
            raise ValueError('Truncated TGA RLE payload')
        tag = raw[at]; at += 1
        count = (tag & 127)+1
        if tag & 128:
            pixels.extend(raw[at:at+stride]*count); at += stride
        else:
            pixels.extend(raw[at:at+count*stride]); at += count*stride
    if len(pixels) != w*h*stride:
        raise ValueError('Invalid TGA payload length')
    rgba = bytearray(w*h*4)
    for y in range(h):
        for x in range(w):
            # Store rows top-down. Texture coordinates in the native shader use this convention.
            sy = y if flags & 32 else h-1-y
            sx = w-1-x if flags & 16 else x
            a=(sy*w+sx)*stride; b=(y*w+x)*4
            rgba[b:b+4] = bytes([pixels[a+2],pixels[a+1],pixels[a],pixels[a+3] if stride==4 else 255])
    return {'width':w,'height':h,'rgba':b64(rgba)}


class Archive:
    def __init__(self, name):
        self.path=Path(name);self.z=zipfile.ZipFile(name)
        self.members=self.z.namelist()
    def read(self, suffix):
        names=[n for n in self.members if n == suffix or n.endswith('/'+suffix)]
        if len(names)!=1:
            raise ValueError(f'Expected one {suffix} in {self.path.name}, found {len(names)}')
        item=self.z.getinfo(names[0])
        if item.file_size>32*1024*1024:
            raise ValueError('Unexpectedly large input')
        return self.z.read(item)
    def json(self, suffix):
        return json.loads(self.read(suffix))


def build(live_path, lines_path):
    live, lines = Archive(live_path), Archive(lines_path)
    hashes=live.json('fixture_hashes.json')
    def verified(name):
        data=live.read(name)
        if name not in hashes or hashlib.sha256(data).hexdigest()!=hashes[name]:
            raise ValueError('Fixture hash mismatch: '+name)
        return data
    snapshot=live.json('analysis/snapshot.json')
    basis=live.json('reference/spline_basis_tables.json')
    settings=live.json('analysis/effective_wave_settings.json')
    w=snapshot['wave']
    pack={'format':1,'firmware':'3.01','capture':snapshot['source_manifest_created_utc'],
          'settings':settings,'basis':basis['basis'],'derivative':basis['derivative'],
          'wave':{'clock':w['clock'],'fraction':w['fraction'],'smoothedClock':w['smoothed_clock'],
                  'counter':w['noise_counter'],'program':w['current_program']}}
    for target,source in [('current','current'),('previous','previous'),('velocity','velocity'),('matrix','transform')]:
        pack['wave'][target]=b64(verified('data/wave/'+source+'.bin'))
    pack['wave']['lattice']=b64(verified('data/wave/lattice_transfer.bin')[:539*16])
    pack['particles']=b64(verified('data/particles/state_before.bin'))
    source_params=verified('data/particles/params.bin')
    # Retain only the numerical fields read by Core.Parameters. Unused payload
    # bytes are zeroed rather than carrying unrelated retained memory onward.
    params=bytearray(2304)
    ranges=((0,12),(16,28),(128,1664),(0x700,0x780),(0x784,0x78c),
            (0x800,0x80c),(0x810,0x81c),(0x830,0x83c),(0x840,0x880),
            (0x890,0x89c),(0x8a0,0x8a8),(0x8ac,0x8bc))
    for first,last in ranges:
        params[first:last]=source_params[first:last]
    pack['particleParams']=b64(params)
    material=lines.json('analysis/settings.json')['PARTICLES.mnu']['values']
    pack['particleMaterial']=material
    pack['viewProjection']=live.json('analysis/wave_validation.json')['factored_view_projection_columns']
    for key, name in [('iridescence','particles/proc_iridescent.tga'),('fresnel','textures/TGA/freslut.tga')]:
        pack[key]=tga(lines.read('extracted/'+name))
    # Compact data-only pack; no executable or whole guest-memory image.
    return pack


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--live',required=True,type=Path);p.add_argument('--lines',required=True,type=Path)
    p.add_argument('--out',type=Path,default=Path('app/ps3-native-data.js'))
    p.add_argument('--optics',type=Path,help='Optional retained particle-uniform JSON from the matching capture')
    args=p.parse_args()
    pack=build(args.live,args.lines)
    if args.optics:
        optics=json.loads(args.optics.read_text(encoding='utf-8'))
        if optics.get('format')!=1 or optics.get('capture')!=pack['capture']:
            raise ValueError('Optics capture does not match the reference pack')
        pack['optics']=optics
    code='''/* LOCAL REFERENCE DATA: do not commit or redistribute as project source. */
(function(root){'use strict';
  var data=PACK;
  function raw(text){var s=atob(text),a=new Uint8Array(s.length);for(var i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a;}
  function floats(text){var a=raw(text),d=new DataView(a.buffer),f=new Float32Array(a.length/4);for(var i=0;i<f.length;i++)f[i]=d.getFloat32(i*4);return f;}
  ['current','previous','velocity','matrix','lattice'].forEach(function(k){data.wave[k]=floats(data.wave[k]);});
  data.particles=floats(data.particles);data.particleParams=raw(data.particleParams);
  ['iridescence','fresnel'].forEach(function(k){data[k].rgba=raw(data[k].rgba);});
  data.basis=new Float32Array(data.basis.flat());data.derivative=new Float32Array(data.derivative.flat());
  data.viewProjection=new Float32Array(data.viewProjection.flat());
  root.LGXMBPS3Reference=data;
})(typeof window==='object'?window:globalThis);
'''.replace('PACK',json.dumps(pack,separators=(',',':'),allow_nan=False))
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(code,encoding='utf-8')
    print(f'Wrote {args.out} ({len(code)} bytes). Local/private seed data, not project source.')

if __name__=='__main__':
    main()
