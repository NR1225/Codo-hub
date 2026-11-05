"""Жобаны Notes-қа қосу: Vibecoding жобасы немесе сайттағы (Жобалар бетіндегі) жоба талданып,
vault-та «жоба туралы» жазба жасалады — мақсаты, стегі, құрылымы, іске қосу командалары, т.б.

Жазбаның басында жасырын белгі тұрады: <!-- codo-source: vibe:<id> --> (немесе site:<id>).
Сол арқылы «Жаңарту» басқанда дәл сол жазба табылады. Автоматты бөлім
<!-- codo:auto --> … <!-- /codo:auto --> арасында — жаңартқанда тек сол ауыстырылады,
қолданушының төменде жазғаны сақталады."""
import json
import os
import re
from collections import Counter
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from db import Note, User, VibecodingProject
from services import project_notes
from services.code_service import CodeService
from services.note_service import NoteService, clean_folder

AUTO_START = "<!-- codo:auto -->"
AUTO_END = "<!-- /codo:auto -->"
INDEX_KEY = "index"
SITE_ROOT = "Жобалар"
INDEX_TITLE = {"kk": "Менің жобаларым", "ru": "Мои проекты", "en": "My projects"}

# Ағашта көрсетілмейтін (бірақ саналатын) папкалар
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", ".cache", "coverage", "out", ".idea", ".vscode"}
LOCK_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Cargo.lock", "bun.lockb", "uv.lock"}
MAX_TREE_LINES = 120
MAX_README_CHARS = 4000
MAX_AI_SOURCE_CHARS = 40_000

EXT_LANG = {
    ".ts": "TypeScript", ".tsx": "TypeScript (React)", ".js": "JavaScript", ".jsx": "JavaScript (React)",
    ".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".html": "HTML", ".htm": "HTML",
    ".css": "CSS", ".scss": "SCSS", ".sass": "SCSS", ".less": "Less", ".vue": "Vue", ".svelte": "Svelte",
    ".java": "Java", ".kt": "Kotlin", ".swift": "Swift", ".go": "Go", ".rs": "Rust", ".c": "C",
    ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++", ".cs": "C#", ".php": "PHP", ".rb": "Ruby",
    ".dart": "Dart", ".sql": "SQL", ".sh": "Shell", ".ps1": "PowerShell", ".md": "Markdown",
    ".json": "JSON", ".yml": "YAML", ".yaml": "YAML", ".toml": "TOML", ".ipynb": "Jupyter",
}
# Тәуелділік атауы → көрінетін технология
KNOWN_DEPS = {
    "react": "React", "next": "Next.js", "vue": "Vue", "nuxt": "Nuxt", "svelte": "Svelte", "@angular/core": "Angular",
    "vite": "Vite", "webpack": "Webpack", "typescript": "TypeScript", "tailwindcss": "Tailwind CSS",
    "express": "Express", "fastify": "Fastify", "@nestjs/core": "NestJS", "socket.io": "Socket.IO",
    "electron": "Electron", "react-native": "React Native", "expo": "Expo", "three": "Three.js",
    "phaser": "Phaser", "mongoose": "MongoDB (Mongoose)", "prisma": "Prisma", "firebase": "Firebase",
    "@supabase/supabase-js": "Supabase", "redux": "Redux", "@reduxjs/toolkit": "Redux Toolkit",
    "react-router-dom": "React Router", "axios": "Axios", "jest": "Jest", "vitest": "Vitest",
    "fastapi": "FastAPI", "flask": "Flask", "django": "Django", "sqlalchemy": "SQLAlchemy",
    "torch": "PyTorch", "tensorflow": "TensorFlow", "transformers": "Hugging Face Transformers",
    "numpy": "NumPy", "pandas": "pandas", "scikit-learn": "scikit-learn", "opencv-python": "OpenCV",
    "pygame": "Pygame", "streamlit": "Streamlit", "gradio": "Gradio", "aiogram": "aiogram (Telegram)",
    "python-telegram-bot": "python-telegram-bot", "discord.py": "discord.py", "requests": "requests",
    "openai": "OpenAI API", "anthropic": "Anthropic API", "google-generativeai": "Gemini API", "langchain": "LangChain",
}
ENTRY_FILES = [
    "index.html", "main.py", "app.py", "manage.py", "bot.py", "server.js", "index.js", "app.js", "main.js",
    "src/main.tsx", "src/main.ts", "src/main.jsx", "src/index.tsx", "src/index.js", "src/App.tsx", "src/App.jsx",
    "src/App.vue", "main.go", "src/main.rs", "Program.cs", "lib/main.dart",
]
TODO_RE = re.compile(r"\b(TODO|FIXME|HACK)\b")

