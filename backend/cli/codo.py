#!/usr/bin/env python3
"""codo — Codo Hub-қа жобаны терминалдан жүктеу.

Тек Python 3.8+ стандартты кітапханасы керек (ештеңе орнатпайды).

Git сияқты:
  1. Бір рет орнату:
       Windows:      curl.exe -fsSL https://<сервер>/api/cli/codo.py | python - install
       macOS/Linux:  curl -fsSL https://<сервер>/api/cli/codo.py | python3 - install
  2. Бір рет кіру:   codo login      (браузер ашылады — «Рұқсат беру» басасыз)
  3. Жоба папкасында:
       codo add .                      # өзгерістерді біріктіру
       codo commit -m "не өзгерді"     # коммит қалдыру
       codo push                       # сайтқа жіберу (бірінші рет — жоба жасалады, кейін — жаңарады)
     .codoignore — жүктелмейтін файлдар (.gitignore сияқты), бірінші add өзі жасайды.
     Жергілікті тарих .codo/ папкасында сақталады (.git сияқты).

Басқасы: codo status | codo log | codo whoami | codo logout | codo install (жаңарту) | codo uninstall

Кілтті CODO_TOKEN, сервер адресін CODO_API_URL айнымалысымен де беруге болады.
Сайт сияқты жұмыс істейді: кэш/қоқыс (node_modules, .git, venv…) пен .gitignore-дағы файлдар
жіберілмейді, құпия файлдарды (.env, кілттер) сервер қорғайды; тіл мен бағыт өзі анықталады.
Үлкен жоба ~24 МБ бөліктерге бөлінеді.
"""
import argparse
import hashlib
import json
import mimetypes
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

DEFAULT_API = "__CODO_API_URL__"
CODO_DIR = os.path.join(os.path.expanduser("~"), ".codo")
CONFIG_PATH = os.path.join(CODO_DIR, "config.json")
SCRIPT_PATH = os.path.join(CODO_DIR, "codo.py")
IGNORE_FILE = ".codoignore"
REPO_DIR = ".codo"  # жобадағы жергілікті тарих (.git сияқты)
IGNORE_TEMPLATE = """# .codoignore — Codo Hub-қа жүктелмейтін файлдар (.gitignore сияқты жазылады)
# node_modules, .git, venv, __pycache__, build т.б. және .gitignore-дағылар бәрібір жүктелмейді.
#
# Мысалдар:
#   uploads/        — папка
#   *.log           — кеңейтім бойынша
#   data/*.csv      — жоба түбірінен бастап
#   !important.log  — ережеден шығару
"""

# frontend/src/hooks/useFileUpload.ts-пен бірдей шектер
BATCH_BYTES = 24 * 1024 * 1024
BATCH_FILES = 1000
BATCH_RETRIES = 2

# Қоқыс ережелері — backend/utils/upload_rules.py-дан: скрипт серверден жүктелгенде
# routes/cli.py оларды осы жолға JSON ретінде жазады (бір көз — екі жерде тізім жүргізбейміз).
# Төмендегі әдепкі мәндер — тек репозиторийдегі файлды тікелей іске қосқанда
_RULES_JSON = "__CODO_RULES__"
JUNK_DIRS = {
    "node_modules", "bower_components", "jspm_packages",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".nox", ".ipynb_checkpoints",
    ".venv", "venv", ".git", ".svn", ".hg",
    ".next", ".nuxt", ".svelte-kit", ".angular", ".expo", ".parcel-cache", ".turbo", ".vercel",
    ".cache", ".gradle", ".dart_tool", ".idea", "coverage", ".nyc_output",
    "dist", "build", "out", "target", "obj", ".output",
    "vendor", "site-packages", ".eggs", ".pnpm-store", ".yarn", "pods", "deriveddata",
    ".vs", ".vscode", ".terraform", ".serverless", ".docusaurus", ".sass-cache",
    "htmlcov", ".hypothesis", "__macosx", ".codo",
}
JUNK_DIR_SUFFIXES = (".egg-info", ".dist-info")
JUNK_FILES = {".ds_store", "thumbs.db", "desktop.ini", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
JUNK_EXTENSIONS = {".pyc", ".pyo", ".log", ".tmp", ".bak", ".swp", ".map", ".zip", ".mp4", ".pdf"}
JUNK_NAME_SUFFIXES = (".min.js", ".min.css", ".bundle.js", ".chunk.js")
EXECUTABLE_EXTENSIONS = {".exe", ".dll", ".msi", ".apk", ".so", ".dylib", ".jar"}
if not _RULES_JSON.startswith("__"):
    _rules = json.loads(_RULES_JSON)
    JUNK_DIRS = set(_rules["junkDirs"])
    JUNK_DIR_SUFFIXES = tuple(_rules["junkDirSuffixes"])
    JUNK_FILES = set(_rules["junkFiles"])
    JUNK_EXTENSIONS = set(_rules["junkExtensions"])
    JUNK_NAME_SUFFIXES = tuple(_rules["junkNameSuffixes"])
    EXECUTABLE_EXTENSIONS = set(_rules["executableExtensions"])
# .gitignore-да тұрса да жүктелетін (сервер қорғайтын) файлдар — upload_rules.py SECRET/DATABASE
_PROTECTED_FILES = {
    ".env", ".htpasswd", ".npmrc", ".pypirc", ".netrc", ".git-credentials",
    "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
    "serviceaccountkey.json", "credentials.json", "client_secret.json",
}
_PROTECTED_EXTENSIONS = {".pem", ".key", ".p12", ".pfx", ".keystore", ".jks", ".kdbx", ".db", ".sqlite", ".sqlite3", ".db3"}

# frontend/src/utils/fileHandler.ts detectLanguage / isImageFile — файлдың өз language өрісі
FILE_LANGUAGES = {
    ".js": "javascript", ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript",
    ".py": "python", ".java": "java", ".cpp": "cpp", ".c": "c", ".h": "c",
    ".html": "html", ".css": "css", ".json": "json", ".md": "markdown",
}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".ico"}

