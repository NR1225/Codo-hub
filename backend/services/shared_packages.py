"""Терминал жобаларына ортақ пакеттер (npm + Python): әр пакет серверде бір рет.

Модель
------
* **Ортақ қойма** — ``<TERMINAL_WORKSPACE_DIR>/.shared/``:
  ``uv-cache`` (Python, uv) және ``pnpm-store`` (npm, pnpm). Әр пакеттің әр
  нұсқасы серверде **бір рет** жүктеліп сақталады — қанша қолданушы, қанша
  жоба қолданса да.
* **Жобаның өз** ``node_modules`` / ``.venv`` папкасы — қоймадағы файлдарға
  hardlink. Пакет қоймада бар болса — жүктелмей, бірден (секундтың бөлігінде)
  қосылады; жоқ болса — бір рет жүктеліп, қоймаға түседі де, келесі жобалар
  оны қайта қолданады. Hardlink диск орнын алмайды.
* **Тұрақтылық**: терминалдағы ``pip`` / ``pip3`` / ``python -m pip`` / ``npm``
  / ``yarn`` / ``pnpm`` командалары ``pkg_shim.py`` арқылы осы қоймаға
  орнатады және пакетті ``requirements.txt`` / ``package.json``-ға жазады.
  Сондықтан кез келген пакет (PyPI / npm-дағы кез келгені — тек белгілі
  тізімдегілер емес) жобамен бірге сақталады: жоба қайта ашылғанда ол
  ``attach`` арқылы қоймадан бірден қайта қосылады.
* Жоба ашылғанда (``terminal_workspace.push`` → ``attach``) манифест бойынша
  ``node_modules`` / ``.venv`` фонда толықтырылады; манифест өзгермесе — ештеңе
  істелмейді (``.codo-deps`` маркері).
* Қауіпсіздік: орнату құпиясыз env-пен жүреді; бөтен адамның коды (кодты көру
  бетінен іске қосу, ``trusted=False``) үшін npm скрипттері өшірулі, Python
  тек дайын wheel-ден. requirements.txt-тағы ``-r``/``--index-url``/URL/жол
  жолдары автоматты орнатуда алынып тасталады.
* **Ұйықтату**: ``SHARED_PACKAGES_IDLE_DAYS`` күн ашылмаған жобаның
  ``node_modules`` / ``.venv``-і өшіріледі (``sweep``) — пакеттер қоймада
  қалады, жоба қайта ашылғанда бірден қалпына келеді.
"""
import ast
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from typing import Dict, Iterable, List, Optional, Set, Tuple

from config import (
    TERMINAL_WORKSPACE_DIR,
    SHARED_PACKAGES_IDLE_DAYS,
    SHARED_PACKAGES_AUTO_PYTHON,
)

logger = logging.getLogger("codo_hub.shared_packages")

IS_WINDOWS = sys.platform == "win32"

# ".shared" — нүктесі бар, ал user_root() атаудан нүктені алып тастайды,
# сондықтан ешбір қолданушының папкасымен соқтығыспайды
SHARED_ROOT = os.path.abspath(os.path.join(TERMINAL_WORKSPACE_DIR, ".shared"))
UV_CACHE = os.path.join(SHARED_ROOT, "uv-cache")
PNPM_STORE = os.path.join(SHARED_ROOT, "pnpm-store")
NPM_CACHE = os.path.join(SHARED_ROOT, "npm-cache")
TOOLS_DIR = os.path.join(SHARED_ROOT, "tools")
BIN_DIR = os.path.join(SHARED_ROOT, "bin")
_TMP = os.path.join(SHARED_ROOT, "tmp")
# Бұрынғы «жиынтық» моделінің қалдықтары (жобалар енді оларға сілтеме жасамайды)
_LEGACY = ("node", "python", "pip-cache", "trash")

PNPM_VERSION = "9.15.9"
VENV_DIR = ".venv"
MARKER = ".codo-deps"
INSTALL_TIMEOUT_SECONDS = 900
MAX_SCAN_DEPTH = 3          # жобаның түбірі + 3 деңгей ішкі папка
MAX_PY_SCAN_FILES = 300
MAX_PY_FILE_BYTES = 512 * 1024
MAX_REQUIREMENTS = 100
_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env", "dist", "build",
    ".next", ".nuxt", ".cache", ".npm", ".yarn", ".pnpm-store",
}

