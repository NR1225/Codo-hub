"""Терминал жобаларына ортақ пакеттер (npm + Python) — автоматты орнату және «ұйықтату».

Жоба терминалға жазылғанда (``terminal_workspace.push``) оның қандай пакеттер
қолданатыны анықталады:

* **npm** — әр ``package.json`` (+ ``package-lock.json``);
* **Python** — ``requirements.txt``; ол жоқ болса — ``.py`` файлдарындағы
  ``import``-тар (тек белгілі пакеттер тізімі бойынша, ``_IMPORT_TO_PIP``).

Бір жиынтық серверде бір рет орнатылады —
``<TERMINAL_WORKSPACE_DIR>/.shared/{node,python}/<кілт>/`` — және жобаның
``node_modules`` / ``.venv`` папкасы осы ортақ папкаға сілтеме (Windows-та
junction, басқа жерде symlink) болады. Бар болса — бірден қолданылады, жоқ
болса — фонда орнатылып, сақталып қалады.

* Кілт — манифест мазмұнының хэші: файлдар өзгерсе, жаңа жиынтық бөлек
  орнатылады, ескісін қолданып жүрген жобалар бұзылмайды.
* Қауіпсіздік: npm ``--ignore-scripts``-пен, pip ``--only-binary=:all:``-мен
  (тек дайын wheel, setup.py іске қосылмайды) және құпиясыз env-пен жүреді.
  requirements.txt-тағы ``-r``/``--index-url``/URL/жергілікті жол жолдары алынып тасталады.
* Жобада өзінің нағыз ``node_modules`` / ``.venv`` папкасы болса — тиіспейміз.
* **Ұйықтату**: ``SHARED_PACKAGES_IDLE_DAYS`` күн бойы ешбір жоба қолданбаған
  жиынтық дискіден өшіріледі (``sweep``). Жүктелген файлдардың кэші
  (``npm-cache``, ``pip-cache``) қалады, сондықтан жоба қайта ашылғанда жиынтық
  интернетсіз дерлік тез «оянады» (қайта орнатылады).
"""
import ast
import hashlib
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
NODE_STORE = os.path.join(SHARED_ROOT, "node")
PY_STORE = os.path.join(SHARED_ROOT, "python")
NPM_CACHE = os.path.join(SHARED_ROOT, "npm-cache")
PIP_CACHE = os.path.join(SHARED_ROOT, "pip-cache")
_TMP = os.path.join(SHARED_ROOT, "tmp")

VENV_DIR = ".venv"
INSTALL_TIMEOUT_SECONDS = 600
MAX_SCAN_DEPTH = 3          # жобаның түбірі + 3 деңгей ішкі папка
MAX_PY_SCAN_FILES = 300
MAX_PY_FILE_BYTES = 512 * 1024
MAX_REQUIREMENTS = 100
_READY = ".ready"
_LAST_USED = ".last_used"
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
# tensorflow — кездейсоқ орнатылмасын). Басқасы керек болса — requirements.txt.
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

# Орнатылып жатқан кілттер және орнату біткенде сілтеме алатын папкалар.
# Кілттер "node:<hash>" / "python:<hash>" түрінде — екі қойма соқтығыспайды.
_pending: Dict[str, Set[str]] = {}
_pending_names: Dict[str, List[str]] = {}
_guard = threading.Lock()
# Ашық терминалдардың папкалары (cwd → сессия саны): олар қолданып тұрған жиынтық
# ұйықтатылмайды және «тазаланбайды»
_active_cwds: Dict[str, int] = {}
TRASH = os.path.join(SHARED_ROOT, "trash")
_CONTENTS = ".contents"
# Іске қосылғанда құралдар өздері жасайтын кэштер — «бұзылу» емес
_RUNTIME_ENTRIES = {".vite", ".cache", "__pycache__", ".package-lock.json", ".modules.yaml"}


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


def _is_ready(store: str, key: str) -> bool:
    return os.path.isfile(os.path.join(store, key, _READY))


def _touch(store: str, key: str) -> None:
    """Жиынтық қолданылды — ұйықтату таймері қайта басталады"""
    path = os.path.join(store, key, _LAST_USED)
    try:
        with open(path, "w") as f:
            f.write(str(int(time.time())))
    except OSError:
        pass


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
    target = _link_target(path)
    root = os.path.normcase(SHARED_ROOT) + os.sep
    return bool(target and target.startswith(root))


