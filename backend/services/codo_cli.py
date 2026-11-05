"""codo — Codo ЖИ көмекшісі терминалдың ішінде (Claude Code сияқты).

Бұл файл backend-ке тәуелсіз (тек Python стандартты кітапханасы): ``shared_packages``
оны ``<TERMINAL_WORKSPACE_DIR>/.shared/bin/codo_cli.py`` етіп көшіріп, ``codo`` командасын
жасайды (Windows-та .cmd + PowerShell функциясы, Linux-та codo/Codo/CODO… барлық нұсқасы).

Қолданылуы:
  codo                 — сөйлесу режимі (/exit — шығу, /help — анықтама)
  codo <сұрақ>         — бір сұрақ қойып, жауабын алу
  codo -y <сұрақ>      — командаларды рұқсат сұрамай орындау

Codo ағымдағы папканың файлдарын көреді, оларды өзі жазады/өзгертеді (өзгеріс редакторда да
көрінеді), командаларды рұқсатыңызбен орындап, нәтижесін тексереді.
Серверге shell-дің env-індегі CODO_AGENT_URL / CODO_AGENT_TOKEN арқылы барады.
"""
import base64
import codecs
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.request

IS_WINDOWS = sys.platform == "win32"
LANG = os.environ.get("CODO_LANG", "kk")
if LANG not in ("kk", "ru", "en"):
    LANG = "en"

API_URL = os.environ.get("CODO_AGENT_URL", "")
TOKEN = os.environ.get("CODO_AGENT_TOKEN", "")

MAX_STEPS = 10            # бір сұраққа құрал қадамдарының шегі
MAX_MESSAGES = 36         # сервер шегі — 40
MAX_FILE_CHARS = 60_000   # бұдан үлкен файл тек жолымен жіберіледі
MAX_TOTAL_CHARS = 180_000 # сервер шегі — 200 000
MAX_FILES = 450
MAX_RESULT_CHARS = 16_000
RUN_TIMEOUT = 120

SKIP_DIRS = {
    "node_modules", "bower_components", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    ".venv", "venv", ".git", ".svn", ".hg", ".next", ".nuxt", ".svelte-kit", ".angular", ".expo",
    ".parcel-cache", ".turbo", ".vercel", ".cache", ".gradle", ".dart_tool", ".idea", "coverage",
    "dist", "build", "out", "target", "obj", ".output", "vendor", "site-packages", ".codo", ".appdata",
    ".shared", ".vscode", ".vs", "htmlcov",
}
SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".ds_store", "thumbs.db"}
BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz", ".tar", ".7z",
    ".exe", ".dll", ".so", ".dylib", ".pyc", ".pyo", ".class", ".jar", ".mp3", ".mp4", ".wav", ".ogg",
    ".woff", ".woff2", ".ttf", ".otf", ".eot", ".sqlite", ".db", ".bin", ".map",
}