_ENV_KEEP = (
    ("SystemRoot", "SystemDrive", "windir", "PATH", "PATHEXT", "COMSPEC",
     "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "ProgramFiles",
     "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "CommonProgramFiles")
    if IS_WINDOWS else ("PATH", "LANG", "TZ")
)

# import атауы → PyPI атауы. Тек осы тізімдегілер import бойынша автоматты
# орнатылады (typosquatting пакеттерінен қорғау + өте ауыр пакеттер — torch,
# tensorflow — кездейсоқ орнатылмасын). Басқа кез келген пакетті терминалда
# `pip install <ат>` орнатады — ол requirements.txt-қа жазылып, тұрақты сақталады.
_IMPORT_TO_PIP = {
    # web / API
    "flask": "flask", "flask_cors": "flask-cors", "flask_sqlalchemy": "flask-sqlalchemy",
    "flask_login": "flask-login", "flask_wtf": "flask-wtf", "flask_socketio": "flask-socketio",
    "django": "django", "rest_framework": "djangorestframework", "fastapi": "fastapi",
    "uvicorn": "uvicorn", "starlette": "starlette", "pydantic": "pydantic", "jinja2": "jinja2",
    "werkzeug": "werkzeug", "requests": "requests", "httpx": "httpx", "aiohttp": "aiohttp",
    "websockets": "websockets", "socketio": "python-socketio", "bs4": "beautifulsoup4",
    "lxml": "lxml", "selenium": "selenium", "jwt": "pyjwt", "bcrypt": "bcrypt",
    "dotenv": "python-dotenv", "markdown": "markdown", "yaml": "pyyaml", "toml": "toml",
    # дерекқор
    "sqlalchemy": "sqlalchemy", "pymongo": "pymongo", "psycopg2": "psycopg2-binary",
    "pymysql": "pymysql", "redis": "redis", "peewee": "peewee",
    # деректер / ғылым
    "numpy": "numpy", "pandas": "pandas", "matplotlib": "matplotlib", "seaborn": "seaborn",
    "plotly": "plotly", "scipy": "scipy", "sklearn": "scikit-learn", "sympy": "sympy",
    "networkx": "networkx", "openpyxl": "openpyxl", "xlrd": "xlrd", "streamlit": "streamlit",
    "nltk": "nltk", "textblob": "textblob",
    # сурет / дыбыс / видео
    "PIL": "pillow", "cv2": "opencv-python", "imageio": "imageio", "qrcode": "qrcode",
    "gtts": "gtts", "pyttsx3": "pyttsx3", "speech_recognition": "SpeechRecognition",
    "moviepy": "moviepy", "pydub": "pydub",
    # ойындар / GUI
    "pygame": "pygame", "pyglet": "pyglet", "arcade": "arcade", "ursina": "ursina",
    "kivy": "kivy", "customtkinter": "customtkinter", "ttkbootstrap": "ttkbootstrap",
    "PyQt5": "PyQt5", "PyQt6": "PyQt6", "PySide6": "PySide6",
    # боттар / AI клиенттері
    "telebot": "pyTelegramBotAPI", "telegram": "python-telegram-bot", "aiogram": "aiogram",
    "discord": "discord.py", "openai": "openai", "anthropic": "anthropic",
    # құралдар
    "colorama": "colorama", "termcolor": "termcolor", "rich": "rich", "tqdm": "tqdm",
    "click": "click", "typer": "typer", "pyfiglet": "pyfiglet", "art": "art", "emoji": "emoji",
    "faker": "faker", "schedule": "schedule", "pytz": "pytz", "dateutil": "python-dateutil",
    "pyperclip": "pyperclip", "pyautogui": "pyautogui", "pynput": "pynput", "keyboard": "keyboard",
    "psutil": "psutil", "cryptography": "cryptography", "paramiko": "paramiko",
    "docx": "python-docx", "pptx": "python-pptx", "fitz": "pymupdf", "reportlab": "reportlab",
    "pyjokes": "pyjokes", "wikipedia": "wikipedia", "serial": "pyserial", "pytest": "pytest",
}


# Орнатылып жатқан папкалар (dest → {eco, packages}), кезектегі тапсырма және нәтижелер
_pending: Dict[str, Dict[str, object]] = {}
_queued: Dict[str, tuple] = {}
_results: Dict[str, Dict[str, object]] = {}
_guard = threading.Lock()
# Ашық терминалдардың папкалары (cwd → сессия саны): олардың пакеттері ұйықтатылмайды
_active_cwds: Dict[str, int] = {}


# ───────────────────────────── жалпы ─────────────────────────────

def _read(path: str) -> Optional[bytes]:
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def _hash(*parts: Optional[bytes]) -> str:
    h = hashlib.sha256()
    for part in parts:
        h.update(part or b"")
        h.update(b"\0")
    return h.hexdigest()[:20]


def _link_target(path: str) -> Optional[str]:
    """Сілтеме (symlink / junction) болса — оның мақсаты, әйтпесе None"""
    try:
        target = os.readlink(path)
    except (OSError, ValueError):
        return None
    if target.startswith("\\\\?\\"):
        target = target[4:]
    return os.path.normcase(os.path.abspath(target))


def is_shared_link(path: str) -> bool:
    """Бұрынғы модельдің ортақ жиынтыққа сілтемесі ме"""
    target = _link_target(path)
    root = os.path.normcase(SHARED_ROOT) + os.sep
    return bool(target and target.startswith(root))


def unlink(path: str) -> None:
    """Сілтемені ғана өшіру — мақсатының ішіне тиіспейді"""
    if IS_WINDOWS:
        os.rmdir(path)  # junction-ды өшіреді, мақсатын емес
    else:
        os.unlink(path)


def _drop_legacy_link(dest: str) -> None:
    if is_shared_link(dest):
        try:
            unlink(dest)
        except OSError as e:
            logger.info("Ескі ортақ сілтеме алынбады (%s): %s", dest, e)


def _marker(dest: str) -> Optional[str]:
    if os.path.islink(dest) or is_shared_link(dest):
        return None
    data = _read(os.path.join(dest, MARKER))
    return data.decode("ascii", "replace").strip() if data else None


def _write_marker(dest: str, key: str) -> None:
    try:
        with open(os.path.join(dest, MARKER), "w") as f:
            f.write(key)
    except OSError:
        pass


def _touch_marker(dest: str) -> None:
    """Жоба ашылды — ұйықтату таймері қайта басталады"""
    try:
        os.utime(os.path.join(dest, MARKER))
    except OSError:
        pass


def _walk(root: str) -> Iterable[Tuple[str, List[str], List[str]]]:
    base_depth = root.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, filenames in os.walk(root):
        if dirpath.count(os.sep) - base_depth >= MAX_SCAN_DEPTH:
            dirnames[:] = []
        else:
            dirnames[:] = [
                d for d in dirnames
                if d not in _SKIP_DIRS and not os.path.islink(os.path.join(dirpath, d))
            ]
        yield dirpath, dirnames, filenames


# ───────────────────────────── құралдар (uv, pnpm, шимдер) ─────────────────────────────

_tools_lock = threading.Lock()
_tools: Dict[str, Optional[str]] = {}
_tools_started = False


def _uv_bin() -> Optional[str]:
    found = shutil.which("uv")
    if found:
        return found
    try:
        import uv  # pip install uv — backend/requirements.txt
        path = uv.find_uv_bin()
        return path if os.path.isfile(path) else None
    except Exception:
        return None


def _node_bin() -> Optional[str]:
    return shutil.which("node")


def _npm_cli() -> Optional[str]:
    """npm-ді node арқылы тікелей шақыру: Windows-тағы npm.cmd орағышы
    шектелген env-пен npm сәтті біткенде де 1 кодын қайтарады"""
    node = _node_bin()
    if node:
        for base in (os.path.dirname(node), os.path.join(os.path.dirname(node), "..", "lib")):
            cli = os.path.abspath(os.path.join(base, "node_modules", "npm", "bin", "npm-cli.js"))
            if os.path.isfile(cli):
                return cli
    return None


def _pnpm_cli() -> Optional[str]:
    """pnpm (ортақ қойма + hardlink). Серверде жоқ болса — бір рет tools/ ішіне орнатылады."""
    path = os.path.join(TOOLS_DIR, "node_modules", "pnpm", "bin", "pnpm.cjs")
    if os.path.isfile(path):
        return path
    node, npm_cli = _node_bin(), _npm_cli()
    if not node:
        return None
    os.makedirs(TOOLS_DIR, exist_ok=True)
    npm = [node, npm_cli] if npm_cli else [shutil.which("npm") or "npm"]
    result = _run([*npm, "install", f"pnpm@{PNPM_VERSION}", "--prefix", TOOLS_DIR,
                   "--no-audit", "--no-fund", "--ignore-scripts"], TOOLS_DIR)
    if result.returncode != 0 or not os.path.isfile(path):
        logger.error("pnpm орнатылмады — npm пакеттері ортақ қоймасыз орнатылады: %s", _tail(result))
        return None
    logger.info("pnpm %s ортақ құралдарға орнатылды", PNPM_VERSION)
    return path


_base_python_cache: Optional[str] = None


def _base_python() -> Optional[str]:
    """Терминалдағы ``python``-мен бірдей интерпретатор (backend-тің өз venv-і емес)"""
    global _base_python_cache
    if _base_python_cache and os.path.isfile(_base_python_cache):
        return _base_python_cache
    candidates = []
    for name in (("python", "py") if IS_WINDOWS else ("python3", "python")):
        found = shutil.which(name)
        # WindowsApps ішіндегі python.exe — Store-ды ашатын бос сілтеме
        if found and "windowsapps" not in found.lower():
            candidates.append(found)
    candidates.append(getattr(sys, "_base_executable", None) or sys.executable)
    for path in candidates:
        if path and os.path.isfile(path):
            _base_python_cache = path
            return path
    return None


_SHIM_TOOLS = ("pip", "pip3", "npm", "yarn", "pnpm")


def _write_shims(python: str) -> None:
    os.makedirs(BIN_DIR, exist_ok=True)
    shutil.copyfile(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pkg_shim.py"),
                    os.path.join(BIN_DIR, "pkg_shim.py"))
    shim = os.path.join(BIN_DIR, "pkg_shim.py")
    for tool in _SHIM_TOOLS:
        if IS_WINDOWS:
            path = os.path.join(BIN_DIR, f"{tool}.cmd")
            body = f'@"{python}" -I "{shim}" {tool} %*\r\n'
        else:
            path = os.path.join(BIN_DIR, tool)
            body = f'#!/bin/sh\nexec "{python}" -I "{shim}" {tool} "$@"\n'
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(body)
        if not IS_WINDOWS:
            os.chmod(path, 0o755)


def powershell_functions() -> str:
    """PowerShell терминалы үшін pip / npm / yarn / pnpm функциялары.

    Функция ``.cmd``-ден басым әрі exit кодын дұрыс береді (cmd AutoRun орнатылған
    серверде ``.cmd`` сәтті біткенде де 1 қайтарады). Шимдер дайын болмаса — бос жол.
    """
    shim = os.path.join(BIN_DIR, "pkg_shim.py")
    python = _tools.get("python") if _tools else None
    if not python or not os.path.isfile(shim):
        return ""

    def q(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    return "".join(
        f"function {tool} {{ & {q(python)} -I {q(shim)} {tool} @args }};" for tool in _SHIM_TOOLS
    )


def ensure_tools() -> Dict[str, Optional[str]]:
    """uv, pnpm және терминал шимдерін дайындау (бір рет; қайта шақыру арзан)"""
    with _tools_lock:
        if _tools:
            return _tools
        for d in (UV_CACHE, PNPM_STORE, NPM_CACHE, _TMP):
            os.makedirs(d, exist_ok=True)
        tools = {
            "uv": _uv_bin(),
            "python": _base_python(),
            "node": _node_bin(),
            "npm_cli": _npm_cli(),
            "pnpm": _pnpm_cli(),
            "uv_cache": UV_CACHE,
            "pnpm_store": PNPM_STORE,
            "npm_cache": NPM_CACHE,
        }
        if not tools["uv"]:
            logger.warning("uv табылмады (pip install uv) — Python пакеттері ортақ қоймасыз орнатылады")
        try:
            if tools["python"]:
                os.makedirs(BIN_DIR, exist_ok=True)
                with open(os.path.join(BIN_DIR, "shim.json"), "w", encoding="utf-8") as f:
                    json.dump(tools, f, ensure_ascii=False, indent=1)
                _write_shims(tools["python"])
        except OSError as e:
            logger.error("Терминал пакет шимдері жазылмады: %s", e)
        _tools.update(tools)
        return _tools


def ensure_tools_async() -> None:
    """Сервер іске қосылғанда — фонда (pnpm-ді бірінші рет жүктеу бірнеше секунд)"""
    global _tools_started
    if _tools or _tools_started:
        return
    _tools_started = True
    threading.Thread(target=ensure_tools, name="shared-tools", daemon=True).start()


def _env(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    env = {k: os.environ[k] for k in _ENV_KEEP if os.environ.get(k)}
    os.makedirs(_TMP, exist_ok=True)
    env["npm_config_cache"] = NPM_CACHE
    env["UV_CACHE_DIR"] = UV_CACHE
    env["UV_LINK_MODE"] = "hardlink"
    env["UV_PYTHON_DOWNLOADS"] = "never"
    env["UV_NO_PROGRESS"] = "1"
    env["PIP_CACHE_DIR"] = os.path.join(UV_CACHE, "pip")
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env["PIP_NO_INPUT"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    if IS_WINDOWS:
        env["TEMP"] = env["TMP"] = _TMP
    else:
        env["HOME"] = SHARED_ROOT
        env["TMPDIR"] = _TMP
    env.update(extra or {})
    return env


def _run(cmd: List[str], cwd: str, extra: Optional[Dict[str, str]] = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, cwd=cwd, env=_env(extra), capture_output=True, timeout=INSTALL_TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(cmd, 1, b"", str(e).encode("utf-8", "replace"))


def _tail(result: subprocess.CompletedProcess) -> str:
    return ((result.stderr or b"") + b"\n" + (result.stdout or b"")).decode("utf-8", "replace")[-2000:]


# ───────────────────────────── кезек ─────────────────────────────

def _schedule(eco: str, dest: str, key: str, names: List[str], worker, *args) -> None:
    """Пакеттер дайын болса — ештеңе жасамау, әйтпесе фонда орнату (бір папкаға бір жұмыс)"""
    if _marker(dest) == key and os.path.isdir(dest):
        _touch_marker(dest)
        return
    with _guard:
        running = dest in _pending
        _pending[dest] = {"eco": eco, "packages": names}
        _queued[dest] = (key, worker, args)
        _results.pop(dest, None)
    if not running:
        threading.Thread(target=_drain, args=(dest,), name=f"shared-{eco}", daemon=True).start()


def _drain(dest: str) -> None:
    while True:
        with _guard:
            job = _queued.pop(dest, None)
            if job is None:
                _pending.pop(dest, None)
                return
        key, worker, args = job
        try:
            _drop_legacy_link(dest)
            ok, failed = worker(*args)
        except Exception as e:
            logger.error("Пакеттерді орнату қатесі (%s): %s", dest, e)
            ok, failed = False, []
        if ok:
            _write_marker(dest, key)
        with _guard:
            _results[dest] = {"ok": ok, "failed": failed}


def pending(root: str) -> List[Dict[str, object]]:
    """Жобада орнатылып жатқан папкалар: [{path, eco, packages}]"""
    prefix = os.path.normcase(os.path.abspath(root)) + os.sep
    with _guard:
        items = [(d, dict(v)) for d, v in _pending.items()]
    return [{"path": d, **v} for d, v in items if os.path.normcase(d).startswith(prefix)]


def result(dest: str) -> Dict[str, object]:
    """Орнату біткеннен кейін: {"ok": bool, "failed": [орнатылмаған пакеттер]}"""
    with _guard:
        res = _results.get(dest)
    return dict(res) if res else {"ok": _marker(dest) is not None, "failed": []}


def session_opened(cwd: str) -> None:
    with _guard:
        _active_cwds[cwd] = _active_cwds.get(cwd, 0) + 1


def session_closed(cwd: str) -> None:
    with _guard:
        n = _active_cwds.get(cwd, 0) - 1
        if n > 0:
            _active_cwds[cwd] = n
        else:
            _active_cwds.pop(cwd, None)


# ───────────────────────────── npm ─────────────────────────────

def _node_names(manifest: bytes) -> List[str]:
    try:
        pkg = json.loads(manifest.decode("utf-8", "replace"))
    except ValueError:
        return []
    names: List[str] = []
    if isinstance(pkg, dict):
        for field in ("dependencies", "devDependencies"):
            deps = pkg.get(field)
            if isinstance(deps, dict):
                names += [n for n in deps if isinstance(n, str)]
    return names


def _install_node(project_dir: str, trusted: bool) -> Tuple[bool, List[str]]:
    tools = ensure_tools()
    node, pnpm = tools.get("node"), tools.get("pnpm")
    if not node:
        logger.warning("node табылмады — npm пакеттері орнатылмайды")
        return False, []
    if pnpm:
        # Әр пакет pnpm-store-да бір рет; node_modules — қарапайым (hoisted) құрылым, файлдары hardlink
        cmd = [node, pnpm, "install", "--store-dir", PNPM_STORE,
               "--config.node-linker=hoisted", "--config.package-import-method=hardlink",
               "--config.confirm-modules-purge=false", "--config.auto-install-peers=true",
               "--config.strict-peer-dependencies=false", "--reporter=append-only"]
    else:
        npm_cli = tools.get("npm_cli")
        cmd = [*([node, npm_cli] if npm_cli else ["npm"]), "install", "--no-audit", "--no-fund"]
    if not trusted:
        cmd.append("--ignore-scripts")  # бөтен адамның коды — install-скрипттер іске қосылмайды
    result = _run(cmd, project_dir)
    if result.returncode != 0:
        logger.error("npm пакеттері орнатылмады (%s): %s", project_dir, _tail(result))
        return False, []
    os.makedirs(os.path.join(project_dir, "node_modules"), exist_ok=True)
    return True, []


def _attach_node(root: str, trusted: bool) -> None:
    for dirpath, _dirs, filenames in _walk(root):
        if "package.json" not in filenames:
            continue
        manifest = _read(os.path.join(dirpath, "package.json"))
        if not manifest:
            continue
        names = _node_names(manifest)
        dest = os.path.join(dirpath, "node_modules")
        if not names and not os.path.exists(dest):
            continue  # тәуелділігі жоқ package.json — орнататын ештеңе жоқ
        key = _hash(manifest, b"trusted" if trusted else b"safe")
        _schedule("node", dest, key, names, _install_node, dirpath, trusted)


# ───────────────────────────── Python ─────────────────────────────

def venv_python(venv: str) -> str:
    return os.path.join(venv, "Scripts", "python.exe") if IS_WINDOWS else os.path.join(venv, "bin", "python")


def venv_bin(venv: str) -> str:
    return os.path.join(venv, "Scripts") if IS_WINDOWS else os.path.join(venv, "bin")


def _site_packages(venv: str) -> Optional[str]:
    if IS_WINDOWS:
        return os.path.join(venv, "Lib", "site-packages")
    lib = os.path.join(venv, "lib")
    try:
        return next(os.path.join(lib, d, "site-packages") for d in os.listdir(lib) if d.startswith("python"))
    except (OSError, StopIteration):
        return None


def _install_pip_proxy(venv: str) -> None:
    """``python -m pip`` те ортақ қоймаға орнатсын (uv venv-інде нағыз pip жоқ)"""
    site = _site_packages(venv)
    if not site or os.path.isdir(os.path.join(site, "pip", "_internal")):
        return  # нағыз pip бар
    pkg = os.path.join(site, "pip")
    os.makedirs(pkg, exist_ok=True)
    shim = os.path.join(BIN_DIR, "pkg_shim.py")
    code = (
        "import subprocess, sys\n"
        f"sys.exit(subprocess.call([sys.executable, '-I', {shim!r}, 'pip', *sys.argv[1:]]))\n"
    )
    for name, body in (("__init__.py", ""), ("__main__.py", code)):
        with open(os.path.join(pkg, name), "w", encoding="utf-8") as f:
            f.write(body)


def ensure_venv(project_dir: str) -> Optional[str]:
    """Жобаның ``.venv``-і (жоқ болса — uv арқылы жасалады, бірнеше миллисекунд)"""
    venv = os.path.join(project_dir, VENV_DIR)
    _drop_legacy_link(venv)
    if os.path.isfile(venv_python(venv)):
        return venv
    tools = ensure_tools()
    base = tools.get("python")
    if not base:
        logger.warning("Python табылмады — Python пакеттері орнатылмайды")
        return None
    if tools.get("uv"):
        result = _run([tools["uv"], "venv", "--quiet", "--allow-existing", "--python", base, venv], project_dir)
    else:
        result = _run([base, "-m", "venv", venv], project_dir)
    if result.returncode != 0:
        logger.error("venv жасалмады (%s): %s", venv, _tail(result))
        return None
    if tools.get("uv"):
        _install_pip_proxy(venv)
    return venv


def _install_python(project_dir: str, requirements: List[str], trusted: bool) -> Tuple[bool, List[str]]:
    venv = ensure_venv(project_dir)
    if not venv:
        return False, []
    uv = ensure_tools().get("uv")
    if uv:
        install = [uv, "pip", "install", "--python", venv]
    else:
        install = [venv_python(venv), "-m", "pip", "install", "--no-input"]
    if not trusted:
        # Бөтен адамның коды — setup.py іске қосылмасын, тек дайын wheel
        install.append("--no-build" if uv else "--only-binary=:all:")
    os.makedirs(_TMP, exist_ok=True)
    req_file = os.path.join(_TMP, f"req-{_hash(venv.encode('utf-8'))}.txt")
    with open(req_file, "w", encoding="utf-8") as f:
        f.write("\n".join(requirements) + "\n")
    try:
        result = _run([*install, "-r", req_file], project_dir)
    finally:
        try:
            os.remove(req_file)
        except OSError:
            pass
    if result.returncode == 0:
        return True, []
    # Бір пакет орнатылмаса да қалғандары жұмыс істесін — біртіндеп орнатамыз
    logger.warning("Python пакеттері бірге орнатылмады, біртіндеп қайталанады: %s", _tail(result))
    failed = [req for req in requirements if _run([*install, req], project_dir).returncode != 0]
    if failed:
        logger.error("Орнатылмаған Python пакеттері: %s", ", ".join(failed))
    return len(failed) < len(requirements), failed


# ───────── requirements.txt / import-тар ─────────

_NAME_RE = r"[A-Za-z0-9][A-Za-z0-9._-]*"
_REQ_RE = re.compile(
    rf"^{_NAME_RE}(\[[A-Za-z0-9._,\s-]+\])?"            # атауы [extras]
    r"(\s*(===|==|!=|<=|>=|~=|<|>)\s*[A-Za-z0-9.*+!_-]+"  # нұсқа шектеулері
    r"(\s*,\s*(===|==|!=|<=|>=|~=|<|>)\s*[A-Za-z0-9.*+!_-]+)*)?"
    r"\s*(;[\w\s.'\"<>=!~(),-]*)?$"                      # маркерлер: ; python_version < "3.11"
)


def clean_requirements(text: str) -> List[str]:
    """requirements.txt-тан тек «атау + нұсқа» жолдары.

    ``-r``, ``-e``, ``--index-url``, URL, ``pkg @ git+…``, жергілікті жолдар алынып
    тасталады — басқа индекстен / сервердің дискісінен ештеңе орнатылмайды.
    """
    out: List[str] = []
    for raw in text.splitlines():
        line = raw.split(" #", 1)[0].split("\t#", 1)[0].strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        if "://" in line or "@" in line or "/" in line.split(";", 1)[0] or "\\" in line:
            continue
        if _REQ_RE.match(line) and line not in out:
            out.append(line)
        if len(out) >= MAX_REQUIREMENTS:
            break
    return out


def _local_modules(root: str) -> Set[str]:
    """Жобаның өз модульдері (utils.py, game/ …) — оларды PyPI-дан іздемейміз"""
    names: Set[str] = set()
    for dirpath, dirnames, filenames in _walk(root):
        names.update(d for d in dirnames)
        names.update(os.path.splitext(f)[0] for f in filenames if f.endswith(".py"))
    return names


def detect_imports(root: str) -> List[str]:
    """``.py`` файлдарындағы import-тар → PyPI атаулары (тек белгілі тізім бойынша).

    Файлдар ``ast`` арқылы талданады — код орындалмайды.
    """
    stdlib = set(getattr(sys, "stdlib_module_names", ()))
    local = _local_modules(root)
    found: Set[str] = set()
    scanned = 0
    for dirpath, _dirs, filenames in _walk(root):
        for name in filenames:
            if not name.endswith(".py"):
                continue
            scanned += 1
            if scanned > MAX_PY_SCAN_FILES:
                break
            path = os.path.join(dirpath, name)
            try:
                if os.path.getsize(path) > MAX_PY_FILE_BYTES:
                    continue
                tree = ast.parse(_read(path) or b"", filename=name)
            except (OSError, SyntaxError, ValueError):
                continue
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    mods = [a.name for a in node.names]
                elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
                    mods = [node.module]
                else:
                    continue
                for mod in mods:
                    top = mod.split(".", 1)[0]
                    if top in stdlib or top in local:
                        continue
                    pip_name = _IMPORT_TO_PIP.get(top)
                    if pip_name:
                        found.add(pip_name)
    return sorted(found, key=str.lower)


def _python_key(requirements: List[str], trusted: bool) -> str:
    base = _base_python() or ""
    return _hash("\n".join(requirements).encode("utf-8"), base.lower().encode("utf-8"),
                 b"trusted" if trusted else b"safe")


def _req_names(reqs: List[str]) -> Set[str]:
    out = set()
    for r in reqs:
        m = re.match(_NAME_RE, r)
        if m:
            out.add(re.sub(r"[-_.]+", "-", m.group(0)).lower())
    return out


def _attach_python(root: str, trusted: bool) -> None:
    if not SHARED_PACKAGES_AUTO_PYTHON:
        return
    targets: Dict[str, List[str]] = {}
    for dirpath, _dirs, filenames in _walk(root):
        if "requirements.txt" in filenames:
            text = (_read(os.path.join(dirpath, "requirements.txt")) or b"").decode("utf-8", "replace")
            targets[dirpath] = clean_requirements(text)
    # Түбірдегі .py файлдарының import-тары да (requirements.txt-та жоқтары) қосылады
    detected = detect_imports(root)
    if detected:
        have = _req_names(targets.get(root, []))
        extra = [n for n in detected if re.sub(r"[-_.]+", "-", n).lower() not in have]
        if extra and (root in targets or not targets):
            targets[root] = targets.get(root, []) + extra
    for dirpath, reqs in targets.items():
        if reqs:
            _schedule("python", os.path.join(dirpath, VENV_DIR), _python_key(reqs, trusted), reqs,
                      _install_python, dirpath, reqs, trusted)


# ───────────────────────────── жария API ─────────────────────────────

def attach(root: str, trusted: bool = True) -> None:
    """Жоба қолданатын пакеттерді қосу: қоймада бары бірден (hardlink), жоғы — фонда бір рет жүктеліп.

    ``trusted=False`` — бөтен адамның коды (install-скрипттер / құрастыру өшірулі).
    """
    for fn in (_attach_node, _attach_python):
        try:
            fn(root, trusted)
        except Exception as e:
            logger.error("%s сәтсіз (%s): %s", fn.__name__, root, e)


def detach(root: str) -> None:
    """Жоба папкасын өшірмес бұрын бұрынғы ортақ сілтемелерді алып тастау.

    Жаңа модельдегі нағыз папкалар қалыпты өшіріледі: hardlink өшсе, қоймадағы
    түпнұсқа файл қалады.
    """
    for dirpath, _dirnames, _files in _walk(root):
        for name in ("node_modules", VENV_DIR):
            dest = os.path.join(dirpath, name)
            if is_shared_link(dest):
                try:
                    unlink(dest)
                except OSError:
                    pass


_MESSAGES = {
    "kk": {
        "installing": "Пакеттер қосылуда ({what}) — серверде бары бірден қосылады, жоғы бір рет жүктеледі…",
        "ready": "Пакеттер дайын ({what}) — енді іске қосуға болады.",
        "partial": "Кейбір пакеттер орнатылмады: {what}",
        "failed": "Пакеттер орнатылмады ({what}). Терминалда қолмен орнатып көріңіз.",
        "hint": "Терминалда pip install / npm install арқылы орнатқан кез келген пакет серверде сақталады және requirements.txt / package.json-ға жазылады.",
    },
    "ru": {
        "installing": "Подключаются пакеты ({what}) — имеющиеся на сервере подключаются сразу, остальные скачиваются один раз…",
        "ready": "Пакеты готовы ({what}) — можно запускать.",
        "partial": "Не удалось установить некоторые пакеты: {what}",
        "failed": "Пакеты не установились ({what}). Попробуйте установить вручную в терминале.",
        "hint": "Любой пакет, установленный в терминале через pip install / npm install, сохраняется на сервере и записывается в requirements.txt / package.json.",
    },
    "en": {
        "installing": "Linking packages ({what}) — ones already on the server are linked instantly, the rest are downloaded once…",
        "ready": "Packages ready ({what}) — you can run the project now.",
        "partial": "Some packages could not be installed: {what}",
        "failed": "Packages failed to install ({what}). Try installing them manually in the terminal.",
        "hint": "Any package you install in the terminal with pip install / npm install is kept on the server and saved to requirements.txt / package.json.",
    },
}


def _what(item: Dict[str, object], root: str) -> str:
    names = [str(n) for n in (item.get("packages") or [])]
    shown = ", ".join(names[:6]) + (f" +{len(names) - 6}" if len(names) > 6 else "")
    eco = "npm" if item["eco"] == "node" else "pip"
    rel = os.path.relpath(os.path.dirname(str(item["path"])), root).replace(os.sep, "/")
    where = "" if rel == "." else f"{rel}: "
    return f"{where}{eco}{': ' + shown if shown else ''}"


def terminal_notice(kind: str, lang: str, what: str = "") -> str:
    """Терминалға жазылатын түрлі-түсті бір жол (ANSI)"""
    text = _MESSAGES.get(lang, _MESSAGES["en"])[kind].format(what=what)
    color, icon = {
        "installing": ("33", "⏳"), "ready": ("32", "✔"), "partial": ("33", "⚠"),
        "failed": ("31", "✖"), "hint": ("90", "ℹ"),
    }[kind]
    return f"\r\n\x1b[{color}m{icon} {text}\x1b[0m\r\n"


def _has_python(root: str) -> bool:
    for _dirpath, _dirs, filenames in _walk(root):
        if any(f.endswith(".py") or f == "requirements.txt" for f in filenames):
            return True
    return False


def terminal_env(cwd: str, env: Dict[str, str], is_project: bool = True) -> None:
    """Терминалдың PATH-ы: алдымен пакет шимдері (pip/npm/yarn/pnpm → ортақ қойма),
    жобаның ішінде — оның ``.venv``-і (``python`` / ``python -m pip`` содан).
    """
    tools = ensure_tools() if _tools else {}
    if not tools:
        ensure_tools_async()  # сервер енді ғана іске қосылды — келесі сессияларда дайын
    paths = []
    if os.path.isfile(os.path.join(BIN_DIR, "pkg_shim.py")):
        paths.append(BIN_DIR)
    if is_project:
        venv = os.path.join(cwd, VENV_DIR)
        with _guard:
            installing = venv in _pending
        if not os.path.isdir(venv) and not installing and tools.get("uv") and _has_python(cwd):
            ensure_venv(cwd)  # uv venv — бірнеше миллисекунд; `python -m pip` бірден жұмыс істесін
        if os.path.isdir(venv) or installing:
            env["VIRTUAL_ENV"] = venv
            paths.append(venv_bin(venv))
    env["PATH"] = os.pathsep.join([*paths, env.get("PATH", "")])
    env["npm_config_cache"] = NPM_CACHE


def _managed_dirs() -> Iterable[str]:
    """Барлық қолданушы жобаларындағы біз басқаратын node_modules / .venv (маркері барлар)"""
    base = os.path.abspath(TERMINAL_WORKSPACE_DIR)
    base_depth = base.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, _files in os.walk(base):
        depth = dirpath.count(os.sep) - base_depth
        if depth == 0:
            dirnames[:] = [d for d in dirnames if d != os.path.basename(SHARED_ROOT)]
        for name in ("node_modules", VENV_DIR):
            if name in dirnames:
                dest = os.path.join(dirpath, name)
                if not os.path.islink(dest) and os.path.isfile(os.path.join(dest, MARKER)):
                    yield dest
        if depth >= MAX_SCAN_DEPTH + 2:  # қолданушы / жоба / + жобаның ішкі папкалары
            dirnames[:] = []
        else:
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not os.path.islink(os.path.join(dirpath, d))]


def sweep(idle_days: Optional[float] = None) -> List[str]:
    """Ұзақ ашылмаған жобалардың ``node_modules`` / ``.venv``-ін өшіру.

    Пакеттердің өзі ортақ қоймада қалады — жоба қайта ашылғанда бірден қалпына
    келеді. Ешбір жоба қолданбайтын пакеттер қоймадан тазаланады (pnpm store
    prune, uv cache prune). Қайтарады: өшірілген папкалар.
    """
    days = SHARED_PACKAGES_IDLE_DAYS if idle_days is None else idle_days
    removed: List[str] = []
    with _guard:
        busy = set(_pending)
        active = [os.path.normcase(os.path.abspath(c)) + os.sep for c in _active_cwds]
    if days > 0:
        cutoff = time.time() - days * 86400
        for dest in list(_managed_dirs()):
            norm = os.path.normcase(dest)
            if dest in busy or any(norm.startswith(a) for a in active):
                continue
            try:
                idle = os.path.getmtime(os.path.join(dest, MARKER)) < cutoff
            except OSError:
                continue
            if idle:
                shutil.rmtree(dest, ignore_errors=True)
                removed.append(dest)
        if removed:
            tools = ensure_tools()
            if tools.get("node") and tools.get("pnpm"):
                _run([tools["node"], tools["pnpm"], "store", "prune", "--store-dir", PNPM_STORE], SHARED_ROOT)
            if tools.get("uv"):
                _run([tools["uv"], "cache", "prune"], SHARED_ROOT)
    # Бұрынғы «жиынтық» моделінің қалдықтары — ешбір терминал ашық болмағанда
    if not active and not busy:
        for name in _LEGACY:
            path = os.path.join(SHARED_ROOT, name)
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
                logger.info("Бұрынғы ортақ пакет жиынтықтары өшірілді: %s", path)
    # Орнатудың уақытша файлдары (бір күннен ескі)
    try:
        names = os.listdir(_TMP)
    except OSError:
        names = []
    for name in names:
        path = os.path.join(_TMP, name)
        try:
            if os.path.getmtime(path) >= time.time() - 86400:
                continue
        except OSError:
            continue
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                os.remove(path)
            except OSError:
                pass
    if removed:
        logger.info("Ұйықтатылған жоба пакеттері (%d): %s", len(removed), ", ".join(removed))
    return removed
