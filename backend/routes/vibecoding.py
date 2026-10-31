"""Vibecoding жобалары — әр қолданушының жеке жобалары (тек иесіне қолжетімді)"""
import asyncio
import json
import logging
import secrets
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from services.project_settings import resolve_private
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from database import messages as direct_messages
from db import ChatGroupMessage, User, VibecodingProject, get_db
from services.code_service import CodeService
from utils.upload_rules import classify_upload_path
from services.group_service import GroupService
from services import project_notes, terminal_workspace
from services.terminal_service import terminal_manager
from utils.auth import get_current_user

router = APIRouter()
logger = logging.getLogger("codo_hub.vibecoding")
limiter = Limiter(key_func=get_remote_address)

MAX_PROJECTS_PER_USER = 100
MAX_PROJECT_BYTES = 2 * 1024 * 1024  # бір жобаның барлық файлдары — 2MB


class VibecodingFile(BaseModel):
    id: str = Field(max_length=64)
    name: str = Field(max_length=255)
    path: str = Field(max_length=1024)
    content: str = ""
    language: str = Field(default="plaintext", max_length=50)


class VibecodingProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    files: List[VibecodingFile] = Field(default_factory=list, max_length=500)
    folders: List[str] = Field(default_factory=list, max_length=1000)
    createdAt: str | None = None


def _iso(value: datetime | None) -> str:
    return value.isoformat() + "Z" if value else ""


def _load_json_list(raw: str | None) -> list:
    try:
        value = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) else []


def _clean_folders(folders: List[str]) -> List[str]:
    """Папка жолдарын тазалау: бос бөліктерсіз, қайталанбайтын, ұзындығы шектелген"""
    result = []
    for folder in folders:
        path = "/".join(part for part in folder.split("/") if part)
        if path and len(path) <= 1024 and path not in result:
            result.append(path)
    return result


def _to_dict(project: VibecodingProject) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "files": _load_json_list(project.files),
        "folders": _load_json_list(project.folders),
        "notesFolder": project.notes_folder,
        "shareToken": project.share_token,
        "createdAt": _iso(project.created_at),
        "updatedAt": _iso(project.updated_at),
    }


