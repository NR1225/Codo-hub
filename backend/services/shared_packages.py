"""Терминал жобаларына ортақ npm пакеттері.

Бір ``package.json`` (+ ``package-lock.json``) үшін пакеттер серверде бір рет
орнатылады — ``<TERMINAL_WORKSPACE_DIR>/.shared/node/<кілт>/node_modules`` —
және сол файлдары бірдей әр жобаның ``node_modules`` папкасы осы ортақ
папкаға сілтеме (Windows-та junction, басқа жерде symlink) болады. Қанша
қолданушы болса да, пакеттің дискіде бір ғана көшірмесі тұрады.

* Кілт — package.json мен lock-файлдың хэші: файлдар өзгерсе, жаңа жиынтық
  бөлек орнатылады, ескісін қолданып жүрген жобалар бұзылмайды.
* Орнату ``--ignore-scripts``-пен және құпиясыз env-пен жүреді — жоба
  пакеттерінің install-скрипттері сервер атынан іске қосылмайды.
* Жобада өзінің нағыз ``node_modules`` папкасы болса (қолданушы ``npm install``
  жасаған) — оған тиіспейміз.
* Ортақ npm кэші (``.shared/npm-cache``) терминалдағы ``npm install``-ды да
  тездетеді: бір рет жүктелген пакет қайта жүктелмейді.
"""
import hashlib
import logging
import os
import shutil
import subprocess
import sys
import threading
from typing import Dict, List, Optional, Set

from config import TERMINAL_WORKSPACE_DIR

logger = logging.getLogger("codo_hub.shared_packages")

IS_WINDOWS = sys.platform == "win32"

# ".shared" — нүктесі бар, ал user_root() атаудан нүктені алып тастайды,
# сондықтан ешбір қолданушының папкасымен соқтығыспайды
SHARED_ROOT = os.path.abspath(os.path.join(TERMINAL_WORKSPACE_DIR, ".shared"))
NODE_STORE = os.path.join(SHARED_ROOT, "node")
NPM_CACHE = os.path.join(SHARED_ROOT, "npm-cache")

INSTALL_TIMEOUT_SECONDS = 600
MAX_SCAN_DEPTH = 3          # жобаның түбірі + 3 деңгей ішкі папка
_READY = ".ready"
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

# Орнатылып жатқан кілттер және орнату біткенде сілтеме алатын папкалар
_pending: Dict[str, Set[str]] = {}
_guard = threading.Lock()


def _read(path: str) -> Optional[bytes]:
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def _key(manifest: bytes, lock: Optional[bytes]) -> str:
    h = hashlib.sha256(manifest)
    h.update(b"\0")
    h.update(lock or b"")
    return h.hexdigest()[:20]


def _store_modules(key: str) -> str:
    return os.path.join(NODE_STORE, key, "node_modules")


def _is_ready(key: str) -> bool:
    return os.path.isfile(os.path.join(NODE_STORE, key, _READY))


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
    store = os.path.normcase(NODE_STORE) + os.sep
    return bool(target and target.startswith(store))


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


def _attach_dir(pkg_dir: str, key: str) -> None:
    dest = os.path.join(pkg_dir, "node_modules")
    want = os.path.normcase(_store_modules(key))
    current = _link_target(dest)
    if current == want:
        return
    if current is not None:
        if not is_shared_link(dest):
            return  # қолданушының өз сілтемесі
        unlink(dest)  # package.json өзгерді — ескі жиынтыққа сілтеме
    elif os.path.exists(dest):
        return  # жобаның өз node_modules папкасы бар
    os.makedirs(_store_modules(key), exist_ok=True)  # junction мақсаты бар болуы керек
    _make_link(_store_modules(key), dest)


def _env() -> Dict[str, str]:
    env = {k: os.environ[k] for k in _ENV_KEEP if os.environ.get(k)}
    env["npm_config_cache"] = NPM_CACHE
    if not IS_WINDOWS:
        env["HOME"] = SHARED_ROOT
    return env


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


