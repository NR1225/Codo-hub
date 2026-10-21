"""Terminal service for managing PTY sessions via WebSocket.

Security model
--------------
The terminal hands an authenticated user a real shell on the server, so every
session is sandboxed and capped:

* **Scrubbed environment** - the shell inherits only a curated allowlist of
  variables (PATH, locale, etc.). App secrets (JWT_SECRET, DB creds, Firebase
  keys, SMTP/Mobizon keys) are never exposed, so a user cannot read them back.
* **Per-user workspace** - each session runs with its cwd and HOME pinned to a
  private directory under ``TERMINAL_WORKSPACE_DIR``; it does not start in the
  backend source tree.
* **Resource limits** - on Unix, CPU time, address space, process count and
  file size are capped via ``setrlimit`` (fork-bomb / memory / disk DoS).
* **Session caps** - per-user and global concurrent-session limits.
* **Idle + lifetime timeouts** - a background task kills idle and over-age
  sessions.
* **Bounded output queue + input size/rate limits** - a slow or hostile client
  cannot exhaust server memory.
* **Process-group / tree kill** - the whole child tree is terminated on close.

Full isolation (per-session container / microVM, dropped network egress,
blocked cloud-metadata endpoint) is an infrastructure layer on top of this and
is documented in the deployment notes rather than enforced here.
"""
import asyncio
import os
import sys
import time
import uuid
import shutil
import logging
import subprocess
from typing import Dict, Optional

from config import (
    TERMINAL_WORKSPACE_DIR,
    TERMINAL_MAX_SESSIONS_PER_USER,
    TERMINAL_MAX_SESSIONS_TOTAL,
    TERMINAL_IDLE_TIMEOUT_SECONDS,
    TERMINAL_MAX_LIFETIME_SECONDS,
    TERMINAL_OUTPUT_QUEUE_MAX,
    TERMINAL_MAX_INPUT_BYTES,
    TERMINAL_RLIMIT_CPU_SECONDS,
    TERMINAL_RLIMIT_MEM_MB,
    TERMINAL_RLIMIT_NPROC,
    TERMINAL_RLIMIT_FSIZE_MB,
)

logger = logging.getLogger("kazakh_hub.terminal")

# Check platform for PTY support
IS_WINDOWS = sys.platform == "win32"

# Environment variables the shell is allowed to inherit. Everything else -
# including every application secret - is dropped.
_WIN_ENV_KEEP = (
    "SystemRoot", "SystemDrive", "windir", "PATH", "PATHEXT", "COMSPEC",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
)
_UNIX_ENV_KEEP = ("PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ")


class TerminalLimitError(Exception):
    """Raised when a new session would exceed a configured cap."""


def _safe_user_dir(user_id: str) -> str:
    """Per-user workspace directory, with the id sanitised to a safe basename."""
    safe = "".join(c for c in str(user_id) if c.isalnum() or c in ("-", "_")) or "anon"
    path = os.path.join(TERMINAL_WORKSPACE_DIR, safe)
    os.makedirs(path, exist_ok=True)
    return os.path.abspath(path)


def _build_env(workspace: str) -> Dict[str, str]:
    """Minimal, secret-free environment for the shell."""
    env: Dict[str, str] = {}
    keep = _WIN_ENV_KEEP if IS_WINDOWS else _UNIX_ENV_KEEP
    for key in keep:
        val = os.environ.get(key)
        if val:
            env[key] = val
    # Fall back to a sane PATH if the server somehow had none.
    env.setdefault("PATH", r"C:\Windows\System32" if IS_WINDOWS else "/usr/bin:/bin")
    env["TERM"] = "xterm-256color"
    # Jail HOME / TEMP to the per-user workspace.
    if IS_WINDOWS:
        env["USERPROFILE"] = workspace
        env["HOMEDRIVE"] = os.path.splitdrive(workspace)[0]
        env["HOMEPATH"] = os.path.splitdrive(workspace)[1]
        env["TEMP"] = workspace
        env["TMP"] = workspace
    else:
        env["HOME"] = workspace
        env["TMPDIR"] = workspace
        env["PWD"] = workspace
    return env


