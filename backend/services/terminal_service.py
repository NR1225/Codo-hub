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
import threading
import concurrent.futures
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

from services.terminal_workspace import user_root
from services.shared_packages import NPM_CACHE

logger = logging.getLogger("codo_hub.terminal")

# Check platform for PTY support
IS_WINDOWS = sys.platform == "win32"

# Environment variables the shell is allowed to inherit. Everything else -
# including every application secret - is dropped.
_WIN_ENV_KEEP = (
    "SystemRoot", "SystemDrive", "windir", "PATH", "PATHEXT", "COMSPEC",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
    # Node / Python / Git сияқты құралдар іздейтін жүйелік жолдар (құпия емес)
    "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData",
    "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432",
)
_UNIX_ENV_KEEP = ("PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ")


class TerminalLimitError(Exception):
    """Raised when a new session would exceed a configured cap."""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        # Клиент осы код бойынша хабарды сайт тілінде көрсетеді
        self.code = code


# Сайт тілі → shell хабарларының тілі (gettext / .NET UI culture)
_LANG_LOCALES = {
    "kk": ("kk_KZ.UTF-8", "kk", "kk-KZ"),
    "ru": ("ru_RU.UTF-8", "ru", "ru-RU"),
    "en": ("en_US.UTF-8", "en", "en-US"),
}


def _safe_user_dir(user_id: str) -> str:
    """Per-user workspace directory, with the id sanitised to a safe basename."""
    return user_root(user_id)


def _build_env(workspace: str, lang: str = "en") -> Dict[str, str]:
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
    env["COLORTERM"] = "truecolor"
    # Ортақ npm кэші: бір рет жүктелген пакет басқа жобаларда қайта жүктелмейді
    env["npm_config_cache"] = NPM_CACHE
    env["npm_config_prefer_offline"] = "true"
    # Dev-серверлер (Vite `open: true`, CRA т.б.) сервер компьютерінде браузер ашпасын
    env["BROWSER"] = "none"
    # Jail HOME / TEMP to the per-user workspace.
    if IS_WINDOWS:
        env["USERPROFILE"] = workspace
        env["HOMEDRIVE"] = os.path.splitdrive(workspace)[0]
        env["HOMEPATH"] = os.path.splitdrive(workspace)[1]
        env["TEMP"] = workspace
        env["TMP"] = workspace
        env["APPDATA"] = os.path.join(workspace, ".appdata", "Roaming")
        env["LOCALAPPDATA"] = os.path.join(workspace, ".appdata", "Local")
        for key in ("APPDATA", "LOCALAPPDATA"):
            os.makedirs(env[key], exist_ok=True)
    else:
        env["HOME"] = workspace
        env["TMPDIR"] = workspace
        env.setdefault("LANG", "C.UTF-8")
        # Хабарлар сайт тілінде (аудармасы орнатылған бағдарламаларда ғана)
        posix_locale, language, _ = _LANG_LOCALES.get(lang, _LANG_LOCALES["en"])
        env["LC_MESSAGES"] = posix_locale
        env["LANGUAGE"] = language
        # Промпт Windows-тағыдай: "codo ~/жоба $"
        env["PS1"] = r"\[\e[1;36m\]codo\[\e[0m\] \[\e[90m\]\w\[\e[0m\] \[\e[32m\]\$\[\e[0m\] "
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