# frontend/src/utils/projectSource.ts LANGUAGE_BY_EXT — жобаның тілдері (сайттағы жүктеудей)
PROJECT_LANGUAGES = {
    "ts": "TypeScript", "tsx": "TypeScript", "mts": "TypeScript", "cts": "TypeScript",
    "js": "JavaScript", "jsx": "JavaScript", "mjs": "JavaScript", "cjs": "JavaScript",
    "vue": "JavaScript", "svelte": "JavaScript",
    "py": "Python", "ipynb": "Python", "java": "Java", "kt": "Kotlin", "kts": "Kotlin",
    "swift": "Swift", "dart": "Dart",
    "c": "C", "h": "C", "cpp": "C++", "cc": "C++", "cxx": "C++", "hpp": "C++", "hh": "C++", "cs": "C#",
    "go": "Go", "rs": "Rust", "php": "PHP", "rb": "Ruby", "r": "R", "m": "MATLAB",
    "html": "HTML", "htm": "HTML", "css": "CSS", "scss": "CSS", "sass": "CSS", "less": "CSS",
    "json": "JSON", "xml": "XML", "yml": "YAML", "yaml": "YAML", "md": "Markdown",
    "sh": "Shell", "bash": "Shell", "zsh": "Shell", "ps1": "Shell", "sql": "SQL",
}
SUPPORTING_LANGUAGES = {"JSON", "XML", "YAML", "Markdown"}


class CodoError(Exception):
    pass


# ---------- Баптау ----------