_T = {
    "kk": {
        "intro": "Codo — терминалдағы ЖИ көмекшісі. Сұрағыңызды жазыңыз (/help — анықтама, /exit — шығу).",
        "help": (
            "/exit      — шығу (Ctrl+D да болады)\n"
            "/clear     — сөйлесуді жаңадан бастау\n"
            "/yes       — командаларды рұқсат сұрамай орындау (қосу/өшіру)\n"
            "/help      — осы анықтама\n"
            "Codo осы папканың файлдарын көреді, өзгерте алады және командаларды рұқсатыңызбен орындайды.\n"
            "Ctrl+C — жауапты тоқтату."
        ),
        "no_env": "codo тек Codo Hub сайтының терминалында жұмыс істейді.",
        "thinking": "ойланып жатыр…",
        "run_ask": "Орындайын ба? [Y/n] ",
        "run_skip": "өткізілді",
        "denied": "Қолданушы бұл команданы орындауға рұқсат бермеді.",
        "timeout": "Команда {sec} секундта бітпеді — тоқтатылды.",
        "exit_code": "шығу коды",
        "written": "жазылды",
        "edited": "өзгертілді",
        "deleted": "өшірілді",
        "moved": "жылжытылды",
        "read": "оқылды",
        "delete_ask": "{path} өшірілсін бе? [y/N] ",
        "bad_path": "жобаның папкасынан тыс жол",
        "not_found": "файл табылмады",
        "edit_fail": "SEARCH бөлігі файлдан табылмады",
        "interrupted": "тоқтатылды",
        "steps": "Қадамдар шегіне жетті — жалғастыру үшін тағы жазыңыз.",
        "cleared": "Сөйлесу тазаланды.",
        "yes_on": "Командалар енді рұқсатсыз орындалады.",
        "yes_off": "Командалар алдында рұқсат сұралады.",
        "net": "Серверге қосылу мүмкін болмады",
        "tool_result": "[Құрал нәтижесі]",
    },
    "ru": {
        "intro": "Codo — ИИ-помощник в терминале. Напишите вопрос (/help — справка, /exit — выход).",
        "help": (
            "/exit      — выход (или Ctrl+D)\n"
            "/clear     — начать разговор заново\n"
            "/yes       — выполнять команды без подтверждения (вкл/выкл)\n"
            "/help      — эта справка\n"
            "Codo видит файлы этой папки, может их менять и выполняет команды с вашего разрешения.\n"
            "Ctrl+C — остановить ответ."
        ),
        "no_env": "codo работает только в терминале сайта Codo Hub.",
        "thinking": "думает…",
        "run_ask": "Выполнить? [Y/n] ",
        "run_skip": "пропущено",
        "denied": "Пользователь не разрешил выполнять эту команду.",
        "timeout": "Команда не завершилась за {sec} секунд — остановлена.",
        "exit_code": "код выхода",
        "written": "записан",
        "edited": "изменён",
        "deleted": "удалён",
        "moved": "перемещён",
        "read": "прочитан",
        "delete_ask": "Удалить {path}? [y/N] ",
        "bad_path": "путь вне папки проекта",
        "not_found": "файл не найден",
        "edit_fail": "блок SEARCH не найден в файле",
        "interrupted": "остановлено",
        "steps": "Достигнут лимит шагов — напишите ещё, чтобы продолжить.",
        "cleared": "Разговор очищен.",
        "yes_on": "Команды теперь выполняются без подтверждения.",
        "yes_off": "Перед командами будет запрашиваться подтверждение.",
        "net": "Не удалось подключиться к серверу",
        "tool_result": "[Құрал нәтижесі]",
    },
    "en": {
        "intro": "Codo — AI assistant in your terminal. Type a question (/help — help, /exit — quit).",
        "help": (
            "/exit      — quit (or Ctrl+D)\n"
            "/clear     — start a new conversation\n"
            "/yes       — run commands without asking (toggle)\n"
            "/help      — this help\n"
            "Codo sees the files in this folder, can change them and runs commands with your permission.\n"
            "Ctrl+C — stop the answer."
        ),
        "no_env": "codo only works in the Codo Hub site terminal.",
        "thinking": "thinking…",
        "run_ask": "Run it? [Y/n] ",
        "run_skip": "skipped",
        "denied": "The user did not allow this command to run.",
        "timeout": "The command did not finish in {sec} seconds — stopped.",
        "exit_code": "exit code",
        "written": "written",
        "edited": "edited",
        "deleted": "deleted",
        "moved": "moved",
        "read": "read",
        "delete_ask": "Delete {path}? [y/N] ",
        "bad_path": "path outside the project folder",
        "not_found": "file not found",
        "edit_fail": "SEARCH block not found in the file",
        "interrupted": "stopped",
        "steps": "Step limit reached — write again to continue.",
        "cleared": "Conversation cleared.",
        "yes_on": "Commands now run without asking.",
        "yes_off": "Commands will ask for permission first.",
        "net": "Could not connect to the server",
        "tool_result": "[Құрал нәтижесі]",
    },
}[LANG]

# ANSI түстері
RESET, BOLD, DIM = "\x1b[0m", "\x1b[1m", "\x1b[2m"
CYAN, GREEN, YELLOW, RED, GRAY, MAGENTA = "\x1b[36m", "\x1b[32m", "\x1b[33m", "\x1b[31m", "\x1b[90m", "\x1b[35m"


def out(text: str = "", end: str = "\n") -> None:
    sys.stdout.write(text + end)
    sys.stdout.flush()


def shell_name() -> str:
    return "PowerShell" if IS_WINDOWS else "bash"


# ─────────────────────────── жоба файлдары ───────────────────────────

ROOT = os.path.realpath(os.getcwd())


