"""Шағымдарды қолмен тексеру — тек модераторларға (MODERATOR_USER_IDS)"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from db import User, get_db
from services import moderation_service
from utils.auth import get_current_user

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


class DecisionBody(BaseModel):
    action: Literal["approve", "reject", "remove"]
    note: str = Field(min_length=moderation_service.NOTE_MIN, max_length=moderation_service.NOTE_MAX)


@router.get("/moderation/me")
@limiter.limit("60/minute")
async def moderation_me(request: Request, user: User = Depends(get_current_user)):
    return {"isModerator": moderation_service.is_moderator(user)}


@router.get("/moderation/complaints")
@limiter.limit("60/minute")
async def list_complaints(
    request: Request,
    status: Optional[Literal["pending", "approved", "closed"]] = Query(default="pending"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return moderation_service.list_cases(db, user, status or "pending")


@router.post("/moderation/complaints/{opinion_id}/decide")
@limiter.limit("30/minute")
async def decide_complaint(request: Request, opinion_id: str, body: DecisionBody,
                           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return await moderation_service.decide(db, user, opinion_id, body.action, body.note)