# `help` (аргументсіз) — сайт тіліндегі қысқа анықтама. PowerShell-дің өз
# анықтамасы тек ағылшынша әрі «-- More --» беттеуімен шығады.
_HELP_TEXT = {
    "kk": {
        "title": "Codo терминалы — негізгі командалар",
        "sections": [
            ("Файлдар мен папкалар", [
                ("ls", "папкадағы файлдар тізімі"),
                ("cd <папка>", "папкаға кіру (cd .. — артқа)"),
                ("mkdir <ат>", "жаңа папка"),
                ("ni <файл>", "жаңа бос файл"),
                ("cat <файл>", "файлдың ішін көрсету"),
                ("cp <қайдан> <қайда>", "көшіру"),
                ("mv <ескі> <жаңа>", "жылжыту / атын өзгерту"),
                ("rm <ат>", "өшіру (папка: rm -r <ат>)"),
            ]),
            ("Бағдарламалар", [
                ("python <файл>.py", "Python скриптін іске қосу"),
                ("node <файл>.js", "JavaScript файлын іске қосу"),
                ("npm install", "тәуелділіктерді орнату"),
                ("npm run dev", "жобаны іске қосу"),
                ("git status", "git күйі"),
            ]),
            ("Терминал", [
                ("cls", "экранды тазалау"),
                ("Ctrl+C", "команданы тоқтату"),
                ("help <команда>", "команданың толық анықтамасы (ағылшынша)"),
                ("exit", "терминалды жабу"),
            ]),
        ],
        "note": "Мұнда жасалған файлдар редакторда да пайда болады.",
    },
    "ru": {
        "title": "Терминал Codo — основные команды",
        "sections": [
            ("Файлы и папки", [
                ("ls", "список файлов в папке"),
                ("cd <папка>", "перейти в папку (cd .. — назад)"),
                ("mkdir <имя>", "новая папка"),
                ("ni <файл>", "новый пустой файл"),
                ("cat <файл>", "показать содержимое файла"),
                ("cp <откуда> <куда>", "копировать"),
                ("mv <старое> <новое>", "переместить / переименовать"),
                ("rm <имя>", "удалить (папку: rm -r <имя>)"),
            ]),
            ("Программы", [
                ("python <файл>.py", "запустить скрипт Python"),
                ("node <файл>.js", "запустить файл JavaScript"),
                ("npm install", "установить зависимости"),
                ("npm run dev", "запустить проект"),
                ("git status", "состояние git"),
            ]),
            ("Терминал", [
                ("cls", "очистить экран"),
                ("Ctrl+C", "остановить команду"),
                ("help <команда>", "полная справка по команде"),
                ("exit", "закрыть терминал"),
            ]),
        ],
        "note": "Созданные здесь файлы появляются и в редакторе.",
    },
    "en": {
        "title": "Codo terminal — basic commands",
        "sections": [
            ("Files and folders", [
                ("ls", "list files in the folder"),
                ("cd <folder>", "enter a folder (cd .. — go back)"),
                ("mkdir <name>", "new folder"),
                ("ni <file>", "new empty file"),
                ("cat <file>", "show a file's contents"),
                ("cp <from> <to>", "copy"),
                ("mv <old> <new>", "move / rename"),
                ("rm <name>", "delete (folder: rm -r <name>)"),
            ]),
            ("Programs", [
                ("python <file>.py", "run a Python script"),
                ("node <file>.js", "run a JavaScript file"),
                ("npm install", "install dependencies"),
                ("npm run dev", "start the project"),
                ("git status", "git status"),
            ]),
            ("Terminal", [
                ("cls", "clear the screen"),
                ("Ctrl+C", "stop a command"),
                ("help <command>", "full help for a command"),
                ("exit", "close the terminal"),
            ]),
        ],
        "note": "Files created here also appear in the editor.",
    },
}