def safe_path(rel: str):
    """Жобаның ішіндегі абсолют жол, әйтпесе None"""
    rel = (rel or "").strip().replace("\\", "/").lstrip("/")
    if rel.startswith("./"):
        rel = rel[2:]
    if not rel or any(part in ("..", "") for part in rel.split("/")):
        return None
    full = os.path.realpath(os.path.join(ROOT, rel))
    if full != ROOT and not full.startswith(ROOT + os.sep):
        return None
    return full


def read_text(full: str):
    try:
        with open(full, "rb") as f:
            data = f.read(MAX_FILE_CHARS * 4 + 1)
    except OSError:
        return None
    if b"\x00" in data[:8000]:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def collect_files() -> list:
    """Папкадағы мәтін файлдары: шекке дейін мазмұнымен, қалғаны — тек жолымен"""
    files, total = [], 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames if d.lower() not in SKIP_DIRS and not d.endswith(".egg-info"))
        for name in sorted(filenames):
            if len(files) >= MAX_FILES:
                return files
            low = name.lower()
            ext = os.path.splitext(low)[1]
            if low in SKIP_FILES or ext in BINARY_EXT or low.endswith((".min.js", ".min.css")):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
            entry = {"path": rel[:512]}
            try:
                size = os.path.getsize(full)
            except OSError:
                continue
            if size <= MAX_FILE_CHARS * 2 and total < MAX_TOTAL_CHARS:
                text = read_text(full)
                if text is not None and len(text) <= MAX_FILE_CHARS and total + len(text) <= MAX_TOTAL_CHARS:
                    entry["content"] = text
                    total += len(text)
            files.append(entry)
    return files


# ─────────────────────────── сервермен байланыс ───────────────────────────

class ApiError(Exception):
    pass


def stream_reply(messages: list, on_text) -> str:
    body = json.dumps({
        "messages": messages,
        "projectName": os.path.basename(ROOT) or "project",
        "projectFiles": collect_files(),
        "platform": f"{sys.platform} ({'Windows' if IS_WINDOWS else os.uname().sysname})",
        "shell": shell_name(),
        "uiLanguage": LANG,
    }).encode("utf-8")
    req = urllib.request.Request(API_URL, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "X-Codo-Terminal": TOKEN,
    })
    # Жергілікті серверге — прокси арқылы емес
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        resp = opener.open(req, timeout=120)
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8", "replace")).get("detail") or ""
        except (ValueError, AttributeError, OSError):
            pass
        if not isinstance(detail, str):
            detail = json.dumps(detail, ensure_ascii=False)[:300]
        raise ApiError(detail or f"HTTP {e.code}")
    except (urllib.error.URLError, OSError) as e:
        raise ApiError(f"{_T['net']}: {getattr(e, 'reason', e)}")
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    parts = []
    with resp:
        while True:
            chunk = resp.read1(4096) if hasattr(resp, "read1") else resp.read(256)
            if not chunk:
                break
            text = decoder.decode(chunk)
            if text:
                parts.append(text)
                on_text(text)
        tail = decoder.decode(b"", final=True)
        if tail:
            parts.append(tail)
            on_text(tail)
    return "".join(parts)


# ─────────────────────────── жауапты терминалға шығару ───────────────────────────

class Renderer:
    """Markdown-ды жеңіл түрлендіру: код блоктары сұр, тақырыптар қалың, `код` көгілдір.
    Толық емес жол бірден шығады (код блогынан тыс), сондықтан жауап ағынмен көрінеді."""

    def __init__(self):
        self.buf = ""
        self.in_code = False
        self.printed = 0  # ағымдағы толық емес жолдың шығып қойған бөлігі

    def feed(self, text: str) -> None:
        self.buf += text
        while "\n" in self.buf:
            line, self.buf = self.buf.split("\n", 1)
            self._line(line, self.printed)
            self.printed = 0
        # Жолдың басы «`» болмаса — бірден шығарамыз (блоктың басы болуы мүмкін емес)
        if self.buf and not self.in_code and not self.buf.lstrip().startswith(("`", "#", "-", "*")):
            sys.stdout.write(self._inline(self.buf[self.printed:]))
            sys.stdout.flush()
            self.printed = len(self.buf)

    def close(self) -> None:
        if self.buf:
            self._line(self.buf, self.printed)
        self.buf, self.printed = "", 0
        if self.in_code:
            self.in_code = False
        sys.stdout.write(RESET)
        sys.stdout.flush()

    @staticmethod
    def _inline(text: str) -> str:
        text = re.sub(r"\*\*([^*]+)\*\*", BOLD + r"\1" + RESET, text)
        return re.sub(r"`([^`\n]+)`", CYAN + r"\1" + RESET, text)

    def _line(self, line: str, already: int) -> None:
        stripped = line.strip()
        if stripped.startswith("```"):
            if self.in_code:
                self.in_code = False
                out(f"{GRAY}└─{RESET}")
            else:
                self.in_code = True
                head = stripped[3:].strip() or "code"
                out(f"{GRAY}┌─ {MAGENTA}{head}{RESET}")
            return
        if self.in_code:
            out(f"{GRAY}│{RESET} {DIM}{line}{RESET}")
            return
        if already:
            out(self._inline(line[already:]))
            return
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            out(f"{BOLD}{m.group(2)}{RESET}")
        else:
            out(self._inline(re.sub(r"^(\s*)[-*] ", r"\1• ", line)))


