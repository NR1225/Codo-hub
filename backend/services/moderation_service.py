"""Шағымдарды модератордың қолмен тексеруі.
- Бүркіт қабылдамаған шағымды автор модераторға жібере алады: сторис «pending» болып
  басқаларға көрінбей тұрады, модератор бекітсе — жарияланады (24 сағат сол сәттен басталады).
- Бүркіт қабылдаған (жарияланған) шағымды модератор кейін алып тастай алады.
Әр шешімнің себебі жазылады және авторға (алып тастағанда — белгіленген адамға да) чатпен барады."""
import logging
from datetime import datetime
from typing import Any, Dict, List

from fastapi import HTTPException
from sqlalchemy.orm import Session

from config import MODERATOR_USER_IDS
from db import Story, StoryOpinion, User

logger = logging.getLogger("codo_hub")

NOTE_MIN, NOTE_MAX = 10, 500


def is_moderator(user: User) -> bool:
    return user.id in MODERATOR_USER_IDS


def _require(user: User) -> None:
    if not is_moderator(user):
        raise HTTPException(status_code=403, detail="Бұл бөлім тек модераторларға")


def _person(u: User | None) -> Dict[str, Any] | None:
    return {"id": u.id, "username": u.username, "avatar": u.avatar} if u else None


def list_cases(db: Session, user: User, status: str) -> List[Dict[str, Any]]:
    """pending — шешім күтіп тұрғандар; approved — жарияланғандар; closed — қабылданбаған/алынғандар"""
    from services.story_service import _project_or_none

    _require(user)
    statuses = {"pending": ["pending"], "approved": ["approved", None], "closed": ["rejected", "removed"]}[status]
    query = db.query(StoryOpinion).filter(StoryOpinion.kind == "complaint")
    with_null = None in statuses
    names = [s for s in statuses if s]
    query = query.filter((StoryOpinion.status.in_(names)) | (StoryOpinion.status.is_(None))) if with_null \
        else query.filter(StoryOpinion.status.in_(names))
    rows = query.order_by(StoryOpinion.created_at.desc()).limit(100).all()

    ids = {r.author_id for r in rows} | {r.target_id for r in rows} | {r.moderated_by for r in rows if r.moderated_by}
    people = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    story_ids = {r.story_id for r in rows if r.story_id}
    stories = {s.id: s for s in db.query(Story).filter(Story.id.in_(story_ids)).all()} if story_ids else {}

    out = []
    for r in rows:
        story = stories.get(r.story_id)
        out.append({
            "id": r.id,
            "status": r.status or "approved",
            "text": r.text,
            "evidence": r.evidence or "",
            "evidenceProject": _project_or_none(r.evidence_project_id),
            "verdict": r.verdict,
            "note": r.moderator_note,
            "moderator": _person(people.get(r.moderated_by)) if r.moderated_by else None,
            "moderatedAt": r.moderated_at.astimezone().isoformat() if r.moderated_at else None,
            "createdAt": r.created_at.astimezone().isoformat(),
            "author": _person(people.get(r.author_id)),
            "target": _person(people.get(r.target_id)),
            "story": {
                "id": story.id,
                "mediaUrl": story.media_url,
                "mediaType": story.media_type,
                "caption": story.caption or "",
                "status": story.status or "published",
            } if story else None,
        })
    return out


async def _notify(moderator: User, to_id: str, text: str) -> None:
    """Шешім туралы чатқа хабар (модератордың атынан). Жіберілмесе — шешім бәрібір күшінде"""
    from services.message_service import MessageService

    if to_id == moderator.id:
        return
    try:
        await MessageService.create_message(moderator.id, to_id, text, are_friends=True)
    except Exception as e:  # noqa: BLE001 — хабар жетпесе де шешім сақталады
        logger.warning("Moderation notice to %s failed: %r", to_id, e)


async def decide(db: Session, user: User, opinion_id: str, action: str, note: str) -> Dict[str, Any]:
    from services.story_service import STORY_TTL, _remove_file

    _require(user)
    note = note.strip()
    if len(note) < NOTE_MIN:
        raise HTTPException(status_code=400, detail=f"Себебін жазыңыз (кемінде {NOTE_MIN} таңба)")
    opinion = db.query(StoryOpinion).filter(StoryOpinion.id == opinion_id, StoryOpinion.kind == "complaint").first()
    if not opinion:
        raise HTTPException(status_code=404, detail="Шағым табылмады")
    status = opinion.status or "approved"
    allowed = {"approve": "pending", "reject": "pending", "remove": "approved"}
    if status != allowed[action]:
        raise HTTPException(status_code=400, detail="Бұл шағымға бұл шешім қолданылмайды")

    story = db.query(Story).filter(Story.id == opinion.story_id).first() if opinion.story_id else None
    target = db.query(User).filter(User.id == opinion.target_id).first()
    target_name = f"@{target.username}" if target else "қолданушы"
    now = datetime.now()

    if action == "approve":
        opinion.status = "approved"
        opinion.created_at = now
        if story:
            # 24 сағат — жарияланған сәттен
            story.status = "published"
            story.created_at = now
            story.expires_at = now + STORY_TTL
    else:
        opinion.status = "rejected" if action == "reject" else "removed"
        if story:
            _remove_file(story.media_url)
            db.delete(story)
        opinion.story_id = None
    opinion.moderator_note = note
    opinion.moderated_by = user.id
    opinion.moderated_at = now
    db.commit()

    messages = {
        "approve": f"✅ {target_name} туралы шағымыңызды модератор қабылдады — сторис жарияланды.\nСебебі: {note}",
        "reject": f"❌ {target_name} туралы шағымыңызды модератор қабылдамады.\nСебебі: {note}",
        "remove": f"🗑 {target_name} туралы шағымыңызды модератор алып тастады.\nСебебі: {note}",
    }
    await _notify(user, opinion.author_id, messages[action])
    if action == "remove" and target:
        await _notify(user, target.id, f"🛡 Сіз туралы шағымды модератор алып тастады.\nСебебі: {note}")
    return {"ok": True, "status": opinion.status}
