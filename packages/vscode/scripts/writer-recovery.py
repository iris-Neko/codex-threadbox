"""Linux-only, metadata-only pidfd signaling. Input comes from the trusted host."""
import json
import os
import re
import select
import signal
import stat
import sys
import time

UUID = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$")


def validate_proc_namespace():
    if os.readlink("/proc/self") != str(os.getpid()):
        raise ValueError("Recovery is disabled because /proc uses a different PID namespace.")


def birth(pid):
    with open(f"/proc/{pid}/stat") as stream:
        return stream.read().rsplit(")", 1)[1].split()[19]


def process_owner(pid, allowed):
    if pid <= 1 or pid == os.getpid():
        return None
    root = f"/proc/{pid}"
    started = birth(pid)
    with open(root + "/status") as stream:
        status = stream.read()
    uid = re.search(r"^Uid:\s+(\d+)\s+(\d+)", status, re.M)
    if not uid or any(int(value) != os.getuid() for value in uid.groups()):
        return None
    executable = os.readlink(root + "/exe")
    if executable not in allowed:
        return None
    with open(root + "/cmdline", "rb") as stream:
        args = stream.read().split(b"\0")
        index = 1
        while index < len(args) and args[index] in (b"-c", b"--config", b"--enable", b"--disable"):
            index += 2
        if index >= len(args) or args[index] != b"app-server":
            return None
    executable_file = os.stat(root + "/exe")
    locks = {}
    for fd in os.listdir(root + "/fd"):
        try:
            link = root + "/fd/" + fd
            path = os.readlink(link)
            if "/thread-writer-locks/" not in path:
                continue
            with open(root + "/fdinfo/" + fd) as stream:
                info = stream.read()
            if not re.search(r"^lock:.*FLOCK\s+ADVISORY\s+WRITE\s", info, re.M):
                continue
            item = os.stat(link)
            thread_id = os.path.basename(path).removesuffix(" (deleted)").removesuffix(".lock")
            if not UUID.fullmatch(thread_id):
                raise ValueError("An unrecognized writer lock prevents safe recovery.")
            lock = {"path": path, "id": thread_id, "device": str(item.st_dev), "inode": str(item.st_ino)}
            locks[(path, item.st_dev, item.st_ino)] = lock
        except FileNotFoundError:
            continue
    if birth(pid) != started:
        raise ValueError("The Codex process changed during inspection. Retry recovery.")
    return {"pid": pid, "startTime": started, "uid": os.getuid(), "executable": executable,
            "executableDevice": str(executable_file.st_dev), "executableInode": str(executable_file.st_ino),
            "locks": sorted(locks.values(), key=lambda item: (item["path"], item["inode"]))}


def target_lock(home, thread_id):
    path = os.path.join(home, "thread-writer-locks", thread_id + ".lock")
    try:
        item = os.stat(path, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(item.st_mode) or item.st_uid != os.getuid():
        raise ValueError("The task lock is not a regular file owned by the current user.")
    if os.path.realpath(os.path.dirname(path)) != os.path.dirname(path):
        raise ValueError("Symlinked lock directories are not supported for recovery.")
    return {"path": path, "id": thread_id, "device": str(item.st_dev), "inode": str(item.st_ino)}


def owns(owner, target):
    return target is not None and target in owner["locks"]


def inspect(home, thread_id, allowed):
    target = target_lock(home, thread_id)
    if target is None:
        return None
    owners = []
    deadline = time.monotonic() + 5
    for entry in os.listdir("/proc"):
        if time.monotonic() > deadline:
            raise ValueError("Process inspection timed out. No process was stopped.")
        if not entry.isdecimal():
            continue
        try:
            owner = process_owner(int(entry), allowed)
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
        if owner and owns(owner, target):
            owners.append(owner)
    if len(owners) > 1:
        raise ValueError("Could not identify one trusted Codex App Server holding this lock. No process was stopped.")
    return owners[0] if owners else None


def validate_approval(current, approved):
    for key in ("pid", "startTime", "uid", "executable", "executableDevice", "executableInode"):
        if current[key] != approved.get(key):
            raise ValueError("The Codex process identity changed. Confirm recovery again.")
    if any(lock not in approved.get("locks", []) for lock in current["locks"]):
        raise ValueError("The Codex process acquired additional tasks. Confirm the new impact before retrying.")


def checked_signal(home, thread_id, allowed, approved, force):
    validate_proc_namespace()
    pid = approved.get("pid")
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 1:
        raise ValueError("Invalid process identity.")
    # pidfd binds the signal to this process, even if its numeric PID is reused.
    fd = os.pidfd_open(pid)
    try:
        if select.select([fd], [], [], 0)[0]:
            return {"released": True}
        current = process_owner(pid, allowed)
        if current is None:
            raise ValueError("The approved process is no longer a trusted Codex App Server.")
        validate_approval(current, approved)
        if not owns(current, target_lock(home, thread_id)):
            return {"released": True}
        signal.pidfd_send_signal(fd, signal.SIGKILL if force else signal.SIGTERM)
        return {"released": False}
    finally:
        os.close(fd)


def main(request):
    if sys.platform != "linux" or not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise ValueError("Recovery requires Linux with pidfd support and Python 3.9 or newer.")
    validate_proc_namespace()
    home = request.get("codexHome")
    thread_id = request.get("threadId")
    allowed = request.get("allowedExecutables")
    if not isinstance(home, str) or not os.path.isabs(home) or not isinstance(thread_id, str) or not UUID.fullmatch(thread_id):
        raise ValueError("Invalid recovery target.")
    if not isinstance(allowed, list) or not allowed or not all(isinstance(x, str) and os.path.isabs(x) for x in allowed):
        raise ValueError("No trusted Codex executable is available for recovery.")
    home = os.path.realpath(home)
    allowed = set(allowed)
    operation = request.get("operation")
    if operation == "inspect":
        return {"owner": inspect(home, thread_id, allowed)}
    approved = request.get("approved")
    if not isinstance(approved, dict):
        raise ValueError("Missing approved process identity.")
    if operation in ("terminate", "force"):
        try:
            return checked_signal(home, thread_id, allowed, approved, operation == "force")
        except ProcessLookupError:
            return {"released": True}
    if operation == "check":
        try:
            current = process_owner(approved["pid"], allowed)
        except (FileNotFoundError, ProcessLookupError):
            return {"released": True}
        if current is None:
            raise ValueError("The approved process identity changed.")
        validate_approval(current, approved)
        return {"released": not owns(current, target_lock(home, thread_id))}
    raise ValueError("Unknown recovery operation.")


if __name__ == "__main__":
    try:
        data = sys.stdin.buffer.read(262145)
        if len(data) > 262144:
            raise ValueError("Recovery request is too large.")
        print(json.dumps(main(json.loads(data))))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