L = {
    "kk": {
        "about": "Жоба туралы", "purpose": "Мақсаты", "noPurpose": "Мақсаты README-де немесе сипаттамада жазылмаған — төменде өзіңіз толықтырыңыз немесе «Codo талдауы» арқылы жаңартыңыз.",
        "source": "Дереккөз", "vibe": "Vibecoding жобасы", "site": "Сайттағы жоба", "vibeMany": "Vibecoding жобалары", "siteMany": "Сайттағы жобалар", "updated": "Соңғы жаңарту",
        "synced": "Notes-қа жаңартылды", "files": "Файлдар", "size": "Көлемі", "stack": "Технологиялар",
        "langs": "Тілдер", "deps": "Тәуелділіктер", "scripts": "Іске қосу командалары", "entry": "Кіру нүктелері",
        "tree": "Құрылымы", "more": "тағы {n} элемент", "readme": "README", "ai": "Codo талдауы",
        "todo": "TODO/FIXME белгілері", "members": "Мүшелері", "tags": "Тегтері", "private": "Жабық", "public": "Ашық",
        "visibility": "Көрінуі", "myNotes": "Менің жазбаларым", "folder": "Жазбалар папкасы", "open": "Ашу",
        "role": "Рөлім", "owner": "иесі", "member": "мүше", "kind": "Түрі", "indexText": "Notes-қа қосылған жобалар. Тізім «Жобаны қосу» арқылы автоматты жаңарады.",
        "type": {"web": "Веб-қосымша", "static": "Статикалық веб-бет", "python": "Python жобасы", "bot": "Бот", "ml": "ML / AI жобасы", "game": "Ойын", "mobile": "Мобильді қосымша", "api": "API / сервер", "other": "Жоба"},
    },
    "ru": {
        "about": "О проекте", "purpose": "Цель", "noPurpose": "Цель не описана в README или описании — дополните ниже или обновите через «Анализ Codo».",
        "source": "Источник", "vibe": "Проект Vibecoding", "site": "Проект на сайте", "vibeMany": "Проекты Vibecoding", "siteMany": "Проекты на сайте", "updated": "Последнее изменение",
        "synced": "Обновлено в Notes", "files": "Файлы", "size": "Размер", "stack": "Технологии",
        "langs": "Языки", "deps": "Зависимости", "scripts": "Команды запуска", "entry": "Точки входа",
        "tree": "Структура", "more": "ещё {n} элементов", "readme": "README", "ai": "Анализ Codo",
        "todo": "Метки TODO/FIXME", "members": "Участники", "tags": "Теги", "private": "Закрытый", "public": "Открытый",
        "visibility": "Видимость", "myNotes": "Мои заметки", "folder": "Папка заметок", "open": "Открыть",
        "role": "Моя роль", "owner": "владелец", "member": "участник", "kind": "Тип", "indexText": "Проекты, добавленные в Notes. Список обновляется автоматически через «Добавить проект».",
        "type": {"web": "Веб-приложение", "static": "Статическая веб-страница", "python": "Python-проект", "bot": "Бот", "ml": "ML / AI проект", "game": "Игра", "mobile": "Мобильное приложение", "api": "API / сервер", "other": "Проект"},
    },
    "en": {
        "about": "About", "purpose": "Purpose", "noPurpose": "The purpose isn't described in a README or description — add it below or refresh with “Codo analysis”.",
        "source": "Source", "vibe": "Vibecoding project", "site": "Site project", "vibeMany": "Vibecoding projects", "siteMany": "Site projects", "updated": "Last change",
        "synced": "Synced to Notes", "files": "Files", "size": "Size", "stack": "Tech stack",
        "langs": "Languages", "deps": "Dependencies", "scripts": "Run commands", "entry": "Entry points",
        "tree": "Structure", "more": "{n} more items", "readme": "README", "ai": "Codo analysis",
        "todo": "TODO/FIXME markers", "members": "Members", "tags": "Tags", "private": "Private", "public": "Public",
        "visibility": "Visibility", "myNotes": "My notes", "folder": "Notes folder", "open": "Open",
        "role": "My role", "owner": "owner", "member": "member", "kind": "Type", "indexText": "Projects added to Notes. The list updates automatically via “Add project”.",
        "type": {"web": "Web app", "static": "Static web page", "python": "Python project", "bot": "Bot", "ml": "ML / AI project", "game": "Game", "mobile": "Mobile app", "api": "API / server", "other": "Project"},
    },
}