def unlink(path: str) -> None:
    """Сілтемені ғана өшіру — ортақ папканың ішіне тиіспейді"""
    if IS_WINDOWS:
        os.rmdir(path)  # junction-ды өшіреді, мақсатын емес
    else:
        os.unlink(path)


def _make_link(target: str, dest: str) -> None:
    if IS_WINDOWS:
        import _winapi
        _winapi.CreateJunction(target, dest)  # әкімші құқығын қажет етпейді
    else:
        os.symlink(target, dest, target_is_directory=True)


def _attach_link(dest: str, target: str) -> None:
    """``dest`` → ``target`` сілтемесі. Жобаның өз папкасы болса — тиіспейміз."""
    want = os.path.normcase(target)
    current = _link_target(dest)
    if current == want:
        return
    if current is not None:
        if not is_shared_link(dest):
            return  # қолданушының өз сілтемесі
        unlink(dest)  # манифест өзгерді — ескі жиынтыққа сілтеме
    elif os.path.exists(dest):
        return  # жобаның өз папкасы бар
    os.makedirs(target, exist_ok=True)  # junction мақсаты бар болуы керек
    _make_link(target, dest)


def _env() -> Dict[str, str]:
    env = {k: os.environ[k] for k in _ENV_KEEP if os.environ.get(k)}
    os.makedirs(_TMP, exist_ok=True)
    env["npm_config_cache"] = NPM_CACHE
    env["PIP_CACHE_DIR"] = PIP_CACHE
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env["PIP_NO_INPUT"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    if IS_WINDOWS:
        env["TEMP"] = env["TMP"] = _TMP
    else:
        env["HOME"] = SHARED_ROOT
        env["TMPDIR"] = _TMP
    return env


def _run(cmd: List[str], cwd: str) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, env=_env(), capture_output=True, timeout=INSTALL_TIMEOUT_SECONDS)


def _tail(result: subprocess.CompletedProcess) -> str:
    return (result.stderr or result.stdout or b"").decode("utf-8", "replace")[-2000:]


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


def _schedule(eco: str, store: str, key: str, dest: str, names: List[str], worker, *args) -> None:
    """Жиынтық дайын болса — бірден сілтеме, әйтпесе фонда орнатуды бастау"""
    target_of = _NODE_TARGET if eco == "node" else _PY_TARGET
    if _is_ready(store, key) and _is_dirty(eco, store, key) and not _in_use(target_of(key)):
        _retire(eco, store, key)  # терминалда қолмен өзгертілген — таза нұсқасы қайта орнатылады
    if _is_ready(store, key):
        _touch(store, key)
        try:
            _attach_link(dest, target_of(key))
        except OSError as e:
            logger.error("Сілтеме жасалмады (%s): %s", dest, e)
        return
    if os.path.exists(dest) and not is_shared_link(dest):
        return  # жобаның өз папкасы бар — ортақ жиынтық керек емес
    pending_key = f"{eco}:{key}"
    with _guard:
        started = pending_key in _pending
        _pending.setdefault(pending_key, set()).add(dest)
        _pending_names[pending_key] = names
    if not started:
        os.makedirs(store, exist_ok=True)
        threading.Thread(
            target=_install_wrapper, args=(eco, store, key, worker, *args),
            name=f"shared-{eco}-{key}", daemon=True,
        ).start()


def _install_wrapper(eco: str, store: str, key: str, worker, *args) -> None:
    final = os.path.join(store, key)
    try:
        shutil.rmtree(final, ignore_errors=True)  # бұрынғы сәтсіз әрекеттің / ұйықтаған жиынтықтың қалдығы
        os.makedirs(final, exist_ok=True)
        if worker(final, *args):
            _write_contents(eco, final)
            with open(os.path.join(final, _READY), "w") as f:
                f.write("ok")
            _touch(store, key)
            logger.info("Ортақ %s пакеттері дайын: %s", eco, key)
        else:
            shutil.rmtree(final, ignore_errors=True)
    except Exception as e:
        logger.error("Ортақ %s пакеттерін орнату қатесі (%s): %s", eco, key, e)
        shutil.rmtree(final, ignore_errors=True)
    finally:
        with _guard:
            waiting = _pending.pop(f"{eco}:{key}", set())
            _pending_names.pop(f"{eco}:{key}", None)
        if _is_ready(store, key):
            target = (_NODE_TARGET if eco == "node" else _PY_TARGET)(key)
            for dest in waiting:
                try:
                    _attach_link(dest, target)
                except OSError as e:
                    logger.error("Сілтеме жасалмады (%s): %s", dest, e)


