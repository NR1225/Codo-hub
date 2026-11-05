"""Vibecoding «Іске қосу»: жоба қалай іске қосылатынын оның терминал папкасынан анықтау.

Нәтиже түрлері:

* ``server`` — dev/веб-сервер (npm dev/start, Vite, Next, Django, Flask, FastAPI,
  Streamlit, Express …). Команда терминалда орындалады, ал ол басқан адрес
  (``http://localhost:PORT``) «Алдын ала көрініс» панелінде ашылады.
* ``web`` — статикалық HTML/CSS/JS: көрініс браузердің өзінде құрастырылады.
* ``console`` — жай скрипт (``python main.py``, ``node app.js``): нәтижесі терминалда.
* ``none`` — іске қосатын ештеңе табылмады.

Команда сервер ОЖ-сіне қарай құрылады (Windows — PowerShell, басқасы — bash), бірақ
екеуінде де бірдей жұмыс істейтін жай түрде: бір команда, қажет болса ``cd <папка>; …``.
Пакеттерді (``node_modules``, ``.venv``) ``shared_packages`` фонда ортақ қоймадан қосады.
"""
import json
import os
import re
import socket
import sys
from typing import Dict, List, Optional, Tuple

IS_WINDOWS = sys.platform == "win32"
PYTHON = "python" if IS_WINDOWS else "python3"

_SKIP_DIRS = {
    "node_modules", ".venv", "venv", "env", ".git", "__pycache__", "dist", "build",
    ".next", ".nuxt", ".svelte-kit", ".cache", ".appdata", "Microsoft", "AppData",
}
_MAX_DEPTH = 3
_MAX_READ = 200_000

# package.json скрипттері — ретімен (бірінші табылғаны іске қосылады)
_NPM_SCRIPTS = ("dev", "start", "serve", "preview")


def _walk(root: str) -> List[str]:
    """Жобадағы файлдардың салыстырмалы жолдары (тәуелділік/құрастыру папкаларынсыз)"""
    out: List[str] = []
    root = os.path.abspath(root)
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        depth = 0 if rel_dir == "." else rel_dir.count(os.sep) + 1
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")] if depth < _MAX_DEPTH else []
        for name in filenames:
            rel = name if rel_dir == "." else os.path.join(rel_dir, name)
            out.append(rel.replace(os.sep, "/"))
    out.sort(key=lambda p: (p.count("/"), p))
    return out


def _read(root: str, rel: str) -> str:
    try:
        with open(os.path.join(root, rel), "rb") as f:
            return f.read(_MAX_READ).decode("utf-8", errors="replace")
    except OSError:
        return ""


def _dir(rel: str) -> str:
    return rel.rsplit("/", 1)[0] if "/" in rel else ""


def _name(rel: str) -> str:
    return rel.rsplit("/", 1)[-1]


def _in_dir(directory: str, command: str) -> str:
    """Командані жобаның ішкі папкасында орындау (PowerShell мен bash-та бірдей)"""
    if not directory:
        return command
    quoted = f'"{directory}"' if " " in directory else directory
    return f"cd {quoted}; {command}"


def _free_port() -> int:
    """Жобаға бос порт: әдепкі 3000 сайттың өз бэкендімен соқтығысады
    (CRA «басқа портта іске қосайын ба? (Y/n)» деп тұрып қалады, Express EADDRINUSE береді)"""
    # 4100-4999 — dev_proxy.ALLOWED_PORTS ауқымымен бірдей болуы керек (прокси осы порттарды ғана өткізеді)
    for port in range(4100, 5000):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("0.0.0.0", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("0.0.0.0", 0))
        return sock.getsockname()[1]


def _with_port(command: str, port: int) -> str:
    """PORT айнымалысымен іске қосу (PowerShell / bash)"""
    if IS_WINDOWS:
        return f"$env:PORT={port}; $env:BROWSER='none'; {command}"
    return f"PORT={port} BROWSER=none {command}"


def _plan(kind: str, command: Optional[str] = None, **extra) -> Dict[str, object]:
    return {"kind": kind, "command": command, **{k: v for k, v in extra.items() if v is not None}}


