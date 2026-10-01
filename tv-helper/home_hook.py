# SPDX-License-Identifier: GPL-3.0-only
"""Own the Home-only native hook. Never launch or restart an LG input service."""
import ctypes
import errno
import hashlib
import json
import os
import re
import select
import socket
import stat
import struct
import subprocess
import time

RUNTIME = "/tmp/lg-xmb-home-button"
TARGETS = ("lginput2", "micomservice", "RELEASE", "tvservice")
LIBRARY = "lgxmb-home-hook.so"
ARTIFACTS = ("ezinject", LIBRARY)
HOME_KEYS = (125, 773, 774)
artifacts = {}  # Supplied only after the bootstrap verifies the complete bundle.


class HookError(Exception):
    pass


def require(condition, code="hook_start_failed"):
    if not condition:
        raise HookError(code)


class Timespec(ctypes.Structure):
    _fields_ = [("seconds", ctypes.c_long), ("nanoseconds", ctypes.c_long)]


def clock():
    # Includes suspend: a lease from before standby must expire on wake.
    if hasattr(time, "clock_gettime"):
        return time.clock_gettime(7)  # CLOCK_BOOTTIME
    # Python 2 has no clock_gettime; /proc/uptime loses milliseconds and can
    # make a valid native event appear to come from the future.
    value = Timespec()
    librt = ctypes.CDLL("librt.so.1", use_errno=True)
    librt.clock_gettime.argtypes = [ctypes.c_int, ctypes.POINTER(Timespec)]
    librt.clock_gettime.restype = ctypes.c_int
    if librt.clock_gettime(7, ctypes.byref(value)) != 0:
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number))
    return value.seconds + value.nanoseconds / 1000000000.0


