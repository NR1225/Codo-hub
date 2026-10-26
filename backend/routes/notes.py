"""Жазбалар (Obsidian сияқты) — әр қолданушының жеке vault-ы (тек иесіне қолжетімді)"""
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from db import User, get_db
from services.note_service import NoteService
from utils.auth import get_current_user

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    folder: str = Field(default="", max_length=1024)
    kind: str = Field(default="note", pattern=r"^(note|canvas)$")
    content: str = ""


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    folder: Optional[str] = Field(default=None, max_length=1024)
    content: Optional[str] = None
    starred: Optional[bool] = None
    updateLinks: bool = True


class FolderCreate(BaseModel):
    path: str = Field(min_length=1, max_length=1024)


class FolderRename(BaseModel):
    path: str = Field(min_length=1, max_length=1024)
    newPath: str = Field(min_length=1, max_length=1024)


@router.get("/notes")
@limiter.limit("60/minute")
async def get_vault(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Vault: барлық жазбалардың метадеректері (мәтінсіз) + папкалар"""
    return NoteService.vault_snapshot(db, user.id)


@router.get("/notes/search")
@limiter.limit("60/minute")
async def search_notes(
    request: Request,
    q: str = Query(min_length=1, max_length=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return NoteService.search(db, user.id, q)


@router.post("/notes/folders")
@limiter.limit("60/minute")
async def create_folder(
    request: Request, data: FolderCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return NoteService.create_folder(db, user.id, data.path)


@router.patch("/notes/folders")
@limiter.limit("30/minute")
async def rename_folder(
    request: Request, data: FolderRename, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Папканың атын өзгерту немесе жылжыту (ішіндегі жазбалармен бірге)"""
    return NoteService.rename_folder(db, user.id, data.path, data.newPath)


@router.delete("/notes/folders")
@limiter.limit("30/minute")
async def delete_folder(
    request: Request,
    path: str = Query(min_length=1, max_length=1024),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Папканы ішіндегі барлық жазбаларымен жою"""
    return NoteService.delete_folder(db, user.id, path)


@router.post("/notes")
@limiter.limit("60/minute")
async def create_note(
    request: Request, data: NoteCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return NoteService.create_note(db, user.id, data.title, data.folder, data.kind, data.content)


@router.get("/notes/{note_id}")
@limiter.limit("120/minute")
async def get_note(request: Request, note_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return NoteService.to_dict(NoteService.get_owned(db, user.id, note_id))


@router.patch("/notes/{note_id}")
@limiter.limit("240/minute")
async def update_note(
    request: Request,
    note_id: str,
    data: NoteUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Мәтінді сақтау, атын өзгерту, жылжыту, жұлдызша қою. Атауы өзгерсе — [[сілтемелер]] де жаңарады"""
    return NoteService.update_note(
        db,
        user.id,
        note_id,
        title=data.title,
        folder=data.folder,
        content=data.content,
        starred=data.starred,
        update_links=data.updateLinks,
    )


@router.delete("/notes/{note_id}")
@limiter.limit("60/minute")
async def delete_note(request: Request, note_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    NoteService.delete_note(db, user.id, note_id)
    return {"message": "Жазба жойылды"}
