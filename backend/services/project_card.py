"""Чаттағы жоба карталары (type='project').

Клиент тек {kind, projectId, invite} жібереді; атауы, тілі, файл саны сияқты деректерді
сервер өзі толтырады — карта жалған ақпарат көрсетпеуі үшін.
"""
import json
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database import codes
from db import User, VibecodingProject

DESCRIPTION_LIMIT = 240


def _load_files(raw: Optional[str]) -> list:
    try:
        value = json.loads(raw or "[]")
    except ValueError:
        return []
    return value if isinstance(value, list) else []


def _repo_card(db: Session, sender_id: str, project_id: str) -> Dict[str, Any]:
    code = next((c for c in codes if c.get("id") == project_id and not c.get("folderId")), None)
    if code and code.get("isPrivate"):
        # Жабық жобамен тек оны көре алатын адам (иесі не мүшесі) бөлісе алады
        from services.code_service import CodeService
        sender = db.query(User).filter(User.id == sender_id).first()
        if not CodeService.can_view(code, sender.username if sender else None):
            code = None
    if not code:
        raise HTTPException(status_code=404, detail="Repository not found")
    structure = code.get("folderStructure") or {}
    file_count = (
        sum(1 for v in structure.values() if isinstance(v, dict) and v.get("type") == "file")
        if code.get("isFolder")
        else 1
    )
    return {
        "kind": "repo",
        "projectId": code["id"],
        "title": code.get("title") or "",
        "language": code.get("language") or "",
        "description": (code.get("description") or "")[:DESCRIPTION_LIMIT],
        "author": code.get("author") or "",
        "isFolder": bool(code.get("isFolder")),
        "fileCount": file_count,
    }


def _vibe_card(db: Session, sender_id: str, project_id: str, invite: bool) -> Dict[str, Any]:
    project = db.query(VibecodingProject).filter(VibecodingProject.id == project_id).first()
    # Әзірге тек өз жобаңызбен бөлісуге болады (ортақ жобалар — келесі кезеңде)
    if not project or project.owner_id != sender_id:
        raise HTTPException(status_code=404, detail="Project not found")
    files = _load_files(project.files)
    languages: Dict[str, int] = {}
    for f in files:
        lang = (f.get("language") or "").strip() if isinstance(f, dict) else ""
        if lang and lang != "plaintext":
            languages[lang] = languages.get(lang, 0) + 1
    owner = db.query(User).filter(User.id == sender_id).first()
    return {
        "kind": "vibe",
        "projectId": project.id,
        "title": project.name,
        "language": max(languages, key=languages.get) if languages else "",
        "fileCount": len(files),
        "ownerId": sender_id,
        "author": owner.username if owner else "",
        "invite": invite,
    }


def build_project_metadata(db: Session, sender_id: str, metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Клиент жіберген метадеректі тексеріп, карта деректерін серверден толтырады"""
    metadata = metadata or {}
    kind = metadata.get("kind")
    project_id = metadata.get("projectId")
    if not isinstance(project_id, str) or not project_id or len(project_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid project")
    if kind == "repo":
        return _repo_card(db, sender_id, project_id)
    if kind == "vibe":
        return _vibe_card(db, sender_id, project_id, bool(metadata.get("invite")))
    raise HTTPException(status_code=400, detail="Invalid project kind")
