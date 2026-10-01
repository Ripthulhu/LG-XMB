# Home button hook

This ARM32 library intercepts Home inside LG's input processes. Python handles
launching LG-XMB; the injected code never runs shell commands. Hardware testing
is still required before claiming support for a TV or remote.

Follow [Building](../../docs/BUILDING.md#rebuild-the-native-home-hook) to rebuild
the hook and its pinned dependencies. See
[Compatibility](../../docs/COMPATIBILITY.md#home-button-routing) for hardware
test results.

Run the native IPC and event checks as root on a Linux development machine:

```sh
cc -std=c99 -Wall -Wextra -Werror -pthread tv-helper/native/test-home-hook.c -o /tmp/test-home-hook
sudo /tmp/test-home-hook
```

The test needs root to check real ownership rules. It creates and removes its
own `/tmp/lg-xmb-native-test` directory, uses a fake uinput file there, and never
injects a process or opens a device. It refuses to overwrite an existing test
directory.

The hook tries `lginput_uinput_send_button` and `MICOM_FuncWriteKeyEvent`. If
neither symbol exists, it hooks `write` for `/dev/uinput` events. Only Home codes
125, 773 and 774 are eligible. Other keys, pointer events and wheel events pass
through. Unknown write formats and batches larger than 4 KiB also pass through.

The controller must verify the target's ARM32 ELF identity and `/proc` start
time before injection. A mapped old LG-XMB hook or another input-hook library
requires an explicit restart/conflict result, not another layer of hooks.
Successfully installed routes announce readiness every 500 ms:

```text
LGXMB_HOME 1 READY <build-id> <pid> <start-ticks> <lginput|micom|write> <boottime-ms>
LGXMB_HOME 1 HOME <build-id> <pid> <start-ticks> <code> 1 <boottime-ms>
```

Both go to `/tmp/lg-xmb-home-button/control.sock` using nonblocking datagrams.
The helper validates kernel `SO_PASSCRED` credentials, process identity, build
ID and message age. The directory must be owned by root with mode 0700, and the
socket by root with mode 0600. Readiness is sent even while remapping is off.

To enable interception, the helper atomically refreshes a root-owned `lease`
file in the same directory every 500 ms:

```text
LGXMB_HOME 1 <build-id> <boottime-ms>
```

The hook requires a regular, single-link lease file which is not writable by
group or others, matches its build, and is less than two seconds old. The clock
is Linux `CLOCK_BOOTTIME`, including time spent suspended. Missing, malformed,
future or expired leases leave stock Home working. A full or missing socket
also leaves the press untouched. Only a successfully queued first press is
swallowed; its matching repeats and release are then consumed. Removing the
lease disables new interception without unloading code from LG's process.

See [NOTICE.md](NOTICE.md) for sources and licenses.
