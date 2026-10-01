# Native Home button hook

LG-XMB's `home-hook.c` is GPL-3.0-only. Its LG input structures, hook targets,
and ezinject entry points are adapted from
[sundermann/inputhookpp](https://github.com/sundermann/inputhookpp/tree/9dc3cf140cb1ae1dbe059525c72710deea7ecf7d),
which is GPL-3.0. The inputhookpp license is included in `licenses/`.

This is a modified implementation. It handles Home only and sends presses to
LG-XMB's root helper. It does not include inputhookpp's configuration watcher,
arbitrary key remapping, or shell command launcher.

The injector is built from
[smx-smx/ezinject at 607055c](https://github.com/smx-smx/ezinject/tree/607055c06b037eadc3992008940d99bdc4a14f53)
by Stefano Moioli, under the zlib license. That source is unchanged. The build
enables position-independent code for its runtime objects. Its license is
included as `licenses/ezinject.txt`.

The hook statically links these libraries supplied by the pinned SDK:

| Library | Source | License text |
| --- | --- | --- |
| Frida Gum | [0c8df674](https://github.com/frida/frida-gum/tree/0c8df6742d2c7a08c32fc3c3b691779b062fb34a) | `licenses/frida-gum.txt`; wxWindows Library Licence 3.1, with its binary-linking exception |
| GLib, GObject, GIO | [2.82.5](https://gitlab.gnome.org/GNOME/glib/-/tree/2.82.5) | `licenses/glib-LGPL-2.1.txt`; LGPL-2.1-or-later |
| Capstone | [e9874611](https://github.com/frida/capstone/tree/e98746112da0a40b2ccd0340db0d20cca5f97950) | `licenses/capstone.txt`, `licenses/capstone-llvm.txt`; BSD |
| libffi | [3.4.6](https://github.com/libffi/libffi/tree/v3.4.6) | `licenses/libffi.txt`; MIT |
| PCRE2 | [10.44](https://github.com/PCRE2Project/pcre2/tree/pcre2-10.44) | `licenses/pcre2.txt`; BSD-3-Clause |
| libdwarf | [0.12.0](https://github.com/davea42/libdwarf-code/tree/v0.12.0) | `licenses/libdwarf.txt`, `licenses/libdwarf-copyright.txt`, `licenses/glib-LGPL-2.1.txt`; LGPL-2.1 with BSD portions |

The LGPL-2.1 text also supplies the GNU library license referenced by Frida's
wxWindows notice, under its permission to use version 2 or any later version.

The SDK is built from
[sundermann/buildroot-nc4 at 93adce88](https://github.com/sundermann/buildroot-nc4/tree/93adce888212c31ff2a89f5ea9260961c64fc6c5)
using `lgtv_defconfig`. That tree contains the dependency source locations,
versions, patches and build recipes. `dependencies.json` pins the downloaded SDK
archive by SHA-256. `tools/build-home-hook.sh` builds the injector and hook from
source with that SDK; the resulting `prebuilt/build.json` records the source and
binary hashes. The build files and linked dependency sources above allow the
hook to be rebuilt and relinked with modified libraries.

The TV's standard C/POSIX runtime libraries are dynamically linked and are not
bundled here. No binaries from the Syspoke or unofficial LG Input Hook IPKs are
used.
