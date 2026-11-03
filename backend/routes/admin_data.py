"""Әкімші панелі: сайттағы барлық деректерді басқару.

Қолданушылар, жобалар (codes), сторис/пікірлер, топтар, Vibecoding, жеке хабарламалар, Notes.
Қорғаныс routes/admin.py-дегідей: тек ADMIN_USER_IDS (басқаларға 404).
Әр өзгеріс — `admin_action`, жеке деректі оқу — `admin_view` болып мониторинг журналына жазылады.
"""
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import false, func, or_
from sqlalchemy.orm import Session

from config import ADMIN_USER_IDS, MODERATOR_USER_IDS
from database import codes, messages, save_messages
from db import (
    ChatGroup, ChatGroupMember, ChatGroupMessage, Note, Story, StoryOpinion, User, VibecodingProject, get_db,
)
from routes.admin import require_admin
from services import login_guard, monitoring
from services.code_service import CodeService

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


# ---------- Көмекші функциялар ----------

def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _log(request: Request, admin: User, action: str, kind: str = "admin_action", **detail: Any) -> None:
    monitoring.record(kind, user_id=admin.id, ip=login_guard.client_ip(request), detail={"action": action, **detail})


def _dump(body: BaseModel) -> Dict[str, Any]:
    return body.model_dump(exclude_none=True) if hasattr(body, "model_dump") else body.dict(exclude_none=True)


def _user_or_404(db: Session, user_id: str) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Қолданушы табылмады")
    return user


def _people(db: Session, ids) -> Dict[str, Dict[str, Any]]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: {"id": u.id, "username": u.username, "avatar": u.avatar}
            for u in db.query(User).filter(User.id.in_(ids)).all()}


def _user_row(u: User) -> Dict[str, Any]:
    return {
        "id": u.id,
        "username": u.username,
        "email": u.email,
        "avatar": u.avatar,
        "bio": u.bio,
        "role": "moderator" if (u.role == "moderator" or u.id in MODERATOR_USER_IDS) else None,
        "roleFromEnv": u.id in MODERATOR_USER_IDS,
        "isAdmin": u.id in ADMIN_USER_IDS,
        "banned": bool(u.banned_at),
        "bannedAt": _iso(u.banned_at),
        "banReason": u.ban_reason,
        "locked": bool(u.locked_until and u.locked_until > datetime.utcnow()),
        "totpEnabled": bool(u.totp_enabled),
        "githubLogin": u.github_login,
        "lastSeenAt": _iso(u.last_seen_at),
        "createdAt": _iso(u.created_at),
    }


def _page(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)) -> Dict[str, int]:
    return {"limit": limit, "offset": offset}


def _ids_filter(column, ids):
    # Бос жиын `IN ()` болып кетпеуі үшін
    return column.in_(list(ids)) if ids else false()


# ---------- Жалпы статистика ----------

@router.get("/admin/stats")
@limiter.limit("60/minute")
async def admin_stats(request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return {
        "users": db.query(func.count(User.id)).scalar(),
        "banned": db.query(func.count(User.id)).filter(User.banned_at.isnot(None)).scalar(),
        "projects": sum(1 for c in codes if not c.get("folderId")),
        "files": len(codes),
        "messages": len(messages),
        "groups": db.query(func.count(ChatGroup.id)).scalar(),
        "stories": db.query(func.count(Story.id)).scalar(),
        "opinions": db.query(func.count(StoryOpinion.id)).scalar(),
        "vibecoding": db.query(func.count(VibecodingProject.id)).scalar(),
        "notes": db.query(func.count(Note.id)).scalar(),
    }


# ---------- Қолданушылар ----------

class AdminUserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=2, max_length=50)
    email: Optional[str] = Field(None, min_length=3, max_length=255)
    bio: Optional[str] = Field(None, max_length=500)
    removeAvatar: Optional[bool] = None
    role: Optional[str] = Field(None, pattern="^(user|moderator)$")


class BanBody(BaseModel):
    reason: str = Field("", max_length=300)