def _lang(lang: Optional[str]) -> str:
    return lang if lang in L else "kk"


def marker(key: str) -> str:
    return f"<!-- codo-source: {key} -->"


def _safe_title(name: str) -> str:
    """Жазба атауына тыйым салынған таңбаларды алып тастау («[Тест] Жылан» → «Тест Жылан»)"""
    title = re.sub(r"[\[\]#|^\\/:*?\"<>]+", " ", name or "")
    return re.sub(r"\s+", " ", title).strip()[:150] or "Project"


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    return str(value or "")[:16].replace("T", " ")


def _size(n: int) -> str:
    for unit in ("B", "KB", "MB"):
        if n < 1024 or unit == "MB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n} B"


# ---------- Дереккөздер ----------

def _vibe_projects(db: Session, owner_id: str) -> List[VibecodingProject]:
    return (
        db.query(VibecodingProject)
        .filter(VibecodingProject.owner_id == owner_id)
        .order_by(VibecodingProject.updated_at.desc())
        .all()
    )


def _linked_notes(db: Session, owner_id: str) -> Dict[str, Note]:
    """codo-source белгісі бар жазбалар: {"vibe:<id>": Note}"""
    found: Dict[str, Note] = {}
    rows = db.query(Note).filter(Note.owner_id == owner_id, Note.kind == "note", Note.content.like("<!-- codo-source: %")).all()
    for note in rows:
        m = re.match(r"<!-- codo-source: ([^\s]+) -->", note.content or "")
        if m and m.group(1) not in found:
            found[m.group(1)] = note
    return found


def list_sources(db: Session, user: User) -> Dict[str, Any]:
    linked = _linked_notes(db, user.id)

    def link(key: str) -> Optional[str]:
        note = linked.get(key)
        return note.id if note else None

    vibe = []
    for p in _vibe_projects(db, user.id):
        try:
            count = len(json.loads(p.files or "[]"))
        except ValueError:
            count = 0
        vibe.append({
            "kind": "vibe", "id": p.id, "name": p.name, "fileCount": count,
            "updatedAt": p.updated_at.isoformat() + "Z" if p.updated_at else "",
            "notesFolder": p.notes_folder, "noteId": link(f"vibe:{p.id}"),
        })
    site = []
    for code in CodeService.my_projects(user.username):
        stats = code.get("folderStats") or {}
        site.append({
            "kind": "site", "id": code["id"], "name": code.get("title") or "Project",
            "description": code.get("description") or "", "role": code.get("role"),
            "isPrivate": bool(code.get("isPrivate")), "fileCount": _site_file_count(code) or stats.get("files", 0),
            "updatedAt": code.get("updatedAt") or code.get("createdAt") or "", "noteId": link(f"site:{code['id']}"),
        })
    site.sort(key=lambda s: str(s["updatedAt"]), reverse=True)
    return {"vibe": vibe, "site": site, "indexNoteId": link(INDEX_KEY)}


def _site_file_count(code: Dict[str, Any]) -> int:
    if not code.get("isFolder"):
        return 1
    try:
        return int(json.loads(code.get("content") or "{}").get("fileCount") or 0)
    except (ValueError, TypeError, AttributeError):
        return 0