def _install(key: str, manifest: bytes, lock: Optional[bytes]) -> None:
    npm = _npm_command()
    # Тікелей соңғы папкаға орнатамыз (Windows үлкен папканы атын өзгертуге
    # жиі бермейді); дайын екенін тек .ready маркері білдіреді
    final = os.path.join(NODE_STORE, key)
    try:
        if not npm:
            logger.warning("npm табылмады — ортақ пакеттер орнатылмайды")
            return
        shutil.rmtree(final, ignore_errors=True)  # бұрынғы сәтсіз әрекеттің қалдығы
        os.makedirs(final, exist_ok=True)
        with open(os.path.join(final, "package.json"), "wb") as f:
            f.write(manifest)
        if lock:
            with open(os.path.join(final, "package-lock.json"), "wb") as f:
                f.write(lock)
        cmd = [*npm, "ci" if lock else "install", "--ignore-scripts", "--no-audit", "--no-fund"]
        result = subprocess.run(
            cmd, cwd=final, env=_env(), capture_output=True, timeout=INSTALL_TIMEOUT_SECONDS,
        )
        if result.returncode != 0:
            logger.error("Ортақ пакеттер орнатылмады (%s): %s", key,
                         result.stderr.decode("utf-8", "replace")[-2000:])
            shutil.rmtree(final, ignore_errors=True)
            return
        # Тәуелділігі жоқ package.json-да npm node_modules жасамайды
        os.makedirs(_store_modules(key), exist_ok=True)
        with open(os.path.join(final, _READY), "w") as f:
            f.write("ok")
        logger.info("Ортақ пакеттер дайын: %s", key)
    except Exception as e:
        logger.error("Ортақ пакеттерді орнату қатесі (%s): %s", key, e)
    finally:
        with _guard:
            waiting = _pending.pop(key, set())
        if _is_ready(key):
            for pkg_dir in waiting:
                try:
                    _attach_dir(pkg_dir, key)
                except OSError as e:
                    logger.error("node_modules сілтемесі жасалмады (%s): %s", pkg_dir, e)


def _package_dirs(root: str) -> List[str]:
    found = []
    base_depth = root.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, filenames in os.walk(root):
        if dirpath.count(os.sep) - base_depth >= MAX_SCAN_DEPTH:
            dirnames[:] = []
        else:
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        if "package.json" in filenames:
            found.append(dirpath)
    return found


def attach(root: str) -> None:
    """Жобадағы әр package.json үшін node_modules-ты ортақ жиынтыққа қосу.

    Жиынтық әлі жоқ болса — фонда орнатуды бастайды, біткенде сілтеме қосылады.
    """
    for pkg_dir in _package_dirs(root):
        manifest = _read(os.path.join(pkg_dir, "package.json"))
        if not manifest:
            continue
        lock = _read(os.path.join(pkg_dir, "package-lock.json"))
        key = _key(manifest, lock)
        if _is_ready(key):
            try:
                _attach_dir(pkg_dir, key)
            except OSError as e:
                logger.error("node_modules сілтемесі жасалмады (%s): %s", pkg_dir, e)
            continue
        dest = os.path.join(pkg_dir, "node_modules")
        if os.path.exists(dest) and not is_shared_link(dest):
            continue  # өз node_modules бар — ортақ жиынтық керек емес
        with _guard:
            started = key in _pending
            _pending.setdefault(key, set()).add(pkg_dir)
        if not started:
            os.makedirs(NODE_STORE, exist_ok=True)
            threading.Thread(
                target=_install, args=(key, manifest, lock),
                name=f"npm-shared-{key}", daemon=True,
            ).start()


def detach(root: str) -> None:
    """Жоба папкасын өшірмес бұрын ортақ сілтемелерді алып тастау"""
    for pkg_dir in _package_dirs(root):
        dest = os.path.join(pkg_dir, "node_modules")
        if is_shared_link(dest):
            try:
                unlink(dest)
            except OSError:
                pass
