"""Safety tests for the bundled helper. No real processes are signaled."""
import copy
import importlib.util
import io
import pathlib
import signal
import unittest
from unittest.mock import patch

SOURCE = pathlib.Path(__file__).resolve().parents[2] / "packages/vscode/scripts/writer-recovery.py"
spec = importlib.util.spec_from_file_location("writer_recovery", SOURCE)
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
TASK = "019f0000-0000-7000-8000-000000000001"
LOCK = {"id": TASK, "path": "/home/test/.codex/thread-writer-locks/" + TASK + ".lock", "device": "1", "inode": "2"}
OWNER = {"pid": 12345, "uid": 1000, "startTime": "1234", "executable": "/trusted/codex",
         "executableDevice": "1", "executableInode": "9", "locks": [LOCK]}


class RecoveryTests(unittest.TestCase):
    def invoke(self, current, force=False):
        with patch.object(recovery.os, "pidfd_open", return_value=42, create=True), \
             patch.object(recovery.os, "close") as closed, \
             patch.object(recovery.select, "select", return_value=([], [], [])), \
             patch.object(recovery, "process_owner", return_value=current), \
             patch.object(recovery, "target_lock", return_value=LOCK), \
             patch.object(recovery.signal, "pidfd_send_signal", create=True) as send:
            try:
                outcome = recovery.checked_signal("/home/test/.codex", TASK, {"/trusted/codex"}, OWNER, force)
            except ValueError:
                send.assert_not_called()
                closed.assert_called_once_with(42)
                raise
            send.assert_called_once_with(42, signal.SIGKILL if force else signal.SIGTERM)
            closed.assert_called_once_with(42)
            return outcome

    def test_signal_uses_pidfd_not_numeric_pid(self):
        with patch.object(recovery.os, "kill") as kill:
            self.invoke(OWNER)
            self.invoke(OWNER, True)
            kill.assert_not_called()

    def test_reused_pid_changed_user_or_executable_is_rejected(self):
        for field, value in [("pid", 54321), ("startTime", "9999"), ("uid", 0),
                             ("executable", "/other/codex"), ("executableInode", "99")]:
            changed = {**OWNER, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.invoke(changed)

    def test_additional_task_or_replaced_lock_is_rejected(self):
        for locks in [[LOCK, {**LOCK, "inode": "3"}], [{**LOCK, "inode": "3"}]]:
            with self.subTest(locks=locks), self.assertRaises(ValueError):
                self.invoke({**OWNER, "locks": locks})

    def test_released_collateral_locks_do_not_expand_approval(self):
        approved = copy.deepcopy(OWNER)
        approved["locks"].append({**LOCK, "inode": "4"})
        recovery.validate_approval(OWNER, approved)

    def test_unrecognized_process_cannot_be_signaled(self):
        with self.assertRaises(ValueError):
            self.invoke(None)

    def test_non_server_command_or_other_uid_is_not_an_owner(self):
        for uid, args in [(1001, b"codex\0app-server\0"), (1000, b"codex\0exec\0app-server\0")]:
            def opened(path, mode="r"):
                return io.BytesIO(args) if mode == "rb" else io.StringIO(f"Uid:\t{uid}\t{uid}\t{uid}\t{uid}\n")
            with patch.object(recovery, "birth", return_value="1234"), \
                 patch.object(recovery.os, "getuid", return_value=1000, create=True), \
                 patch.object(recovery.os, "readlink", return_value="/trusted/codex"), \
                 patch("builtins.open", side_effect=opened):
                self.assertIsNone(recovery.process_owner(12345, {"/trusted/codex"}))


if __name__ == "__main__":
    unittest.main()