# ─────────────────────────── блоктар (құралдар) ───────────────────────────

FENCE_RE = re.compile(r"^```([\w+#.-]*)(.*)$")
ATTR_RE = re.compile(r"([\w-]+)=(\"[^\"\n]*\"|[^\s`]+)")


def parse_blocks(text: str) -> list:
    """```тіл атрибуттар … ``` блоктары: [(тіл, атрибуттар, жалаушалар, мазмұны)]"""
    blocks, lines, i = [], text.split("\n"), 0
    while i < len(lines):
        m = FENCE_RE.match(lines[i].strip())
        if not m:
            i += 1
            continue
        lang, rest = m.group(1).lower(), m.group(2)
        attrs = {a.lower(): v.strip('"').strip() for a, v in ATTR_RE.findall(rest)}
        flags = ATTR_RE.sub(" ", rest).lower().split()
        body, i = [], i + 1
        while i < len(lines) and lines[i].strip() != "```":
            body.append(lines[i])
            i += 1
        i += 1
        blocks.append((lang, attrs, flags, "\n".join(body)))
    return blocks


def apply_edit(content: str, spec: str):
    """SEARCH/REPLACE бөліктерін қолдану: (жаңа мәтін, қате)"""
    pattern = re.compile(r"<<<<<<< SEARCH\n(.*?)\n?=======\n(.*?)\n?>>>>>>> REPLACE", re.S)
    pieces = pattern.findall(spec.replace("\r\n", "\n"))
    if not pieces:
        return None, _T["edit_fail"]
    eol = "\r\n" if "\r\n" in content else "\n"
    text = content.replace("\r\n", "\n")
    for search, replace in pieces:
        if search and search in text:
            text = text.replace(search, replace, 1)
        elif search.strip() and search.strip() in text:
            text = text.replace(search.strip(), replace.strip(), 1)
        elif not search.strip():
            text = text + ("" if text.endswith("\n") or not text else "\n") + replace
        else:
            return None, _T["edit_fail"] + ":\n" + search[:300]
    return text.replace("\n", eol), None


def note(icon: str, color: str, text: str) -> None:
    out(f"{color}{icon}{RESET} {text}")


def confirm(prompt: str, default_yes: bool) -> bool:
    try:
        ans = input(f"{YELLOW}?{RESET} {prompt}").strip().lower()
    except EOFError:
        return False
    if not ans:
        return default_yes
    return ans[0] in ("y", "д", "и", "иә", "j")


def run_command(cmd: str) -> str:
    """Команданы орындап, шығысын терминалға да, Codo-ға да береміз"""
    if IS_WINDOWS:
        ps = shutil.which("pwsh") or shutil.which("powershell") or "powershell"
        # -EncodedCommand: тырнақшалар мен арнайы таңбалар бүлінбейді
        script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference='SilentlyContinue';" + cmd
        argv = [ps, "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
                base64.b64encode(script.encode("utf-16-le")).decode("ascii")]
    else:
        argv = [shutil.which("bash") or "/bin/sh", "-c", cmd]
    try:
        proc = subprocess.Popen(argv, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL)
    except OSError as e:
        return f"$ {cmd}\n{e}"
    captured = []

    def pump():
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        while True:
            chunk = proc.stdout.read1(4096) if hasattr(proc.stdout, "read1") else proc.stdout.read(256)
            if not chunk:
                break
            text = decoder.decode(chunk)
            captured.append(text)
            sys.stdout.write(GRAY + text + RESET)
            sys.stdout.flush()

    reader = threading.Thread(target=pump, daemon=True)
    reader.start()
    timed_out = False
    try:
        proc.wait(timeout=RUN_TIMEOUT)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_tree(proc)
    except KeyboardInterrupt:
        kill_tree(proc)
        reader.join(2)
        raise
    reader.join(5)
    output = "".join(captured)
    if output and not output.endswith("\n"):
        out()
    tail = output[-MAX_RESULT_CHARS:]
    status = _T["timeout"].format(sec=RUN_TIMEOUT) if timed_out else f"{_T['exit_code']}: {proc.returncode}"
    color = RED if timed_out or proc.returncode else GREEN
    note("●", color, status)
    return f"$ {cmd}\n{tail}\n({status})"


