"""Басты беттегі сторис: фото/видео + жазу + Codo Hub жобасына сілтеме, 24 сағат тұрады"""
import json
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from db import Story, StoryOpinion, User
from services import opinion_service
from services.code_service import CodeService

STORY_TTL = timedelta(hours=24)
PENDING_TTL = timedelta(days=7)  # модераторға жіберілген шағым осынша күтеді
MAX_ACTIVE_PER_USER = 10
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_VIDEO_SIZE = 50 * 1024 * 1024  # 50MB

UPLOAD_SUBDIR = "stories"
UPLOAD_DIR = os.path.join("uploads", UPLOAD_SUBDIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Сторис реакциялары — тек осы жиыннан
REACTIONS = (
    "❤️", "🔥", "👏", "😂", "😮", "😍", "🤩", "🥳",
    "😎", "🤯", "😢", "😡", "🙏", "💯", "👍", "👎",
    "🚀", "💡", "🎉", "🤔", "💪", "⭐", "🏆", "☕",
)
# Codo қасқыр стикерлері (frontend/public/stickers/wolf/<аты>.svg)
WOLF_STICKERS = ("wolf:smile", "wolf:happy", "wolf:love", "wolf:laugh", "wolf:wink", "wolf:wow", "wolf:sad", "wolf:angry", "wolf:cool", "wolf:fire", "wolf:think", "wolf:sleepy", "wolf:code", "wolf:100", "wolf:sweat", "wolf:thanks")
REACTIONS = REACTIONS + WOLF_STICKERS

# Белгіленген адам туралы пікір түрі
MENTION_KINDS = ("praise", "complaint")

# Магиялық байттар бойынша анықталған тип → кеңейтім (браузер жариялаған типке сенбейміз)
ALLOWED_MEDIA = {
    "image/jpeg": ("image", ".jpg"),
    "image/png": ("image", ".png"),
    "image/webp": ("image", ".webp"),
    "image/gif": ("image", ".gif"),
    "video/mp4": ("video", ".mp4"),
    "video/webm": ("video", ".webm"),
    "video/quicktime": ("video", ".mov"),
}


# Фотосыз (мәтіндік) сторис фоны — media_url = "bg:<аты>", media_type = "text".
# Түстері frontend-те: components/home/stories/storyUtils.ts → STORY_BACKGROUNDS
STORY_BACKGROUNDS = ("aurora", "ocean", "sunset", "forest", "midnight", "mint", "gold", "code")


def _project_or_none(project_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Сілтеме жасалған жоба әлі бар болса — оның қысқа сипаттамасы"""
    if not project_id:
        return None
    code = CodeService.find_code_by_id(project_id)
    if not code:
        return None
    return {
        "id": code["id"],
        "title": code.get("title", ""),
        "language": code.get("language", ""),
        "isFolder": bool(code.get("isFolder")),
        "description": code.get("description") or "",
    }


def _viewer_entries(story: Story) -> List[Dict[str, Any]]:
    """viewers: [{id, at}] (ескі жазбаларда жай id жолы болуы мүмкін)"""
    raw = json.loads(story.viewers or "[]")
    return [v if isinstance(v, dict) else {"id": v, "at": None} for v in raw]


def _reactions(story: Story) -> Dict[str, str]:
    return json.loads(story.reactions or "{}")


def _hide_pending(story: Optional[Story], viewer_id: Optional[str]) -> Story:
    """Модератор тексеріп жатқан сторис — тек авторына бар"""
    if not story or (story.status == "pending" and story.author_id != viewer_id):
        raise HTTPException(status_code=404, detail="Сторис табылмады")
    return story


def _remove_file(media_url: str) -> None:
    if not media_url.startswith("/api/uploads/"):
        return  # мәтіндік сторис — файлы жоқ
    name = os.path.basename(media_url)
    path = os.path.join(UPLOAD_DIR, name)
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


class StoryService:
    @staticmethod
    def purge_expired(db: Session) -> None:
        expired = db.query(Story).filter(Story.expires_at <= datetime.now()).all()
        for story in expired:
            _remove_file(story.media_url)
            if story.status == "pending":
                # Модератор мерзімінде қарамаған шағым — жарияланбай жабылады
                db.query(StoryOpinion).filter(StoryOpinion.story_id == story.id).update(
                    {"status": "rejected", "moderator_note": "Модератор 7 күн ішінде қарап үлгермеді", "story_id": None})
            db.delete(story)
        if expired:
            db.commit()

    @staticmethod
    def validate_project(project_id: Optional[str], user: User) -> Optional[str]:
        """Тек Codo Hub-та бар, осы қолданушының өз жобасы (папка ішіндегі файл емес)"""
        if not project_id:
            return None
        code = CodeService.find_code_by_id(project_id)
        if not code or code.get("author") != user.username or code.get("folderId"):
            raise HTTPException(status_code=400, detail="Жоба табылмады немесе ол сіздікі емес")
        return code["id"]

    @staticmethod
    async def _save_media(file: UploadFile, story_id: str) -> Tuple[str, str]:
        """Фото/видеоны тексеріп сақтау → (media_url, media_type)"""
        content = await file.read(MAX_VIDEO_SIZE + 1)
        if not content:
            raise HTTPException(status_code=400, detail="Файл бос")

        import filetype

        kind = filetype.guess(content)
        if kind is None or kind.mime not in ALLOWED_MEDIA:
            raise HTTPException(status_code=400, detail="Тек сурет (JPG, PNG, WEBP, GIF) не видео (MP4, WEBM, MOV)")
        media_type, ext = ALLOWED_MEDIA[kind.mime]
        limit = MAX_IMAGE_SIZE if media_type == "image" else MAX_VIDEO_SIZE
        if len(content) > limit:
            raise HTTPException(status_code=400, detail=f"Файл тым үлкен (ең көбі {limit // (1024 * 1024)}MB)")

        filename = f"{story_id}{ext}"
        with open(os.path.join(UPLOAD_DIR, filename), "wb") as out:
            out.write(content)
        return f"/api/uploads/{UPLOAD_SUBDIR}/{filename}", media_type

    @staticmethod
    async def create(
        db: Session, user: User, file: Optional[UploadFile], caption: str, project_id: Optional[str],
        mention_id: Optional[str] = None, mention_kind: Optional[str] = None, background: Optional[str] = None,
        opinion: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        """opinion — адам белгіленгенде: text (пікір), шағымда тағы evidence, evidenceProjectId, reviewToken"""
        StoryService.purge_expired(db)
        active = db.query(Story).filter(Story.author_id == user.id).count()
        if active >= MAX_ACTIVE_PER_USER:
            raise HTTPException(status_code=400, detail=f"Бір уақытта ең көбі {MAX_ACTIVE_PER_USER} сторис болады")

        # Жазу мен жоба — қалауынша. Жазу тек түсті фонды стористе міндетті (басқа ештеңе жоқ)
        caption = (caption or "").strip()
        has_media = file is not None and bool(file.filename)

        # Адам белгілеу — міндетті емес. Белгіленсе: пікір түрі + өз сөзімен пікір;
        # мақтау — оның жобасында ≥50 лайк болса; шағым — Бүркіт дәлелін қабылдаса
        opinion = opinion or {}
        mention_id = (mention_id or "").strip() or None
        mention_text = (opinion.get("text") or "").strip()
        evidence = (opinion.get("evidence") or "").strip()
        evidence_project_id = (opinion.get("evidenceProjectId") or "").strip() or None
        verdict = None
        pending = False
        if mention_id:
            if mention_id == user.id:
                raise HTTPException(status_code=400, detail="Өзіңізді белгілей алмайсыз")
            target = db.query(User).filter(User.id == mention_id).first()
            if not target:
                raise HTTPException(status_code=400, detail="Белгіленген қолданушы табылмады")
            if mention_kind not in MENTION_KINDS:
                raise HTTPException(status_code=400, detail="Пікір түрін таңдаңыз: мақтау не шағым")
            if mention_kind == "praise":
                opinion_service.validate_texts(mention_text)
                if opinion_service.best_likes(target.username) < opinion_service.PRAISE_MIN_LIKES:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Мақтау үшін оның жобасында кемінде {opinion_service.PRAISE_MIN_LIKES} лайк болуы керек",
                    )
                evidence, evidence_project_id = "", None
            else:
                opinion_service.validate_texts(mention_text, evidence)
                if opinion.get("manualReview") and not opinion.get("reviewToken"):
                    # Бүркіт қабылдамады не қолжетімсіз — модератор қолмен тексереді
                    if evidence_project_id:
                        code = CodeService.find_code_by_id(evidence_project_id)
                        if not code or code.get("author") != target.username:
                            raise HTTPException(status_code=400, detail="Бұл жоба осы адамдікі емес")
                    pending = True
                else:
                    verdict = opinion_service.verify_token(
                        opinion.get("reviewToken"), user.id, target.id, mention_text, evidence, evidence_project_id,
                    )
        else:
            mention_kind = None
            mention_text = ""

        if not caption and not has_media:
            raise HTTPException(status_code=400, detail="Сторисқа жазу қосыңыз")
        project_id = StoryService.validate_project(project_id, user)

        story_id = str(uuid.uuid4())
        if not has_media:
            if background not in STORY_BACKGROUNDS:
                raise HTTPException(status_code=400, detail="Фото/видео қосыңыз не фон таңдаңыз")
            media_url, media_type = f"bg:{background}", "text"
        else:
            media_url, media_type = await StoryService._save_media(file, story_id)

        now = datetime.now()
        story = Story(
            id=story_id,
            author_id=user.id,
            media_url=media_url,
            media_type=media_type,
            caption=caption[:300],
            project_id=project_id,
            viewers="[]",
            reactions="{}",
            clicks=0,
            mention_id=mention_id,
            mention_kind=mention_kind,
            mention_text=mention_text or None,
            status="pending" if pending else None,
            created_at=now,
            expires_at=now + (PENDING_TTL if pending else STORY_TTL),
        )
        db.add(story)
        if mention_id:
            # Профильде көрінетін пікір — стористен ұзақ сақталады
            db.add(StoryOpinion(
                id=str(uuid.uuid4()),
                story_id=story_id,
                author_id=user.id,
                target_id=mention_id,
                kind=mention_kind,
                text=mention_text,
                evidence=evidence or None,
                evidence_project_id=evidence_project_id,
                verdict=verdict,
                status="pending" if pending else "approved",
                created_at=now,
            ))
        db.commit()
        return StoryService.to_dict(story, user, user, db)

    @staticmethod
    def to_dict(story: Story, author: Optional[User], viewer: Optional[User], db: Optional[Session] = None,
                mentioned: Optional[Dict[str, User]] = None, reply_mode: Optional[str] = None) -> Dict[str, Any]:
        data = {
            "id": story.id,
            "mediaUrl": story.media_url,
            "mediaType": story.media_type,
            "caption": story.caption or "",
            "status": story.status or "published",
            "project": _project_or_none(story.project_id),
            "createdAt": story.created_at.astimezone().isoformat(),  # уақыт белдеуімен — браузер дұрыс есептеуі үшін
            "expiresAt": story.expires_at.astimezone().isoformat(),
        }
        # Көрушілер санын тек авторы көреді
        data["mention"] = None
        if story.mention_id:
            target = (mentioned or {}).get(story.mention_id)
            if target is None and db is not None:
                target = db.query(User).filter(User.id == story.mention_id).first()
            if target:
                data["mention"] = {
                    "id": target.id,
                    "username": target.username,
                    "avatar": target.avatar,
                    "kind": story.mention_kind,
                    "text": story.mention_text or "",
                }

        reactions = _reactions(story)
        if viewer and viewer.id == story.author_id:
            # Авторға — статистика: көрулер, «Жобаға өту» басулары, реакциялар саны
            data["views"] = len(_viewer_entries(story))
            data["clicks"] = story.clicks or 0
            summary: Dict[str, int] = {}
            for emoji in reactions.values():
                summary[emoji] = summary.get(emoji, 0) + 1
            data["reactions"] = summary
        elif viewer:
            # Аккаунт бойынша «көрдім» — басқа құрылғыда да есептеледі
            data["seen"] = any(v["id"] == viewer.id for v in _viewer_entries(story))
            data["myReaction"] = reactions.get(viewer.id)
            # Жауап қайда барады: direct — чатқа, request — сұрауға, blocked — тек достар жаза алады
            data["replyMode"] = reply_mode
        return data

    @staticmethod
    def list_grouped(db: Session, viewer: Optional[User]) -> List[Dict[str, Any]]:
        """Авторлар бойынша топталған белсенді сторис: ең жаңасы бар автор бірінші"""
        StoryService.purge_expired(db)
        stories = [
            s for s in db.query(Story).order_by(Story.created_at.asc()).all()
            if s.status != "pending" or (viewer and s.author_id == viewer.id)
        ]
        author_ids = {s.author_id for s in stories}
        authors = {u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()} if author_ids else {}
        mention_ids = {s.mention_id for s in stories if s.mention_id}
        mentioned = {u.id: u for u in db.query(User).filter(User.id.in_(mention_ids)).all()} if mention_ids else {}

        reply_modes: Dict[str, str] = {}
        if viewer:
            from services.friend_service import FriendService
            reply_modes = {aid: FriendService.delivery_mode(viewer.id, aid) for aid in authors if aid != viewer.id}

        groups: Dict[str, Dict[str, Any]] = {}
        for story in stories:
            author = authors.get(story.author_id)
            if not author:
                continue
            group = groups.setdefault(author.id, {
                "authorId": author.id,
                "author": author.username,
                "avatar": author.avatar,
                "items": [],
            })
            group["items"].append(StoryService.to_dict(story, author, viewer, mentioned=mentioned,
                                                       reply_mode=reply_modes.get(author.id)))

        # Авторға: әр стористі соңғы көрген 3 адам (аватарлары картада қабаттасып тұрады)
        if viewer and viewer.id in groups:
            own = {s.id: s for s in stories if s.author_id == viewer.id}
            recent_ids = {s.id: [v["id"] for v in _viewer_entries(s)][-3:][::-1] for s in own.values()}
            all_ids = {uid for ids in recent_ids.values() for uid in ids}
            people = {u.id: u for u in db.query(User).filter(User.id.in_(all_ids)).all()} if all_ids else {}
            for item in groups[viewer.id]["items"]:
                item["recentViewers"] = [
                    {"id": people[uid].id, "username": people[uid].username, "avatar": people[uid].avatar}
                    for uid in recent_ids.get(item["id"], []) if uid in people
                ]

        result = list(groups.values())
        result.sort(key=lambda g: g["items"][-1]["createdAt"], reverse=True)
        # Өз сторисім — әрқашан бірінші
        if viewer:
            result.sort(key=lambda g: g["authorId"] != viewer.id)
        return result

    @staticmethod
    def mark_viewed(db: Session, story_id: str, viewer: Optional[User]) -> None:
        story = _hide_pending(db.query(Story).filter(Story.id == story_id).first(), viewer.id if viewer else None)
        if not viewer or viewer.id == story.author_id:
            return
        viewers = _viewer_entries(story)
        if all(v["id"] != viewer.id for v in viewers):
            viewers.append({"id": viewer.id, "at": datetime.now().isoformat()})
            story.viewers = json.dumps(viewers)
            db.commit()

    @staticmethod
    def list_viewers(db: Session, story_id: str, user: User) -> List[Dict[str, Any]]:
        """Кім көрді — тек авторына, ең соңғы көргені бірінші"""
        story = db.query(Story).filter(Story.id == story_id).first()
        if not story:
            raise HTTPException(status_code=404, detail="Сторис табылмады")
        if story.author_id != user.id:
            raise HTTPException(status_code=403, detail="Көрушілерді тек авторы көреді")
        entries = _viewer_entries(story)
        reactions = _reactions(story)
        ids = [v["id"] for v in entries]
        users = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
        result = []
        for entry in reversed(entries):
            u = users.get(entry["id"])
            if not u:
                continue
            viewed_at = datetime.fromisoformat(entry["at"]).astimezone().isoformat() if entry.get("at") else None
            result.append({
                "id": u.id,
                "username": u.username,
                "avatar": u.avatar,
                "viewedAt": viewed_at,
                "reaction": reactions.get(u.id),
            })
        # Реакция қойғандар — жоғарыда
        result.sort(key=lambda v: v["reaction"] is None)
        return result

    @staticmethod
    def react(db: Session, story_id: str, user: User, emoji: Optional[str]) -> Optional[str]:
        """Реакция қою/ауыстыру; emoji=None — алып тастау. Өз сторисіңе қойылмайды"""
        story = _hide_pending(db.query(Story).filter(Story.id == story_id).first(), user.id)
        if story.author_id == user.id:
            raise HTTPException(status_code=400, detail="Өз сторисіңізге реакция қоя алмайсыз")
        if emoji is not None and emoji not in REACTIONS:
            raise HTTPException(status_code=400, detail="Бұл реакция қолжетімсіз")
        reactions = _reactions(story)
        if emoji is None:
            reactions.pop(user.id, None)
        else:
            reactions[user.id] = emoji
        story.reactions = json.dumps(reactions, ensure_ascii=False)
        db.commit()
        return emoji

    @staticmethod
    async def share(db: Session, story_id: str, user: User, target_ids: List[str], text: str) -> Dict[str, Any]:
        """Стористі достарға чат арқылы жіберу (сторис картасымен). Әр алушыға жеке:
        біреуіне жіберілмесе (тек достар), қалғандарына бара береді"""
        from services.friend_service import FriendService
        from services.message_service import MessageService

        story = _hide_pending(
            db.query(Story).filter(Story.id == story_id, Story.expires_at > datetime.now()).first(), user.id)
        if story.status == "pending":
            raise HTTPException(status_code=400, detail="Сторис әлі модератор тексеруінде")
        author = db.query(User).filter(User.id == story.author_id).first()
        targets = [t for t in dict.fromkeys(target_ids) if t and t != user.id]
        if not targets:
            raise HTTPException(status_code=400, detail="Кімге жіберетініңізді таңдаңыз")

        metadata = {"storyShare": {
            "storyId": story.id,
            "mediaUrl": story.media_url,
            "mediaType": story.media_type,
            "caption": story.caption or "",
            "expiresAt": story.expires_at.astimezone().isoformat(),
            "authorId": story.author_id,
            "author": author.username if author else "",
        }}
        results = []
        for target_id in targets:
            try:
                delivery = FriendService.delivery_extra(user.id, target_id)
                message = await MessageService.create_message(
                    from_user_id=user.id,
                    to_user_id=target_id,
                    content=(text or "").strip(),
                    are_friends=True,
                    message_type="text",
                    metadata=metadata,
                    extra=delivery,
                )
                results.append({"id": target_id, "ok": True, "request": bool(delivery.get("request")), "messageId": message["id"]})
            except HTTPException as e:
                results.append({"id": target_id, "ok": False, "error": e.detail})
        return {"results": results}

    @staticmethod
    async def reply(db: Session, story_id: str, user: User, text: str) -> Dict[str, Any]:
        """Сторисқа жауап — авторға жеке хабарлама (сторис үзіндісімен).
        Автордың баптауына қарай тікелей чатқа не «сұрауға» барады"""
        from services.friend_service import FriendService
        from services.message_service import MessageService

        story = _hide_pending(
            db.query(Story).filter(Story.id == story_id, Story.expires_at > datetime.now()).first(), user.id)
        if story.author_id == user.id:
            raise HTTPException(status_code=400, detail="Өз сторисіңізге жауап жаза алмайсыз")
        text = (text or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Хабарлама бос")
        delivery = FriendService.delivery_extra(user.id, story.author_id)
        message = await MessageService.create_message(
            from_user_id=user.id,
            to_user_id=story.author_id,
            content=text,
            are_friends=True,
            message_type="text",
            metadata={"storyReply": {
                "storyId": story.id,
                "mediaUrl": story.media_url,
                "mediaType": story.media_type,
                "caption": story.caption or "",
                "expiresAt": story.expires_at.astimezone().isoformat(),
            }},
            extra=delivery,
        )
        return {"message": message, "request": bool(delivery.get("request"))}

    @staticmethod
    def register_click(db: Session, story_id: str, viewer: Optional[User]) -> None:
        """«Жобаға өту» басылды — автордың өз басуы есептелмейді"""
        story = _hide_pending(db.query(Story).filter(Story.id == story_id).first(), viewer.id if viewer else None)
        if viewer and viewer.id == story.author_id:
            return
        story.clicks = (story.clicks or 0) + 1
        db.commit()

    @staticmethod
    def delete(db: Session, story_id: str, user: User) -> None:
        story = db.query(Story).filter(Story.id == story_id).first()
        if not story:
            raise HTTPException(status_code=404, detail="Сторис табылмады")
        if story.author_id != user.id:
            raise HTTPException(status_code=403, detail="Тек өз сторисіңізді өшіре аласыз")
        _remove_file(story.media_url)
        db.query(StoryOpinion).filter(StoryOpinion.story_id == story.id).delete()
        db.delete(story)
        db.commit()

    @staticmethod
    def opinions_about(db: Session, username: str, kind: Optional[str], limit: int, offset: int) -> Dict[str, Any]:
        """Профиль үшін: адам туралы пікірлер (ең жаңасы бірінші) + мақтау/шағым саны"""
        from sqlalchemy import func as sa_func

        target = db.query(User).filter(sa_func.lower(User.username) == username.lower()).first()
        if not target:
            raise HTTPException(status_code=404, detail="Қолданушы табылмады")

        # Тек жарияланған пікірлер (модераторда тұрғаны, қабылданбағаны, алынғаны — жоқ)
        base = db.query(StoryOpinion).filter(
            StoryOpinion.target_id == target.id,
            (StoryOpinion.status == "approved") | (StoryOpinion.status.is_(None)),
        )
        counts = {k: 0 for k in MENTION_KINDS}
        for k, n in base.with_entities(StoryOpinion.kind, sa_func.count()).group_by(StoryOpinion.kind).all():
            counts[k] = n

        query = base.filter(StoryOpinion.kind == kind) if kind in MENTION_KINDS else base
        total = query.count()
        rows = query.order_by(StoryOpinion.created_at.desc()).offset(offset).limit(limit).all()

        author_ids = {r.author_id for r in rows}
        authors = {u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()} if author_ids else {}
        story_ids = {r.story_id for r in rows if r.story_id}
        active = {s.id for s in db.query(Story.id).filter(Story.id.in_(story_ids), Story.expires_at > datetime.now()).all()} if story_ids else set()

        items = []
        for r in rows:
            author = authors.get(r.author_id)
            items.append({
                "id": r.id,
                "kind": r.kind,
                "text": r.text,
                "verdict": r.verdict,  # шағымды Бүркіт неге қабылдады
                "moderatorNote": r.moderator_note,  # модератор бекітсе — себебі
                "createdAt": r.created_at.astimezone().isoformat(),
                "author": {"id": author.id, "username": author.username, "avatar": author.avatar} if author else None,
                # Сторис әлі тірі болса — сілтемемен ашуға болады
                "storyId": r.story_id if r.story_id in active else None,
            })
        return {"praise": counts["praise"], "complaint": counts["complaint"], "total": total, "items": items}

    @staticmethod
    def delete_opinion(db: Session, opinion_id: str, user: User) -> None:
        """Пікірді тек авторы өшіре алады"""
        opinion = db.query(StoryOpinion).filter(StoryOpinion.id == opinion_id).first()
        if not opinion:
            raise HTTPException(status_code=404, detail="Пікір табылмады")
        if opinion.author_id != user.id:
            raise HTTPException(status_code=403, detail="Тек өз пікіріңізді өшіре аласыз")
        db.delete(opinion)
        db.commit()