@router.get("/vibecoding/projects")
@limiter.limit("60/minute")
async def list_projects(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Қолданушының барлық Vibecoding жобалары"""
    projects = (
        db.query(VibecodingProject)
        .filter(VibecodingProject.owner_id == user.id)
        .order_by(VibecodingProject.updated_at.desc())
        .all()
    )
    for p in projects:
        _link_notes(db, p)
    return [_to_dict(p) for p in projects]


def _link_notes(db: Session, project: VibecodingProject) -> None:
    """Жобаның Notes папкасын қамтамасыз ету; Notes шегіне жетсе — жобаны сақтауға кедергі жасамайды"""
    try:
        project_notes.ensure_folder(db, project)
    except HTTPException:
        db.rollback()


@router.put("/vibecoding/projects/{project_id}")
@limiter.limit("120/minute")
async def save_project(
    request: Request,
    project_id: str,
    data: VibecodingProjectIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Жобаны жасау немесе жаңарту (upsert)"""
    if not project_id or len(project_id) > 64:
        raise HTTPException(status_code=400, detail="Жоба ID-і дұрыс емес")

    files_json = json.dumps([f.model_dump() for f in data.files], ensure_ascii=False)
    folders_json = json.dumps(_clean_folders(data.folders), ensure_ascii=False)
    if len(files_json.encode("utf-8")) > MAX_PROJECT_BYTES:
        raise HTTPException(status_code=413, detail="Жоба тым үлкен (максимум 2MB)")

    project = db.query(VibecodingProject).filter(VibecodingProject.id == project_id).first()
    if project and project.owner_id != user.id:
        # Басқа біреудің жобасы — бар екенін де ашпаймыз
        raise HTTPException(status_code=404, detail="Жоба табылмады")

    if not project:
        count = db.query(VibecodingProject).filter(VibecodingProject.owner_id == user.id).count()
        if count >= MAX_PROJECTS_PER_USER:
            raise HTTPException(status_code=400, detail="Жобалар саны шегіне жетті")
        created_at = None
        if data.createdAt:
            try:
                created_at = datetime.fromisoformat(data.createdAt.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                created_at = None
        project = VibecodingProject(
            id=project_id, owner_id=user.id, name=data.name, files=files_json, folders=folders_json
        )
        if created_at:
            project.created_at = created_at
        db.add(project)
    else:
        project.name = data.name
        project.files = files_json
        project.folders = folders_json
        project.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(project)
    if not project.notes_folder:
        _link_notes(db, project)
    # Жоба терминалда ашылған болса — оның папкасын да жаңарту
    try:
        await asyncio.to_thread(
            terminal_workspace.push, user.id, project.id, project.name,
            _load_json_list(project.files), _load_json_list(project.folders),
        )
    except Exception as e:
        logger.error("Terminal workspace push failed for %s: %s", project.id, e)
    return _to_dict(project)


@router.delete("/vibecoding/projects/{project_id}")
@limiter.limit("60/minute")
async def delete_project(
    request: Request,
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Жобаны жою"""
    project = db.query(VibecodingProject).filter(VibecodingProject.id == project_id).first()
    if not project or project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    db.delete(project)
    db.commit()
    # Алдымен терминалдарды жабамыз — әйтпесе shell папканы бос жібермейді (Windows)
    await terminal_manager.close_project_sessions(user.id, project_id)
    await asyncio.to_thread(terminal_workspace.remove, user.id, project_id)
    return {"message": "Жоба жойылды"}


class ForkRequest(BaseModel):
    messageId: str = Field(min_length=1, max_length=64)
    groupId: Optional[str] = Field(default=None, max_length=64)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)


def _shared_vibe_card(db: Session, user_id: str, data: ForkRequest) -> tuple[str, dict]:
    """Қолданушыға чатта шынымен жіберілген Vibecoding жоба картасын табу: (жіберуші id, metadata)"""
    if data.groupId:
        GroupService.require_member(db, data.groupId, user_id)
        msg = (
            db.query(ChatGroupMessage)
            .filter(ChatGroupMessage.id == data.messageId, ChatGroupMessage.group_id == data.groupId)
            .first()
        )
        if not msg or msg.type != "project":
            raise HTTPException(status_code=404, detail="Жоба табылмады")
        try:
            meta = json.loads(msg.meta or "{}")
        except ValueError:
            meta = {}
        return msg.from_user_id, meta if isinstance(meta, dict) else {}

    msg = next(
        (
            m for m in direct_messages
            if m.get("id") == data.messageId and user_id in (m.get("toUserId"), m.get("fromUserId"))
        ),
        None,
    )
    if not msg or msg.get("type") != "project":
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    return msg.get("fromUserId"), msg.get("metadata") or {}


@router.post("/vibecoding/projects/fork")
@limiter.limit("20/minute")
async def fork_shared_project(
    request: Request,
    data: ForkRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Чатта бөлісілген Vibecoding жобасының көшірмесін өзіме алу"""
    sender_id, meta = _shared_vibe_card(db, user.id, data)
    if meta.get("kind") != "vibe":
        raise HTTPException(status_code=400, detail="Бұл Vibecoding жобасы емес")

    source = db.query(VibecodingProject).filter(VibecodingProject.id == meta.get("projectId")).first()
    # Жоба әлі де картаны жіберген адамдікі болуы керек (жойылса/басқаға өтсе — жоқ)
    if not source or source.owner_id != sender_id:
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    if source.owner_id == user.id:
        raise HTTPException(status_code=400, detail="Бұл өз жобаңыз")

    count = db.query(VibecodingProject).filter(VibecodingProject.owner_id == user.id).count()
    if count >= MAX_PROJECTS_PER_USER:
        raise HTTPException(status_code=400, detail="Жобалар саны шегіне жетті")

    copy = VibecodingProject(
        id=f"fork-{uuid.uuid4().hex[:20]}",
        owner_id=user.id,
        name=(data.name or source.name).strip()[:200] or source.name,
        files=source.files,
        folders=source.folders,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _to_dict(copy)


# ─── Бөлісу сілтемесі, сілтеме бойынша көшіру, Жобалар бетіне жариялау ───

def _own_project(db: Session, user: User, project_id: str) -> VibecodingProject:
    project = db.query(VibecodingProject).filter(VibecodingProject.id == project_id).first()
    if not project or project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    return project


def _shared_project(db: Session, token: str) -> VibecodingProject:
    project = (
        db.query(VibecodingProject).filter(VibecodingProject.share_token == token).first()
        if token and len(token) <= 64 else None
    )
    if not project:
        raise HTTPException(status_code=404, detail="Сілтеме жарамсыз немесе өшірілген")
    return project


@router.post("/vibecoding/projects/{project_id}/share")
@limiter.limit("30/minute")
async def create_share_link(
    request: Request, project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Жобаның бөлісу сілтемесі (бар болса — сол): сілтемесі бар кез келген қолданушы көріп, көшіре алады"""
    project = _own_project(db, user, project_id)
    if not project.share_token:
        project.share_token = secrets.token_urlsafe(18)
        db.commit()
    return {"token": project.share_token}


@router.delete("/vibecoding/projects/{project_id}/share")
@limiter.limit("30/minute")
async def revoke_share_link(
    request: Request, project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Сілтемені өшіру — бұрын берілген сілтемелер бұдан былай ашылмайды"""
    project = _own_project(db, user, project_id)
    project.share_token = None
    db.commit()
    return {"message": "Сілтеме өшірілді"}


@router.get("/vibecoding/shared/{token}")
@limiter.limit("60/minute")
async def get_shared_project(
    request: Request, token: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Сілтеме бойынша жобаны көру (тек оқу)"""
    project = _shared_project(db, token)
    owner = db.query(User).filter(User.id == project.owner_id).first()
    return {
        "name": project.name,
        "owner": owner.username if owner else None,
        "isOwner": project.owner_id == user.id,
        "projectId": project.id if project.owner_id == user.id else None,
        "files": _load_json_list(project.files),
        "folders": _load_json_list(project.folders),
        "updatedAt": _iso(project.updated_at),
    }


class SharedForkRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)


@router.post("/vibecoding/shared/{token}/fork")
@limiter.limit("20/minute")
async def fork_by_link(
    request: Request,
    token: str,
    data: SharedForkRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Сілтеме бойынша бөлісілген жобаның көшірмесін өзіме алу"""
    source = _shared_project(db, token)
    if source.owner_id == user.id:
        raise HTTPException(status_code=400, detail="Бұл өз жобаңыз")
    count = db.query(VibecodingProject).filter(VibecodingProject.owner_id == user.id).count()
    if count >= MAX_PROJECTS_PER_USER:
        raise HTTPException(status_code=400, detail="Жобалар саны шегіне жетті")
    copy = VibecodingProject(
        id=f"fork-{uuid.uuid4().hex[:20]}",
        owner_id=user.id,
        name=(data.name or source.name).strip()[:200] or source.name,
        files=source.files,
        folders=source.folders,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _to_dict(copy)


class PublishRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    tags: List[str] = Field(default_factory=list, max_length=10)


@router.post("/vibecoding/projects/{project_id}/publish")
@limiter.limit("10/minute")
async def publish_project(
    request: Request,
    project_id: str,
    data: PublishRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Vibecoding жобасын Жобалар бетіне (кодтар) папка ретінде жариялау — Upload-тағы папкамен бірдей пішінде"""
    project = _own_project(db, user, project_id)
    all_files = [f for f in _load_json_list(project.files) if isinstance(f, dict) and f.get("path")]
    # Кэш/қоқыс үнсіз, құпия (.env) мен бинарлы файлдар — тізіммен өткізіледі (Upload-пен бірдей ереже)
    kinds = {f["path"]: classify_upload_path(f["path"]) for f in all_files}
    files = [f for f in all_files if kinds[f["path"]] is None]
    skipped = [p for p, kind in kinds.items() if kind in ("executable", "secret", "database", "binary")]
    if not files:
        raise HTTPException(status_code=400, detail="Жоба бос — жариялайтын файл жоқ")

    title = (data.title or project.name).strip()[:200] or project.name
    # Upload сияқты: барлық жол түбірлік папка атымен басталады
    root = "".join(ch for ch in title if ch not in '\/:*?"<>|').strip() or "project"
    structure: dict = {root: {"type": "folder", "name": root}}
    for folder in _load_json_list(project.folders):
        if isinstance(folder, str) and folder and classify_upload_path(f"{folder}/_") != "junk":
            parts = folder.split("/")
            for i in range(1, len(parts) + 1):
                key = f"{root}/{'/'.join(parts[:i])}"
                structure.setdefault(key, {"type": "folder", "name": parts[i - 1]})
    languages: dict[str, int] = {}
    files_data = []
    for f in files:
        path = f"{root}/{f['path']}"
        parts = f["path"].split("/")
        for i in range(1, len(parts)):
            key = f"{root}/{'/'.join(parts[:i])}"
            structure.setdefault(key, {"type": "folder", "name": parts[i - 1]})
        content = f.get("content") or ""
        language = f.get("language") or "other"
        structure[path] = {"type": "file", "name": parts[-1], "size": len(content.encode("utf-8")), "language": language}
        languages[language] = languages.get(language, 0) + 1
        files_data.append({
            "title": parts[-1],
            "content": content,
            "language": language,
            "author": user.username,
            "description": data.description,
            "tags": ["folder-file"],
            "folderPath": path,
        })

    main_language = max(languages, key=languages.get) if languages else "folder"
    folder_data = {
        "title": title,
        "content": json.dumps({"structure": structure, "fileCount": len(files_data)}, ensure_ascii=False, indent=2),
        "language": main_language if main_language not in ("plaintext", "other") else "folder",
        "author": user.username,
        "description": data.description,
        "tags": [t.strip()[:30] for t in data.tags if t.strip()] or ["folder", "vibecoding"],
        "folderStructure": structure,
        "isPrivate": resolve_private(None, user.id),
    }
    try:
        result = CodeService.create_folder_batch(folder_data, files_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if result["created"] == 0:
        # Бірде-бір файл өтпесе (сайттың қауіпсіздік саясаты: .py, .js, .html т.б.) — бос папка қалмасын
        CodeService.delete_code(result["folderId"])
        raise HTTPException(
            status_code=400,
            detail="Жобаның бірде-бір файлы жариялауға рұқсат етілмеген түрде: " + ", ".join(result["failedFiles"][:10]),
        )
    return {
        "codeId": result["folderId"],
        "title": title,
        "created": result["created"],
        "failed": result["failed"],
        "failedFiles": result["failedFiles"],
        "skipped": skipped,
    }