# ──────────────── тазалық: терминалда қолмен өзгертілген жиынтықтар ────────────────
# Жобаның node_modules / .venv — ортақ папкаға сілтеме. Терминалда біреу
# ``pip install x`` / ``npm install x`` / ``rm -r node_modules/y`` жасаса, өзгеріс
# ортақ жиынтыққа түседі де, басқа жобаларға «қоқыс» болып өтеді. Сондықтан орнату
# біткенде жиынтықтың құрамы (жоғарғы деңгейдегі атаулар) жазылып қойылады; кейін
# құрамы өзгерсе — ешбір ашық терминал қолданбай тұрғанда ол алынып тасталып, таза
# нұсқасы қайта орнатылады.

def _content_dirs(eco: str, final: str) -> List[str]:
    if eco == "node":
        return [os.path.join(final, "node_modules")]
    venv = os.path.join(final, "venv")
    if IS_WINDOWS:
        return [os.path.join(venv, "Lib", "site-packages")]
    lib = os.path.join(venv, "lib")
    try:
        return [os.path.join(lib, d, "site-packages") for d in os.listdir(lib) if d.startswith("python")]
    except OSError:
        return []


def _snapshot(eco: str, final: str) -> str:
    entries = []
    for d in _content_dirs(eco, final):
        try:
            entries += [n for n in os.listdir(d) if n not in _RUNTIME_ENTRIES]
        except OSError:
            pass
    lock = os.path.join(final, "node_modules", ".package-lock.json")
    if eco == "node" and os.path.isfile(lock):
        # npm install / update пакеттің нұсқасын ауыстырса — атаулар сол, бірақ осы файл өзгереді
        entries.append(_hash(_read(lock)))
    return _hash("\n".join(sorted(entries)).encode("utf-8"))


def _write_contents(eco: str, final: str) -> None:
    with open(os.path.join(final, _CONTENTS), "w") as f:
        f.write(_snapshot(eco, final))


def _is_dirty(eco: str, store: str, key: str) -> bool:
    final = os.path.join(store, key)
    saved = _read(os.path.join(final, _CONTENTS))
    if saved is None:
        return False  # ескі нұсқада жасалған жиынтық — салыстыратын ештеңе жоқ
    return saved.decode("ascii", "replace").strip() != _snapshot(eco, final)


def _retire(eco: str, store: str, key: str) -> None:
    """Бұзылған жиынтықты қоқыс себетіне жылжыту (Windows-та файл ашық болса — келесі жолы)"""
    os.makedirs(TRASH, exist_ok=True)
    try:
        os.replace(os.path.join(store, key), os.path.join(TRASH, f"{eco}-{key}-{int(time.time())}"))
        logger.warning("Ортақ %s жиынтығы терминалда өзгертілген — таза нұсқасы қайта орнатылады: %s", eco, key)
    except OSError as e:
        logger.info("Бұзылған жиынтық әзірге алынбады (%s): %s", key, e)


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


def _links_in(root: str) -> Iterable[Tuple[str, str]]:
    """(сілтеме, мақсаты) — жобадағы барлық ортақ node_modules / .venv"""
    for dirpath, _dirs, _files in _walk(root):
        for name in ("node_modules", VENV_DIR):
            dest = os.path.join(dirpath, name)
            target = _link_target(dest)
            if target:
                yield dest, target


def _in_use(target: str) -> bool:
    """Ашық терминалдың жобасы осы жиынтыққа сілтеме жасап тұр ма"""
    want = os.path.normcase(target)
    with _guard:
        cwds = list(_active_cwds)
    return any(t == want for cwd in cwds for _d, t in _links_in(cwd))