def _load_vibe(db: Session, user: User, project_id: str) -> Tuple[Dict[str, Any], List[Tuple[str, str]]]:
    project = project_notes.get_project(db, user.id, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    try:
        raw = json.loads(project.files or "[]")
    except ValueError:
        raw = []
    files = [(str(f.get("path") or f.get("name") or "").lstrip("/"), str(f.get("content") or "")) for f in raw if isinstance(f, dict)]
    meta = {
        "kind": "vibe", "id": project.id, "name": project.name, "description": "",
        "updatedAt": project.updated_at, "project": project,
    }
    return meta, [f for f in files if f[0]]


def _load_site(user: User, code_id: str) -> Tuple[Dict[str, Any], List[Tuple[str, str]]]:
    code = CodeService.find_code_by_id(code_id)
    if not code or code.get("folderId"):
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    role = "owner" if code.get("author") == user.username else "member" if user.username in (code.get("members") or []) else None
    if not role:
        # Тек өз жобаңызды немесе мүше болған жобаны қосуға болады
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    from database import codes  # жадтағы тізім (CodeService сияқты)

    files: List[Tuple[str, str]] = []
    if code.get("isFolder"):
        for child in codes:
            if child.get("folderId") != code_id:
                continue
            path = str(child.get("folderPath") or child.get("title") or "")
            # Жол түбірлік папка атымен басталады — оны алып тастаймыз
            path = path.split("/", 1)[1] if "/" in path else path
            content = CodeService.for_viewer(child, user.username).get("content") or ""
            files.append((path, str(content)))
    else:
        files.append((str(code.get("title") or "file"), str(CodeService.for_viewer(code, user.username).get("content") or "")))
    meta = {
        "kind": "site", "id": code_id, "name": code.get("title") or "Project",
        "description": str(code.get("description") or "").strip(), "updatedAt": code.get("updatedAt") or code.get("createdAt"),
        "tags": [t for t in code.get("tags") or [] if isinstance(t, str)], "members": code.get("members") or [],
        "isPrivate": bool(code.get("isPrivate")), "role": role, "author": code.get("author"),
    }
    return meta, files


# ---------- Талдау ----------

def _skipped(path: str) -> bool:
    return any(part in SKIP_DIRS for part in path.split("/")[:-1])


def _find(files: Dict[str, str], name: str) -> Optional[Tuple[str, str]]:
    """Түбірдегі файл, болмаса — ең таяз ішкі папкадағы (монорепо: frontend/package.json)"""
    if name in files:
        return name, files[name]
    matches = sorted((p for p in files if p.split("/")[-1] == name and not _skipped(p)), key=lambda p: p.count("/"))
    return (matches[0], files[matches[0]]) if matches else None


def _readme(files: Dict[str, str]) -> Optional[Tuple[str, str]]:
    for name in ("README.md", "readme.md", "Readme.md", "README.MD", "README.txt", "README"):
        hit = _find(files, name)
        if hit and hit[1].strip():
            return hit
    return None


def _first_paragraph(markdown: str) -> str:
    """README-дің тақырыптан кейінгі бірінші мағыналы абзацы"""
    text = re.sub(r"```.*?```", "", markdown, flags=re.S)
    for block in re.split(r"\n\s*\n", text):
        block = block.strip()
        if not block or block.startswith(("#", "![", "[!", "<", "|", "---", "===")):
            # «# Атау\nСипаттама» — тақырыптан кейінгі жолдарды аламыз
            lines = [ln for ln in block.splitlines() if ln.strip() and not ln.lstrip().startswith(("#", "![", "<", "[!", "|"))]
            if lines and block.startswith("#"):
                return " ".join(ln.strip() for ln in lines)[:600]
            continue
        return re.sub(r"\s+", " ", block)[:600]
    return ""


def _html_title(files: Dict[str, str]) -> str:
    hit = _find(files, "index.html")
    if not hit:
        return ""
    m = re.search(r"<title[^>]*>(.*?)</title>", hit[1], re.S | re.I)
    desc = re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)', hit[1], re.I)
    return (desc.group(1) if desc else m.group(1) if m else "").strip()[:300]


