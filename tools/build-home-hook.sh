#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Run on Linux/WSL. Only builds files locally; never connects to a TV.
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
native="$project/tv-helper/native"
cache=${HOME_HOOK_BUILD_DIR:-/tmp/lg-xmb-home-hook-build}
mkdir -p "$cache" "$native/prebuilt"
get_pin() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$native/dependencies.json" "$1"; }
toolchain="$cache/$(get_pin toolchainDirectory)"
archive="$cache/toolchain.tar.gz"
if [ ! -f "$archive" ]; then curl -fL --retry 2 -o "$archive" "$(get_pin toolchainUrl)"; fi
printf '%s  %s\n' "$(get_pin toolchainSha256)" "$archive" | sha256sum -c -
if [ ! -d "$toolchain" ]; then
    tar xf "$archive" -C "$cache"
    "$toolchain/relocate-sdk.sh"
fi
if [ ! -d "$cache/ezinject/.git" ]; then git clone https://github.com/smx-smx/ezinject "$cache/ezinject"; fi
git -C "$cache/ezinject" checkout --detach "$(get_pin ezinjectCommit)"
test -z "$(git -C "$cache/ezinject" status --porcelain --untracked-files=no)"
export SOURCE_DATE_EPOCH=1750000000
toolchain_file="$toolchain/share/buildroot/toolchainfile.cmake"
sysroot="$toolchain/arm-lgtv-linux-gnueabi/sysroot"
cmake -S "$cache/ezinject" -B "$cache/ezinject-build" -DCMAKE_BUILD_TYPE=Release \
    -DEZ_LIBC=glibc -DUSE_FRIDA_GUM=1 -DFRIDA_GUM=1 -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DCMAKE_TOOLCHAIN_FILE="$toolchain_file" -DCMAKE_INSTALL_PREFIX="$sysroot"
cmake --build "$cache/ezinject-build" --parallel 4
cmake --install "$cache/ezinject-build"
build_id=$(python3 - "$project" <<'PY'
import hashlib, pathlib, sys
root = pathlib.Path(sys.argv[1])
paths = ['tv-helper/native/home-hook.c', 'tv-helper/native/CMakeLists.txt',
         'tv-helper/native/dependencies.json', 'tools/build-home-hook.sh']
entries = ''.join('%s %s\n' % (p, hashlib.sha256((root / p).read_bytes()).hexdigest()) for p in sorted(paths))
print(hashlib.sha256(entries.encode()).hexdigest())
PY
)
cmake -S "$native" -B "$cache/hook-build" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE="$toolchain_file" -DHOME_HOOK_BUILD_ID="$build_id"
cmake --build "$cache/hook-build" --parallel 4
cp "$cache/hook-build/lgxmb-home-hook.so" "$native/prebuilt/lgxmb-home-hook.so"
cp "$sysroot/bin/ezinject" "$native/prebuilt/ezinject"
"$toolchain/bin/arm-lgtv-linux-gnueabi-strip" "$native/prebuilt/lgxmb-home-hook.so" "$native/prebuilt/ezinject"
python3 - "$project" "$build_id" <<'PY'
import hashlib, json, pathlib, struct, sys
root = pathlib.Path(sys.argv[1])
out = root / 'tv-helper/native/prebuilt'
paths = ['tv-helper/native/home-hook.c', 'tv-helper/native/CMakeLists.txt',
         'tv-helper/native/dependencies.json', 'tools/build-home-hook.sh']
files = {}
for name in ['ezinject', 'lgxmb-home-hook.so']:
    data = (out / name).read_bytes()
    if data[:6] != b'\x7fELF\x01\x01' or struct.unpack_from('<H', data, 18)[0] != 40:
        raise SystemExit('Expected an ARM32 little-endian ELF: ' + name)
    files[name] = hashlib.sha256(data).hexdigest()
metadata = dict(schema=1, protocol=1, buildId=sys.argv[2], architecture='arm-linux-gnueabi',
    sources={p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in sorted(paths)}, files=files)
(out / 'build.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps(metadata, indent=2))
PY
