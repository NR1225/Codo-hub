"""Vibecoding жобасы ↔ терминал папкасы синхрондауы.

Әр жоба терминалда ашылғанда оның файлдары қолданушының жеке workspace-іне
(``<TERMINAL_WORKSPACE_DIR>/<user>/<жоба-атауы>``) жазылады. Екі бағыт бар:

* **push** (жоба → диск) — терминал ашылғанда және жоба сақталған сайын;
* **pull** (диск → жоба) — терминалда команда орындалып, файлдар өзгергенде.

Үш жақты салыстыру үшін «manifest» сақталады: соңғы синхрондаудағы әр файлдың
хэші. Сонда кім нені өзгерткені белгілі болады — терминалдағы өзгерісті
редактордың ескі нұсқасы басып кетпейді, және керісінше.
Manifest жоба папкасынан тыс (``<user>/.kh-sync/<id>.json``) тұрады.
"""
import hashlib
import json
import logging
import os
import re
import shutil
import threading
from typing import Dict, List, Optional

from config import TERMINAL_WORKSPACE_DIR
from services import shared_packages
from utils.upload_rules import classify_upload_path, is_skipped

logger = logging.getLogger("codo_hub.terminal_workspace")

# Pull кезінде қарамайтын папкалар (тәуелділіктер, кэш, build нәтижелері)
IGNORED_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env", "dist", "build",
    ".next", ".nuxt", ".cache", ".npm", ".yarn", ".pnpm-store", ".idea", ".vscode",
    ".pytest_cache", ".mypy_cache", "target", "coverage",
}
MAX_FILE_BYTES = 512 * 1024          # бір файл (үлкені жобаға тартылмайды)
MAX_PULL_BYTES = 2 * 1024 * 1024     # жобаның шегімен бірдей
MAX_PULL_FILES = 500


def _junk_dir(rel_dir: str) -> bool:
    """Upload-тағы ереже: кэш/тәуелділік/build папкасы (dist, .pytest_cache, *.egg-info…)"""
    return classify_upload_path(f"{rel_dir}/_") == "junk"


def _junk_file(rel: str) -> bool:
    """Кэш/лог/lock-файл/орындалатын файл — жобаға (редакторға) қайтпайды"""
    return is_skipped(classify_upload_path(rel))

_locks: Dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def _safe_name(value: str, fallback: str = "x") -> str:
    return "".join(c for c in str(value) if c.isalnum() or c in ("-", "_")) or fallback


def user_root(user_id: str) -> str:
    path = os.path.abspath(os.path.join(TERMINAL_WORKSPACE_DIR, _safe_name(user_id, "anon")))
    os.makedirs(path, exist_ok=True)
    return path


def _manifest_path(user_id: str, project_id: str) -> str:
    return os.path.join(user_root(user_id), ".kh-sync", f"{_safe_name(project_id)}.json")


