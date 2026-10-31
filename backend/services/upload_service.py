"""Чат тіркемелерін (сурет, видео, аудио, файл) тексеріп сақтау — жеке және топтық чатқа ортақ"""
import os
import shutil
import uuid
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, UploadFile

from config import DANGEROUS_EXTENSIONS, MAX_FILE_SIZE
from utils.media_access import LEGACY_CHAT_DIRS, UPLOADS_PREFIX, safe_id

UPLOAD_DIR = "uploads"

_SUBDIRS = {
    "image": "images",
    "audio": "audio",
    "video": "video",
    "file": "files",
}

for _subdir in _SUBDIRS.values():
    os.makedirs(f"{UPLOAD_DIR}/{_subdir}", exist_ok=True)


# Файл қай чатқа тиесілі: ("dm", a, b) не ("g", group_id)
ChatScope = Tuple[str, ...]


def dm_scope(user_a: Any, user_b: Any) -> ChatScope:
    a, b = sorted((str(user_a), str(user_b)))
    return ("dm", a, b)


def group_scope(group_id: Any) -> ChatScope:
    return ("g", str(group_id))


def _scope_dir(scope: ChatScope) -> str:
    """uploads/chat/dm/<a>/<b> не uploads/chat/g/<group_id>.
    Чат жолда тұрғандықтан сервер әр сұраныста «бұл адам осы чатта ма» деп тексере алады"""
    ids = [safe_id(x) for x in scope[1:]]
    if scope[0] not in ("dm", "g") or not ids or not all(ids):
        raise HTTPException(status_code=400, detail="Invalid chat")
    return "/".join(["chat", scope[0], *ids])


def _clean_name(name: Optional[str]) -> str:
    safe = os.path.basename(name or "") or "upload"
    safe = safe.replace("..", "").replace("/", "").replace("\\", "")
    # URL-ді бұзатын таңбалар (? # %) — сілтеме мен қолтаңба бір жолға сәйкес келуі үшін
    safe = "".join("_" if ch in '?#%"<>' or ord(ch) < 32 else ch for ch in safe).strip()
    return safe[:150] or "upload"


async def save_chat_attachment(file: UploadFile, message_type: str, scope: ChatScope) -> Dict[str, Any]:
    """Файлды тексеріп, uploads/chat/<чат>/<кездейсоқ>/ ішіне сақтайды және тіркеме объектісін
    қайтарады. Кездейсоқ папка — жолды болжап табу мүмкін емес.

    Қате болса HTTPException(400) лақтырады.
    """
    content_bytes = await file.read()

    if file.filename:
        file_ext = os.path.splitext(file.filename)[1].lower()
        if file_ext in DANGEROUS_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"File type '{file_ext}' is not allowed")

    # Сурет деп жарияланса — шын мәнінде сурет екенін магиялық байттар бойынша тексеру
    if file.content_type and file.content_type.startswith("image/"):
        import filetype

        kind = filetype.guess(content_bytes)
        if kind is None:
            raise HTTPException(
                status_code=400,
                detail="Could not verify file type. Only valid image files are accepted.",
            )
        if kind.mime != file.content_type:
            raise HTTPException(status_code=400, detail="File content does not match the declared file type")

    if len(content_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds maximum allowed size")

    safe_filename = _clean_name(file.filename)
    rel_dir = f"{_scope_dir(scope)}/{uuid.uuid4().hex}"
    os.makedirs(os.path.join(UPLOAD_DIR, rel_dir), exist_ok=True)
    file_path = os.path.join(UPLOAD_DIR, rel_dir, safe_filename)

    upload_dir_abs = os.path.abspath(UPLOAD_DIR)
    if not os.path.abspath(file_path).startswith(upload_dir_abs + os.sep):
        raise HTTPException(status_code=400, detail="Invalid file path")

    with open(file_path, "wb") as buffer:
        buffer.write(content_bytes)

    return {
        "filename": safe_filename,
        "url": f"{UPLOADS_PREFIX}{rel_dir}/{safe_filename}",
        "size": len(content_bytes),
        "mimeType": file.content_type or "application/octet-stream",
    }


def _is_upload_url(url: Any) -> bool:
    return isinstance(url, str) and (url.startswith(UPLOADS_PREFIX) or "/uploads/" in url)


def strip_client_attachments(attachments: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """JSON арқылы келген тіркемелерден серверде жүктелген файлдарға сілтемелерді алып тастау.
    Әйтпесе біреу бөтен чаттың файл жолын өз хабарламасына жазып, сервер оған қолтаңба
    қойып берер еді. Нағыз файл тек /upload маршруттары арқылы қосылады"""
    return [a for a in (attachments or []) if isinstance(a, dict) and not _is_upload_url(a.get("url"))]


def copy_attachments_to(attachments: List[Dict[str, Any]], scope: ChatScope) -> List[Dict[str, Any]]:
    """Forward: файлдың көшірмесін жаңа чаттың папкасына жасау — жаңа чаттағылар оны көре
    алады, ал бастапқы чатқа рұқсат ашылмайды. Файл табылмаса, тіркеме алынып тасталады"""
    result: List[Dict[str, Any]] = []
    target_dir = _scope_dir(scope)
    upload_dir_abs = os.path.abspath(UPLOAD_DIR)
    for att in attachments or []:
        url = att.get("url") if isinstance(att, dict) else None
        if not isinstance(url, str) or not url.startswith(UPLOADS_PREFIX):
            if isinstance(att, dict) and not _is_upload_url(url):
                result.append(att)
            continue
        rel = url[len(UPLOADS_PREFIX):].split("?", 1)[0]
        if rel.startswith("~"):
            rel = rel.partition("/")[2]
        top = rel.split("/", 1)[0]
        src = os.path.abspath(os.path.join(UPLOAD_DIR, rel))
        if ".." in rel or top not in ("chat",) + LEGACY_CHAT_DIRS or not src.startswith(upload_dir_abs + os.sep) or not os.path.isfile(src):
            continue
        if rel.startswith(target_dir + "/"):
            result.append(att)  # сол чаттың өзіне
            continue
        name = _clean_name(os.path.basename(rel))
        rel_dir = f"{target_dir}/{uuid.uuid4().hex}"
        os.makedirs(os.path.join(UPLOAD_DIR, rel_dir), exist_ok=True)
        dst = os.path.join(UPLOAD_DIR, rel_dir, name)
        try:
            os.link(src, dst)  # орын алмайды; болмаса — кәдімгі көшірме
        except OSError:
            shutil.copy2(src, dst)
        result.append({**att, "url": f"{UPLOADS_PREFIX}{rel_dir}/{name}"})
    return result