def kill_tree(proc) -> None:
    try:
        if IS_WINDOWS:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        else:
            proc.kill()
    except OSError:
        pass


def execute_blocks(text: str, state: dict) -> list:
    """Жауаптағы блоктарды орындау. Codo-ға қайтарылатын нәтижелер тізімі (read/run/қате)."""
    results = []
    for lang, attrs, flags, body in parse_blocks(text):
        if lang == "read" and attrs.get("path"):
            full = safe_path(attrs["path"])
            content = read_text(full) if full and os.path.isfile(full) else None
            if content is None:
                note("✗", RED, f"{attrs['path']}: {_T['not_found']}")
                results.append(f"read {attrs['path']}: {_T['not_found']}")
            else:
                note("◇", CYAN, f"{attrs['path']} — {_T['read']}")
                results.append(f"Файл {attrs['path']}:\n```\n{content[:MAX_RESULT_CHARS]}\n```")
        elif lang in ("bash", "sh", "shell", "powershell", "ps1", "cmd", "zsh") and "run" in flags:
            cmd = body.strip()
            if not cmd:
                continue
            out(f"{YELLOW}${RESET} {BOLD}{cmd}{RESET}")
            if not state["yes"] and not confirm(_T["run_ask"], True):
                note("–", GRAY, _T["run_skip"])
                results.append(f"$ {cmd}\n{_T['denied']}")
                continue
            results.append(run_command(cmd))
        elif lang == "delete" and attrs.get("path"):
            full = safe_path(attrs["path"])
            if not full or full == ROOT:
                note("✗", RED, f"{attrs['path']}: {_T['bad_path']}")
                results.append(f"delete {attrs['path']}: {_T['bad_path']}")
                continue
            if not os.path.exists(full):
                results.append(f"delete {attrs['path']}: {_T['not_found']}")
                continue
            if not state["yes"] and not confirm(_T["delete_ask"].format(path=attrs["path"]), False):
                note("–", GRAY, _T["run_skip"])
                results.append(f"delete {attrs['path']}: {_T['denied']}")
                continue
            try:
                shutil.rmtree(full) if os.path.isdir(full) else os.remove(full)
                note("−", RED, f"{attrs['path']} — {_T['deleted']}")
            except OSError as e:
                results.append(f"delete {attrs['path']}: {e}")
        elif lang in ("move", "rename") and attrs.get("from") and attrs.get("to"):
            src, dst = safe_path(attrs["from"]), safe_path(attrs["to"])
            if not src or not dst:
                results.append(f"move: {_T['bad_path']}")
                continue
            try:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.move(src, dst)
                note("→", CYAN, f"{attrs['from']} → {attrs['to']} — {_T['moved']}")
            except OSError as e:
                note("✗", RED, f"move: {e}")
                results.append(f"move {attrs['from']} → {attrs['to']}: {e}")
        elif attrs.get("edit"):
            full = safe_path(attrs["edit"])
            content = read_text(full) if full and os.path.isfile(full) else None
            if content is None:
                note("✗", RED, f"{attrs['edit']}: {_T['not_found']}")
                results.append(f"edit {attrs['edit']}: {_T['not_found']}")
                continue
            new, err = apply_edit(content, body)
            if err:
                note("✗", RED, f"{attrs['edit']}: {err.splitlines()[0]}")
                results.append(f"edit {attrs['edit']}: {err}")
                continue
            with open(full, "w", encoding="utf-8", newline="") as f:
                f.write(new)
            note("✎", GREEN, f"{attrs['edit']} — {_T['edited']}")
        elif attrs.get("path") and lang not in ("project", "ui", "markdown"):
            full = safe_path(attrs["path"])
            if not full:
                note("✗", RED, f"{attrs['path']}: {_T['bad_path']}")
                results.append(f"write {attrs['path']}: {_T['bad_path']}")
                continue
            existed = os.path.exists(full)
            try:
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w", encoding="utf-8", newline="") as f:
                    f.write(body + ("\n" if body and not body.endswith("\n") else ""))
                lines = body.count("\n") + 1 if body else 0
                note("✎" if existed else "+", GREEN,
                     f"{attrs['path']} — {_T['edited'] if existed else _T['written']} ({lines})")
            except OSError as e:
                note("✗", RED, f"{attrs['path']}: {e}")
                results.append(f"write {attrs['path']}: {e}")
    return results


