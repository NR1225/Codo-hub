"""Vibecoding Source Control: жобаның git күйі, өзгерістер, коммиттер графы"""
import asyncio
import json
import os
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from db import User, VibecodingProject, get_db
from services import terminal_workspace, vibe_git
from utils.auth import get_current_user

router = APIRouter()
logger = logging.getLogger("codo_hub.vibe_git")
limiter = Limiter(key_func=get_remote_address)


class PathsIn(BaseModel):
    paths: List[str] = Field(default_factory=list, max_length=2000)


class CommitIn(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    all: bool = False


def _load(raw: Optional[str]) -> list:
    try:
        data = json.loads(raw or "[]")
        return data if isinstance(data, list) else []
    except ValueError:
        return []


async def _workspace(db: Session, user: User, project_id: str) -> str:
    """Жобаның терминал папкасы (жоқ болса — дерекқордағы файлдардан жасалады)"""
    if not vibe_git.available():
        raise HTTPException(status_code=503, detail="Серверде git орнатылмаған")
    project = db.query(VibecodingProject).filter(VibecodingProject.id == project_id).first()
    if not project or project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    root = terminal_workspace.project_dir(user.id, project.id)
    if not root or not os.path.isdir(root):
        root = await asyncio.to_thread(
            terminal_workspace.push, user.id, project.id, project.name,
            _load(project.files), _load(project.folders), True,
        )
    if not root:
        raise HTTPException(status_code=500, detail="Жоба папкасы жасалмады")
    return root


async def _call(fn, *args):
    try:
        return await asyncio.to_thread(fn, *args)
    except vibe_git.GitError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


async def _changes(user: User, project_id: str):
    """git файлдарды өзгерткенде (discard) — редакторға жіберілетін өзгерістер"""
    try:
        return await asyncio.to_thread(terminal_workspace.pull, user.id, project_id)
    except Exception as e:  # pragma: no cover
        logger.error("Workspace pull after git failed for %s: %s", project_id, e)
        return None


@router.get("/vibecoding/projects/{project_id}/git/status")
@limiter.limit("120/minute")
async def git_status(request: Request, project_id: str,
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _call(vibe_git.status, root)


@router.post("/vibecoding/projects/{project_id}/git/init")
@limiter.limit("10/minute")
async def git_init(request: Request, project_id: str,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    await _call(vibe_git.init, root, user.username)
    return await _call(vibe_git.status, root)


@router.post("/vibecoding/projects/{project_id}/git/stage")
@limiter.limit("120/minute")
async def git_stage(request: Request, project_id: str, data: PathsIn,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    await _call(vibe_git.stage, root, data.paths)
    return await _call(vibe_git.status, root)


@router.post("/vibecoding/projects/{project_id}/git/unstage")
@limiter.limit("120/minute")
async def git_unstage(request: Request, project_id: str, data: PathsIn,
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    await _call(vibe_git.unstage, root, data.paths)
    return await _call(vibe_git.status, root)


@router.post("/vibecoding/projects/{project_id}/git/discard")
@limiter.limit("60/minute")
async def git_discard(request: Request, project_id: str, data: PathsIn,
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not data.paths:
        raise HTTPException(status_code=400, detail="Файл таңдалмаған")
    root = await _workspace(db, user, project_id)
    await _call(vibe_git.discard, root, data.paths)
    status = await _call(vibe_git.status, root)
    return {"status": status, "changes": await _changes(user, project_id)}


@router.post("/vibecoding/projects/{project_id}/git/commit")
@limiter.limit("30/minute")
async def git_commit(request: Request, project_id: str, data: CommitIn,
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    sha = await _call(vibe_git.commit, root, data.message, data.all, user.username)
    return {"sha": sha, "status": await _call(vibe_git.status, root)}


@router.get("/vibecoding/projects/{project_id}/git/log")
@limiter.limit("60/minute")
async def git_log(request: Request, project_id: str, limit: int = Query(200, ge=1, le=400),
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _call(vibe_git.log, root, limit)


@router.get("/vibecoding/projects/{project_id}/git/diff")
@limiter.limit("120/minute")
async def git_diff(request: Request, project_id: str,
                   path: str = Query(..., max_length=1024), staged: bool = False,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _call(vibe_git.file_diff, root, path, staged)


@router.get("/vibecoding/projects/{project_id}/git/commits/{sha}")
@limiter.limit("120/minute")
async def git_commit_detail(request: Request, project_id: str, sha: str,
                            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _call(vibe_git.show_commit, root, sha)


@router.get("/vibecoding/projects/{project_id}/git/commits/{sha}/diff")
@limiter.limit("120/minute")
async def git_commit_diff(request: Request, project_id: str, sha: str,
                          path: str = Query(..., max_length=1024),
                          user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _call(vibe_git.commit_file_diff, root, sha, path)