def _unix_preexec():
    """Run in the child after fork (Unix only): new session + resource limits."""
    import resource

    os.setsid()  # own process group, so the whole tree can be killed at once

    def _set(res, soft_hard):
        try:
            resource.setrlimit(res, soft_hard)
        except (ValueError, OSError):
            pass

    if TERMINAL_RLIMIT_CPU_SECONDS > 0:
        _set(resource.RLIMIT_CPU, (TERMINAL_RLIMIT_CPU_SECONDS, TERMINAL_RLIMIT_CPU_SECONDS + 5))
    if TERMINAL_RLIMIT_MEM_MB > 0 and hasattr(resource, "RLIMIT_AS"):
        mem = TERMINAL_RLIMIT_MEM_MB * 1024 * 1024
        _set(resource.RLIMIT_AS, (mem, mem))
    if TERMINAL_RLIMIT_NPROC > 0 and hasattr(resource, "RLIMIT_NPROC"):
        _set(resource.RLIMIT_NPROC, (TERMINAL_RLIMIT_NPROC, TERMINAL_RLIMIT_NPROC))
    if TERMINAL_RLIMIT_FSIZE_MB > 0:
        fsize = TERMINAL_RLIMIT_FSIZE_MB * 1024 * 1024
        _set(resource.RLIMIT_FSIZE, (fsize, fsize))
    # Drop core dumps.
    _set(resource.RLIMIT_CORE, (0, 0))


class TerminalSession:
    """A single terminal session backed by a sandboxed shell process."""

    def __init__(self, session_id: str, user_id: str, cols: int = 80, rows: int = 24):
        self.session_id = session_id
        self.user_id = user_id
        self.cols = cols
        self.rows = rows
        self.process: Optional[asyncio.subprocess.Process] = None
        self.workspace = _safe_user_dir(user_id)
        self.created_at = time.monotonic()
        self.last_activity = self.created_at
        self.output_queue: asyncio.Queue = asyncio.Queue(maxsize=TERMINAL_OUTPUT_QUEUE_MAX)
        self._master_fd: Optional[int] = None
        self._reader_task: Optional[asyncio.Task] = None

    def touch(self):
        """Mark the session as active (resets the idle timer)."""
        self.last_activity = time.monotonic()

    async def start(self):
        """Start the shell process inside the sandbox."""
        env = _build_env(self.workspace)
        try:
            if IS_WINDOWS:
                self.process = await asyncio.create_subprocess_exec(
                    os.environ.get("COMSPEC", "cmd.exe"),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    cwd=self.workspace,
                    env=env,
                    creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
            else:
                import pty
                master_fd, slave_fd = pty.openpty()
                self.process = await asyncio.create_subprocess_exec(
                    "/bin/bash",
                    stdin=slave_fd,
                    stdout=slave_fd,
                    stderr=slave_fd,
                    cwd=self.workspace,
                    env=env,
                    preexec_fn=_unix_preexec,
                    close_fds=True,
                )
                os.close(slave_fd)
                self._master_fd = master_fd
                self._set_winsize(self.cols, self.rows)
            self._reader_task = asyncio.create_task(self._pump_output())
            logger.info(
                "Terminal %s started for user %s (cwd=%s)",
                self.session_id, self.user_id, self.workspace,
            )
        except Exception as e:
            logger.error("Failed to start terminal %s: %s", self.session_id, e)
            raise

    def _set_winsize(self, cols: int, rows: int):
        """Resize the Unix PTY so full-screen programs render correctly."""
        if IS_WINDOWS or self._master_fd is None:
            return
        try:
            import fcntl
            import struct
            import termios
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(self._master_fd, termios.TIOCSWINSZ, winsize)
        except Exception:
            pass

    async def _pump_output(self):
        """Read shell output and push it onto the bounded queue (backpressure)."""
        loop = asyncio.get_event_loop()
        try:
            if IS_WINDOWS:
                stdout = self.process.stdout
                while True:
                    data = await stdout.read(4096)
                    if not data:
                        break
                    await self.output_queue.put(data.decode("utf-8", errors="replace"))
            else:
                fd = self._master_fd
                while True:
                    try:
                        data = await loop.run_in_executor(None, os.read, fd, 4096)
                    except OSError:
                        break  # PTY closed (child exited)
                    if not data:
                        break
                    await self.output_queue.put(data.decode("utf-8", errors="replace"))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Error reading terminal %s: %s", self.session_id, e)
        finally:
            try:
                self.output_queue.put_nowait(None)  # signal EOF to the WS handler
            except asyncio.QueueFull:
                pass

    async def write(self, data: str):
        """Write user input to the shell, capped to TERMINAL_MAX_INPUT_BYTES."""
        if not self.process:
            return
        payload = data.encode("utf-8")[:TERMINAL_MAX_INPUT_BYTES]
        self.touch()
        try:
            if IS_WINDOWS:
                if self.process.stdin:
                    self.process.stdin.write(payload)
                    await self.process.stdin.drain()
            elif self._master_fd is not None:
                os.write(self._master_fd, payload)
        except Exception as e:
            logger.error("Error writing to terminal %s: %s", self.session_id, e)

    async def resize(self, cols: int, rows: int):
        """Resize the terminal."""
        self.cols = max(1, min(int(cols or 80), 1000))
        self.rows = max(1, min(int(rows or 24), 1000))
        self._set_winsize(self.cols, self.rows)

    async def kill(self):
        """Terminate the shell and its entire child tree."""
        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None
        proc = self.process
        if proc and proc.returncode is None:
            try:
                if IS_WINDOWS:
                    # Kill the whole process tree (cmd.exe spawns children).
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                        capture_output=True, check=False,
                    )
                else:
                    import signal
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=5)
                    except asyncio.TimeoutError:
                        try:
                            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                        except ProcessLookupError:
                            pass
            except Exception as e:
                logger.error("Error killing terminal %s: %s", self.session_id, e)
            finally:
                try:
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except Exception:
                    pass
        if self._master_fd is not None:
            try:
                os.close(self._master_fd)
            except OSError:
                pass
            self._master_fd = None
        self.process = None

    @property
    def is_alive(self) -> bool:
        return self.process is not None and self.process.returncode is None

    @property
    def age(self) -> float:
        return time.monotonic() - self.created_at

    @property
    def idle(self) -> float:
        return time.monotonic() - self.last_activity