# ─────────────────────────── сөйлесу ───────────────────────────

def ask(messages: list, prompt: str, state: dict) -> None:
    messages.append({"role": "user", "content": prompt[:20_000]})
    for step in range(MAX_STEPS):
        del messages[:-MAX_MESSAGES]
        while messages and messages[0]["role"] != "user":
            messages.pop(0)
        out(f"{GRAY}✦ {_T['thinking']}{RESET}", end="\r")
        renderer = Renderer()
        first = [True]

        def on_text(text: str) -> None:
            if first[0]:
                first[0] = False
                sys.stdout.write("\x1b[2K\r" + f"{CYAN}✦ Codo{RESET}\n")
            renderer.feed(text)

        try:
            reply = stream_reply(messages, on_text)
        except ApiError as e:
            sys.stdout.write("\x1b[2K\r")
            note("✗", RED, str(e))
            messages.pop()  # сұрақты қайта жазуға болады
            return
        except KeyboardInterrupt:
            renderer.close()
            out(f"\n{GRAY}— {_T['interrupted']} —{RESET}")
            if messages and messages[-1]["role"] == "user":
                messages.pop()
            return
        renderer.close()
        if first[0]:
            sys.stdout.write("\x1b[2K\r")
        if not reply.strip():
            return
        messages.append({"role": "assistant", "content": reply[:20_000]})
        try:
            results = execute_blocks(reply, state)
        except KeyboardInterrupt:
            out(f"\n{GRAY}— {_T['interrupted']} —{RESET}")
            return
        if not results:
            return
        payload = _T["tool_result"] + "\n\n" + "\n\n".join(results)
        messages.append({"role": "user", "content": payload[:20_000]})
        out()
    note("!", YELLOW, _T["steps"])


def repl(state: dict) -> None:
    try:
        import readline  # noqa: F401 — Linux-та жолды өңдеу мен тарих (↑/↓)
    except ImportError:
        pass
    out(f"{CYAN}{BOLD}✦ Codo{RESET} {GRAY}· {os.path.basename(ROOT) or ROOT}{RESET}")
    out(f"{GRAY}{_T['intro']}{RESET}")
    messages: list = []
    while True:
        try:
            line = input(f"\n{CYAN}codo ❯{RESET} ").strip()
        except (EOFError, KeyboardInterrupt):
            out()
            return
        if not line:
            continue
        cmd = line.lower()
        if cmd in ("/exit", "/quit", "exit", "quit", "/q", "шығу"):
            return
        if cmd == "/help":
            out(_T["help"])
            continue
        if cmd == "/clear":
            messages.clear()
            note("✓", GREEN, _T["cleared"])
            continue
        if cmd == "/yes":
            state["yes"] = not state["yes"]
            note("✓", GREEN, _T["yes_on"] if state["yes"] else _T["yes_off"])
            continue
        ask(messages, line, state)


def main(argv: list) -> int:
    for stream in (sys.stdout, sys.stderr, sys.stdin):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    if IS_WINDOWS:
        os.system("")  # ANSI түстерін қосу (ескі консольдерде)
    if not API_URL or not TOKEN:
        out(f"{RED}✗{RESET} {_T['no_env']}")
        return 1
    state = {"yes": False}
    args = list(argv)
    if args and args[0] in ("-h", "--help", "help", "/help"):
        out(__doc__.split("Қолданылуы:")[0].strip().splitlines()[0])
        out(_T["help"])
        return 0
    while args and args[0] in ("-y", "--yes"):
        state["yes"] = True
        args.pop(0)
    if args:
        ask([], " ".join(args), state)
        return 0
    repl(state)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        out(RESET)
        sys.exit(130)