def _node_names(manifest: bytes) -> List[str]:
    import json
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


def pending(root: str) -> List[Dict[str, object]]:
    """Жобада орнатылып жатқан жиынтықтар: [{path, eco, packages}]"""
    prefix = os.path.normcase(os.path.abspath(root)) + os.sep
    out: List[Dict[str, object]] = []
    with _guard:
        items = [(k, set(v), list(_pending_names.get(k, []))) for k, v in _pending.items()]
    for pending_key, dests, names in items:
        eco = pending_key.split(":", 1)[0]
        for dest in dests:
            if os.path.normcase(dest).startswith(prefix):
                out.append({"path": dest, "eco": eco, "packages": names})
    return out


def result(dest: str) -> Dict[str, object]:
    """Орнату біткеннен кейін: {"ok": bool, "failed": [орнатылмаған пакеттер]}"""
    target = _link_target(dest)
    if not target or not os.path.isdir(target):
        return {"ok": False, "failed": []}
    final = os.path.dirname(target)
    failed = (_read(os.path.join(final, "failed.txt")) or b"").decode("utf-8", "replace").split()
    return {"ok": os.path.isfile(os.path.join(final, _READY)), "failed": failed}


# ───────────────────────────── npm ─────────────────────────────

def _NODE_TARGET(key: str) -> str:
    return os.path.join(NODE_STORE, key, "node_modules")


def _npm_command() -> Optional[List[str]]:
    """npm-ді node арқылы тікелей шақыру: Windows-тағы npm.cmd орағышы
    шектелген env-пен npm сәтті біткенде де 1 кодын қайтарады"""
    node = shutil.which("node")
    if node:
        cli = os.path.join(os.path.dirname(node), "node_modules", "npm", "bin", "npm-cli.js")
        if os.path.isfile(cli):
            return [node, cli]
    npm = shutil.which("npm")
    return [npm] if npm else None


def _install_node(final: str, manifest: bytes, lock: Optional[bytes]) -> bool:
    # Тікелей соңғы папкаға орнатамыз (Windows үлкен папканы атын өзгертуге
    # жиі бермейді); дайын екенін тек .ready маркері білдіреді
    npm = _npm_command()
    if not npm:
        logger.warning("npm табылмады — ортақ npm пакеттері орнатылмайды")
        return False
    with open(os.path.join(final, "package.json"), "wb") as f:
        f.write(manifest)
    if lock:
        with open(os.path.join(final, "package-lock.json"), "wb") as f:
            f.write(lock)
    cmd = [*npm, "ci" if lock else "install", "--ignore-scripts", "--no-audit", "--no-fund"]
    result = _run(cmd, final)
    if result.returncode != 0:
        logger.error("Ортақ npm пакеттері орнатылмады: %s", _tail(result))
        return False
    # Тәуелділігі жоқ package.json-да npm node_modules жасамайды
    os.makedirs(os.path.join(final, "node_modules"), exist_ok=True)
    return True


def _attach_node(root: str) -> None:
    for dirpath, _dirs, filenames in _walk(root):
        if "package.json" not in filenames:
            continue
        manifest = _read(os.path.join(dirpath, "package.json"))
        if not manifest:
            continue
        lock = _read(os.path.join(dirpath, "package-lock.json"))
        key = _hash(manifest, lock)
        _schedule("node", NODE_STORE, key, os.path.join(dirpath, "node_modules"),
                  _node_names(manifest), _install_node, manifest, lock)


# ───────────────────────────── Python ─────────────────────────────

def _PY_TARGET(key: str) -> str:
    return os.path.join(PY_STORE, key, "venv")


def venv_python(venv: str) -> str:
    return os.path.join(venv, "Scripts", "python.exe") if IS_WINDOWS else os.path.join(venv, "bin", "python")


def venv_bin(venv: str) -> str:
    return os.path.join(venv, "Scripts") if IS_WINDOWS else os.path.join(venv, "bin")


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