def _ps_help_function(lang: str) -> str:
    """PowerShell `help` функциясы: аргументсіз — біздің анықтама, әйтпесе Get-Help."""
    text = _HELP_TEXT.get(lang, _HELP_TEXT["en"])

    def q(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    width = max(len(cmd) for _, rows in text["sections"] for cmd, _ in rows) + 2
    lines = [f"Write-Host {q(text['title'])} -ForegroundColor White;"]
    for heading, rows in text["sections"]:
        lines.append(f"Write-Host '';Write-Host {q(heading)} -ForegroundColor Yellow;")
        for cmd, desc in rows:
            lines.append(
                f"Write-Host {q('  ' + cmd.ljust(width))} -ForegroundColor Cyan -NoNewline;"
                f"Write-Host {q(desc)} -ForegroundColor Gray;"
            )
    lines.append(f"Write-Host '';Write-Host {q(text['note'])} -ForegroundColor DarkGray;")
    return (
        "function help {"
        " if($args.Count -eq 0){" + "".join(lines) + "}"
        " else{Get-Help @args | Out-Host} };"
    )


def _shell_command(lang: str = "en") -> list:
    """Платформаға сай интерактивті shell.

    Windows: PowerShell (жоқ болса cmd.exe), Linux/macOS: bash (жоқ болса sh).
    Промпт барлық жерде бірдей әрі қысқа: ``codo ~/жоба >``.
    """
    if IS_WINDOWS:
        ps = shutil.which("pwsh") or shutil.which("powershell")
        if ps:
            culture = _LANG_LOCALES.get(lang, _LANG_LOCALES["en"])[2]
            init = (
                "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
                # PowerShell хабарлары сайт тілінде (Windows тіл пакеті болса)
                f"try{{[Globalization.CultureInfo]::DefaultThreadCurrentUICulture='{culture}';"
                f"[Globalization.CultureInfo]::CurrentUICulture='{culture}'}}catch{{}};"
                "$OutputEncoding=[Text.Encoding]::UTF8;"
                + _ps_help_function(lang) +
                "function prompt {"
                " $p=(Get-Location).Path;"
                " if($p.StartsWith($env:USERPROFILE)){$p='~'+$p.Substring($env:USERPROFILE.Length).Replace('\\','/')};"
                " \"$([char]27)[1;36mcodo$([char]27)[0m $([char]27)[90m$p$([char]27)[0m $([char]27)[32m>$([char]27)[0m \" }"
            )
            return [ps, "-NoLogo", "-NoProfile", "-NoExit", "-Command", init]
        return [os.environ.get("COMSPEC", "cmd.exe"), "/K", "chcp 65001 >nul"]
    shell = shutil.which("bash") or "/bin/sh"
    return [shell, "--noprofile"] if shell.endswith("bash") else [shell]


def _load_winpty():
    try:
        import winpty  # pywinpty — Windows ConPTY
        return winpty
    except ImportError:
        return None


class TerminalSession:
    """A single terminal session backed by a sandboxed shell in a real PTY.

    * Linux / macOS - ``pty.openpty`` + bash.
    * Windows - ConPTY via ``pywinpty`` (echo, line editing, colours and resize
      behave exactly like a native terminal). Without pywinpty it falls back to
      plain pipes, which only supports line-at-a-time commands.
    """

    def __init__(self, session_id: str, user_id: str, cols: int = 80, rows: int = 24,
                 cwd: Optional[str] = None, project_id: Optional[str] = None, lang: str = "en"):
        self.session_id = session_id
        self.lang = lang if lang in _LANG_LOCALES else "en"
        self.user_id = user_id
        self.cols = cols
        self.rows = rows
        self.project_id = project_id
        self.process: Optional[asyncio.subprocess.Process] = None
        self._winpty = None  # winpty.PtyProcess (Windows ConPTY)
        self.workspace = _safe_user_dir(user_id)
        self.cwd = cwd if cwd and os.path.isdir(cwd) else self.workspace
        self.created_at = time.monotonic()
        self.last_activity = self.created_at
        self.last_output = 0.0
        self.output_queue: asyncio.Queue = asyncio.Queue(maxsize=TERMINAL_OUTPUT_QUEUE_MAX)
        self._master_fd: Optional[int] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._exit_code: Optional[int] = None
        self._closed = False

    @property
    def mode(self) -> str:
        if self._winpty is not None:
            return "conpty"
        if self._master_fd is not None:
            return "pty"
        return "pipe"

    def touch(self):
        """Mark the session as active (resets the idle timer)."""
        self.last_activity = time.monotonic()

    async def start(self):
        """Start the shell process inside the sandbox."""
        env = _build_env(self.workspace, self.lang)
        argv = _shell_command(self.lang)
        loop = asyncio.get_running_loop()
        try:
            if IS_WINDOWS:
                winpty = _load_winpty()
                if winpty is not None:
                    self._winpty = winpty.PtyProcess.spawn(
                        argv, cwd=self.cwd, env=env, dimensions=(self.rows, self.cols),
                    )
                    self._start_reader(loop, self._read_winpty)
                else:
                    logger.warning("pywinpty is not installed - terminal falls back to pipes")
                    self.process = await asyncio.create_subprocess_exec(
                        *argv,
                        stdin=asyncio.subprocess.PIPE,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.STDOUT,
                        cwd=self.cwd,
                        env=env,
                        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                    )
                    self._reader_task = asyncio.create_task(self._pump_pipe())
            else:
                import pty
                master_fd, slave_fd = pty.openpty()
                self.process = await asyncio.create_subprocess_exec(
                    *argv,
                    stdin=slave_fd,
                    stdout=slave_fd,
                    stderr=slave_fd,
                    cwd=self.cwd,
                    env=env,
                    preexec_fn=_unix_preexec,
                    close_fds=True,
                )
                os.close(slave_fd)
                self._master_fd = master_fd
                self._set_winsize(self.cols, self.rows)
                self._start_reader(loop, self._read_fd)
            logger.info(
                "Terminal %s started for user %s (mode=%s, cwd=%s)",
                self.session_id, self.user_id, self.mode, self.cwd,
            )
        except Exception as e:
            logger.error("Failed to start terminal %s: %s", self.session_id, e)
            raise

    # ── Output ──

    def _read_winpty(self) -> Optional[str]:
        try:
            return self._winpty.read(4096) or ""
        except EOFError:
            return None

    def _read_fd(self) -> Optional[str]:
        try:
            data = os.read(self._master_fd, 4096)
        except OSError:
            return None  # PTY closed (child exited)
        return data.decode("utf-8", errors="replace") if data else None

    def _start_reader(self, loop: asyncio.AbstractEventLoop, read):
        """Dedicated reader thread per session: blocking PTY reads never starve the
        shared executor, and the bounded ``queue.put`` gives backpressure."""

        def run():
            try:
                while not self._closed:
                    chunk = read()
                    if chunk is None:
                        break
                    if not chunk:
                        time.sleep(0.01)
                        continue
                    self.last_output = time.monotonic()
                    fut = asyncio.run_coroutine_threadsafe(self.output_queue.put(chunk), loop)
                    while True:
                        try:
                            fut.result(timeout=1)
                            break
                        except concurrent.futures.TimeoutError:
                            if self._closed:  # клиент кетті, кезек енді оқылмайды
                                fut.cancel()
                                return
            except Exception as e:  # loop closed / session killed
                if not self._closed:
                    logger.error("Error reading terminal %s: %s", self.session_id, e)
            finally:
                try:
                    loop.call_soon_threadsafe(self._signal_eof)
                except RuntimeError:
                    pass

        threading.Thread(target=run, name=f"term-{self.session_id[:8]}", daemon=True).start()

    def _signal_eof(self):
        try:
            self.output_queue.put_nowait(None)  # signal EOF to the WS handler
        except asyncio.QueueFull:
            pass

    async def _pump_pipe(self):
        """Windows fallback without ConPTY: read the shell's stdout pipe."""
        try:
            stdout = self.process.stdout
            while True:
                data = await stdout.read(4096)
                if not data:
                    break
                self.last_output = time.monotonic()
                await self.output_queue.put(data.decode("utf-8", errors="replace"))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Error reading terminal %s: %s", self.session_id, e)
        finally:
            self._signal_eof()

    # ── Input / resize ──

    async def write(self, data: str):
        """Write user input to the shell, capped to TERMINAL_MAX_INPUT_BYTES."""
        payload = data.encode("utf-8")[:TERMINAL_MAX_INPUT_BYTES]
        self.touch()
        try:
            if self._winpty is not None:
                await asyncio.to_thread(self._winpty.write, payload.decode("utf-8", "ignore"))
            elif self._master_fd is not None:
                os.write(self._master_fd, payload)
            elif self.process and self.process.stdin:
                # Pipe fallback has no line discipline, so translate Enter.
                self.process.stdin.write(payload.replace(b"\r", b"\r\n"))
                await self.process.stdin.drain()
        except Exception as e:
            logger.error("Error writing to terminal %s: %s", self.session_id, e)

    def _set_winsize(self, cols: int, rows: int):
        """Resize the Unix PTY so full-screen programs render correctly."""
        if self._master_fd is None:
            return
        try:
            import fcntl
            import struct
            import termios
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(self._master_fd, termios.TIOCSWINSZ, winsize)
        except Exception:
            pass

    async def resize(self, cols: int, rows: int):
        """Resize the terminal."""
        self.cols = max(1, min(int(cols or 80), 1000))
        self.rows = max(1, min(int(rows or 24), 1000))
        if self._winpty is not None:
            try:
                self._winpty.setwinsize(self.rows, self.cols)
            except Exception:
                pass
        else:
            self._set_winsize(self.cols, self.rows)

    # ── Lifecycle ──

    async def kill(self):
        """Terminate the shell and its entire child tree."""
        self._closed = True
        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None

        pty_proc = self._winpty
        if pty_proc is not None:
            try:
                if pty_proc.isalive():
                    # ConPTY ішіндегі балалар да (node, python...) бірге жабылады
                    await asyncio.to_thread(
                        subprocess.run,
                        ["taskkill", "/F", "/T", "/PID", str(pty_proc.pid)],
                        capture_output=True, check=False,
                    )
                    pty_proc.terminate(force=True)
                self._exit_code = pty_proc.exitstatus
            except Exception as e:
                # taskkill-тен кейін процесс жоқ — terminate "Access is denied" береді, бұл қалыпты
                logger.debug("Terminal %s kill: %s", self.session_id, e)
            self._winpty = None
            return

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
        if self._winpty is not None:
            try:
                return self._winpty.isalive()
            except Exception:
                return False
        return self.process is not None and self.process.returncode is None

    @property
    def exit_code(self) -> int:
        if self._winpty is not None:
            try:
                return self._winpty.exitstatus or 0
            except Exception:
                return 0
        if self.process and self.process.returncode is not None:
            return self.process.returncode
        return self._exit_code or 0

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

    async def create_session(self, user_id: str, cols: int = 80, rows: int = 24,
                             cwd: Optional[str] = None, project_id: Optional[str] = None,
                             lang: str = "en") -> TerminalSession:
        """Create a new sandboxed terminal session, enforcing caps."""
        if len(self.sessions) >= TERMINAL_MAX_SESSIONS_TOTAL:
            raise TerminalLimitError("Server terminal capacity reached, try again later", "limitTotal")
        if self._user_session_count(user_id) >= TERMINAL_MAX_SESSIONS_PER_USER:
            raise TerminalLimitError("Too many open terminals for this account", "limitUser")

        session_id = str(uuid.uuid4())
        session = TerminalSession(session_id, user_id, cols, rows, cwd=cwd, project_id=project_id, lang=lang)
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

    async def close_project_sessions(self, user_id: str, project_id: str):
        """Жоба жойылғанда оның папкасында ашық тұрған терминалдарды жабу"""
        for sid, s in list(self.sessions.items()):
            if s.user_id == user_id and s.project_id == project_id:
                await self.close_session(sid)

    async def close_session(self, session_id: str):
        """Close and clean up a terminal session."""
        session = self.sessions.pop(session_id, None)
        if session:
            await session.kill()
            logger.info("Terminal session %s closed", session_id)


# Global terminal manager instance
terminal_manager = TerminalManager()
