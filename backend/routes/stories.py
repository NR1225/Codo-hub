"""Басты беттегі сторис: фото/видео + Codo Hub жобасына сілтеме"""
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from db import User, get_db
from fastapi import HTTPException

from services import opinion_service
from services.story_service import StoryService
from utils.auth import get_current_user, get_optional_user

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


class ReplyBody(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class ShareBody(BaseModel):
    targets: List[str] = Field(min_length=1, max_length=20)
    text: str = Field(default="", max_length=1000)


class OpinionReviewBody(BaseModel):
    mentionId: str = Field(min_length=1, max_length=12)
    text: str = Field(min_length=1, max_length=opinion_service.OPINION_MAX)
    evidence: str = Field(min_length=1, max_length=opinion_service.EVIDENCE_MAX)
    projectId: Optional[str] = Field(default=None, max_length=64)


class ReactionBody(BaseModel):
    emoji: Optional[str] = Field(default=None, max_length=16)  # null — реакцияны алып тастау


@router.get("/stories")
@limiter.limit("60/minute")
async def list_stories(request: Request, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    return StoryService.list_grouped(db, user)


@router.post("/stories")
@limiter.limit("10/minute")
async def create_story(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
    caption: str = Form(default="", max_length=300),
    background: Optional[str] = Form(default=None, max_length=16),
    projectId: Optional[str] = Form(default=None, max_length=64),
    mentionId: Optional[str] = Form(default=None, max_length=12),
    mentionKind: Optional[str] = Form(default=None, max_length=12),
    mentionText: Optional[str] = Form(default=None, max_length=opinion_service.OPINION_MAX),
    evidence: Optional[str] = Form(default=None, max_length=opinion_service.EVIDENCE_MAX),
    evidenceProjectId: Optional[str] = Form(default=None, max_length=64),
    reviewToken: Optional[str] = Form(default=None, max_length=2000),
    manualReview: bool = Form(default=False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    opinion = {"text": mentionText, "evidence": evidence, "evidenceProjectId": evidenceProjectId,
               "reviewToken": reviewToken, "manualReview": manualReview}
    return await StoryService.create(db, user, file, caption, projectId, mentionId, mentionKind, background, opinion)


def _target(db: Session, user_id: str) -> User:
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Қолданушы табылмады")
    return target


@router.get("/stories/mention-info/{user_id}")
@limiter.limit("30/minute")
async def mention_info(request: Request, user_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Белгіленетін адам: мақтауға бола ма (лайк шарты) және оның жобалары (шағымға дәлел ретінде)"""
    return opinion_service.mention_info(_target(db, user_id))


@router.post("/stories/opinion-review")
@limiter.limit("6/minute")
async def review_opinion(request: Request, body: OpinionReviewBody, user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    """Бүркіт шағымды дәлелімен тексереді; қабылдаса — жариялауға токен береді"""
    return await opinion_service.review_complaint(user, _target(db, body.mentionId), body.text, body.evidence, body.projectId)


@router.post("/stories/{story_id}/view")
@limiter.limit("120/minute")
async def view_story(
    request: Request, story_id: str, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)
):
    StoryService.mark_viewed(db, story_id, user)
    return {"ok": True}


@router.post("/stories/{story_id}/react")
@limiter.limit("60/minute")
async def react_story(
    request: Request, story_id: str, body: ReactionBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return {"reaction": StoryService.react(db, story_id, user, body.emoji)}


@router.post("/stories/{story_id}/reply")
@limiter.limit("30/minute")
async def reply_story(
    request: Request, story_id: str, body: ReplyBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Сторисқа жауап — авторға чат арқылы (не сұрау ретінде)"""
    return await StoryService.reply(db, story_id, user, body.text)


@router.post("/stories/{story_id}/share")
@limiter.limit("20/minute")
async def share_story(
    request: Request, story_id: str, body: ShareBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Стористі достарға чат арқылы жіберу"""
    return await StoryService.share(db, story_id, user, body.targets, body.text)


@router.post("/stories/{story_id}/click")
@limiter.limit("60/minute")
async def click_story(
    request: Request, story_id: str, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)
):
    StoryService.register_click(db, story_id, user)
    return {"ok": True}


@router.get("/stories/{story_id}/viewers")
@limiter.limit("60/minute")
async def story_viewers(request: Request, story_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return StoryService.list_viewers(db, story_id, user)


@router.get("/opinions/{username}")
@limiter.limit("60/minute")
async def opinions_about(
    request: Request,
    username: str,
    kind: Optional[str] = Query(default=None, pattern=r"^(praise|complaint)$"),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Адам туралы стористердегі пікірлер (мақтау/шағым) — профильде көрінеді"""
    return StoryService.opinions_about(db, username, kind, limit, offset)


@router.delete("/opinions/{opinion_id}")
@limiter.limit("30/minute")
async def delete_opinion(request: Request, opinion_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    StoryService.delete_opinion(db, opinion_id, user)
    return {"ok": True}


@router.delete("/stories/{story_id}")
@limiter.limit("30/minute")
async def delete_story(request: Request, story_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    StoryService.delete(db, story_id, user)
    return {"ok": True}