def _python_deps(files: Dict[str, str]) -> List[str]:
    deps: List[str] = []
    hit = _find(files, "requirements.txt")
    if hit:
        for line in hit[1].splitlines():
            line = line.split("#")[0].strip()
            if line and not line.startswith("-"):
                deps.append(re.split(r"[<>=!~\[; ]", line)[0].strip())
    hit = _find(files, "pyproject.toml")
    if hit:
        block = re.search(r"dependencies\s*=\s*\[(.*?)\]", hit[1], re.S)
        if block:
            deps += [re.split(r"[<>=!~\[; ]", d)[0] for d in re.findall(r"[\"']([^\"']+)[\"']", block.group(1))]
    return [d for d in dict.fromkeys(d.lower() for d in deps) if d]


def analyze(meta: Dict[str, Any], file_list: List[Tuple[str, str]]) -> Dict[str, Any]:
    files = {p: c for p, c in file_list}
    visible = [p for p in files if not _skipped(p)]
    total_bytes = sum(len(c.encode("utf-8", "ignore")) for c in files.values())

    langs: Counter = Counter()
    for p in visible:
        lang = EXT_LANG.get(os.path.splitext(p)[1].lower())
        if lang and lang not in ("JSON", "Markdown", "YAML", "TOML"):
            langs[lang] += 1

    pkg: Dict[str, Any] = {}
    pkg_hit = _find(files, "package.json")
    if pkg_hit:
        try:
            pkg = json.loads(pkg_hit[1]) or {}
        except ValueError:
            pkg = {}
    js_deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})} if isinstance(pkg, dict) else {}
    py_deps = _python_deps(files)
    all_deps = list(js_deps.keys()) + py_deps
    stack = list(dict.fromkeys(KNOWN_DEPS[d] for d in all_deps if d in KNOWN_DEPS))

    scripts: List[str] = []
    if isinstance(pkg.get("scripts"), dict):
        base = os.path.dirname(pkg_hit[0]) if pkg_hit else ""
        prefix = f"cd {base} && " if base else ""
        scripts = [f"{prefix}npm run {k}  # {v}" for k, v in list(pkg["scripts"].items())[:10]]
    if py_deps and _find(files, "requirements.txt"):
        scripts.append("pip install -r requirements.txt")
    entries = [e for e in ENTRY_FILES if e in files]
    if not entries:
        entries = sorted({p for p in visible if p.split("/")[-1] in {e.split("/")[-1] for e in ENTRY_FILES}}, key=lambda p: p.count("/"))[:5]
    for e in entries:
        if e.endswith(".py") and not any(s.startswith("python") for s in scripts):
            scripts.append(f"python {e}")

    # Жоба түрі
    names = {d.lower() for d in all_deps}
    ptype = "other"
    if names & {"react-native", "expo"} or _find(files, "pubspec.yaml"):
        ptype = "mobile"
    elif names & {"phaser", "pygame", "three"} or re.search(r"game|ойын|игра", meta["name"], re.I):
        ptype = "game"
    elif names & {"aiogram", "python-telegram-bot", "discord.py", "telebot", "pytelegrambotapi"} or re.search(r"\bbot\b|бот", meta["name"], re.I):
        ptype = "bot"
    elif names & {"torch", "tensorflow", "transformers", "scikit-learn", "keras"} or any(p.endswith(".ipynb") for p in visible):
        ptype = "ml"
    elif names & {"react", "vue", "svelte", "next", "@angular/core", "vite", "nuxt"}:
        ptype = "web"
    elif names & {"fastapi", "flask", "django", "express", "fastify", "@nestjs/core"}:
        ptype = "api"
    elif any(p.endswith((".html", ".htm")) for p in visible):
        ptype = "static"
    elif langs.get("Python"):
        ptype = "python"

    readme = _readme(files)
    purpose = (
        meta.get("description")
        if meta.get("description") and not meta["description"].startswith("Файл папкадан")
        else ""
    ) or (pkg.get("description") if isinstance(pkg.get("description"), str) else "") or (
        _first_paragraph(readme[1]) if readme else ""
    ) or _html_title(files)

    todos = sum(len(TODO_RE.findall(c)) for p, c in files.items() if not _skipped(p) and not p.endswith(".md"))

    return {
        "type": ptype, "purpose": purpose.strip(), "fileCount": len(files), "bytes": total_bytes,
        "languages": langs.most_common(8), "stack": stack, "jsDeps": list(js_deps.keys()), "pyDeps": py_deps,
        "scripts": scripts, "entries": entries, "readme": readme, "todos": todos,
        "tree": _tree(visible, len(files) - len(visible)),
    }


