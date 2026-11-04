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

import uuid
from datetime import datetime

from db import User, VibecodingProject, VibePullRequest, get_db
from services import codo_remote, terminal_workspace, vibe_git
from utils.auth import get_current_user

router = APIRouter()
logger = logging.getLogger("codo_hub.vibe_git")
limiter = Limiter(key_func=get_remote_address)


class PathsIn(BaseModel):
    paths: List[str] = Field(default_factory=list, max_length=2000)


class CommitIn(BaseModel):
    message: str = Field(default="", max_length=5000)
    all: bool = False
    amend: bool = False


class BranchIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    checkout: bool = True
    start: Optional[str] = Field(default=None, max_length=200)
    new_name: Optional[str] = Field(default=None, max_length=200)
    force: bool = False


class StashIn(BaseModel):
    message: str = Field(default="", max_length=500)
    include_untracked: bool = True
    staged_only: bool = False


class StashActionIn(BaseModel):
    action: str = Field(pattern="^(apply|pop|drop)$")
    index: int = Field(ge=0, le=10000)


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
    if data.amend:
        sha = await _call(vibe_git.amend, root, data.message, data.all, user.username)
    else:
        if not data.message.strip():
            raise HTTPException(status_code=400, detail="Коммит хабарламасы бос")
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


async def _mutate(user: User, project_id: str, root: str, fn, *args):
    """Жұмыс папкасын өзгертетін операция (checkout, stash, merge): қате болса да
    файлдар өзгеруі мүмкін — сондықтан әрқашан редакторға өзгерістерді қайтарамыз"""
    error = None
    try:
        await asyncio.to_thread(fn, root, *args)
    except vibe_git.GitError as e:
        error = str(e)
    changes = await _changes(user, project_id)
    st = await _call(vibe_git.status, root)
    return {"status": st, "changes": changes, "error": error}