# ─── Node ─────────────────────────────────────────────────────────────

def _framework(pkg: dict, script_body: str) -> Optional[str]:
    deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
    body = script_body.lower()
    for name, marker in (
        ("next", "next"), ("vite", "vite"), ("react-scripts", "react-scripts"), ("nuxt", "nuxt"),
        ("astro", "astro"), ("@angular/cli", "ng "), ("@sveltejs/kit", "svelte-kit"), ("parcel", "parcel"),
        ("webpack-dev-server", "webpack"), ("expo", "expo"),
    ):
        if marker in body or name in deps:
            return name
    return None


def _node_plan(root: str, files: List[str]) -> Optional[Dict[str, object]]:
    for rel in (f for f in files if _name(f) == "package.json"):
        try:
            pkg = json.loads(_read(root, rel) or "{}")
        except ValueError:
            continue
        if not isinstance(pkg, dict):
            continue
        scripts = pkg.get("scripts") if isinstance(pkg.get("scripts"), dict) else {}
        directory = _dir(rel)
        for script in _NPM_SCRIPTS:
            body = scripts.get(script)
            if not isinstance(body, str) or not body.strip():
                continue
            run = "npm start" if script == "start" else f"npm run {script}"
            port = _free_port()
            # Vite/Next/Astro/Nuxt PORT айнымалысын елемейді (Vite-тың 5173-і — сайттың өз frontend-і),
            # сондықтан скрипт тікелей солардың CLI-ын шақырса, портты аргумент ретінде береміз.
            # Windows PowerShell 5.1 «--»-ті npm-ге жеткізбеуі мүмкін — онда Vite өзі бос портқа ауысады
            if not IS_WINDOWS and re.match(r"^(vite|next dev|next|astro dev|astro|nuxt dev|nuxi dev|nuxt)(\s|$)", body.strip()) \
                    and "--port" not in body and " -p " not in f" {body} ":
                run += f" -- --port {port}"
            return _plan("server", _in_dir(directory, _with_port(run, port)), cwd=directory or None,
                         framework=_framework(pkg, body) or "node", script=script, port=port)
        # Скрипт жоқ, бірақ «main» сервер файлы бар
        main = pkg.get("main")
        if isinstance(main, str) and main.strip():
            target = f"{directory}/{main}".strip("/") if directory else main
            if target in files:
                if _is_node_server(_read(root, target)):
                    port = _free_port()
                    return _plan("server", _in_dir(directory, _with_port(f"node {main}", port)),
                                 cwd=directory or None, framework="node", port=port)
                return _plan("console", _in_dir(directory, f"node {main}"), cwd=directory or None, framework="node")
    return None


_NODE_SERVER_RE = re.compile(r"\.listen\s*\(|createServer\s*\(|require\(['\"]express['\"]\)|from\s+['\"]express['\"]|Bun\.serve|Deno\.serve")


def _is_node_server(code: str) -> bool:
    return bool(_NODE_SERVER_RE.search(code))


def _node_file_plan(root: str, files: List[str]) -> Optional[Dict[str, object]]:
    # Тек әдеттегі кіру файлдары — кездейсоқ кітапхана файлын сервер деп қабылдамау үшін
    preferred = ("server.js", "app.js", "index.js", "main.js", "server.mjs", "index.mjs", "server.cjs")
    for rel in (f for f in preferred if f in files):
        if _is_node_server(_read(root, rel)):
            port = _free_port()
            return _plan("server", _with_port(f"node {rel}", port), framework="node", entry=rel, port=port)
    return None


# ─── Python ───────────────────────────────────────────────────────────

def _py_module(rel: str) -> str:
    return rel[:-3].replace("/", ".")