def _tree(paths: List[str], hidden: int) -> List[str]:
    """Қысқа ағаш: папкалар бірінші, 4 деңгейге дейін, MAX_TREE_LINES жолдан аспайды"""
    root: Dict[str, Any] = {}
    for p in paths:
        node = root
        for part in p.split("/")[:-1]:
            node = node.setdefault(part + "/", {})
        node.setdefault(p.split("/")[-1], None)

    lines: List[str] = []
    overflow = 0

    def walk(node: Dict[str, Any], depth: int):
        nonlocal overflow
        for name in sorted(node, key=lambda k: (not k.endswith("/"), k.lower())):
            if len(lines) >= MAX_TREE_LINES:
                overflow += 1 + _count(node[name])
                continue
            child = node[name]
            if child is not None and depth >= 3:
                lines.append("  " * depth + f"{name} ({_count(child)})")
                continue
            lines.append("  " * depth + name)
            if child is not None:
                walk(child, depth + 1)

    walk(root, 0)
    if overflow:
        lines.append(f"… +{overflow}")
    if hidden:
        lines.append(f"(+{hidden} node_modules / build / .git …)")
    return lines


def _count(node: Optional[Dict[str, Any]]) -> int:
    if node is None:
        return 0
    return sum(1 + _count(v) for v in node.values())


# ---------- Codo (Gemini) талдауы ----------

AI_PROMPT = {
    "kk": "Сен Codo — код талдаушысың. Төмендегі жоба файлдарын оқып, қазақ тілінде қысқа Markdown талдау жаз. Бөлімдер (### деңгейлі тақырыптармен): «Мақсаты» (1–3 сөйлем: жоба не үшін және кімге арналған), «Негізгі мүмкіндіктер» (тізім), «Қалай жұмыс істейді» (архитектура, негізгі файлдар), «Жақсартуға ұсыныстар» (нақты 3–5 пункт: қателер, қауіпсіздік, жетіспейтін нәрселер). Тек файлдарда бар нәрсені жаз, ойдан қоспа. ``` блогына салма.",
    "ru": "Ты Codo — анализатор кода. Прочитай файлы проекта и напиши краткий анализ на русском в Markdown. Разделы (заголовки ###): «Цель» (1–3 предложения: для чего и для кого проект), «Основные возможности» (список), «Как работает» (архитектура, ключевые файлы), «Что улучшить» (3–5 конкретных пунктов: ошибки, безопасность, чего не хватает). Пиши только то, что есть в файлах. Не оборачивай в ```.",
    "en": "You are Codo, a code analyst. Read the project files below and write a short Markdown analysis in English. Sections (### headings): “Purpose” (1–3 sentences: what the project is for and who it serves), “Key features” (list), “How it works” (architecture, key files), “Suggested improvements” (3–5 concrete points: bugs, security, missing pieces). Only state what the files show. Don't wrap in ```.",
}


def _ai_source(meta: Dict[str, Any], info: Dict[str, Any], files: List[Tuple[str, str]]) -> str:
    parts = [f"Жоба: {meta['name']}", "Құрылымы:\n" + "\n".join(info["tree"])]
    budget = MAX_AI_SOURCE_CHARS
    priority = [p for p in ("README.md", "package.json", "requirements.txt", "pyproject.toml") if p in dict(files)] + info["entries"]
    ordered = sorted(
        (f for f in files if not _skipped(f[0]) and f[0].split("/")[-1] not in LOCK_FILES and EXT_LANG.get(os.path.splitext(f[0])[1].lower())),
        key=lambda f: (f[0] not in priority, priority.index(f[0]) if f[0] in priority else 0, f[0].count("/"), len(f[1])),
    )
    for path, content in ordered:
        if budget <= 500:
            break
        chunk = content[: min(len(content), 8000, budget)]
        parts.append(f"--- {path} ---\n{chunk}")
        budget -= len(chunk)
    return "\n\n".join(parts)