@router.get("/vibecoding/projects/{project_id}/git/branches")
@limiter.limit("120/minute")
async def git_branches(request: Request, project_id: str,
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _call(vibe_git.branches, root)


@router.post("/vibecoding/projects/{project_id}/git/checkout")
@limiter.limit("60/minute")
async def git_checkout(request: Request, project_id: str, data: BranchIn,
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _mutate(user, project_id, root, vibe_git.checkout, data.name)


@router.post("/vibecoding/projects/{project_id}/git/branch")
@limiter.limit("60/minute")
async def git_create_branch(request: Request, project_id: str, data: BranchIn,
                            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _mutate(user, project_id, root, vibe_git.create_branch, data.name, data.checkout, data.start)


@router.post("/vibecoding/projects/{project_id}/git/branch/rename")
@limiter.limit("60/minute")
async def git_rename_branch(request: Request, project_id: str, data: BranchIn,
                            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not data.new_name:
        raise HTTPException(status_code=400, detail="Жаңа атау берілмеген")
    root = await _workspace(db, user, project_id)
    await _call(vibe_git.rename_branch, root, data.name, data.new_name)
    return await _call(vibe_git.status, root)


@router.post("/vibecoding/projects/{project_id}/git/branch/delete")
@limiter.limit("60/minute")
async def git_delete_branch(request: Request, project_id: str, data: BranchIn,
                            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    await _call(vibe_git.delete_branch, root, data.name, data.force)
    return await _call(vibe_git.status, root)


@router.post("/vibecoding/projects/{project_id}/git/merge")
@limiter.limit("30/minute")
async def git_merge(request: Request, project_id: str, data: BranchIn,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _mutate(user, project_id, root, vibe_git.merge, data.name, user.username)


@router.post("/vibecoding/projects/{project_id}/git/merge/abort")
@limiter.limit("30/minute")
async def git_merge_abort(request: Request, project_id: str,
                          user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _mutate(user, project_id, root, vibe_git.merge_abort)


@router.get("/vibecoding/projects/{project_id}/git/last-message")
@limiter.limit("60/minute")
async def git_last_message(request: Request, project_id: str,
                           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return {"message": await _call(vibe_git.last_commit_message, root)}


@router.post("/vibecoding/projects/{project_id}/git/undo-commit")
@limiter.limit("30/minute")
async def git_undo_commit(request: Request, project_id: str,
                          user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    message = await _call(vibe_git.last_commit_message, root)
    await _call(vibe_git.undo_last_commit, root)
    return {"status": await _call(vibe_git.status, root), "message": message}


@router.get("/vibecoding/projects/{project_id}/git/stash")
@limiter.limit("120/minute")
async def git_stash_list(request: Request, project_id: str,
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _call(vibe_git.stash_list, root)


@router.post("/vibecoding/projects/{project_id}/git/stash")
@limiter.limit("30/minute")
async def git_stash_push(request: Request, project_id: str, data: StashIn,
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _mutate(user, project_id, root, vibe_git.stash_push,
                         data.message, data.include_untracked, data.staged_only)


@router.post("/vibecoding/projects/{project_id}/git/stash/action")
@limiter.limit("30/minute")
async def git_stash_action(request: Request, project_id: str, data: StashActionIn,
                           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _mutate(user, project_id, root, vibe_git.stash_action, data.action, data.index)


# ═══ Codo репозиторийі (push / pull) ═══════════════════════════════

class CodoPushIn(BaseModel):
    branch: Optional[str] = Field(default=None, max_length=200)
    force: bool = False


class CodoPullIn(BaseModel):
    source: str = Field(default="codo", pattern="^(codo|upstream)$")
    branch: Optional[str] = Field(default=None, max_length=200)


def _project(db: Session, project_id: str) -> Optional[VibecodingProject]:
    return db.query(VibecodingProject).filter(VibecodingProject.id == project_id).first()


def _user_brief(db: Session, user_id: Optional[str]) -> Optional[dict]:
    if not user_id:
        return None
    u = db.query(User).filter(User.id == user_id).first()
    return {"id": u.id, "username": u.username} if u else None


def _parent_brief(db: Session, project: VibecodingProject) -> Optional[dict]:
    parent = _project(db, project.parent_id) if project.parent_id else None
    if not parent:
        return None
    return {"id": parent.id, "name": parent.name, "owner": _user_brief(db, parent.owner_id)}


async def _codo_info(db: Session, project: VibecodingProject, root: str) -> dict:
    parent = _parent_brief(db, project)
    info = await _call(codo_remote.sync_info, root, project.id, parent["id"] if parent else None)
    info["branches"] = await _call(codo_remote.branches, project.id)
    info["defaultBranch"] = await _call(codo_remote.default_branch, project.id)
    info["parent"] = parent
    info["openPrs"] = db.query(VibePullRequest).filter(
        VibePullRequest.target_project_id == project.id, VibePullRequest.status == "open").count()
    return info


@router.get("/vibecoding/projects/{project_id}/git/codo")
@limiter.limit("120/minute")
async def codo_info(request: Request, project_id: str,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    return await _codo_info(db, _project(db, project_id), root)


@router.post("/vibecoding/projects/{project_id}/git/codo/fetch")
@limiter.limit("60/minute")
async def codo_fetch(request: Request, project_id: str,
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    root = await _workspace(db, user, project_id)
    project = _project(db, project_id)
    await _call(codo_remote.fetch, root, project_id)
    if project.parent_id:
        await _call(codo_remote.fetch, root, project.parent_id, "upstream")
    return {"status": await _call(vibe_git.status, root), "codo": await _codo_info(db, project, root)}


@router.post("/vibecoding/projects/{project_id}/git/codo/push")
@limiter.limit("30/minute")
async def codo_push(request: Request, project_id: str, data: CodoPushIn,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Codo-ға жіберу: осы бұтақ — жобаның басқаларға көрінетін ресми нұсқасы"""
    root = await _workspace(db, user, project_id)
    project = _project(db, project_id)
    result = await _call(codo_remote.push, root, project_id, data.branch, data.force)
    project.updated_at = datetime.utcnow()
    db.commit()
    return {**result, "status": await _call(vibe_git.status, root), "codo": await _codo_info(db, project, root)}


@router.post("/vibecoding/projects/{project_id}/git/codo/pull")
@limiter.limit("30/minute")
async def codo_pull(request: Request, project_id: str, data: CodoPullIn,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Codo-дан (немесе түпнұсқа жобадан — upstream) жаңартуларды тарту"""
    root = await _workspace(db, user, project_id)
    project = _project(db, project_id)
    if data.source == "upstream":
        if not project.parent_id or not _project(db, project.parent_id):
            raise HTTPException(status_code=400, detail="Бұл жоба fork емес немесе түпнұсқа өшірілген")
        res = await _mutate(user, project_id, root, codo_remote.pull, project_id, user.username, "upstream",
                            project.parent_id, data.branch)
    else:
        res = await _mutate(user, project_id, root, codo_remote.pull, project_id, user.username, "codo", None, data.branch)
    res["codo"] = await _codo_info(db, project, root)
    return res


# ═══ Pull request ══════════════════════════════════════════════════

class PrCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(default="", max_length=20000)
    source_branch: str = Field(min_length=1, max_length=200)
    target: str = Field(default="parent", pattern="^(parent|self)$")
    target_branch: Optional[str] = Field(default=None, max_length=200)


class PrMergeIn(BaseModel):
    squash: bool = False
    message: Optional[str] = Field(default=None, max_length=5000)


def _iso(dt) -> Optional[str]:
    return dt.isoformat() + "Z" if dt else None


def _pr_dict(db: Session, pr: VibePullRequest, viewer: User) -> dict:
    target = _project(db, pr.target_project_id)
    source = _project(db, pr.source_project_id)
    return {
        "id": pr.id,
        "number": pr.number,
        "title": pr.title,
        "body": pr.body or "",
        "status": pr.status,
        "author": _user_brief(db, pr.author_id),
        "target": {"projectId": pr.target_project_id, "name": target.name if target else None,
                   "branch": pr.target_branch, "owner": _user_brief(db, target.owner_id) if target else None},
        "source": {"projectId": pr.source_project_id, "name": source.name if source else None,
                   "branch": pr.source_branch, "exists": bool(source)},
        "sameProject": pr.source_project_id == pr.target_project_id,
        "headSha": pr.head_sha,
        "mergedSha": pr.merged_sha,
        "mergedBy": _user_brief(db, pr.merged_by),
        "canMerge": bool(target) and target.owner_id == viewer.id,
        "isAuthor": pr.author_id == viewer.id,
        "createdAt": _iso(pr.created_at),
        "updatedAt": _iso(pr.updated_at),
        "closedAt": _iso(pr.closed_at),
    }


def _pr_for(db: Session, user: User, project_id: str, pr_id: str) -> VibePullRequest:
    """PR-ды көруге құқық: target жобаның иесі немесе PR авторы (source жоба осы болса)"""
    pr = db.query(VibePullRequest).filter(VibePullRequest.id == pr_id).first()
    if not pr or project_id not in (pr.target_project_id, pr.source_project_id):
        raise HTTPException(status_code=404, detail="PR табылмады")
    project = _project(db, project_id)
    if not project or project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="PR табылмады")
    if project_id == pr.source_project_id and project_id != pr.target_project_id and pr.author_id != user.id:
        raise HTTPException(status_code=404, detail="PR табылмады")
    return pr


@router.get("/vibecoding/projects/{project_id}/git/prs")
@limiter.limit("120/minute")
async def pr_list(request: Request, project_id: str,
                  state: str = Query("open", pattern="^(open|closed|merged|all)$"),
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _project(db, project_id)
    if not project or project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    q = db.query(VibePullRequest).filter(
        (VibePullRequest.target_project_id == project_id)
        | ((VibePullRequest.source_project_id == project_id) & (VibePullRequest.author_id == user.id))
    )
    if state != "all":
        q = q.filter(VibePullRequest.status == state)
    prs = q.order_by(VibePullRequest.created_at.desc()).limit(200).all()
    return [_pr_dict(db, pr, user) for pr in prs]


@router.post("/vibecoding/projects/{project_id}/git/prs")
@limiter.limit("20/minute")
async def pr_create(request: Request, project_id: str, data: PrCreateIn,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """PR ашу: бұтақ алдымен Codo-ға жіберіледі, коммиттері target-қа көшіріледі"""
    root = await _workspace(db, user, project_id)
    source = _project(db, project_id)
    if data.target == "parent":
        target = _project(db, source.parent_id) if source.parent_id else None
        if not target:
            raise HTTPException(status_code=400, detail="Бұл жоба fork емес — PR тек өз бұтақтарыңыз арасында")
    else:
        target = source
    target_branch = data.target_branch or await _call(codo_remote.default_branch, target.id) or "main"
    target_branch = await _call(vibe_git._branch_name, target_branch)
    if target.id == source.id and target_branch == data.source_branch:
        raise HTTPException(status_code=400, detail="Бір бұтақтан өзіне PR ашуға болмайды")
    dup = db.query(VibePullRequest).filter(
        VibePullRequest.target_project_id == target.id, VibePullRequest.source_project_id == source.id,
        VibePullRequest.source_branch == data.source_branch, VibePullRequest.target_branch == target_branch,
        VibePullRequest.status == "open").first()
    if dup:
        raise HTTPException(status_code=409, detail=f"Бұл бұтақтан ашық PR бар: #{dup.number}")

    await _call(codo_remote.push, root, source.id, data.source_branch, False)
    number = db.query(VibePullRequest).filter(VibePullRequest.target_project_id == target.id).count() + 1
    head = await _call(codo_remote.pr_snapshot, target.id, source.id, data.source_branch, number)
    compare = await _call(codo_remote.pr_compare, target.id, target_branch, number)
    if compare.get("upToDate"):
        raise HTTPException(status_code=400,
                            detail=f"«{data.source_branch}» бұтағында «{target_branch}»-та жоқ коммит жоқ")
    pr = VibePullRequest(
        id=str(uuid.uuid4()), number=number, target_project_id=target.id, target_branch=target_branch,
        source_project_id=source.id, source_branch=data.source_branch, author_id=user.id,
        title=data.title.strip(), body=data.body.strip(), status="open", head_sha=head,
    )
    db.add(pr)
    db.commit()
    db.refresh(pr)
    return _pr_dict(db, pr, user)


async def _refresh_snapshot(db: Session, pr: VibePullRequest) -> None:
    """Ашық PR — автор жаңа коммит жіберсе, соны аламыз"""
    if pr.status != "open" or not _project(db, pr.source_project_id):
        return
    try:
        head = await asyncio.to_thread(codo_remote.pr_snapshot, pr.target_project_id, pr.source_project_id,
                                       pr.source_branch, pr.number)
    except vibe_git.GitError:
        return
    if head and head != pr.head_sha:
        pr.head_sha = head
        db.commit()


@router.get("/vibecoding/projects/{project_id}/git/prs/{pr_id}")
@limiter.limit("120/minute")
async def pr_detail(request: Request, project_id: str, pr_id: str,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _pr_for(db, user, project_id, pr_id)
    await _refresh_snapshot(db, pr)
    compare = await _call(codo_remote.pr_compare, pr.target_project_id, pr.target_branch, pr.number)
    return {**_pr_dict(db, pr, user), **compare}


@router.get("/vibecoding/projects/{project_id}/git/prs/{pr_id}/diff")
@limiter.limit("120/minute")
async def pr_diff(request: Request, project_id: str, pr_id: str, path: str = Query(..., max_length=1024),
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _pr_for(db, user, project_id, pr_id)
    return await _call(codo_remote.pr_file_diff, pr.target_project_id, pr.target_branch, pr.number, path)


@router.post("/vibecoding/projects/{project_id}/git/prs/{pr_id}/merge")
@limiter.limit("20/minute")
async def pr_merge(request: Request, project_id: str, pr_id: str, data: PrMergeIn,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _pr_for(db, user, project_id, pr_id)
    target = _project(db, pr.target_project_id)
    if not target or target.owner_id != user.id:
        raise HTTPException(status_code=403, detail="PR-ды тек жоба иесі біріктіре алады")
    if pr.status != "open":
        raise HTTPException(status_code=400, detail="PR ашық емес")
    await _refresh_snapshot(db, pr)
    author = _user_brief(db, pr.author_id)
    msg = (data.message or "").strip() or (
        f"Merge pull request #{pr.number} from {author['username'] if author else '?'}/{pr.source_branch}"
        f"\n\n{pr.title}" + (f"\n\n{pr.body}" if pr.body else ""))
    sha = await _call(codo_remote.pr_merge, pr.target_project_id, pr.target_branch, pr.number, msg,
                      user.username, f"{vibe_git._safe_email(user.username)}@users.codohub.local", data.squash)
    pr.status, pr.merged_sha, pr.merged_by, pr.closed_at = "merged", sha, user.id, datetime.utcnow()
    db.commit()
    # Иесінің жұмыс папкасына да жаңа коммитті тартамыз (сол бұтақта тұрса)
    root = await _workspace(db, user, target.id)
    res = {"status": await _call(vibe_git.status, root), "changes": None, "error": None}
    st = res["status"]
    if st.get("repo") and st.get("branch") == pr.target_branch and not st.get("detached"):
        res = await _mutate(user, target.id, root, codo_remote.pull, target.id, user.username, "codo", None, pr.target_branch)
    else:
        await _call(codo_remote.fetch, root, target.id)
    return {**res, "pr": _pr_dict(db, pr, user)}


@router.post("/vibecoding/projects/{project_id}/git/prs/{pr_id}/{action}")
@limiter.limit("30/minute")
async def pr_state(request: Request, project_id: str, pr_id: str, action: str,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if action not in ("close", "reopen"):
        raise HTTPException(status_code=404, detail="Белгісіз әрекет")
    pr = _pr_for(db, user, project_id, pr_id)
    target = _project(db, pr.target_project_id)
    if pr.author_id != user.id and (not target or target.owner_id != user.id):
        raise HTTPException(status_code=403, detail="Рұқсат жоқ")
    if pr.status == "merged":
        raise HTTPException(status_code=400, detail="Біріктірілген PR-ды өзгерту мүмкін емес")
    pr.status = "closed" if action == "close" else "open"
    pr.closed_at = datetime.utcnow() if action == "close" else None
    db.commit()
    return _pr_dict(db, pr, user)