def _install_python(final: str, requirements: List[str]) -> bool:
    base = _base_python()
    if not base:
        logger.warning("Python табылмады — ортақ Python пакеттері орнатылмайды")
        return False
    venv = os.path.join(final, "venv")
    result = _run([base, "-m", "venv", venv], final)
    if result.returncode != 0:
        logger.error("venv жасалмады: %s", _tail(result))
        return False
    req_file = os.path.join(final, "requirements.txt")
    with open(req_file, "w", encoding="utf-8") as f:
        f.write("\n".join(requirements) + "\n")
    pip = [venv_python(venv), "-m", "pip", "install", "--only-binary=:all:", "--no-input"]
    result = _run([*pip, "-r", req_file], final)
    if result.returncode == 0:
        return True
    # Бір пакеттің wheel-і жоқ болса да қалғандары жұмыс істесін — біртіндеп орнатамыз
    logger.warning("Python пакеттері бірге орнатылмады, біртіндеп қайталанады: %s", _tail(result))
    failed = []
    for req in requirements:
        if _run([*pip, req], final).returncode != 0:
            failed.append(req)
    if failed:
        with open(os.path.join(final, "failed.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(failed) + "\n")
        logger.error("Орнатылмаған Python пакеттері: %s", ", ".join(failed))
    return len(failed) < len(requirements)


def _python_key(requirements: List[str]) -> str:
    base = _base_python() or ""
    return _hash("\n".join(requirements).encode("utf-8"), base.lower().encode("utf-8"))


def _attach_python(root: str) -> None:
    if not SHARED_PACKAGES_AUTO_PYTHON:
        return
    req_dirs = []
    for dirpath, _dirs, filenames in _walk(root):
        if "requirements.txt" in filenames:
            req_dirs.append(dirpath)
    targets: List[Tuple[str, List[str]]] = []
    for dirpath in req_dirs:
        text = (_read(os.path.join(dirpath, "requirements.txt")) or b"").decode("utf-8", "replace")
        reqs = clean_requirements(text)
        if reqs:
            targets.append((dirpath, reqs))
    if not req_dirs:
        # requirements.txt жоқ — import-тардан табамыз (бір venv жобаның түбірінде)
        reqs = detect_imports(root)
        if reqs:
            targets.append((root, reqs))
    for dirpath, reqs in targets:
        key = _python_key(reqs)
        _schedule("python", PY_STORE, key, os.path.join(dirpath, VENV_DIR), reqs, _install_python, reqs)


# ───────────────────────────── жария API ─────────────────────────────

def attach(root: str) -> None:
    """Жоба қолданатын пакеттерді ортақ жиынтықтарға қосу.

    Жиынтық дайын болса — бірден сілтеме; жоқ болса — фонда орнатылып, біткенде
    сілтеме қосылады.
    """
    for fn in (_attach_node, _attach_python):
        try:
            fn(root)
        except Exception as e:
            logger.error("%s сәтсіз (%s): %s", fn.__name__, root, e)


def detach(root: str) -> None:
    """Жоба папкасын өшірмес бұрын ортақ сілтемелерді алып тастау"""
    for dirpath, dirnames, _files in _walk(root):
        for name in ("node_modules", VENV_DIR):
            dest = os.path.join(dirpath, name)
            if is_shared_link(dest):
                try:
                    unlink(dest)
                except OSError:
                    pass


_MESSAGES = {
    "kk": {
        "installing": "Пакеттер орнатылуда ({what}) — бірінші рет бір минуттай алады. Дайын болғанда хабарлаймын…",
        "ready": "Пакеттер дайын ({what}) — енді іске қосуға болады.",
        "partial": "Кейбір пакеттер орнатылмады: {what}",
        "failed": "Пакеттер орнатылмады ({what}). Терминалда қолмен орнатып көріңіз.",
        "hint": "Жаңа пакет керек болса — requirements.txt / package.json-ға жазыңыз (терминалда қолмен орнатылғаны уақытша).",
    },
    "ru": {
        "installing": "Устанавливаются пакеты ({what}) — в первый раз это займёт около минуты. Сообщу, когда будет готово…",
        "ready": "Пакеты готовы ({what}) — можно запускать.",
        "partial": "Не удалось установить некоторые пакеты: {what}",
        "failed": "Пакеты не установились ({what}). Попробуйте установить вручную в терминале.",
        "hint": "Нужен новый пакет — добавьте его в requirements.txt / package.json (установленное вручную в терминале временно).",
    },
    "en": {
        "installing": "Installing packages ({what}) — the first time takes about a minute. I'll let you know when it's ready…",
        "ready": "Packages ready ({what}) — you can run the project now.",
        "partial": "Some packages could not be installed: {what}",
        "failed": "Packages failed to install ({what}). Try installing them manually in the terminal.",
        "hint": "Need a new package? Add it to requirements.txt / package.json (anything installed by hand in the terminal is temporary).",
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


def status(root: str) -> Dict[str, str]:
    """Жобадағы ортақ жиынтықтардың күйі: {"node_modules": "ready"|"installing"} т.б."""
    out: Dict[str, str] = {}
    with _guard:
        waiting = {d for dests in _pending.values() for d in dests}
    for dirpath, _dirs, _files in _walk(root):
        for name in ("node_modules", VENV_DIR):
            dest = os.path.join(dirpath, name)
            rel = os.path.relpath(dest, root).replace(os.sep, "/")
            if dest in waiting:
                out[rel] = "installing"
            elif is_shared_link(dest) and os.path.isdir(dest):
                out[rel] = "ready"
    return out


def terminal_env(cwd: str, env: Dict[str, str]) -> None:
    """Терминал жобаның ішінде ашылса — ``python``/``pip`` жобаның ``.venv``-інен.

    ``.venv`` әлі орнатылып жатса да PATH-қа қосамыз: орнату біткен сәттен бастап
    ``python main.py`` пакеттерді көреді (shell PATH-ты әр командада қайта іздейді).
    """
    venv = os.path.join(cwd, VENV_DIR)
    with _guard:
        installing = any(venv in dests for dests in _pending.values())
    if not (os.path.isdir(venv) or installing):
        return
    env["VIRTUAL_ENV"] = venv
    env["PATH"] = venv_bin(venv) + os.pathsep + env.get("PATH", "")
    env["PIP_CACHE_DIR"] = PIP_CACHE


def _last_used(path: str) -> float:
    for marker in (_LAST_USED, _READY):
        try:
            return os.path.getmtime(os.path.join(path, marker))
        except OSError:
            continue
    try:
        return os.path.getmtime(path)
    except OSError:
        return time.time()


def sweep(idle_days: Optional[float] = None) -> List[str]:
    """Ұзақ қолданылмаған жиынтықтарды «ұйықтату» (дискіден өшіру).

    Жүктеу кэші қалады — жоба қайта ашылғанда жиынтық тез қайта орнатылады
    (жобадағы сілтеме сол жолға қарайды, сондықтан өзі қайта жалғанады).
    Қайтарады: ұйықтатылған жиынтықтар ("node/<кілт>").
    """
    days = SHARED_PACKAGES_IDLE_DAYS if idle_days is None else idle_days
    if days <= 0:
        return []
    cutoff = time.time() - days * 86400
    slept: List[str] = []
    with _guard:
        busy = set(_pending)
    for eco, store in (("node", NODE_STORE), ("python", PY_STORE)):
        try:
            keys = os.listdir(store)
        except OSError:
            continue
        for key in keys:
            path = os.path.join(store, key)
            if f"{eco}:{key}" in busy or not os.path.isdir(path):
                continue
            if _last_used(path) >= cutoff:
                continue
            if _in_use(_NODE_TARGET(key) if eco == "node" else _PY_TARGET(key)):
                _touch(store, key)
                continue
            shutil.rmtree(path, ignore_errors=True)
            slept.append(f"{eco}/{key}")
    # Бұзылған жиынтықтардың себеті және орнатудың уақытша файлдары (бір күннен ескі)
    for folder in (TRASH, _TMP):
        try:
            names = os.listdir(folder)
        except OSError:
            continue
        for name in names:
            path = os.path.join(folder, name)
            try:
                old = os.path.getmtime(path) < time.time() - 86400 or folder == TRASH
            except OSError:
                continue
            if old:
                if os.path.isdir(path) and not os.path.islink(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    try:
                        os.remove(path)
                    except OSError:
                        pass
    if slept:
        logger.info("Ұйықтатылған пакет жиынтықтары (%d): %s", len(slept), ", ".join(slept))
    return slept