def _python_plan(root: str, files: List[str]) -> Optional[Dict[str, object]]:
    py = [f for f in files if f.endswith(".py")]
    if not py:
        return None
    manage = next((f for f in py if _name(f) == "manage.py"), None)
    if manage:
        # Әдепкі 8000 порты сайттың өз бэкендімен соқтығысады — бос порт береміз
        port = _free_port()
        return _plan("server", _in_dir(_dir(manage), f"{PYTHON} manage.py runserver 127.0.0.1:{port}"),
                     cwd=_dir(manage) or None, framework="django", port=port)

    preferred = ("app.py", "main.py", "server.py", "run.py", "streamlit_app.py", "wsgi.py", "asgi.py")
    py.sort(key=lambda f: (f.count("/"), preferred.index(_name(f)) if _name(f) in preferred else len(preferred), f))
    for rel in py:
        code = _read(root, rel)
        directory, name = _dir(rel), _name(rel)
        if re.search(r"^\s*(import streamlit|from streamlit)", code, re.M):
            port = _free_port()
            return _plan("server", _in_dir(directory, f"{PYTHON} -m streamlit run {name} --server.headless true --server.port {port}"),
                         cwd=directory or None, framework="streamlit", entry=rel, port=port)
        if re.search(r"\bFastAPI\s*\(", code):
            port = _free_port()
            if re.search(r"uvicorn\.run\s*\(", code):
                command = _with_port(f"{PYTHON} {name}", port)
            else:
                match = re.search(r"^(\w+)\s*=\s*FastAPI\s*\(", code, re.M)
                command = f"{PYTHON} -m uvicorn {_py_module(name)}:{match.group(1) if match else 'app'} --reload --port {port}"
            return _plan("server", _in_dir(directory, command), cwd=directory or None, framework="fastapi", entry=rel, port=port)
        if re.search(r"\bFlask\s*\(", code):
            port = _free_port()
            command = (_with_port(f"{PYTHON} {name}", port) if re.search(r"\.run\s*\(", code)
                       else f"{PYTHON} -m flask --app {_py_module(name)} run --port {port}")
            return _plan("server", _in_dir(directory, command), cwd=directory or None, framework="flask", entry=rel, port=port)
        if re.search(r"^\s*(import gradio|from gradio)", code, re.M):
            port = _free_port()
            env = f"$env:GRADIO_SERVER_PORT={port}; " if IS_WINDOWS else f"GRADIO_SERVER_PORT={port} "
            return _plan("server", _in_dir(directory, f"{env}{PYTHON} {name}"), cwd=directory or None,
                         framework="gradio", entry=rel, port=port)
        if re.search(r"http\.server|socketserver\.TCPServer|HTTPServer\s*\(|aiohttp\.web\.run_app", code):
            return _plan("server", _in_dir(directory, f"{PYTHON} {name}"), cwd=directory or None, framework="python", entry=rel)
    return None


def _console_plan(files: List[str]) -> Optional[Dict[str, object]]:
    for names, runner in (
        (("main.py", "app.py", "run.py", "bot.py"), PYTHON),
        (("index.js", "main.js", "app.js", "bot.js"), "node"),
    ):
        for name in names:
            if name in files:
                return _plan("console", f"{runner} {name}", entry=name)
    if "main.go" in files or "go.mod" in files:
        return _plan("console", "go run .", entry="main.go")
    roots = [f for f in files if "/" not in f]
    for ext, runner in ((".py", PYTHON), (".js", "node"), (".mjs", "node"), (".ts", "npx tsx")):
        found = [f for f in roots if f.endswith(ext)]
        if len(found) == 1:
            return _plan("console", f"{runner} {found[0]}", entry=found[0])
    return None


# ─── Негізгі ──────────────────────────────────────────────────────────

def detect(root: str) -> Dict[str, object]:
    """Жоба папкасы бойынша іске қосу жоспары"""
    if not root or not os.path.isdir(root):
        return _plan("none")
    files = _walk(root)

    plan = _node_plan(root, files) or _python_plan(root, files) or _node_file_plan(root, files)
    if plan:
        return plan

    html = [f for f in files if re.search(r"\.html?$", f, re.I)]
    if html:
        entry = next((f for f in html if f.lower() == "index.html"), None) or html[0]
        return _plan("web", entry=entry)

    return _console_plan(files) or _plan("none")
