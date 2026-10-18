"""Топтық чат маршруттары — тек топ мүшелеріне қолжетімді"""
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from db import User, get_db
from models import MessageEdit, PinToggle, PollVote, ReactionToggle
from services.group_service import MAX_GROUP_MEMBERS, GroupService, _public_users
from services.message_extras import build_poll_metadata, reply_snapshot
from services.project_card import build_project_metadata
from services.upload_service import save_chat_attachment
from utils.auth import get_current_user

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

MESSAGE_TYPES = r"^(text|image|audio|video|file|sticker|emoji|location|project|poll)$"


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)
    memberIds: List[str] = Field(default_factory=list, max_length=MAX_GROUP_MEMBERS)


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)


class GroupMembersAdd(BaseModel):
    userIds: List[str] = Field(min_length=1, max_length=MAX_GROUP_MEMBERS)


class GroupRoleUpdate(BaseModel):
    role: str = Field(pattern=r"^(admin|member)$")


class GroupMessageCreate(BaseModel):
    content: str = Field(default="", max_length=5000)
    type: str = Field(default="text", max_length=20, pattern=MESSAGE_TYPES)
    attachments: Optional[List[Dict[str, Any]]] = None
    metadata: Optional[Dict[str, Any]] = None
    replyToId: Optional[str] = Field(default=None, max_length=64)


def _reply_extra(db: Session, group_id: str, user_id: str, reply_to_id: Optional[str]) -> Dict[str, Any]:
    """replyToId → {'replyTo': үзінді}; хабарлама осы топта болуы керек"""
    if not reply_to_id:
        return {}
    row, _ = GroupService.get_visible_message(db, group_id, reply_to_id, user_id)
    users = _public_users(db, [row.from_user_id])
    source = GroupService.message_to_dict(row, users)
    sender = users.get(row.from_user_id)
    return {"replyTo": reply_snapshot(source, sender["username"] if sender else None)}


@router.get("/groups")
@limiter.limit("60/minute")
async def list_groups(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return GroupService.list_groups(db, user.id)


@router.post("/groups")
@limiter.limit("10/minute")
async def create_group(
    request: Request, data: GroupCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return await GroupService.create_group(db, user.id, data.name, data.memberIds, data.description)


@router.get("/groups/{group_id}")
@limiter.limit("60/minute")
async def get_group(request: Request, group_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return GroupService.group_details(db, group_id, user.id)


@router.patch("/groups/{group_id}")
@limiter.limit("20/minute")
async def update_group(
    request: Request,
    group_id: str,
    data: GroupUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await GroupService.update_group(db, group_id, user.id, data.name, data.description)


@router.delete("/groups/{group_id}")
@limiter.limit("10/minute")
async def delete_group(request: Request, group_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    await GroupService.delete_group(db, group_id, user.id)
    return {"ok": True}


@router.post("/groups/{group_id}/members")
@limiter.limit("20/minute")
async def add_members(
    request: Request,
    group_id: str,
    data: GroupMembersAdd,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await GroupService.add_members(db, group_id, user.id, data.userIds)


@router.delete("/groups/{group_id}/members/{member_id}")
@limiter.limit("20/minute")
async def remove_member(
    request: Request,
    group_id: str,
    member_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Мүшені шығару; member_id өзімнің id-м болса — топтан шығу"""
    return await GroupService.remove_member(db, group_id, user.id, member_id)


@router.patch("/groups/{group_id}/members/{member_id}")
@limiter.limit("20/minute")
async def set_member_role(
    request: Request,
    group_id: str,
    member_id: str,
    data: GroupRoleUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await GroupService.set_role(db, group_id, user.id, member_id, data.role)


@router.get("/groups/{group_id}/messages")
@limiter.limit("60/minute")
async def get_messages(
    request: Request,
    group_id: str,
    limit: int = Query(200, ge=1, le=500),
    before: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return GroupService.get_messages(db, group_id, user.id, limit, before)


@router.post("/groups/{group_id}/messages")
@limiter.limit("30/minute")
async def send_message(
    request: Request,
    group_id: str,
    data: GroupMessageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    metadata = data.metadata
    content = data.content
    if data.type == "poll":
        metadata = build_poll_metadata(data.metadata)
        content = metadata["question"]
    if data.type == "project":
        # Алдымен мүшелік — мүше емес адамға жоба туралы ештеңе ашылмайды
        GroupService.require_member(db, group_id, user.id)
        metadata = build_project_metadata(db, user.id, data.metadata)
    extra = _reply_extra(db, group_id, user.id, data.replyToId)
    return await GroupService.send_message(db, group_id, user.id, content, data.type, data.attachments, metadata, extra)


@router.post("/groups/{group_id}/messages/upload")
@limiter.limit("10/minute")
async def upload_message_file(
    request: Request,
    group_id: str,
    file: UploadFile = File(...),
    messageType: str = Form("file"),
    content: Optional[str] = Form(None, max_length=5000),
    metadata: Optional[str] = Form(None, max_length=4000),
    replyToId: Optional[str] = Form(None, max_length=64),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if messageType not in ("image", "audio", "video", "file"):
        raise HTTPException(status_code=400, detail="Invalid message type")
    # Алдымен мүшелікті тексереміз — мүше болмаса файл сақталмайды
    GroupService.require_member(db, group_id, user.id)
    extra = _reply_extra(db, group_id, user.id, replyToId)
    attachment = await save_chat_attachment(file, messageType)

    metadata_dict: Dict[str, Any] = {}
    if metadata:
        try:
            parsed = json.loads(metadata)
            if isinstance(parsed, dict):
                metadata_dict = parsed
        except ValueError:
            pass

    return await GroupService.send_message(db, group_id, user.id, content or "", messageType, [attachment], metadata_dict, extra)


@router.put("/groups/{group_id}/read")
@limiter.limit("60/minute")
async def mark_read(request: Request, group_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return GroupService.mark_read(db, group_id, user.id)


# ---------- Хабарлама әрекеттері ----------

@router.patch("/groups/{group_id}/messages/{message_id}")
@limiter.limit("30/minute")
async def edit_message(
    request: Request, group_id: str, message_id: str, body: MessageEdit,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return await GroupService.edit_message(db, group_id, message_id, user.id, body.content)


@router.delete("/groups/{group_id}/messages/{message_id}")
@limiter.limit("30/minute")
async def delete_message(
    request: Request, group_id: str, message_id: str,
    scope: str = Query("me", pattern=r"^(me|all)$"),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return await GroupService.delete_message(db, group_id, message_id, user.id, scope == "all")


@router.post("/groups/{group_id}/messages/{message_id}/reactions")
@limiter.limit("60/minute")
async def react_to_message(
    request: Request, group_id: str, message_id: str, body: ReactionToggle,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return await GroupService.react(db, group_id, message_id, user.id, body.emoji)


@router.post("/groups/{group_id}/messages/{message_id}/listened")
@limiter.limit("60/minute")
async def mark_listened(
    request: Request, group_id: str, message_id: str,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return await GroupService.mark_listened(db, group_id, message_id, user.id)


@router.post("/groups/{group_id}/messages/{message_id}/pin")
@limiter.limit("30/minute")
async def pin_message(
    request: Request, group_id: str, message_id: str, body: PinToggle,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return await GroupService.set_pinned(db, group_id, message_id, user.id, body.pinned)


@router.post("/groups/{group_id}/messages/{message_id}/vote")
@limiter.limit("60/minute")
async def vote_in_poll(
    request: Request, group_id: str, message_id: str, body: PollVote,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return await GroupService.vote(db, group_id, message_id, user.id, body.optionIds)
