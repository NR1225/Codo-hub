"""Терминалдағы ``pip`` / ``pip3`` / ``python -m pip`` / ``npm`` / ``yarn`` / ``pnpm`` орағышы.

Бұл файл backend-ке тәуелсіз: ``shared_packages.ensure_tools()`` оны
``<TERMINAL_WORKSPACE_DIR>/.shared/bin/`` ішіне көшіріп, терминалдың PATH-ының
басына қояды. Әр команда:

* пакетті серверге **ортақ қоймаға** орнатады (Python — uv кэші, npm — pnpm
  store). Пакет қоймада бар болса — қайта жүктелмей, hardlink арқылы бірден
  қолданылады; жоқ болса — бір рет жүктеліп, бәріне ортақ болады;
* орнатылғанын жобаның ``requirements.txt`` / ``package.json`` файлына жазады —
  сондықтан жоба қайта ашылғанда да, басқа компьютерде де пакет сақталып қалады.

Қолданылуы: ``python pkg_shim.py <pip|npm|yarn|pnpm> [аргументтер...]``
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IS_WINDOWS = sys.platform == "win32"
VENV_DIR = ".venv"


def _config() -> dict:
    try:
        with open(os.path.join(HERE, "shim.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


CFG = _config()


_TEXT = {
    "saved": {"kk": "ℹ {rel} жаңартылды — пакеттер жобамен бірге сақталады.",
              "ru": "ℹ {rel} обновлён — пакеты сохраняются вместе с проектом.",
              "en": "ℹ {rel} updated — packages are saved with the project."},
    "help": {"kk": "pip install <пакет> · pip uninstall <пакет> · pip list · pip freeze · pip show <пакет>",
             "ru": "pip install <пакет> · pip uninstall <пакет> · pip list · pip freeze · pip show <пакет>",
             "en": "pip install <package> · pip uninstall <package> · pip list · pip freeze · pip show <package>"},
    "download": {"kk": "pip download мұнда қолжетімсіз — pip install қолданыңыз.",
                 "ru": "pip download здесь недоступен — используйте pip install.",
                 "en": "pip download is not available here — use pip install."},
    "global": {"kk": "✖ Глобал орнату мұнда жоқ — пакетті жобаға орнатыңыз (-g-сіз). Бір рет іске қосу үшін: npx <пакет>",
               "ru": "✖ Глобальная установка недоступна — установите пакет в проект (без -g). Для разового запуска: npx <пакет>",
               "en": "✖ Global installs are not available — install the package into the project (without -g). To run once: npx <package>"},
    "not_ready": {"kk": "✖ Пакет менеджері әзірге дайын емес — бір минуттан кейін қайталап көріңіз.",
                  "ru": "✖ Менеджер пакетов ещё не готов — попробуйте через минуту.",
                  "en": "✖ The package manager is not ready yet — try again in a minute."},
}


def _t(key: str, **kw) -> str:
    lang = os.environ.get("CODO_LANG", "en")
    texts = _TEXT[key]
    return texts.get(lang, texts["en"]).format(**kw)


def _say(text: str, color: str = "36") -> None:
    sys.stderr.write(f"\x1b[{color}m{text}\x1b[0m\n")
    sys.stderr.flush()


def _home() -> str:
    """Қолданушының терминал папкасы — жоба түбірін одан жоғары іздемейміз"""
    home = os.environ.get("USERPROFILE" if IS_WINDOWS else "HOME") or ""
    return os.path.normcase(os.path.abspath(home)) if home else ""


def _find_up(start: str, names) -> str:
    """``start``-тан жоғары қарай ``names``-тің бірі бар бірінші папка (табылмаса — start)"""
    home = _home()
    cur = os.path.abspath(start)
    while True:
        if any(os.path.exists(os.path.join(cur, n)) for n in names):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur or os.path.normcase(cur) == home:
            return os.path.abspath(start)
        cur = parent


def _run(cmd, env_extra=None, cwd=None) -> int:
    env = dict(os.environ)
    env.update(env_extra or {})
    # Біздің bin папкасы ішкі шақыруларда қайталанбасын (npm → npm шексіз цикл)
    bin_dir = os.path.normcase(HERE)
    env["PATH"] = os.pathsep.join(
        p for p in env.get("PATH", "").split(os.pathsep) if os.path.normcase(p.rstrip("\\/")) != bin_dir
    )
    try:
        return subprocess.call(cmd, env=env, cwd=cwd)
    except KeyboardInterrupt:
        return 130
    except OSError as e:
        _say(f"✖ {e}", "31")
        return 127


# ───────────────────────────── Python ─────────────────────────────

_NAME_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _req_name(spec: str) -> str:
    m = _NAME_RE.match(spec)
    return _norm(m.group(1)) if m else ""


def _uv_env() -> dict:
    return {
        "UV_CACHE_DIR": CFG.get("uv_cache", ""),
        "UV_LINK_MODE": "hardlink",
        "UV_PYTHON_DOWNLOADS": "never",
    }


def venv_python(venv: str) -> str:
    return os.path.join(venv, "Scripts", "python.exe") if IS_WINDOWS else os.path.join(venv, "bin", "python")


def ensure_venv(root: str) -> str:
    venv = os.path.join(root, VENV_DIR)
    if os.path.isfile(venv_python(venv)):
        return venv
    uv, py = CFG.get("uv"), CFG.get("python")
    if os.path.lexists(venv) and not os.path.isdir(venv):
        os.remove(venv)
    try:
        os.rmdir(venv)  # бұрынғы ортақ жиынтыққа сілтеме (junction/symlink) немесе бос папка
    except OSError:
        if os.path.islink(venv):
            os.unlink(venv)
    code = _run([uv, "venv", "--quiet", "--allow-existing", "--python", py, venv], _uv_env())
    if code != 0:
        raise SystemExit(code)
    install_pip_proxy(venv)
    return venv


def install_pip_proxy(venv: str) -> None:
    """``python -m pip`` те осы орағышқа келсін (uv venv-інде нағыз pip жоқ)"""
    if IS_WINDOWS:
        site = os.path.join(venv, "Lib", "site-packages")
    else:
        lib = os.path.join(venv, "lib")
        try:
            site = next(os.path.join(lib, d, "site-packages") for d in os.listdir(lib) if d.startswith("python"))
        except (OSError, StopIteration):
            return
    pkg = os.path.join(site, "pip")
    if os.path.isdir(os.path.join(site, "pip", "_internal")):
        return  # нағыз pip орнатылған
    os.makedirs(pkg, exist_ok=True)
    shim = os.path.join(HERE, "pkg_shim.py").replace("\\", "\\\\")
    code = (
        "import subprocess, sys\n"
        f"sys.exit(subprocess.call([sys.executable, '-I', '{shim}', 'pip', *sys.argv[1:]]))\n"
    )
    for name in ("__init__.py", "__main__.py"):
        with open(os.path.join(pkg, name), "w", encoding="utf-8") as f:
            f.write("" if name == "__init__.py" else code)


def _update_requirements(root: str, add=(), remove=()) -> None:
    path = os.path.join(root, "requirements.txt")
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        lines = []
    drop = {_req_name(s) for s in (*add, *remove)}
    out = [line for line in lines if not (_req_name(line) in drop and not line.lstrip().startswith(("#", "-")))]
    out += list(add)
    if out == lines:
        return
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    rel = os.path.relpath(path, os.getcwd())
    _say(_t("saved", rel=rel), "90")


# pip-тің uv-де жоқ немесе мағынасыз жалаулары
_PIP_DROP = {"--user", "--break-system-packages", "--no-warn-script-location", "--disable-pip-version-check",
             "-q", "--quiet", "--no-cache-dir", "--root-user-action=ignore"}
_PIP_VALUE_FLAGS = {"-r", "--requirement", "-c", "--constraint", "-e", "--editable", "-i", "--index-url",
                    "--extra-index-url", "-f", "--find-links", "--target", "-t", "--prefix", "--python",
                    "--root-user-action", "--platform", "--python-version", "--only-binary", "--no-binary"}


def _split_pip(args):
    """(uv-ге берілетін аргументтер, requirements.txt-қа жазылатын пакеттер)"""
    passed, specs = [], []
    i = 0
    while i < len(args):
        a = args[i]
        if a in _PIP_DROP:
            i += 1
            continue
        if a in _PIP_VALUE_FLAGS:
            passed += args[i:i + 2]
            i += 2
            continue
        passed.append(a)
        if not a.startswith("-") and _req_name(a) and "/" not in a and "\\" not in a and "://" not in a \
                and not a.endswith((".whl", ".tar.gz", ".zip")):
            specs.append(a.strip())
        i += 1
    return passed, specs


def pip(args) -> int:
    if not args or args[0] in ("-h", "--help", "help"):
        _say(_t("help"))
        return 0
    if args[0] in ("-V", "--version"):
        return _run([CFG["uv"], "--version"])
    cmd, rest = args[0], args[1:]
    root = _find_up(os.getcwd(), (VENV_DIR, "requirements.txt"))
    venv = ensure_venv(root)
    base = [CFG["uv"], "pip"]
    if cmd == "install":
        passed, specs = _split_pip(rest)
        if any(a in ("-g", "--global") for a in passed):
            passed = [a for a in passed if a not in ("-g", "--global")]
        code = _run([*base, "install", "--python", venv, *passed], _uv_env())
        if code == 0 and specs:
            _update_requirements(root, add=specs)
        return code
    if cmd == "uninstall":
        names = [a for a in rest if not a.startswith("-")]
        code = _run([*base, "uninstall", "--python", venv, *names], _uv_env())
        if code == 0 and names:
            _update_requirements(root, remove=names)
        return code
    if cmd in ("list", "freeze", "show", "check", "tree"):
        return _run([*base, cmd, "--python", venv, *rest], _uv_env())
    if cmd == "download":
        _say(_t("download"), "33")
        return 1
    return _run([*base, cmd, "--python", venv, *rest], _uv_env())


# ───────────────────────────── npm / yarn / pnpm ─────────────────────────────

def _pnpm_base() -> list:
    pnpm = CFG.get("pnpm")
    if not pnpm:
        return []
    return [
        CFG["node"], pnpm,
        "--store-dir", CFG["pnpm_store"],
        "--config.node-linker=hoisted",
        "--config.package-import-method=hardlink",
        "--config.confirm-modules-purge=false",
        "--config.auto-install-peers=true",
        "--config.strict-peer-dependencies=false",
    ]


def _real_npm(args) -> int:
    npm_cli = CFG.get("npm_cli")
    cmd = [CFG["node"], npm_cli] if npm_cli else ["npm"]
    return _run([*cmd, *args], {"npm_config_cache": CFG.get("npm_cache", "")})


def _pnpm(args, root=None) -> int:
    base = _pnpm_base()
    if not base:
        return _real_npm(args)  # pnpm жоқ — қарапайым npm (ортақ кэшпен)
    return _run([*base, *args], cwd=root)


_NPM_INSTALL = {"install", "i", "add", "isntall", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal"}
_NPM_REMOVE = {"uninstall", "remove", "rm", "r", "un", "unlink"}
_NPM_UPDATE = {"update", "up", "upgrade", "udpate"}
# npm жалаулары → pnpm баламасы (None — алып тастау)
_FLAG_MAP = {
    "--save-dev": "-D", "-D": "-D", "--save-optional": "-O", "-O": "-O",
    "--save-exact": "-E", "-E": "-E", "--save-peer": "--save-peer",
    "--save": None, "-S": None, "--save-prod": None, "-P": None,
    "--no-audit": None, "--no-fund": None, "--legacy-peer-deps": None, "--force": None,
    "--silent": "--silent", "--prefer-offline": None,
}


def _pkg_root() -> str:
    return _find_up(os.getcwd(), ("package.json",))


def _map_flags(args):
    out, pkgs = [], []
    for a in args:
        if a.startswith("-"):
            mapped = _FLAG_MAP.get(a, a)
            if mapped:
                out.append(mapped)
        else:
            pkgs.append(a)
    return out, pkgs


def _no_global(args) -> bool:
    if any(a in ("-g", "--global", "--location=global") for a in args):
        _say(_t("global"), "31")
        return True
    return False


def npm(args) -> int:
    if not args:
        return _real_npm(args)
    cmd, rest = args[0], args[1:]
    if cmd in _NPM_INSTALL or cmd == "ci":
        if _no_global(rest):
            return 1
        flags, pkgs = _map_flags(rest)
        root = _pkg_root()
        if pkgs:
            return _pnpm(["add", *flags, *pkgs], root)
        return _pnpm(["install", *flags], root)
    if cmd in _NPM_REMOVE:
        if _no_global(rest):
            return 1
        flags, pkgs = _map_flags(rest)
        return _pnpm(["remove", *flags, *pkgs], _pkg_root())
    if cmd in _NPM_UPDATE:
        flags, pkgs = _map_flags(rest)
        return _pnpm(["update", *flags, *pkgs], _pkg_root())
    return _real_npm(args)


def yarn(args) -> int:
    if not args or args[0] == "install":
        return _pnpm(["install", *_map_flags(args[1:])[0]], _pkg_root())
    cmd, rest = args[0], args[1:]
    if cmd == "global":
        _no_global(["-g"])
        return 1
    if cmd == "add":
        flags, pkgs = _map_flags(rest)
        return _pnpm(["add", *flags, *pkgs], _pkg_root())
    if cmd == "remove":
        return _pnpm(["remove", *rest], _pkg_root())
    if cmd in ("upgrade", "up"):
        return _pnpm(["update", *rest], _pkg_root())
    # yarn dev / yarn run build / yarn test — pnpm скрипттерді дәл солай іске қосады
    return _pnpm(args, _pkg_root())


def pnpm(args) -> int:
    if args and args[0] in ("add", "install", "i", "remove", "rm", "uninstall", "update", "up") and _no_global(args[1:]):
        return 1
    return _pnpm(args, _pkg_root() if args and args[0] in ("add", "install", "i", "remove", "rm", "uninstall",
                                                             "update", "up") else None)


def main(argv) -> int:
    if not argv:
        return 2
    tool, args = argv[0], argv[1:]
    if not CFG.get("uv") and tool == "pip":
        _say(_t("not_ready"), "31")
        return 1
    handler = {"pip": pip, "pip3": pip, "npm": npm, "yarn": yarn, "pnpm": pnpm}.get(tool)
    if not handler:
        return 2
    return handler(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