@router.get("/admin/users")
@limiter.limit("120/minute")
async def admin_users(
    request: Request,
    q: str = Query("", max_length=100),
    filter: str = Query("", pattern="^(|banned|moderators|admins)$"),
    page: Dict[str, int] = Depends(_page),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    needle = q.strip()
    if needle:
        like = f"%{needle}%"
        query = query.filter(or_(User.username.ilike(like), User.email.ilike(like), User.id == needle))
    if filter == "banned":
        query = query.filter(User.banned_at.isnot(None))
    elif filter == "moderators":
        query = query.filter(or_(User.role == "moderator", _ids_filter(User.id, MODERATOR_USER_IDS)))
    elif filter == "admins":
        query = query.filter(_ids_filter(User.id, ADMIN_USER_IDS))
    total = query.count()
    rows = query.order_by(User.created_at.desc()).offset(page["offset"]).limit(page["limit"]).all()
    return {"total": total, "items": [_user_row(u) for u in rows]}


@router.get("/admin/users/{user_id}")
@limiter.limit("120/minute")
async def admin_user_detail(request: Request, user_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _user_or_404(db, user_id)
    mine = [m for m in messages if u.id in (m.get("fromUserId"), m.get("toUserId"))]
    peers = {m.get("toUserId") if m.get("fromUserId") == u.id else m.get("fromUserId") for m in mine}
    return {
        **_user_row(u),
        "counts": {
            "projects": sum(1 for c in codes if c.get("author") == u.username and not c.get("folderId")),
            "messages": len(mine),
            "conversations": len(peers - {None}),
            "groups": db.query(func.count(ChatGroupMember.group_id)).filter(ChatGroupMember.user_id == u.id).scalar(),
            "stories": db.query(func.count(Story.id)).filter(Story.author_id == u.id).scalar(),
            "notes": db.query(func.count(Note.id)).filter(Note.owner_id == u.id).scalar(),
            "vibecoding": db.query(func.count(VibecodingProject.id)).filter(VibecodingProject.owner_id == u.id).scalar(),
        },
    }


@router.patch("/admin/users/{user_id}")
@limiter.limit("30/minute")
async def admin_update_user(request: Request, user_id: str, body: AdminUserUpdate,
                            admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.account_service import rename_author

    u = _user_or_404(db, user_id)
    changes: Dict[str, Any] = {}
    if body.username is not None and body.username.strip() and body.username.strip() != u.username:
        new = body.username.strip()
        if db.query(User).filter(func.lower(User.username) == new.lower(), User.id != u.id).first():
            raise HTTPException(status_code=409, detail="Бұл username бос емес")
        changes["username"] = [u.username, new]
        rename_author(u.username, new)
        u.username = new
    if body.email is not None and body.email.strip() and body.email.strip().lower() != (u.email or "").lower():
        new = body.email.strip().lower()
        if "@" not in new:
            raise HTTPException(status_code=400, detail="Пошта дұрыс емес")
        if db.query(User).filter(func.lower(User.email) == new, User.id != u.id).first():
            raise HTTPException(status_code=409, detail="Бұл пошта бос емес")
        changes["email"] = True
        u.email = new
    if body.bio is not None:
        u.bio = body.bio.strip() or None
        changes["bio"] = True
    if body.removeAvatar:
        u.avatar = None
        changes["avatar"] = "removed"
    if body.role is not None:
        u.role = None if body.role == "user" else body.role
        changes["role"] = body.role
    db.commit()
    _log(request, admin, "user_update", target=u.id, targetUsername=u.username, changes=changes)
    return _user_row(u)


@router.post("/admin/users/{user_id}/ban")
@limiter.limit("30/minute")
async def admin_ban_user(request: Request, user_id: str, body: BanBody,
                         admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _user_or_404(db, user_id)
    if u.id in ADMIN_USER_IDS:
        raise HTTPException(status_code=400, detail="Әкімшіні бұғаттауға болмайды")
    u.banned_at = datetime.utcnow()
    u.ban_reason = body.reason.strip() or None
    # Барлық сессияларды бірден жабу
    u.session_id = None
    u.refresh_token_hash = None
    db.commit()
    login_guard.forget_devices(db, u.id)
    _log(request, admin, "ban", target=u.id, targetUsername=u.username, reason=u.ban_reason)
    return _user_row(u)


@router.post("/admin/users/{user_id}/unban")
@limiter.limit("30/minute")
async def admin_unban_user(request: Request, user_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _user_or_404(db, user_id)
    u.banned_at = None
    u.ban_reason = None
    db.commit()
    _log(request, admin, "unban", target=u.id, targetUsername=u.username)
    return _user_row(u)


@router.delete("/admin/users/{user_id}")
@limiter.limit("10/minute")
async def admin_delete_user(request: Request, user_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.account_service import delete_account

    u = _user_or_404(db, user_id)
    if u.id in ADMIN_USER_IDS:
        raise HTTPException(status_code=400, detail="Әкімшіні өшіруге болмайды")
    username = u.username
    delete_account(db, u)
    _log(request, admin, "user_delete", target=user_id, targetUsername=username)
    return {"ok": True}


# ---------- Жобалар (codes) ----------

class AdminCodeUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    tags: Optional[List[str]] = None
    isPrivate: Optional[bool] = None
    content: Optional[str] = None


def _code_or_404(code_id: str) -> Dict[str, Any]:
    code = CodeService.find_code_by_id(code_id)
    if not code:
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    return code


def _code_row(c: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **{k: c.get(k) for k in ("id", "title", "author", "language", "isFolder", "isPrivate", "folderId",
                                 "folderPath", "createdAt", "updatedAt", "protection")},
        "likes": len(c.get("likes") or []),
        "comments": len(c.get("comments") or []),
        "views": c.get("views") or len(c.get("viewedBy") or []),
        "files": sum(1 for x in codes if x.get("folderId") == c["id"]) if c.get("isFolder") else None,
    }


@router.get("/admin/codes")
@limiter.limit("120/minute")
async def admin_codes(
    request: Request,
    q: str = Query("", max_length=100),
    author: str = Query("", max_length=100),
    folderId: str = Query("", max_length=64),
    page: Dict[str, int] = Depends(_page),
    admin: User = Depends(require_admin),
):
    rows = [c for c in codes if c.get("folderId") == folderId] if folderId else [c for c in codes if not c.get("folderId")]
    if author.strip():
        rows = [c for c in rows if (c.get("author") or "").lower() == author.strip().lower()]
    needle = q.strip().lower()
    if needle:
        rows = [c for c in rows if needle in (c.get("title") or "").lower() or needle in (c.get("author") or "").lower()
                or needle in (c.get("description") or "").lower() or needle == c.get("id")]
    if folderId:
        rows = sorted(rows, key=lambda c: c.get("folderPath") or c.get("title") or "")
    else:
        rows = sorted(rows, key=lambda c: c.get("createdAt") or "", reverse=True)
    chunk = rows[page["offset"]:page["offset"] + page["limit"]]
    return {"total": len(rows), "items": [_code_row(c) for c in chunk]}


@router.get("/admin/codes/{code_id}")
@limiter.limit("120/minute")
async def admin_code_detail(request: Request, code_id: str, admin: User = Depends(require_admin)):
    code = _code_or_404(code_id)
    # Әкімші қорғалған файлдың түпнұсқасын да көреді (жоба иесінің құқығымен ашамыз)
    view = CodeService.for_viewer(code, CodeService.project_of(code).get("author"))
    view.pop("folderStructure", None)
    if code.get("isFolder"):
        view.pop("content", None)
    return view


@router.patch("/admin/codes/{code_id}")
@limiter.limit("30/minute")
async def admin_update_code(request: Request, code_id: str, body: AdminCodeUpdate, admin: User = Depends(require_admin)):
    code = _code_or_404(code_id)
    data = _dump(body)
    if "content" in data and code.get("isFolder"):
        raise HTTPException(status_code=400, detail="Папканың мазмұнын өзгертуге болмайды")
    try:
        result = CodeService.update_code(code_id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _log(request, admin, "code_update", target=code_id, title=code.get("title"), author=code.get("author"), fields=list(data))
    result.pop("folderStructure", None)
    return result


@router.delete("/admin/codes/{code_id}")
@limiter.limit("30/minute")
async def admin_delete_code(request: Request, code_id: str, admin: User = Depends(require_admin)):
    code = _code_or_404(code_id)
    deleted = CodeService.delete_code(code_id)
    _log(request, admin, "code_delete", target=code_id, title=code.get("title"), author=code.get("author"), count=len(deleted))
    return {"deleted": deleted}


@router.delete("/admin/codes/{code_id}/comments/{comment_id}")
@limiter.limit("60/minute")
async def admin_delete_comment(request: Request, code_id: str, comment_id: str, admin: User = Depends(require_admin)):
    _code_or_404(code_id)
    try:
        CodeService.delete_comment(code_id, comment_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    _log(request, admin, "comment_delete", target=code_id, comment=comment_id)
    return {"ok": True}


# ---------- Сторис және пікірлер ----------

@router.get("/admin/stories")
@limiter.limit("120/minute")
async def admin_stories(request: Request, page: Dict[str, int] = Depends(_page),
                        admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    query = db.query(Story)
    total = query.count()
    rows = query.order_by(Story.created_at.desc()).offset(page["offset"]).limit(page["limit"]).all()
    people = _people(db, {r.author_id for r in rows} | {r.mention_id for r in rows})
    return {"total": total, "items": [{
        "id": r.id,
        "author": people.get(r.author_id),
        "mediaType": r.media_type,
        "caption": r.caption or "",
        "projectId": r.project_id,
        "mention": {**people[r.mention_id], "kind": r.mention_kind, "text": r.mention_text} if r.mention_id in people else None,
        "status": r.status or "published",
        "views": len(json.loads(r.viewers or "[]")),
        "clicks": r.clicks or 0,
        "createdAt": _iso(r.created_at),
        "expiresAt": _iso(r.expires_at),
    } for r in rows]}


@router.delete("/admin/stories/{story_id}")
@limiter.limit("60/minute")
async def admin_delete_story(request: Request, story_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.story_service import _remove_file

    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="Сторис табылмады")
    _remove_file(story.media_url)
    db.query(StoryOpinion).filter(StoryOpinion.story_id == story.id).delete()
    author_id = story.author_id
    db.delete(story)
    db.commit()
    _log(request, admin, "story_delete", target=story_id, author=author_id)
    return {"ok": True}


@router.get("/admin/opinions")
@limiter.limit("120/minute")
async def admin_opinions(request: Request, kind: str = Query("", pattern="^(|praise|complaint)$"),
                         page: Dict[str, int] = Depends(_page), admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    query = db.query(StoryOpinion)
    if kind:
        query = query.filter(StoryOpinion.kind == kind)
    total = query.count()
    rows = query.order_by(StoryOpinion.created_at.desc()).offset(page["offset"]).limit(page["limit"]).all()
    people = _people(db, {r.author_id for r in rows} | {r.target_id for r in rows})
    return {"total": total, "items": [{
        "id": r.id,
        "kind": r.kind,
        "text": r.text,
        "evidence": r.evidence,
        "verdict": r.verdict,
        "status": r.status or "approved",
        "author": people.get(r.author_id),
        "target": people.get(r.target_id),
        "createdAt": _iso(r.created_at),
    } for r in rows]}


@router.delete("/admin/opinions/{opinion_id}")
@limiter.limit("60/minute")
async def admin_delete_opinion(request: Request, opinion_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    opinion = db.query(StoryOpinion).filter(StoryOpinion.id == opinion_id).first()
    if not opinion:
        raise HTTPException(status_code=404, detail="Пікір табылмады")
    db.delete(opinion)
    db.commit()
    _log(request, admin, "opinion_delete", target=opinion_id)
    return {"ok": True}


# ---------- Топтар ----------

class AdminGroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


def _group_or_404(db: Session, group_id: str) -> ChatGroup:
    group = db.query(ChatGroup).filter(ChatGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Топ табылмады")
    return group


@router.get("/admin/groups")
@limiter.limit("120/minute")
async def admin_groups(request: Request, q: str = Query("", max_length=100), page: Dict[str, int] = Depends(_page),
                       admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    query = db.query(ChatGroup)
    if q.strip():
        query = query.filter(ChatGroup.name.ilike(f"%{q.strip()}%"))
    total = query.count()
    rows = query.order_by(ChatGroup.created_at.desc()).offset(page["offset"]).limit(page["limit"]).all()
    ids = [g.id for g in rows]
    members = dict(db.query(ChatGroupMember.group_id, func.count(ChatGroupMember.user_id))
                   .filter(ChatGroupMember.group_id.in_(ids)).group_by(ChatGroupMember.group_id).all()) if ids else {}
    msgs = dict(db.query(ChatGroupMessage.group_id, func.count(ChatGroupMessage.id))
                .filter(ChatGroupMessage.group_id.in_(ids)).group_by(ChatGroupMessage.group_id).all()) if ids else {}
    people = _people(db, {g.owner_id for g in rows})
    return {"total": total, "items": [{
        "id": g.id, "name": g.name, "description": g.description,
        "owner": people.get(g.owner_id), "members": members.get(g.id, 0), "messages": msgs.get(g.id, 0),
        "createdAt": _iso(g.created_at),
    } for g in rows]}


@router.get("/admin/groups/{group_id}")
@limiter.limit("60/minute")
async def admin_group_detail(request: Request, group_id: str, limit: int = Query(300, ge=1, le=1000),
                             admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.group_service import GroupService

    g = _group_or_404(db, group_id)
    members = db.query(ChatGroupMember).filter(ChatGroupMember.group_id == g.id).all()
    rows = (db.query(ChatGroupMessage).filter(ChatGroupMessage.group_id == g.id)
            .order_by(ChatGroupMessage.created_at.desc()).limit(limit).all())
    people = _people(db, {m.user_id for m in members} | {r.from_user_id for r in rows})
    _log(request, admin, "group_read", kind="admin_view", target=g.id, name=g.name)
    return {
        "id": g.id, "name": g.name, "description": g.description,
        "ownerId": g.owner_id, "createdAt": _iso(g.created_at),
        "members": [{**(people.get(m.user_id) or {"id": m.user_id, "username": "?"}), "role": m.role,
                     "joinedAt": _iso(m.joined_at)} for m in members],
        "messages": [GroupService.message_to_dict(r, people) for r in reversed(rows)],
    }


@router.patch("/admin/groups/{group_id}")
@limiter.limit("30/minute")
async def admin_update_group(request: Request, group_id: str, body: AdminGroupUpdate,
                             admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.group_service import GroupService

    g = _group_or_404(db, group_id)
    if body.name is not None:
        g.name = body.name.strip()
    if body.description is not None:
        g.description = body.description.strip() or None
    db.commit()
    await GroupService.broadcast(db, g.id, {"type": "group_updated", "groupId": g.id})
    _log(request, admin, "group_update", target=g.id, name=g.name)
    return {"ok": True}


@router.delete("/admin/groups/{group_id}")
@limiter.limit("30/minute")
async def admin_delete_group(request: Request, group_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.group_service import GroupService
    from websocket import manager

    g = _group_or_404(db, group_id)
    name = g.name
    member_ids = GroupService.member_ids(db, group_id)
    GroupService._delete_group_rows(db, group_id)
    for uid in member_ids:
        await manager.send_personal_message({"type": "group_removed", "groupId": group_id}, uid)
    _log(request, admin, "group_delete", target=group_id, name=name)
    return {"ok": True}


@router.delete("/admin/groups/{group_id}/members/{user_id}")
@limiter.limit("60/minute")
async def admin_remove_group_member(request: Request, group_id: str, user_id: str,
                                    admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.group_service import GroupService
    from websocket import manager

    g = _group_or_404(db, group_id)
    member = db.query(ChatGroupMember).filter(ChatGroupMember.group_id == g.id, ChatGroupMember.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Мүше табылмады")
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="Топ иесін шығаруға болмайды — топты өшіріңіз")
    db.delete(member)
    db.commit()
    await manager.send_personal_message({"type": "group_removed", "groupId": g.id}, user_id)
    await GroupService.broadcast(db, g.id, {"type": "group_updated", "groupId": g.id})
    _log(request, admin, "group_member_remove", target=g.id, member=user_id)
    return {"ok": True}


@router.delete("/admin/groups/{group_id}/messages/{message_id}")
@limiter.limit("120/minute")
async def admin_delete_group_message(request: Request, group_id: str, message_id: str,
                                     admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.group_service import GroupService

    msg = db.query(ChatGroupMessage).filter(ChatGroupMessage.id == message_id, ChatGroupMessage.group_id == group_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Хабарлама табылмады")
    db.delete(msg)
    db.commit()
    await GroupService.broadcast(db, group_id, {"type": "group_message_deleted", "groupId": group_id, "messageId": message_id})
    _log(request, admin, "group_message_delete", target=group_id, message=message_id)
    return {"ok": True}


# ---------- Vibecoding ----------

class AdminVibeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    revokeShare: Optional[bool] = None


def _vibe_or_404(db: Session, project_id: str) -> VibecodingProject:
    p = db.query(VibecodingProject).filter(VibecodingProject.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Жоба табылмады")
    return p


@router.get("/admin/vibecoding")
@limiter.limit("120/minute")
async def admin_vibecoding(request: Request, q: str = Query("", max_length=100), ownerId: str = Query("", max_length=12),
                           page: Dict[str, int] = Depends(_page), admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    query = db.query(VibecodingProject)
    if q.strip():
        query = query.filter(VibecodingProject.name.ilike(f"%{q.strip()}%"))
    if ownerId:
        query = query.filter(VibecodingProject.owner_id == ownerId)
    total = query.count()
    rows = query.order_by(VibecodingProject.updated_at.desc()).offset(page["offset"]).limit(page["limit"]).all()
    people = _people(db, {p.owner_id for p in rows})
    return {"total": total, "items": [{
        "id": p.id, "name": p.name, "owner": people.get(p.owner_id),
        "files": len(json.loads(p.files or "[]")), "shared": bool(p.share_token),
        "createdAt": _iso(p.created_at), "updatedAt": _iso(p.updated_at),
    } for p in rows]}


@router.get("/admin/vibecoding/{project_id}")
@limiter.limit("60/minute")
async def admin_vibecoding_detail(request: Request, project_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    p = _vibe_or_404(db, project_id)
    _log(request, admin, "vibecoding_read", kind="admin_view", target=p.id, owner=p.owner_id)
    return {
        "id": p.id, "name": p.name, "ownerId": p.owner_id, "shared": bool(p.share_token),
        "files": [{"path": f.get("path") or f.get("name"), "language": f.get("language"), "content": f.get("content", "")}
                  for f in json.loads(p.files or "[]")],
        "createdAt": _iso(p.created_at), "updatedAt": _iso(p.updated_at),
    }


@router.patch("/admin/vibecoding/{project_id}")
@limiter.limit("30/minute")
async def admin_update_vibecoding(request: Request, project_id: str, body: AdminVibeUpdate,
                                  admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    p = _vibe_or_404(db, project_id)
    if body.name is not None:
        p.name = body.name.strip()
    if body.revokeShare:
        p.share_token = None
    db.commit()
    _log(request, admin, "vibecoding_update", target=p.id, owner=p.owner_id, revokeShare=bool(body.revokeShare))
    return {"ok": True}


@router.delete("/admin/vibecoding/{project_id}")
@limiter.limit("30/minute")
async def admin_delete_vibecoding(request: Request, project_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    p = _vibe_or_404(db, project_id)
    owner = p.owner_id
    db.delete(p)
    db.commit()
    _log(request, admin, "vibecoding_delete", target=project_id, owner=owner)
    return {"ok": True}


# ---------- Жеке хабарламалар ----------

class AdminMessageUpdate(BaseModel):
    content: str = Field(..., min_length=1, max_length=20000)


def _dm_or_404(message_id: str) -> Dict[str, Any]:
    msg = next((m for m in messages if m.get("id") == message_id), None)
    if not msg:
        raise HTTPException(status_code=404, detail="Хабарлама табылмады")
    return msg


@router.get("/admin/users/{user_id}/conversations")
@limiter.limit("60/minute")
async def admin_conversations(request: Request, user_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _user_or_404(db, user_id)
    stats: Dict[str, Dict[str, Any]] = {}
    for m in messages:
        if u.id not in (m.get("fromUserId"), m.get("toUserId")):
            continue
        peer = m.get("toUserId") if m.get("fromUserId") == u.id else m.get("fromUserId")
        entry = stats.setdefault(peer, {"count": 0, "lastAt": ""})
        entry["count"] += 1
        entry["lastAt"] = max(entry["lastAt"], m.get("createdAt") or "")
    people = _people(db, stats.keys())
    items = [{"peer": people.get(pid) or {"id": pid, "username": "?"}, **s} for pid, s in stats.items()]
    items.sort(key=lambda x: x["lastAt"], reverse=True)
    _log(request, admin, "conversations_list", kind="admin_view", target=u.id, targetUsername=u.username)
    return {"items": items}


@router.get("/admin/messages")
@limiter.limit("60/minute")
async def admin_conversation(request: Request, a: str = Query(..., max_length=64), b: str = Query(..., max_length=64),
                             admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = [m for m in messages if {m.get("fromUserId"), m.get("toUserId")} == {a, b}]
    rows.sort(key=lambda m: m.get("createdAt") or "")
    _log(request, admin, "conversation_read", kind="admin_view", a=a, b=b, count=len(rows))
    return {"people": _people(db, {a, b}), "messages": rows[-1000:]}


@router.patch("/admin/messages/{message_id}")
@limiter.limit("60/minute")
async def admin_edit_message(request: Request, message_id: str, body: AdminMessageUpdate, admin: User = Depends(require_admin)):
    from services.message_service import MessageService

    msg = _dm_or_404(message_id)
    msg["content"] = body.content
    msg["editedAt"] = datetime.now().isoformat()
    MessageService._save_and_sync(msg)
    await MessageService._notify_both(msg, {"type": "message_updated", "message": msg})
    _log(request, admin, "message_edit", target=message_id, a=msg.get("fromUserId"), b=msg.get("toUserId"))
    return msg


@router.delete("/admin/messages/{message_id}")
@limiter.limit("120/minute")
async def admin_delete_message(request: Request, message_id: str, admin: User = Depends(require_admin)):
    from services.message_service import MessageService

    msg = _dm_or_404(message_id)
    messages[:] = [m for m in messages if m.get("id") != message_id]
    save_messages()
    await MessageService._notify_both(msg, {"type": "message_deleted", "messageId": message_id})
    _log(request, admin, "message_delete", target=message_id, a=msg.get("fromUserId"), b=msg.get("toUserId"))
    return {"ok": True}


# ---------- Notes ----------

class AdminNoteUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = None


def _note_or_404(db: Session, note_id: str) -> Note:
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Жазба табылмады")
    return note


@router.get("/admin/users/{user_id}/notes")
@limiter.limit("60/minute")
async def admin_user_notes(request: Request, user_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.note_service import NoteService

    u = _user_or_404(db, user_id)
    rows = db.query(Note).filter(Note.owner_id == u.id).order_by(Note.folder, Note.title).all()
    _log(request, admin, "notes_list", kind="admin_view", target=u.id, targetUsername=u.username)
    return {"items": [NoteService.to_meta(n) for n in rows]}


@router.get("/admin/notes/{note_id}")
@limiter.limit("60/minute")
async def admin_note_detail(request: Request, note_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.note_service import NoteService

    note = _note_or_404(db, note_id)
    _log(request, admin, "note_read", kind="admin_view", target=note.id, owner=note.owner_id)
    return NoteService.to_dict(note)


@router.patch("/admin/notes/{note_id}")
@limiter.limit("30/minute")
async def admin_update_note(request: Request, note_id: str, body: AdminNoteUpdate,
                            admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.note_service import NoteService

    note = _note_or_404(db, note_id)
    result = NoteService.update_note(db, note.owner_id, note.id, title=body.title, content=body.content)
    _log(request, admin, "note_update", target=note_id, owner=note.owner_id)
    return result


@router.delete("/admin/notes/{note_id}")
@limiter.limit("30/minute")
async def admin_delete_note(request: Request, note_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from services.note_service import NoteService

    note = _note_or_404(db, note_id)
    owner = note.owner_id
    NoteService.delete_note(db, owner, note.id)
    _log(request, admin, "note_delete", target=note_id, owner=owner)
    return {"ok": True}