class TerminalManager:
    """Manages all terminal sessions with per-user and global caps."""

    def __init__(self):
        self.sessions: Dict[str, TerminalSession] = {}
        self._cleanup_task: Optional[asyncio.Task] = None

    def _user_session_count(self, user_id: str) -> int:
        return sum(1 for s in self.sessions.values() if s.user_id == user_id)

    async def create_session(self, user_id: str, cols: int = 80, rows: int = 24) -> TerminalSession:
        """Create a new sandboxed terminal session, enforcing caps."""
        if len(self.sessions) >= TERMINAL_MAX_SESSIONS_TOTAL:
            raise TerminalLimitError("Server terminal capacity reached, try again later")
        if self._user_session_count(user_id) >= TERMINAL_MAX_SESSIONS_PER_USER:
            raise TerminalLimitError("Too many open terminals for this account")

        session_id = str(uuid.uuid4())
        session = TerminalSession(session_id, user_id, cols, rows)
        await session.start()
        self.sessions[session_id] = session
        self._ensure_cleanup_task()
        return session

    def _ensure_cleanup_task(self):
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self):
        """Kill idle, over-age or dead sessions on a fixed cadence."""
        try:
            while True:
                await asyncio.sleep(30)
                for sid, s in list(self.sessions.items()):
                    reason = None
                    if not s.is_alive:
                        reason = "exited"
                    elif s.idle > TERMINAL_IDLE_TIMEOUT_SECONDS:
                        reason = "idle timeout"
                    elif s.age > TERMINAL_MAX_LIFETIME_SECONDS:
                        reason = "max lifetime reached"
                    if reason:
                        logger.info("Closing terminal %s (%s)", sid, reason)
                        await self.close_session(sid)
                if not self.sessions:
                    break  # idle manager; it restarts when a new session opens
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Terminal cleanup loop error: %s", e)

    async def close_session(self, session_id: str):
        """Close and clean up a terminal session."""
        session = self.sessions.pop(session_id, None)
        if session:
            await session.kill()
            logger.info("Terminal session %s closed", session_id)


# Global terminal manager instance
terminal_manager = TerminalManager()