async def ai_summary(user: User, meta: Dict[str, Any], info: Dict[str, Any], files: List[Tuple[str, str]], lang: str) -> str:
    from services import burkit_service

    key, _ = burkit_service.resolve_key(user)
    if not key:
        raise HTTPException(status_code=403, detail="Codo талдауы үшін API кілтін қосыңыз (Баптаулар → Codo).")
    payload = {
        "systemInstruction": {"parts": [{"text": AI_PROMPT[lang]}]},
        "contents": [{"role": "user", "parts": [{"text": _ai_source(meta, info, files)}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 2048},
    }
    stream = await burkit_service.open_stream(key, payload)
    text = "".join([chunk async for chunk in stream])
    return burkit_service.strip_fences(text).strip()


# ---------- Markdown ----------

def render(meta: Dict[str, Any], info: Dict[str, Any], lang: str, folder: str, ai: Optional[str]) -> str:
    t = L[lang]
    out: List[str] = [AUTO_START, f"# {meta['name']}", ""]
    kind_label = t["vibe"] if meta["kind"] == "vibe" else t["site"]
    link = f"/vibecoding?project={meta['id']}" if meta["kind"] == "vibe" else f"/view/{meta['id']}"
    out.append(f"> [!info] {t['type'][info['type']]} · {kind_label}")
    out.append(f"> {t['source']}: [{t['open']}]({link}) · {t['updated']}: {_iso(meta.get('updatedAt'))} · {t['synced']}: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    out.append("")

    out += [f"## {t['purpose']}", "", info["purpose"] or f"_{t['noPurpose']}_", ""]
    if ai:
        out += [f"## {t['ai']}", "", ai, ""]

    facts = [
        f"- **{t['kind']}:** {t['type'][info['type']]}",
        f"- **{t['files']}:** {info['fileCount']} · **{t['size']}:** {_size(info['bytes'])}",
    ]
    if info["languages"]:
        facts.append(f"- **{t['langs']}:** " + ", ".join(f"{name} ({n})" for name, n in info["languages"]))
    if info["stack"]:
        facts.append(f"- **{t['stack']}:** " + ", ".join(info["stack"]))
    if meta["kind"] == "site":
        facts.append(f"- **{t['visibility']}:** {t['private'] if meta.get('isPrivate') else t['public']} · **{t['role']}:** {t[meta['role']]}")
        if meta.get("members"):
            facts.append(f"- **{t['members']}:** " + ", ".join(meta["members"][:20]))
        tags = [x for x in meta.get("tags", []) if not x.startswith(("category:", "lang:", "folder"))]
        if tags:
            facts.append(f"- **{t['tags']}:** " + ", ".join(tags[:15]))
    if folder:
        facts.append(f"- **{t['folder']}:** `{folder}`")
    if info["todos"]:
        facts.append(f"- **{t['todo']}:** {info['todos']}")
    out += [f"## {t['about']}", "", *facts, ""]

    if info["entries"]:
        out += [f"## {t['entry']}", "", *[f"- `{e}`" for e in info["entries"]], ""]
    if info["scripts"]:
        out += [f"## {t['scripts']}", "", "```bash", *info["scripts"], "```", ""]
    deps = info["jsDeps"] + info["pyDeps"]
    if deps:
        shown = ", ".join(f"`{d}`" for d in deps[:40]) + (f" … +{len(deps) - 40}" if len(deps) > 40 else "")
        out += [f"## {t['deps']}", "", shown, ""]
    if info["tree"]:
        out += [f"## {t['tree']}", "", "```", *info["tree"], "```", ""]
    if info["readme"]:
        path, text = info["readme"]
        body = text.strip()
        if len(body) > MAX_README_CHARS:
            body = body[:MAX_README_CHARS].rsplit("\n", 1)[0] + "\n\n…"
        # README тақырыптары жазбаның өз тақырыптарымен араласпасын — бір деңгей төмендетеміз
        body = _demote_headings(body)
        out += [f"## {t['readme']} (`{path}`)", "", body, ""]
    out.append(AUTO_END)
    return "\n".join(out)


def _demote_headings(text: str) -> str:
    """# → ###: код блоктарының ішіне тиіспейміз (``` ішіндегі «# пікір» тақырып емес)"""
    out, fence = [], False
    for line in text.split("\n"):
        if line.lstrip().startswith(("```", "~~~")):
            fence = not fence
        elif not fence:
            m = re.match(r"^(#{1,5}) ", line)
            if m:
                line = "#" * min(len(m.group(1)) + 2, 6) + line[len(m.group(1)):]
        out.append(line)
    return "\n".join(out)


def _merge(existing: str, key: str, block: str, lang: str) -> str:
    """Автоматты бөлімді ауыстыру; қолданушының жазғаны (бөлімнен тыс) сақталады"""
    head = marker(key)
    if existing and AUTO_START in existing and AUTO_END in existing:
        before, rest = existing.split(AUTO_START, 1)
        after = rest.split(AUTO_END, 1)[1]
        return before + block + after
    tail = existing.replace(head, "", 1).strip() if existing else ""
    return f"{head}\n{block}\n\n## {L[lang]['myNotes']}\n\n{tail}\n"


def _write(db: Session, owner_id: str, key: str, folder: str, title: str, block: str, lang: str, existing: Optional[Note]) -> Note:
    if existing:
        NoteService.update_note(db, owner_id, existing.id, content=_merge(existing.content or "", key, block, lang))
        db.refresh(existing)
        return existing
    created = NoteService.create_note(db, owner_id, title, folder, "note", _merge("", key, block, lang))
    return db.query(Note).filter(Note.id == created["id"]).first()


def _note_link(note: Note) -> str:
    return f"[[{note.folder}/{note.title}|{note.title}]]" if note.folder else f"[[{note.title}]]"


def _refresh_index(db: Session, owner_id: str, lang: str) -> Optional[Note]:
    """«Менің жобаларым» — қосылған барлық жобаның тізімі (сілтемелерімен)"""
    linked = _linked_notes(db, owner_id)
    t = L[lang]
    vibe = sorted((n for k, n in linked.items() if k.startswith("vibe:")), key=lambda n: n.title.lower())
    site = sorted((n for k, n in linked.items() if k.startswith("site:")), key=lambda n: n.title.lower())
    lines = [AUTO_START, f"# {INDEX_TITLE[lang]}", "", t["indexText"], ""]
    if vibe:
        lines += [f"## {t['vibeMany']} ({len(vibe)})", "", *[f"- {_note_link(n)}" for n in vibe], ""]
    if site:
        lines += [f"## {t['siteMany']} ({len(site)})", "", *[f"- {_note_link(n)}" for n in site], ""]
    lines.append(AUTO_END)
    return _write(db, owner_id, INDEX_KEY, "", INDEX_TITLE[lang], "\n".join(lines), lang, linked.get(INDEX_KEY))


# ---------- Негізгі әрекет ----------

async def import_project(db: Session, user: User, kind: str, project_id: str, lang: Optional[str], use_ai: bool) -> Dict[str, Any]:
    lang = _lang(lang)
    if kind == "vibe":
        meta, files = _load_vibe(db, user, project_id)
        folder = project_notes.ensure_folder(db, meta["project"])
    elif kind == "site":
        meta, files = _load_site(user, project_id)
        folder = clean_folder(f"{SITE_ROOT}/{_safe_title(meta['name'])}")
    else:
        raise HTTPException(status_code=400, detail="Жоба түрі дұрыс емес")

    info = analyze(meta, files)
    ai_text = await ai_summary(user, meta, info, files, lang) if use_ai else None

    key = f"{kind}:{project_id}"
    existing = _linked_notes(db, user.id).get(key)
    if existing and not use_ai:
        # Бұрын жасалған Codo талдауы жай жаңартқанда жоғалмасын
        ai_text = _previous_ai(existing.content or "", lang)
    block = render(meta, info, lang, folder, ai_text)
    note = _write(db, user.id, key, folder, _safe_title(meta["name"]), block, lang, existing)
    _refresh_index(db, user.id, lang)
    return {**NoteService.to_meta(note), "created": existing is None}


def _previous_ai(content: str, lang: str) -> Optional[str]:
    """Алдыңғы «Codo талдауы» бөлімі (кез келген тілде) — қайта сұрамай сақтап қаламыз"""
    for heading in {L[x]["ai"] for x in L}:
        m = re.search(rf"^## {re.escape(heading)}\n\n(.*?)(?=^## |\Z|{re.escape(AUTO_END)})", content, re.S | re.M)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return None