def load_config() -> dict:
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_config(config: dict) -> None:
    os.makedirs(CODO_DIR, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    try:
        os.chmod(CONFIG_PATH, 0o600)  # кілтті басқа қолданушылар оқымауы үшін
    except OSError:
        pass


def resolve_api(args) -> str:
    api = (getattr(args, "api", None) or os.environ.get("CODO_API_URL")
           or load_config().get("api") or DEFAULT_API)
    if api.startswith("__"):
        raise CodoError("Сервер адресі белгісіз: --api https://<сервер>/api беріңіз")
    return api.rstrip("/")


def resolve_auth(args) -> tuple:
    """(api, token, me) — me: /cli/whoami жауабы (username, site)"""
    api = resolve_api(args)
    token = getattr(args, "token", None)
    if token:
        return api, token, _save_login(api, token)
    token = os.environ.get("CODO_TOKEN") or load_config().get("token")
    if not token:
        print("Әлі кірмегенсіз — алдымен аккаунтқа кіреміз.")
        token = browser_login(api)
    return api, token, _request(f"{api}/cli/whoami", token)


def browser_login(api: str) -> str:
    """GitHub CLI сияқты: браузерде сайт ашылады, «Рұқсат беру» басылғанша күтеміз"""
    device = (platform.node() or "terminal")[:60]
    start = _request(f"{api}/cli/login/start", body={"deviceName": device}, method="POST")
    print(f"\n  Код: {start['code']}")
    print(f"  Браузерде ашыңыз: {start['url']}\n")
    try:
        import webbrowser
        webbrowser.open(start["url"])
    except Exception:
        pass
    print("Сайтта «Рұқсат беру» басуыңызды күтіп тұрмын…", flush=True)
    deadline = time.time() + int(start.get("expiresIn") or 600)
    while time.time() < deadline:
        time.sleep(2)
        res = _request(f"{api}/cli/login/poll", body={"secret": start["secret"]}, method="POST")
        if res.get("status") == "approved":
            save_config({"api": api, "token": res["token"]})
            print(f"Кірдіңіз: {res.get('username')}")
            return res["token"]
        if res.get("status") == "expired":
            break
    raise CodoError("Уақыт өтіп кетті — codo login-ды қайта іске қосыңыз")


def _save_login(api: str, token: str) -> dict:
    if not token.startswith("codo_"):
        raise CodoError("Кілт «codo_» деп басталуы керек")
    me = _request(f"{api}/cli/whoami", token)
    save_config({"api": api, "token": token})
    return me


# ---------- HTTP ----------

def _request(url: str, token: str = None, body=None, content_type: str = None, method: str = None):
    headers = {"Accept": "application/json", "User-Agent": "codo-cli/1"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if isinstance(body, dict):
        body, content_type = json.dumps(body).encode("utf-8"), "application/json"
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return json.loads(resp.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8")).get("detail")
        except Exception:
            detail = None
        err = CodoError(f"{e.code}: {detail or e.reason}")
        err.status = e.code
        raise err
    except urllib.error.URLError as e:
        err = CodoError(f"Серверге қосылу мүмкін болмады: {e.reason}")
        err.status = 0
        raise err


def _multipart(manifest: dict, files: list) -> tuple:
    """manifest JSON + шикі файлдар (manifest.files ретімен) — сайттың формасымен бірдей"""
    boundary = "codo" + uuid.uuid4().hex
    parts = []
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n'
        f"Content-Type: application/json\r\n\r\n".encode("utf-8")
        + json.dumps(manifest, ensure_ascii=False).encode("utf-8") + b"\r\n"
    )
    for item in files:
        with open(item["abs"], "rb") as f:
            data = f.read()
        filename = item["path"].replace('"', "%22")
        mime = mimetypes.guess_type(item["name"])[0] or "application/octet-stream"
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{filename}"\r\n'
            f"Content-Type: {mime}\r\n\r\n".encode("utf-8") + data + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def _send_with_retry(url: str, token: str, manifest: dict, files: list):
    body, content_type = _multipart(manifest, files)
    for attempt in range(BATCH_RETRIES + 1):
        try:
            return _request(url, token, body, content_type, method="POST")
        except CodoError as e:
            status = getattr(e, "status", 0)
            # Желі үзілсе немесе сервер 5xx берсе — қайталаймыз (сервер қайталанған жолдарды өткізеді)
            if attempt >= BATCH_RETRIES or (status != 0 and status < 500):
                raise
            time.sleep(attempt + 1)


# ---------- Жобаны жинау ----------

def _ext(name: str) -> str:
    dot = name.rfind(".")
    return name[dot:].lower() if dot > 0 else ""


def _is_junk_dir(name: str) -> bool:
    name = name.lower()
    return name in JUNK_DIRS or name.endswith(JUNK_DIR_SUFFIXES)


def _is_junk_file(name: str) -> bool:
    """Кэш, lock-файл, медиа, архив, .exe т.б. — серверге мүлде жіберілмейді (upload_rules.py)"""
    name = name.lower()
    ext = _ext(name)
    return (name in JUNK_FILES or ext in JUNK_EXTENSIONS or ext in EXECUTABLE_EXTENSIONS
            or name.endswith(JUNK_NAME_SUFFIXES))


def _is_protected(name: str) -> bool:
    name = name.lower()
    if name in _PROTECTED_FILES or _ext(name) in _PROTECTED_EXTENSIONS:
        return True
    return name.startswith(".env.") and name[5:] not in {"example", "sample", "template", "dist", "defaults"}


def _glob_regex(pattern: str) -> str:
    """.gitignore үлгісі → regex (**, *, ?, [..])"""
    out, i = "", 0
    while i < len(pattern):
        c = pattern[i]
        if pattern.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif pattern.startswith("**", i):
            out, i = out + ".*", i + 2
        elif c == "*":
            out, i = out + "[^/]*", i + 1
        elif c == "?":
            out, i = out + "[^/]", i + 1
        elif c == "[":
            end = pattern.find("]", i + 1)
            if end == -1:
                out, i = out + re.escape(c), i + 1
            else:
                out, i = out + pattern[i:end + 1], end + 1
        else:
            out, i = out + re.escape(c), i + 1
    return out


def load_ignore_rules(root: str) -> list:
    """.codoignore ережелері: [(regex, теріске шығару, тек папка)] — .gitignore сияқты"""
    try:
        with open(os.path.join(root, IGNORE_FILE), encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return []
    rules = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        negate = line.startswith("!")
        if negate:
            line = line[1:]
        dir_only = line.endswith("/")
        line = line.rstrip("/")
        if not line:
            continue
        # Ішінде «/» болса — түбірден бастап, әйтпесе кез келген деңгейдегі атқа сәйкес келеді
        anchored = "/" in line
        body = _glob_regex(line.lstrip("/"))
        regex = re.compile(("^" if anchored else "^(?:.*/)?") + body + "$")
        rules.append((regex, negate, dir_only))
    return rules


def is_ignored(rules: list, rel: str, is_dir: bool) -> bool:
    ignored = False
    for regex, negate, dir_only in rules:
        if dir_only and not is_dir:
            continue
        if regex.match(rel):
            ignored = not negate
    return ignored


def _git_ignored(root: str) -> tuple:
    """.gitignore бойынша өткізілетіндер: (файлдар, папкалар) — root-қа қатысты жолдар.
    git жоқ немесе бұл репозиторий емес болса — бос (тек қоқыс ережелері қолданылады)"""
    try:
        out = subprocess.run(
            ["git", "-C", root, "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
            capture_output=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return set(), ()
    if out.returncode != 0:
        return set(), ()
    entries = [p for p in out.stdout.decode("utf-8", "replace").split("\0") if p]
    dirs = tuple(p for p in entries if p.endswith("/"))
    return {p for p in entries if not p.endswith("/")}, dirs


def collect_project(root: str) -> tuple:
    """Папканы аралап, сайттағыдай манифест құрады: (folder_name, structure, files, skipped).
    skipped — өткізілгендер {атау: саны}: тек жобаның өз коды жүктеледі"""
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        raise CodoError(f"Папка табылмады: {root}")
    folder_name = os.path.basename(root.rstrip("\\/")) or "project"
    ignored_files, ignored_dirs = _git_ignored(root)
    rules = load_ignore_rules(root)
    structure = {}
    files = []
    skipped = {}

    def skip(label: str) -> None:
        skipped[label] = skipped.get(label, 0) + 1

    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
        rel_prefix = "" if rel_dir == "." else f"{rel_dir}/"
        kept_dirs = []
        for d in sorted(dirnames):
            if _is_junk_dir(d):
                skip(f"{d}/")
                continue
            if os.path.islink(os.path.join(dirpath, d)):
                continue
            # .gitignore-дағы папканың ішіндегісі жобаның бөлігі емес (сайттағыдай — қорғалған болса да)
            if f"{rel_prefix}{d}/" in ignored_dirs or is_ignored(rules, f"{rel_prefix}{d}", True):
                skip(f"{d}/")
                continue
            kept_dirs.append(d)
        dirnames[:] = kept_dirs
        prefix = folder_name if rel_dir == "." else f"{folder_name}/{rel_dir}"
        for name in sorted(filenames):
            abs_path = os.path.join(dirpath, name)
            if os.path.islink(abs_path) or not os.path.isfile(abs_path):
                continue
            # .codoignore — codo-ның өз баптауы, жобаның коды емес
            if rel_dir == "." and name == IGNORE_FILE:
                continue
            if _is_junk_file(name):
                skip(f"*{_ext(name)}" if _ext(name) and name.lower() not in JUNK_FILES else name)
                continue
            if f"{rel_prefix}{name}" in ignored_files and not _is_protected(name):
                skip(".gitignore")
                continue
            # .codoignore-ды қолданушы өзі жазған — құпия файлдарға да қолданылады
            if is_ignored(rules, f"{rel_prefix}{name}", False):
                skip(IGNORE_FILE)
                continue
            path = f"{prefix}/{name}"
            parts = path.split("/")
            current = ""
            for part in parts[:-1]:
                current = f"{current}/{part}" if current else part
                structure.setdefault(current, {"type": "folder", "name": part})
            size = os.path.getsize(abs_path)
            language = FILE_LANGUAGES.get(_ext(name), "other")
            structure[path] = {"type": "file", "name": name, "size": size, "language": language}
            files.append({
                "abs": abs_path, "path": path, "inner": f"{rel_prefix}{name}", "name": name,
                "language": language, "isImage": _ext(name) in IMAGE_EXTENSIONS, "size": size,
            })
    if not files:
        raise CodoError("Папкада жүктейтін файл жоқ (бәрі қоқыс/кэш немесе ignore-да)")
    return folder_name, structure, files, skipped


def _skipped_summary(skipped: dict) -> str:
    top = sorted(skipped.items(), key=lambda item: -item[1])[:8]
    rest = len(skipped) - len(top)
    return ", ".join(name for name, _ in top) + (f" +{rest}" if rest > 0 else "")


def detect_languages(files: list) -> list:
    """UploadModal.detectLanguages: үлесі ≥5% код тілдері (конфиг/құжатсыз), көп дегенде 5"""
    sizes = {}
    for f in files:
        if f["isImage"]:
            continue
        dot = f["name"].rfind(".")
        lang = PROJECT_LANGUAGES.get(f["name"][dot + 1:].lower()) if dot > 0 else None
        if lang:
            sizes[lang] = sizes.get(lang, 0) + f["size"]
    ranked = sorted(sizes.items(), key=lambda item: -item[1])
    code = [(name, size) for name, size in ranked if name not in SUPPORTING_LANGUAGES]
    total = sum(size for _, size in code) or 1
    picked = [name for i, (name, size) in enumerate(code) if i == 0 or size / total >= 0.05][:5]
    return picked or [name for name, _ in ranked[:1]] or ["Other"]


def suggest_categories(files: list, languages: list) -> list:
    """UploadModal.suggestCategories: файлдарға қарап бағыт ұсыну, көп дегенде 3; табылмаса — other"""
    langs = set(languages)
    paths = [f["inner"].lower() for f in files]
    has = lambda test: any(test(p) for p in paths)  # noqa: E731
    out = []
    if "Swift" in langs:
        out.append("ios-app")
    if has(lambda p: p.endswith("androidmanifest.xml")):
        out.append("android-app")
    if "Dart" in langs or has(lambda p: p.endswith("pubspec.yaml")):
        out.append("cross-platform-app")
    if has(lambda p: p.endswith(".ipynb")):
        out.append("machine-learning")
    if langs & {"HTML", "CSS"} or has(lambda p: p.endswith((".tsx", ".jsx", ".vue", ".svelte"))):
        out.append("web-app")
    if has(lambda p: any(f"{d}/" in f"/{p}" for d in ("/routes", "/api", "/controllers", "/endpoints"))):
        out.append("api")
    if "SQL" in langs or has(lambda p: "/migrations/" in f"/{p}"):
        out.append("database")
    return list(dict.fromkeys(out))[:3] or ["other"]


def split_batches(files: list) -> list:
    batches, current, size = [], [], 0
    for item in files:
        if current and (size + item["size"] > BATCH_BYTES or len(current) >= BATCH_FILES):
            batches.append(current)
            current, size = [], 0
        current.append(item)
        size += item["size"]
    if current:
        batches.append(current)
    return batches


def _entry(item: dict) -> dict:
    return {k: item[k] for k in ("path", "name", "language", "isImage", "size")}


def _human(size: float) -> str:
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if size < 1024 or unit == "ГБ":
            return f"{size:.0f} {unit}" if unit == "Б" else f"{size:.1f} {unit}"
        size /= 1024


# ---------- Орнату ----------

def _path_dirs() -> list:
    return [os.path.normcase(os.path.abspath(p)) for p in os.environ.get("PATH", "").split(os.pathsep) if p]


def _install_windows(script: str) -> tuple:
    """codo.cmd: PATH-та бұрыннан бар WindowsApps-қа (ашық терминалда бірден жұмыс істейді),
    болмаса ~/.codo/bin + қолданушының PATH-ына қосу. Қайтарады: (жол, жаңа терминал керек пе)"""
    wrapper = f'@echo off\r\n"{sys.executable}" "{script}" %*\r\n'
    apps = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WindowsApps")
    if os.path.isdir(apps) and os.path.normcase(os.path.abspath(apps)) in _path_dirs():
        target = os.path.join(apps, "codo.cmd")
        try:
            with open(target, "w", encoding="utf-8", newline="") as f:
                f.write(wrapper)
            return target, False
        except OSError:
            pass
    bin_dir = os.path.join(CODO_DIR, "bin")
    os.makedirs(bin_dir, exist_ok=True)
    target = os.path.join(bin_dir, "codo.cmd")
    with open(target, "w", encoding="utf-8", newline="") as f:
        f.write(wrapper)
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
        try:
            current, kind = winreg.QueryValueEx(key, "Path")
        except FileNotFoundError:
            current, kind = "", winreg.REG_EXPAND_SZ
        entries = [p for p in current.split(";") if p]
        if not any(os.path.normcase(p) == os.path.normcase(bin_dir) for p in entries):
            winreg.SetValueEx(key, "Path", 0, kind, ";".join(entries + [bin_dir]))
            try:  # жаңа терминалдар PATH-ты бірден көруі үшін
                import ctypes
                ctypes.windll.user32.SendMessageTimeoutW(0xFFFF, 0x1A, 0, "Environment", 2, 5000, None)
            except Exception:
                pass
    return target, True


def _install_unix(script: str) -> tuple:
    """codo: PATH-тағы ~/.local/bin, ~/bin немесе /usr/local/bin-ге; ешқайсысы болмаса
    ~/.local/bin құрып, shell баптауына PATH қосамыз"""
    wrapper = f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n'
    home = os.path.expanduser("~")
    candidates = [os.path.join(home, ".local", "bin"), os.path.join(home, "bin"), "/usr/local/bin"]
    in_path = _path_dirs()
    chosen = next((d for d in candidates if os.path.normcase(d) in in_path
                   and (os.access(d, os.W_OK) or (not os.path.exists(d) and d.startswith(home)))), None)
    needs_new_shell = chosen is None
    bin_dir = chosen or candidates[0]
    os.makedirs(bin_dir, exist_ok=True)
    target = os.path.join(bin_dir, "codo")
    with open(target, "w", encoding="utf-8") as f:
        f.write(wrapper)
    os.chmod(target, 0o755)
    if needs_new_shell:
        line = '\nexport PATH="$HOME/.local/bin:$PATH"  # codo\n'
        for rc in (".zshrc", ".bashrc", ".profile"):
            rc_path = os.path.join(home, rc)
            if rc == ".profile" or os.path.exists(rc_path):
                try:
                    with open(rc_path, "a+", encoding="utf-8") as f:
                        f.seek(0)
                        if "# codo" not in f.read():
                            f.write(line)
                except OSError:
                    pass
    return target, needs_new_shell


def cmd_install(args) -> None:
    api = resolve_api(args)
    if args.token:
        _save_login(api, args.token)
    else:
        config = load_config()
        config["api"] = api
        save_config(config)
    # Құбыр арқылы (python -) іске қосылғанда файл жоқ — скриптті серверден қайта аламыз
    with urllib.request.urlopen(f"{api}/cli/codo.py", timeout=60) as resp:
        source = resp.read()
    os.makedirs(CODO_DIR, exist_ok=True)
    with open(SCRIPT_PATH, "wb") as f:
        f.write(source)
    target, needs_new_shell = (_install_windows if os.name == "nt" else _install_unix)(SCRIPT_PATH)
    print(f"Орнатылды: {target}")
    if needs_new_shell:
        print("Жаңа терминал ашыңыз.")
    logged_in = bool(os.environ.get("CODO_TOKEN") or load_config().get("token"))
    print("Дайын. Жоба папкасында:" if logged_in else "Келесі қадам:")
    if not logged_in:
        print("  codo login                    — аккаунтқа кіру (бір рет, браузер ашылады)")
    print("  codo add .                    — өзгерістерді біріктіру")
    print('  codo commit -m "не өзгерді"   — коммит қалдыру')
    print("  codo push                     — сайтқа жіберу")


# ---------- Жергілікті репозиторий (.codo/ — git-тің .git-і сияқты) ----------
#
# .codo/repo.json     — {projectId, title, description}: сайттағы жоба (бірінші push-тан кейін)
# .codo/index.json    — {жол: {sha, size}}: codo add біріктірген күй (staging)
# .codo/commits.json  — [{id, message, time, tree, pushed}]: коммиттер
# .codo/objects/<sha> — файлдардың add сәтіндегі көшірмесі (push осыларды жібереді)

def find_repo(start: str = ".") -> str:
    """Ағымдағы немесе жоғарғы папкалардағы codo репозиторийі (git сияқты), табылмаса — ""."""
    current = os.path.abspath(start)
    while True:
        if os.path.isfile(os.path.join(current, REPO_DIR, "repo.json")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return ""
        current = parent


def init_repo(root: str) -> None:
    if os.path.normcase(os.path.abspath(root)) == os.path.normcase(os.path.expanduser("~")):
        raise CodoError("Үй папкасында емес — жоба папкасына барып (cd), сол жерде іске қосыңыз")
    os.makedirs(os.path.join(root, REPO_DIR, "objects"), exist_ok=True)
    _write_json(os.path.join(root, REPO_DIR, "repo.json"), {})
    if ensure_ignore_file(root):
        print(f"{IGNORE_FILE} жасалды — жүктелмейтін файлдарды соған жаза аласыз")


def require_repo() -> str:
    root = find_repo()
    if not root:
        raise CodoError("Бұл папкада codo жобасы жоқ. Алдымен: codo add .")
    return root


def _read_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write_json(path: str, data) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _repo_path(root: str, name: str) -> str:
    return os.path.join(root, REPO_DIR, name)


def _head_tree(commits: list) -> dict:
    return commits[-1]["tree"] if commits else {}


def _diff(old: dict, new: dict) -> tuple:
    """(жаңа, өзгерген, өшірілген) жолдар тізімі"""
    added = sorted(p for p in new if p not in old)
    changed = sorted(p for p in new if p in old and old[p]["sha"] != new[p]["sha"])
    removed = sorted(p for p in old if p not in new)
    return added, changed, removed


def _hash_file(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _worktree(root: str) -> tuple:
    """Жұмыс папкасының қазіргі күйі (қоқыс/ignore сүзілген): ({жол: {sha, size}}, {жол: abs}, skipped)"""
    try:
        _name, _structure, files, skipped = collect_project(root)
    except CodoError:
        return {}, {}, {}
    tree = {f["inner"]: {"sha": _hash_file(f["abs"]), "size": f["size"]} for f in files}
    return tree, {f["inner"]: f["abs"] for f in files}, skipped


def _in_scope(path: str, scopes: list) -> bool:
    return any(s == "" or path == s or path.startswith(s + "/") for s in scopes)


def _print_diff(added: list, changed: list, removed: list, indent: str = "  ") -> None:
    for p in added:
        print(f"{indent}+ {p}")
    for p in changed:
        print(f"{indent}~ {p}")
    for p in removed:
        print(f"{indent}- {p}")


def _summary(added: list, changed: list, removed: list) -> str:
    return f"+{len(added)} жаңа, ~{len(changed)} өзгерген, -{len(removed)} өшірілген"


# ---------- Командалар ----------

def cmd_login(args) -> None:
    api = resolve_api(args)
    if args.token:
        me = _save_login(api, args.token)
        print(f"Кірдіңіз: {me.get('username')}")
        return
    browser_login(api)


def ensure_ignore_file(root: str) -> bool:
    """Жобада .codoignore жоқ болса — үлгісін жасайды. True — жаңадан жасалды"""
    target = os.path.join(os.path.abspath(root), IGNORE_FILE)
    if os.path.exists(target):
        return False
    try:
        with open(target, "w", encoding="utf-8") as f:
            f.write(IGNORE_TEMPLATE)
    except OSError:
        return False  # тек оқуға арналған папка — .codoignore-сыз жалғастырамыз
    return True


def cmd_init(args) -> None:
    root = os.path.abspath(".")
    if find_repo(root) == root:
        print(f"codo жобасы бұрыннан бар: {root}")
        return
    init_repo(root)
    print(f"codo жобасы жасалды: {root}\nКелесі қадам: codo add .")


def cmd_add(args) -> None:
    """git add сияқты: файлдарды біріктіреді (коммитке дайындайды)"""
    root = find_repo()
    if not root:
        root = os.path.abspath(".")
        init_repo(root)
    scopes = []
    for p in args.paths or ["."]:
        rel = os.path.relpath(os.path.abspath(p), root).replace("\\", "/")
        if rel.startswith(".."):
            raise CodoError(f"Жобадан тыс жол: {p}")
        scopes.append("" if rel == "." else rel.rstrip("/"))

    worktree, abs_paths, skipped = _worktree(root)
    index = _read_json(_repo_path(root, "index.json"), {})
    new_index = {p: v for p, v in index.items() if not _in_scope(p, scopes)}
    objects = _repo_path(root, "objects")
    os.makedirs(objects, exist_ok=True)
    for path, meta in worktree.items():
        if not _in_scope(path, scopes):
            continue
        obj = os.path.join(objects, meta["sha"])
        if not os.path.exists(obj):
            shutil.copyfile(abs_paths[path], obj)
        new_index[path] = meta
    _write_json(_repo_path(root, "index.json"), new_index)

    added, changed, removed = _diff(index, new_index)
    if not (added or changed or removed):
        print("Жаңа өзгеріс жоқ — бәрі бұрыннан біріктірілген")
    else:
        _print_diff(added, changed, removed)
        print(f"Біріктірілді: {_summary(added, changed, removed)}")
        print('Келесі қадам: codo commit -m "не өзгергенін жазыңыз"')
    if skipped:
        print(f"  Жүктелмейді: {_skipped_summary(skipped)}")


def cmd_commit(args) -> None:
    """git commit сияқты: біріктірілген күйді хабарламамен сақтайды"""
    root = require_repo()
    message = (args.message or "").strip()
    if not message:
        raise CodoError('Хабарлама жазыңыз: codo commit -m "не өзгерді"')
    index = _read_json(_repo_path(root, "index.json"), {})
    commits = _read_json(_repo_path(root, "commits.json"), [])
    added, changed, removed = _diff(_head_tree(commits), index)
    if not (added or changed or removed):
        raise CodoError("Коммитке өзгеріс жоқ. Алдымен файлдарды біріктіріңіз: codo add .")
    if not index:
        raise CodoError("Жобада бірде-бір файл қалмайды — коммит жасалмады")
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    commit_id = hashlib.sha1(json.dumps([message, now, index], sort_keys=True).encode("utf-8")).hexdigest()[:10]
    commits.append({
        "id": commit_id, "message": message, "time": now, "tree": index,
        "added": len(added), "changed": len(changed), "removed": len(removed), "pushed": False,
    })
    _write_json(_repo_path(root, "commits.json"), commits)
    print(f"[{commit_id[:7]}] {message}")
    print(f"  {_summary(added, changed, removed)}")
    print("Келесі қадам: codo push — сайтқа жіберу")


def cmd_status(args) -> None:
    root = find_repo()
    if not root:
        print("Бұл папкада codo жобасы жоқ. Бастау үшін:")
        print('  codo add .\n  codo commit -m "алғашқы нұсқа"\n  codo push')
        return
    index = _read_json(_repo_path(root, "index.json"), {})
    commits = _read_json(_repo_path(root, "commits.json"), [])
    staged = _diff(_head_tree(commits), index)
    worktree, _abs, _skipped = _worktree(root)
    unstaged = _diff(index, worktree)
    unpushed = [c for c in commits if not c.get("pushed")]
    project_id = _read_json(_repo_path(root, "repo.json"), {}).get("projectId")

    print(f"Жоба: {os.path.basename(root)}" + ("" if project_id else "  (сайтқа әлі жіберілмеген)"))
    if any(staged):
        print("\nКоммитке дайын (codo commit -m \"...\"):")
        _print_diff(*staged, indent="    ")
    if any(unstaged):
        print("\nБіріктірілмеген өзгерістер (codo add .):")
        _print_diff(*unstaged, indent="    ")
    if unpushed:
        print(f"\nСайтқа жіберілмеген коммит: {len(unpushed)} (codo push)")
    if not any(staged) and not any(unstaged) and not unpushed:
        print("Бәрі сайтта — жаңа өзгеріс жоқ")


def cmd_log(args) -> None:
    root = require_repo()
    commits = _read_json(_repo_path(root, "commits.json"), [])
    if not commits:
        print("Коммит әлі жоқ")
        return
    for c in reversed(commits):
        mark = "✓" if c.get("pushed") else "·"
        print(f"{mark} {c['id'][:7]}  {c['time'].replace('T', ' ')}  {c['message']}"
              f"  (+{c.get('added', 0)} ~{c.get('changed', 0)} -{c.get('removed', 0)})")
    print("\n✓ — сайтқа жіберілген, · — жіберілмеген (codo push)")


def cmd_logout(args) -> None:
    config = load_config()
    config.pop("token", None)
    save_config(config)
    print("Кілт осы компьютерден өшірілді. Оны толық жою үшін: Баптаулар → Терминал")


def cmd_whoami(args) -> None:
    api, _token, me = resolve_auth(args)
    print(f"{me.get('username')}  ({api})")


def _tree_files(root: str, tree: dict, folder_name: str) -> list:
    """Коммиттегі файлдар — жұмыс папкасынан емес, add сәтіндегі көшірмелерден (.codo/objects)"""
    objects = _repo_path(root, "objects")
    files = []
    for inner in sorted(tree):
        meta = tree[inner]
        name = inner.rsplit("/", 1)[-1]
        obj = os.path.join(objects, meta["sha"])
        if not os.path.exists(obj):
            raise CodoError(f"Коммит файлы табылмады: {inner} — codo add . && codo commit қайта жасаңыз")
        files.append({
            "abs": obj, "path": f"{folder_name}/{inner}", "inner": inner, "name": name,
            "language": FILE_LANGUAGES.get(_ext(name), "other"),
            "isImage": _ext(name) in IMAGE_EXTENSIONS, "size": meta["size"],
        })
    return files


def _structure(files: list) -> dict:
    structure = {}
    for f in files:
        parts = f["path"].split("/")
        current = ""
        for part in parts[:-1]:
            current = f"{current}/{part}" if current else part
            structure.setdefault(current, {"type": "folder", "name": part})
        structure[f["path"]] = {"type": "file", "name": f["name"], "size": f["size"], "language": f["language"]}
    return structure


def _upload_batches(api: str, token: str, first_url: str, first_manifest: dict, files: list, folder_id: str = "") -> dict:
    """Бөліктеп жіберу: бірінші бөлік first_url-ға, қалғаны /codes/{id}/files-ке"""
    batches = split_batches(files) or [[]]
    totals = {"created": 0, "failed": 0, "protected": 0, "failedFiles": []}
    done = 0
    for index, batch in enumerate(batches):
        entries = [_entry(f) for f in batch]
        try:
            if index == 0:
                res = _send_with_retry(first_url, token, {**first_manifest, "files": entries}, batch)
                folder_id = res.get("folderId") or (res.get("folder") or {}).get("id") or folder_id
            else:
                res = _send_with_retry(f"{api}/codes/{folder_id}/files", token, {"files": entries}, batch)
        except CodoError as e:
            if index == 0:
                raise
            print(f"\n  {index + 1}-бөлік өтпеді: {e}", file=sys.stderr)
            totals["failed"] += len(batch)
            totals["failedFiles"] += [f["path"] for f in batch]
            res = {}
        for key in ("created", "failed", "protected"):
            totals[key] += res.get(key) or 0
        totals["failedFiles"] += res.get("failedFiles") or []
        done += len(batch)
        if files:
            print(f"\r  Жіберілуде… {done}/{len(files)}", end="", flush=True)
    if files:
        print()
    totals["folderId"] = folder_id
    return totals


def cmd_push(args) -> None:
    """git push сияқты: жіберілмеген коммиттерді сайтқа жібереді.
    Бірінші push жоба жасайды, кейінгілері сол жобаны жаңартады (тек өзгерген файлдар жіберіледі)"""
    root = require_repo()
    commits = _read_json(_repo_path(root, "commits.json"), [])
    unpushed = [c for c in commits if not c.get("pushed")]
    if not commits:
        raise CodoError('Коммит жоқ. Алдымен: codo add .  сосын  codo commit -m "алғашқы нұсқа"')
    index = _read_json(_repo_path(root, "index.json"), {})
    if any(_diff(_head_tree(commits), index)):
        print('Ескерту: біріктірілген, бірақ коммиттелмеген өзгерістер бар — олар жіберілмейді (codo commit -m "...")')
    if not unpushed:
        print("Жіберілмеген коммит жоқ — сайттағы жоба соңғы коммитпен бірдей")
        return

    repo = _read_json(_repo_path(root, "repo.json"), {})
    api, token, me = resolve_auth(args)
    latest = unpushed[-1]
    pushed = [c for c in commits if c.get("pushed")]
    base = pushed[-1]["tree"] if pushed and repo.get("projectId") else None
    folder_name = os.path.basename(root) or "project"
    files = _tree_files(root, latest["tree"], folder_name)
    structure = _structure(files)
    added, changed, removed = _diff(base or {}, latest["tree"])
    message = latest["message"] if len(unpushed) == 1 else f"{latest['message']} (+{len(unpushed) - 1} коммит)"
    commit_info = {"id": latest["id"], "message": message,
                   "added": len(added), "changed": len(changed), "removed": len(removed)}
    print(f"Жіберілуде: {len(unpushed)} коммит · {_summary(added, changed, removed)}")

    started = time.time()
    result = None
    if base is not None:
        # Бар жобаны жаңарту: тек жаңа/өзгерген файлдар жіберіледі
        upload = [f for f in files if f["inner"] in set(added) | set(changed)]
        manifest = {
            "paths": [f["path"] for f in files],
            "replace": [f"{folder_name}/{p}" for p in changed],
            "structure": structure,
            "commit": commit_info,
        }
        try:
            result = _upload_batches(api, token, f"{api}/codes/{repo['projectId']}/commit", manifest, upload,
                                     repo["projectId"])
        except CodoError as e:
            if getattr(e, "status", 0) != 404:
                raise
            print("Сайттағы жоба өшірілген — жаңасы жасалады")
    if result is None:
        languages = detect_languages(files)
        categories = suggest_categories(files, languages)
        tags = ["folder", *(f"category:{c}" for c in categories), *(f"lang:{lang}" for lang in languages[1:])]
        tags += [t.strip() for t in (args.tags or "").split(",") if t.strip()]
        manifest = {
            "folderName": folder_name,
            "title": args.title or repo.get("title") or folder_name,
            "description": args.description or repo.get("description"),
            "tags": tags,
            "language": languages[0],
            "structure": structure,
            "commit": {**commit_info, "added": len(files), "changed": 0, "removed": 0},
        }
        result = _upload_batches(api, token, f"{api}/codes/folder", manifest, files)
        if result["created"] == 0:
            raise CodoError("Бірде-бір файл жүктелмеді")
        repo.update({"projectId": result["folderId"], "title": manifest["title"]})
        _write_json(_repo_path(root, "repo.json"), repo)

    for c in commits:
        c["pushed"] = True
    _write_json(_repo_path(root, "commits.json"), commits)

    print(f"Дайын ({time.time() - started:.1f} с): [{latest['id'][:7]}] {latest['message']}")
    if result.get("protected"):
        print(f"  Қорғалған құпия файлдар: {result['protected']} — мазмұнын тек сіз көресіз")
    if result.get("failed"):
        print(f"  Өтпеді: {result['failed']}: {', '.join(result['failedFiles'][:10])}", file=sys.stderr)
    site = (me or {}).get("site")
    project_id = repo.get("projectId")
    if project_id:
        print(f"Жоба: {site.rstrip('/')}/view/{project_id}" if site else f"Жоба ID: {project_id}")


def cmd_uninstall(args) -> None:
    """codo-ны компьютерден толық өшіру: команда, кілт, баптаулар (~/.codo).
    Жобалардағы .codo/ тарихы мен сайттағы жобалар қалады"""
    removed = []
    home = os.path.expanduser("~")
    candidates = [os.path.join(CODO_DIR, "bin", "codo.cmd")]
    if os.name == "nt":
        candidates.append(os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WindowsApps", "codo.cmd"))
    else:
        candidates += [os.path.join(home, ".local", "bin", "codo"), os.path.join(home, "bin", "codo"),
                       "/usr/local/bin/codo"]
    for path in candidates:
        try:
            with open(path, encoding="utf-8") as f:
                if SCRIPT_PATH not in f.read():
                    continue  # басқа бағдарламаның «codo»-сы — тиіспейміз
            if os.name == "nt" and path.lower().endswith(".cmd"):
                # Іске қосылып тұрған codo.cmd-ты cmd соңына дейін оқиды — бірден өшірсе
                # «The batch file cannot be found» шығады, сондықтан codo жабылған соң өшіреміз
                subprocess.Popen(
                    f'cmd /d /c ping -n 3 127.0.0.1 >nul & del /f /q "{path}"',
                    creationflags=0x08000000 | 0x00000200,  # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
                    close_fds=True,
                )
            else:
                os.remove(path)
            removed.append(path)
        except OSError:
            pass
    if os.name == "nt":
        try:
            import winreg
            bin_dir = os.path.join(CODO_DIR, "bin")
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
                current, kind = winreg.QueryValueEx(key, "Path")
                entries = [p for p in current.split(";") if p]
                kept = [p for p in entries if os.path.normcase(p) != os.path.normcase(bin_dir)]
                if len(kept) != len(entries):
                    winreg.SetValueEx(key, "Path", 0, kind, ";".join(kept))
        except OSError:
            pass
    else:
        for rc in (".zshrc", ".bashrc", ".profile"):
            rc_path = os.path.join(home, rc)
            try:
                with open(rc_path, encoding="utf-8") as f:
                    lines = f.readlines()
                kept = [line for line in lines if "# codo" not in line]
                if len(kept) != len(lines):
                    with open(rc_path, "w", encoding="utf-8") as f:
                        f.writelines(kept)
            except OSError:
                pass
    if os.path.isdir(CODO_DIR):
        shutil.rmtree(CODO_DIR, ignore_errors=True)
        removed.append(CODO_DIR)
    if removed:
        print("codo өшірілді:\n  " + "\n  ".join(removed))
        print("Сайттағы кілтті де жою үшін: Баптаулар → Терминал → Кірген құрылғылар")
    else:
        print("codo бұл компьютерде орнатылмаған")


COMMANDS = ("add", "commit", "push", "status", "log", "init", "install", "uninstall", "login", "logout", "whoami")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="codo",
        description="Codo Hub-қа жобаны терминалдан жүктеу (git сияқты): codo add . → codo commit -m \"...\" → codo push",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("add", help="Өзгерістерді біріктіру (git add): codo add .")
    p.add_argument("paths", nargs="*", help="Файлдар/папкалар (әдепкі: бүкіл жоба)")
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("commit", help='Коммит қалдыру (git commit): codo commit -m "хабарлама"')
    p.add_argument("-m", "--message", required=True, help="Не өзгергені")
    p.set_defaults(func=cmd_commit)

    p = sub.add_parser("push", help="Коммиттерді сайтқа жіберу (git push)")
    p.add_argument("--title", "-t", help="Жоба атауы — бірінші push-та (әдепкі: папка аты)")
    p.add_argument("--description", "-d", help="Сипаттама — бірінші push-та")
    p.add_argument("--tags", help="Қосымша тегтер, үтірмен — бірінші push-та")
    p.add_argument("--token", help="CLI кілті — тексеріліп, келесі жолға сақталады")
    p.add_argument("--api")
    p.set_defaults(func=cmd_push)

    p = sub.add_parser("status", help="Не өзгергенін көрсету (git status)")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("log", help="Коммиттер тарихы (git log)")
    p.set_defaults(func=cmd_log)

    p = sub.add_parser("init", help="Ағымдағы папкада codo жобасын бастау (add өзі де жасайды)")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("install", help="codo командасын орнату/жаңарту")
    p.add_argument("--token", help="CLI кілті (міндетті емес — кейін codo login)")
    p.add_argument("--api")
    p.set_defaults(func=cmd_install)

    p = sub.add_parser("uninstall", help="codo-ны компьютерден өшіру")
    p.set_defaults(func=cmd_uninstall)

    p = sub.add_parser("login", help="Аккаунтқа кіру (браузер ашылады)")
    p.add_argument("token", nargs="?", help="codo_… кілті (бермесеңіз — браузер арқылы)")
    p.add_argument("--api", help="Сервер адресі, мыс. https://example.com/api")
    p.set_defaults(func=cmd_login)

    p = sub.add_parser("logout", help="Сақталған кілтті өшіру")
    p.set_defaults(func=cmd_logout)

    p = sub.add_parser("whoami", help="Қай аккаунтпен кірілгенін көрсету")
    p.add_argument("--api")
    p.set_defaults(func=cmd_whoami)

    # Команда жазылмаса — status (git сияқты не істеу керегін көрсетеді)
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        argv = ["status"]
    elif argv[0] not in COMMANDS and argv[0] not in ("-h", "--help"):
        parser.print_help()
        return 2
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except CodoError as e:
        print(f"Қате: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nТоқтатылды", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    # Windows консолінде қазақ әріптері бұзылмауы үшін
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