def runtime_directory(create=False):
    parent = os.open(os.path.dirname(RUNTIME), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        name = os.path.basename(RUNTIME)
        anchored = "/proc/self/fd/%d/%s" % (parent, name)
        if create:
            try:
                os.mkdir(anchored, 0o700)
            except OSError as error:
                if error.errno != errno.EEXIST:
                    raise
        fd = os.open(anchored, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(fd)
        if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
            os.close(fd)
            raise HookError("hook_conflict")
        return fd
    finally:
        os.close(parent)


def remove_owned(directory, name, is_socket=False):
    path = "/proc/self/fd/%d/%s" % (directory, name)
    try:
        info = os.lstat(path)
    except OSError as error:
        if error.errno == errno.ENOENT:
            return
        raise
    require(info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o077
            and (stat.S_ISSOCK(info.st_mode) if is_socket else stat.S_ISREG(info.st_mode)),
            "hook_conflict")
    os.unlink(path)


def disarm():
    try:
        directory = runtime_directory()
    except OSError as error:
        if error.errno == errno.ENOENT:
            return
        raise
    try:
        remove_owned(directory, "lease")
    finally:
        os.close(directory)


def healthy(setup, build):
    """Read-only controller health, independent of a saved 'running' status."""
    directory = None
    try:
        require(isinstance(build, type(u"")) and re.match(r"\A[0-9a-f]{64}\Z", build))
        directory = runtime_directory()
        raw = setup.read_file(directory, "lease", 160, repair_permissions=False)
        parts = raw.decode("ascii").split()
        require(len(parts) == 4 and parts[:3] == ["LGXMB_HOME", "1", build])
        age = clock() * 1000 - int(parts[3])
        info = os.lstat(setup.at(directory, "control.sock"))
        return (0 <= age < 2000 and stat.S_ISSOCK(info.st_mode)
                and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600)
    except (HookError, OSError, IOError, ValueError, UnicodeError, setup.SetupError):
        return False
    finally:
        if directory is not None:
            os.close(directory)


# Python 2 lacks socket.recvmsg. Use libc only for that missing primitive;
# kernel credentials, packet truncation and the wire format remain identical.
class IOVec(ctypes.Structure):
    _fields_ = [("base", ctypes.c_void_p), ("length", ctypes.c_size_t)]


class Message(ctypes.Structure):
    _fields_ = [("name", ctypes.c_void_p), ("name_length", ctypes.c_uint),
                ("iov", ctypes.POINTER(IOVec)), ("iov_length", ctypes.c_size_t),
                ("control", ctypes.c_void_p), ("control_length", ctypes.c_size_t),
                ("flags", ctypes.c_int)]


class Control(ctypes.Structure):
    _fields_ = [("length", ctypes.c_size_t), ("level", ctypes.c_int), ("kind", ctypes.c_int)]


def receive(sock):
    if hasattr(sock, "recvmsg"):
        data, ancillary, flags, _ = sock.recvmsg(256, socket.CMSG_SPACE(12))
    else:
        data_buffer, control_buffer = ctypes.create_string_buffer(256), ctypes.create_string_buffer(64)
        iov = IOVec(ctypes.cast(data_buffer, ctypes.c_void_p), 256)
        message = Message(None, 0, ctypes.pointer(iov), 1,
                          ctypes.cast(control_buffer, ctypes.c_void_p), 64, 0)
        libc = ctypes.CDLL(None, use_errno=True)
        libc.recvmsg.argtypes = [ctypes.c_int, ctypes.POINTER(Message), ctypes.c_int]
        libc.recvmsg.restype = ctypes.c_ssize_t
        count = libc.recvmsg(sock.fileno(), ctypes.byref(message), 0)
        if count < 0:
            number = ctypes.get_errno()
            raise OSError(number, os.strerror(number))
        data, flags, ancillary = data_buffer.raw[:count], message.flags, []
        if message.control_length >= ctypes.sizeof(Control) + 12:
            header = Control.from_buffer_copy(control_buffer.raw)
            if header.length == ctypes.sizeof(Control) + 12:
                ancillary = [(header.level, header.kind,
                              control_buffer.raw[ctypes.sizeof(Control):ctypes.sizeof(Control) + 12])]
    credentials = [struct.unpack("3i", value) for level, kind, value in ancillary
                   if level == socket.SOL_SOCKET and kind == 2 and len(value) == 12]  # SCM_CREDENTIALS
    require(not flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) and len(credentials) == 1)
    return data, credentials[0]


def process(pid):
    """Return the identity of an exact, root-owned LG input process."""
    directory = "/proc/%d" % pid
    try:
        if os.stat(directory).st_uid != 0:
            return None
        with open(directory + "/comm", "rb") as stream:
            name = stream.read(64).decode("ascii").strip()
        if name not in TARGETS:
            return None
        with open(directory + "/stat", "rb") as stream:
            fields = stream.read(4096).rsplit(b")", 1)[1].split()
        if fields[0] in (b"Z", b"X"):
            return None
        birth = int(fields[19])
        return (pid, birth, name)
    except (OSError, IOError, ValueError, IndexError, UnicodeError):
        return None


def targets():
    return {int(name): identity for name in os.listdir("/proc") if name.isdigit()
            for identity in [process(int(name))] if identity is not None}


def inspect_target(identity, library):
    pid = identity[0]
    with open("/proc/%d/exe" % pid, "rb") as stream:
        header = stream.read(20)
    require(header[:6] == b"\x7fELF\x01\x01" and header[18:20] == b"\x28\x00", "hook_unsupported")
    with open("/proc/%d/maps" % pid, "rb") as stream:
        raw = stream.read(2 * 1024 * 1024 + 1)
    require(len(raw) <= 2 * 1024 * 1024)
    mapped = False
    for line in raw.decode("utf-8", "replace").splitlines():
        path = line.split(None, 5)[-1]
        if LIBRARY in path:
            require(path == library, "hook_reboot_required")
            mapped = True
        elif any(token in path.lower() for token in ("inputhook", "lginput-hook")):
            raise HookError("hook_conflict")
    return mapped if process(pid) == identity else None


def install_artifacts(setup, base):
    require(all(name in artifacts for name in ARTIFACTS + ("build.json",)), "hook_missing")
    try:
        metadata = json.loads(artifacts["build.json"].decode("ascii"))
        build = metadata["buildId"]
        require(metadata["schema"] == 1 and metadata["protocol"] == 1
                and metadata["architecture"] == "arm-linux-gnueabi"
                and re.match(r"\A[0-9a-f]{64}\Z", build), "hook_missing")
        for name in ARTIFACTS:
            require(hashlib.sha256(artifacts[name]).hexdigest() == metadata["files"][name], "hook_missing")
            require(artifacts[name][:6] == b"\x7fELF\x01\x01"
                    and artifacts[name][18:20] == b"\x28\x00", "hook_unsupported")
    except (ValueError, KeyError, TypeError, UnicodeError):
        raise HookError("hook_missing")
    parent = setup.make_directory(base, "native")
    try:
        directory = setup.make_directory(parent, build)
    finally:
        os.close(parent)
    try:
        for name in ARTIFACTS:
            existing = setup.read_file(directory, name, 16 * 1024 * 1024, optional=True,
                                       repair_permissions=False)
            if existing is None:
                setup.write_file(directory, name, artifacts[name])
            else:
                require(existing == artifacts[name], "hook_conflict")
            fd = os.open(setup.at(directory, name), os.O_RDONLY | os.O_NOFOLLOW)
            try:
                setup.regular_file(os.fstat(fd))
                os.fchmod(fd, 0o755 if name == "ezinject" else 0o644)
            finally:
                os.close(fd)
    finally:
        os.close(directory)
    return build, setup.BASE + "/native/" + build


class Controller:
    def __init__(self, setup, base):
        self.setup, self.directory, self.socket = setup, None, None
        self.children, self.identities, self.attempted, self.ready = {}, {}, {}, {}
        self.running, self.reason, self.last_input = False, "hook_unavailable", None
        self.next_scan = self.next_lease = 0
        try:
            self.build, self.path = install_artifacts(setup, base)
            self.directory = runtime_directory(create=True)
            remove_owned(self.directory, "lease")
            remove_owned(self.directory, "control.sock", is_socket=True)
            self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
            self.socket.setsockopt(socket.SOL_SOCKET, getattr(socket, "SO_PASSCRED", 16), 1)
            self.socket.setblocking(False)
            self.socket.bind(setup.at(self.directory, "control.sock"))
            os.chmod(setup.at(self.directory, "control.sock"), 0o600)
        except BaseException:
            self.close()
            raise

    def _scan(self):
        current = targets()
        self.ready = {identity: entry for identity, entry in self.ready.items()
                      if current.get(identity[0]) == identity}
        self.identities = current
        for identity in list(current.values()):
            if identity in self.attempted:
                continue
            self.attempted[identity] = clock() + 5
            try:
                mapped = inspect_target(identity, self.path + "/" + LIBRARY)
            except (OSError, IOError) as error:
                if error.errno not in (errno.ENOENT, errno.ESRCH):
                    raise
                mapped = None
            if mapped is None:
                del current[identity[0]]  # The service exited during discovery.
                continue
            if mapped:
                continue  # Its heartbeat will reconnect to this controller.
            pid = identity[0]
            log = RUNTIME + "/inject-%d.log" % pid
            self.setup.write_file(self.directory, "inject-%d.log" % pid, b"")
            with open(os.devnull, "r+b") as null:
                child = subprocess.Popen([self.path + "/ezinject", "-l", log, str(pid),
                                          self.path + "/" + LIBRARY], stdin=null,
                                         stdout=null, stderr=null, close_fds=True)
            self.children[identity] = (child, clock() + 5)

    def _messages(self, launch):
        for _ in range(64):
            try:
                data, credentials = receive(self.socket)
            except (OSError, socket.error) as error:
                if error.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    break
                raise
            except HookError:
                continue
            try:
                parts = data.decode("ascii").split()
                require(7 <= len(parts) <= 9 and parts[:2] == ["LGXMB_HOME", "1"]
                        and parts[3] == self.build and credentials[1] == 0)
                pid, birth = int(parts[4]), int(parts[5])
                identity = self.identities.get(pid)
                require(credentials[0] == pid and identity is not None and identity[1] == birth
                        and process(pid) == identity)
                if len(parts) == 8 and parts[2] == "READY" and parts[6] in ("lginput", "micom", "write"):
                    timestamp = int(parts[7]) / 1000.0
                    require(0 <= clock() - timestamp <= 1.5)
                    self.ready[identity] = (timestamp, parts[6])
                elif len(parts) == 9 and parts[2] == "HOME":
                    code, state, timestamp = int(parts[6]), int(parts[7]), int(parts[8])
                    require(self.running and self._ready(clock()) and healthy(self.setup, self.build)
                            and code in HOME_KEYS and state == 1
                            and 0 <= clock() * 1000 - timestamp <= 250)
                    self.last_input = {"source": identity[2], "code": code}
                    launch()
            except (HookError, ValueError, UnicodeError):
                continue

    def step(self, launch, timeout=.25):
        if select.select([self.socket], [], [], timeout)[0]:
            self._messages(launch)
        now = clock()
        for identity, (child, deadline) in list(self.children.items()):
            code = child.poll()
            if code is None and now >= deadline:
                child.kill()
                child.wait()
                raise HookError("hook_start_failed")
            if code is not None:
                del self.children[identity]
                require(code == 0 or process(identity[0]) != identity, "hook_start_failed")
        if now >= self.next_scan:
            self._scan()
            self.next_scan = now + 2
        # ezinject can leave a failed module mapped while reporting success.
        # Without its first heartbeat, retrying would only reuse that module.
        require(not any(identity not in self.ready and now >= self.attempted[identity]
                        for identity in self.identities.values()), "hook_reboot_required")
        self.running = self._ready(now)
        self.reason = "" if self.running else ("hook_start_failed" if self.identities else "hook_unavailable")
        if not self.running:
            remove_owned(self.directory, "lease")
        elif now >= self.next_lease:
            self.setup.write_file(self.directory, "lease",
                ("LGXMB_HOME 1 %s %d\n" % (self.build, int(now * 1000))).encode("ascii"))
            self.next_lease = now + .5

    def _ready(self, now):
        return bool(self.identities) and all(identity in self.ready
            and 0 <= now - self.ready[identity][0] < 2 for identity in self.identities.values())

    def close(self):
        self.running = False
        try:
            if self.directory is not None:
                remove_owned(self.directory, "lease")
        finally:
            for child, _ in self.children.values():
                if child.poll() is None:
                    child.kill()
                child.wait()
            self.children.clear()
            try:
                if self.socket is not None:
                    self.socket.close()
                    self.socket = None
                    remove_owned(self.directory, "control.sock", is_socket=True)
            finally:
                if self.directory is not None:
                    os.close(self.directory)
                    self.directory = None