def _load_manifest(user_id: str, project_id: str) -> Optional[dict]:
    try:
        with open(_manifest_path(user_id, project_id), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _save_manifest(user_id: str, project_id: str, manifest: dict) -> None:
    path = _manifest_path(user_id, project_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)
    os.replace(tmp, path)


def _dir_slug(name: str) -> str:
    """Жоба атауынан папка атауы: "Менің сайтым!" → "Менің-сайтым" (терминал промптында көрінеді)"""
    slug = re.sub(r"[^\w.-]+", "-", name, flags=re.UNICODE).strip("-.")
    return slug[:60] or "project"


def _clean_rel(path: str) -> Optional[str]:
    """Жоба ішіндегі салыстырмалы жол; жобадан шығатын жолдар қабылданбайды"""
    if not isinstance(path, str) or "\\" in path or ":" in path or "\0" in path:
        return None
    parts = [p for p in path.split("/") if p and p != "."]
    if not parts or any(p == ".." for p in parts):
        return None
    return "/".join(parts)


def _inside(root: str, rel: str) -> Optional[str]:
    """Абсолют жол — тек symlink арқылы да root-тан шықпаса"""
    full = os.path.realpath(os.path.join(root, *rel.split("/")))
    real_root = os.path.realpath(root)
    if full != real_root and not full.startswith(real_root + os.sep):
        return None
    return full


def _hash(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def _read_bytes(path: str) -> Optional[bytes]:
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def _decode_text(data: bytes) -> Optional[str]:
    """Мәтінді файлды оқу; бинарлы болса — None.

    Windows PowerShell 5 ``>`` арқылы UTF-16 жазады, сондықтан BOM-ды ескереміз.
    """
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError:
            return None
    if b"\0" in data:
        return None
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None


def project_dir(user_id: str, project_id: str) -> Optional[str]:
    """Жоба бұрын терминалда ашылған болса — оның папкасы"""
    manifest = _load_manifest(user_id, project_id)
    if not manifest or not manifest.get("dir"):
        return None
    return os.path.join(user_root(user_id), manifest["dir"])


def push(user_id: str, project_id: str, project_name: str, files: List[dict],
         folders: List[str], create: bool = False) -> Optional[str]:
    """Жобаны дискіге жазу. ``create`` болмаса — тек бұрын ашылған жобалар үшін.

    Қайтарады: жоба папкасы (немесе None).
    """
    with _lock(f"{user_id}:{project_id}"):
        root_user = user_root(user_id)
        manifest = _load_manifest(user_id, project_id)
        if manifest is None:
            if not create:
                return None
            base = _dir_slug(project_name)
            dir_name, n = base, 2
            while os.path.exists(os.path.join(root_user, dir_name)):
                dir_name, n = f"{base}-{n}", n + 1
            manifest = {"dir": dir_name, "files": {}, "folders": []}

        root = os.path.join(root_user, manifest["dir"])
        os.makedirs(root, exist_ok=True)
        old_files: Dict[str, str] = manifest.get("files") or {}
        new_files: Dict[str, str] = {}

        for item in files:
            rel = _clean_rel(item.get("path", ""))
            if not rel:
                continue
            full = _inside(root, rel)
            if not full:
                continue
            # Бинарлы файл (нақты .sqlite база т.б.) байттармен келеді, қалғаны — мәтін
            raw = item.get("bytes")
            data = raw if isinstance(raw, bytes) else (item.get("content") or "").encode("utf-8")
            want = _hash(data)
            disk = _read_bytes(full)
            disk_hash = _hash(disk) if disk is not None else None
            base_hash = old_files.get(rel)

            if disk_hash == want:
                new_files[rel] = want
            elif base_hash is not None and base_hash == want and disk_hash != base_hash:
                # Редакторда өзгеріс жоқ, бірақ терминал файлды өзгертті/өшірді — pull алады
                new_files[rel] = base_hash
            else:
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "wb") as f:
                    f.write(data)
                new_files[rel] = want

        # Редакторда өшірілген файлдар — дискіде өзгермеген болса ғана өшіреміз
        for rel, base_hash in old_files.items():
            if rel in new_files:
                continue
            full = _inside(root, rel)
            if not full or not os.path.isfile(full):
                continue
            disk = _read_bytes(full)
            if disk is not None and _hash(disk) == base_hash:
                try:
                    os.remove(full)
                except OSError:
                    pass

        new_folders = []
        for folder in folders:
            rel = _clean_rel(folder)
            full = _inside(root, rel) if rel else None
            if full:
                os.makedirs(full, exist_ok=True)
                new_folders.append(rel)
        # Редакторда өшірілген бос папкалар
        for rel in sorted(set(manifest.get("folders") or []) - set(new_folders), key=len, reverse=True):
            full = _inside(root, rel)
            if full and os.path.isdir(full):
                try:
                    os.rmdir(full)  # тек бос болса
                except OSError:
                    pass

        manifest["files"] = new_files
        manifest["folders"] = new_folders
        _save_manifest(user_id, project_id, manifest)
        # node_modules — барлық қолданушыға ортақ бір жиынтыққа сілтеме
        try:
            shared_packages.attach(root)
        except Exception as e:
            logger.error("Shared packages attach failed for %s: %s", root, e)
        return root


def pull(user_id: str, project_id: str) -> Optional[dict]:
    """Терминалда болған өзгерістер (manifest-пен салыстырғанда).

    Қайтарады: {"upserts": [{path, content}], "deletes": [path],
    "folders": [жаңа папкалар], "deletedFolders": [path]} немесе None.
    """
    with _lock(f"{user_id}:{project_id}"):
        manifest = _load_manifest(user_id, project_id)
        if not manifest:
            return None
        root = os.path.join(user_root(user_id), manifest["dir"])
        if not os.path.isdir(root):
            return None
        known: Dict[str, str] = manifest.get("files") or {}
        known_folders = set(manifest.get("folders") or [])

        seen_files = set()
        disk_folders = set()
        upserts = []
        total = 0
        for dirpath, dirnames, filenames in os.walk(root):
            rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
            dirnames[:] = [
                d for d in dirnames
                if d not in IGNORED_DIRS and not os.path.islink(os.path.join(dirpath, d))
                and not _junk_dir(d if rel_dir == "." else f"{rel_dir}/{d}")
            ]
            if rel_dir != ".":
                disk_folders.add(rel_dir)
            for name in filenames:
                full = os.path.join(dirpath, name)
                rel = name if rel_dir == "." else f"{rel_dir}/{name}"
                if os.path.islink(full):
                    continue
                if _junk_file(rel):
                    # package-lock.json, *.log, *.pyc… — дискіде қалады, жобаға тартылмайды
                    if rel in known:
                        seen_files.add(rel)
                    continue
                try:
                    size = os.path.getsize(full)
                except OSError:
                    continue
                if size > MAX_FILE_BYTES:
                    continue
                seen_files.add(rel)
                data = _read_bytes(full)
                if data is None:
                    continue
                if known.get(rel) == _hash(data):
                    continue
                text = _decode_text(data)
                if text is None:
                    continue  # бинарлы файл
                total += len(data)
                if len(upserts) >= MAX_PULL_FILES or total > MAX_PULL_BYTES:
                    continue
                upserts.append({"path": rel, "content": text})

        deletes = [rel for rel in known if rel not in seen_files and not os.path.exists(os.path.join(root, *rel.split("/")))]
        new_folders = sorted(disk_folders - known_folders)
        deleted_folders = sorted(
            f for f in known_folders
            if f not in disk_folders and not os.path.isdir(os.path.join(root, *f.split("/")))
        )
        return {
            "upserts": upserts,
            "deletes": deletes,
            "folders": new_folders,
            "deletedFolders": deleted_folders,
        }


def signature(root: str) -> str:
    """Папканың арзан «суреті» (жол + өлшем + mtime) — өзгеріс болды ма, соны білу үшін"""
    h = hashlib.sha1()
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in IGNORED_DIRS and not _junk_dir(d if rel_dir == "." else f"{rel_dir}/{d}")
        )
        h.update(dirpath.encode("utf-8", "replace"))
        for name in sorted(filenames):
            try:
                st = os.stat(os.path.join(dirpath, name))
            except OSError:
                continue
            h.update(f"{name}:{st.st_size}:{st.st_mtime_ns};".encode("utf-8", "replace"))
    return h.hexdigest()


def remove(user_id: str, project_id: str) -> None:
    """Жоба жойылғанда оның терминал папкасын да өшіру"""
    with _lock(f"{user_id}:{project_id}"):
        manifest = _load_manifest(user_id, project_id)
        if manifest and manifest.get("dir"):
            root = os.path.join(user_root(user_id), manifest["dir"])
            # Алдымен ортақ node_modules сілтемелері — rmtree ортақ папканы өшірмесін
            shared_packages.detach(root)
            shutil.rmtree(root, ignore_errors=True)
        try:
            os.remove(_manifest_path(user_id, project_id))
        except OSError:
            pass
