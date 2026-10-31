"""Жүктелген файлдарға (/api/uploads/...) қол жеткізуді қорғау.

<img>/<video>/<audio> кіру токенін жібермейді, сондықтан жабық жобадағы /run/ сияқты
файлды кім қарап отырғаны жолдың өзіне жазылады:

    /api/uploads/~<қолданушы id>.<мерзімі>.<қолтаңба>/chat/dm/<a>/<b>/<кездейсоқ>/<атауы>

Сервер қол қойғандықтан бұл сегментті ешкім қолдан жасай алмайды. Ол тек файл бар
хабарламаны көруге рұқсаты бар адамға жауап ретінде беріледі. Файл сұралған сайын рұқсат
қайта тексеріледі: жеке чатта — сол екі адамның бірі ме, топта — әлі мүше ме.

Файлдар:
- chat/dm/<a>/<b>/...  — жеке чат (a < b). Тек осы екеуіне.
- chat/g/<group_id>/... — топ. Тек қазіргі мүшелерге.
- images|audio|video|files/... — ескі чат файлдары (чаты белгісіз). Тек жарамды қолтаңбамен.
- stories/<story_id>.<ext> — жария сторис бәріне ашық; модерациядағысы тек авторына.
"""
import hashlib
import hmac
import math
import re
import time
from typing import Any, Optional, Tuple

from config import JWT_SECRET_KEY

UPLOADS_PREFIX = "/api/uploads/"
MEDIA_TOKEN_TTL = 6 * 3600
# Мерзім сағатқа дейін дөңгелектенеді — бір сағат ішінде сілтеме өзгермейді,
# браузер файлды қайта-қайта жүктемейді
_EXP_BUCKET = 3600

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_TOKEN_RE = re.compile(r"^~([A-Za-z0-9_-]{1,64})\.(\d{1,12})\.([0-9a-f]{32})$")
LEGACY_CHAT_DIRS = ("images", "audio", "video", "files")


def safe_id(value: Any) -> Optional[str]:
    value = str(value or "")
    return value if _ID_RE.match(value) else None


def _sig(user_id: str, exp: str, rel_path: str) -> str:
    msg = f"media:{user_id}:{exp}:{rel_path}".encode()
    return hmac.new(JWT_SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()[:32]


def _needs_signature(rel_path: str) -> bool:
    top = rel_path.split("/", 1)[0]
    return top in ("chat", "stories") or top in LEGACY_CHAT_DIRS


def sign_url(url: str, user_id: str) -> str:
    """/api/uploads/<жол> → /api/uploads/~<id>.<мерзім>.<қолтаңба>/<жол> (осы қолданушыға)"""
    if not url.startswith(UPLOADS_PREFIX) or not safe_id(user_id):
        return url
    rel = url[len(UPLOADS_PREFIX):]
    if rel.startswith("~"):
        # Сақталған деректе қолтаңба болмауы керек; бар болса — алып тастап, қайта қоямыз
        rel = rel.partition("/")[2]
    rel = rel.split("?", 1)[0]
    if not rel or not _needs_signature(rel):
        return url
    exp = str(int(math.ceil((time.time() + MEDIA_TOKEN_TTL) / _EXP_BUCKET) * _EXP_BUCKET))
    return f"{UPLOADS_PREFIX}~{user_id}.{exp}.{_sig(user_id, exp, rel)}/{rel}"


def sign_payload(data: Any, user_id: Optional[str]) -> Any:
    """JSON құрылымындағы файл сілтемелеріне осы қолданушының қолтаңбасын қою.

    Тек сервер өзі жазатын өрістерге: attachments[].url (чат файлы) және mediaUrl (сторис).
    Хабарлама мәтіні не metadata ішіндегі кез келген жолға қол қойылмайды — әйтпесе біреу
    бөтен файлдың жолын мәтінге жазып, қолтаңбалы сілтеме алар еді.
    Жаңа көшірме қайтарады — жадтағы хабарламалар (messages тізімі) өзгермейді"""
    if not user_id:
        return data
    if isinstance(data, list):
        return [sign_payload(v, user_id) for v in data]
    if not isinstance(data, dict):
        return data
    out = {}
    for key, value in data.items():
        if key == "attachments" and isinstance(value, list):
            out[key] = [
                {**att, "url": sign_url(att["url"], user_id)}
                if isinstance(att, dict) and isinstance(att.get("url"), str) else sign_payload(att, user_id)
                for att in value
            ]
        elif key == "mediaUrl" and isinstance(value, str) and value.startswith(UPLOADS_PREFIX + "stories/"):
            out[key] = sign_url(value, user_id)
        else:
            out[key] = sign_payload(value, user_id)
    return out


def split_token(path: str) -> Tuple[Optional[str], str]:
    """'~id.exp.sig/<жол>' → (жарамды қолданушы id не None, <жол>)"""
    if not path.startswith("~"):
        return None, path
    first, _, rest = path.partition("/")
    match = _TOKEN_RE.match(first)
    if not match:
        return None, rest
    user_id, exp, sig = match.groups()
    if int(exp) < time.time() or not hmac.compare_digest(sig, _sig(user_id, exp, rest)):
        return None, rest
    return user_id, rest


def can_access(rel_path: str, user_id: Optional[str]) -> bool:
    """Файлды осы адам қазір көре ала ма (қолтаңба тексерілгеннен кейін)"""
    parts = rel_path.split("/")
    top = parts[0]

    if top == "chat":
        if not user_id:
            return False
        if len(parts) >= 6 and parts[1] == "dm":
            return user_id in (parts[2], parts[3])
        if len(parts) >= 5 and parts[1] == "g":
            from db import SessionLocal
            from services.group_service import GroupService

            db = SessionLocal()
            try:
                return GroupService.get_membership(db, parts[2], user_id) is not None
            finally:
                db.close()
        return False

    if top in LEGACY_CHAT_DIRS:
        # Ескі файл қай чатқа тиесілі екені белгісіз — қолтаңбаны тек рұқсаты барлар алған
        return user_id is not None

    if top == "stories":
        story_id = parts[-1].rsplit(".", 1)[0]
        from db import SessionLocal, Story

        db = SessionLocal()
        try:
            story = db.query(Story).filter(Story.id == story_id).first()
            if story and story.status == "pending":
                return user_id is not None and story.author_id == user_id
            return True
        finally:
            db.close()

    # Басқа папкалар (бар болса) — бұрынғыдай ашық
    return True


def is_private(rel_path: str) -> bool:
    return rel_path.split("/", 1)[0] in ("chat",) + LEGACY_CHAT_DIRS
