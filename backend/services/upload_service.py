"""Чат тіркемелерін (сурет, видео, аудио, файл) тексеріп сақтау — жеке және топтық чатқа ортақ"""
import os
from datetime import datetime
from typing import Any, Dict

from fastapi import HTTPException, UploadFile

from config import DANGEROUS_EXTENSIONS, MAX_FILE_SIZE

UPLOAD_DIR = "uploads"

_SUBDIRS = {
    "image": "images",
    "audio": "audio",
    "video": "video",
    "file": "files",
}

for _subdir in _SUBDIRS.values():
    os.makedirs(f"{UPLOAD_DIR}/{_subdir}", exist_ok=True)


async def save_chat_attachment(file: UploadFile, message_type: str) -> Dict[str, Any]:
    """Файлды тексеріп, uploads/ ішіне сақтайды және тіркеме объектісін қайтарады.

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

    upload_subdir = _SUBDIRS.get(message_type, "files")
    upload_path = f"{UPLOAD_DIR}/{upload_subdir}"

    # Файл атауын тазалау (path traversal болмауы үшін)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_filename = os.path.basename(file.filename) if file.filename else "upload"
    safe_filename = safe_filename.replace("..", "").replace("/", "").replace("\\", "") or "upload"
    unique_filename = f"{timestamp}_{safe_filename}"
    file_path = os.path.join(upload_path, unique_filename)

    upload_dir_abs = os.path.abspath(UPLOAD_DIR)
    if not os.path.abspath(file_path).startswith(upload_dir_abs):
        raise HTTPException(status_code=400, detail="Invalid file path")

    with open(file_path, "wb") as buffer:
        buffer.write(content_bytes)

    return {
        "filename": safe_filename,
        "url": f"/api/uploads/{upload_subdir}/{unique_filename}",
        "size": len(content_bytes),
        "mimeType": file.content_type or "application/octet-stream",
    }
