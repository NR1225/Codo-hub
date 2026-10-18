"""Онлайн / соңғы рет кірген уақыт (Telegram сияқты «желіде», «5 минут бұрын болды»).

Онлайн — қолданушының кемінде бір WebSocket қосылымы бар. Соңғы қосылым жабылғанда
users.last_seen_at жазылады. Күй тек «байланысты» адамдарға көрінеді және жіберіледі:
достар, бұрын хат жазысқандар және ортақ топтағылар.
"""
from datetime import datetime
from typing import Any, Dict, Iterable, Optional, Set

from db import ChatGroupMember, SessionLocal, User
from websocket import manager


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def related_user_ids(user_id: str) -> Set[str]:
    from database import friends, messages

    related: Set[str] = set(friends.get(user_id, []))
    for msg in messages:
        if msg.get("fromUserId") == user_id and msg.get("toUserId"):
            related.add(msg["toUserId"])
        elif msg.get("toUserId") == user_id and msg.get("fromUserId"):
            related.add(msg["fromUserId"])

    db = SessionLocal()
    try:
        group_ids = [
            gid for (gid,) in db.query(ChatGroupMember.group_id).filter(ChatGroupMember.user_id == user_id).all()
        ]
        if group_ids:
            rows = db.query(ChatGroupMember.user_id).filter(ChatGroupMember.group_id.in_(group_ids)).all()
            related.update(uid for (uid,) in rows)
    finally:
        db.close()

    related.discard(user_id)
    return related


def get_presence(viewer_id: str, user_ids: Iterable[str]) -> Dict[str, Dict[str, Any]]:
    allowed = related_user_ids(viewer_id) | {viewer_id}
    ids = [uid for uid in dict.fromkeys(user_ids) if uid in allowed]
    if not ids:
        return {}
    db = SessionLocal()
    try:
        rows = db.query(User.id, User.last_seen_at).filter(User.id.in_(ids)).all()
    finally:
        db.close()
    return {
        uid: {"online": manager.is_user_online(uid), "lastSeen": _iso(last_seen)}
        for uid, last_seen in rows
    }


async def _broadcast(user_id: str, online: bool, last_seen: Optional[datetime]):
    payload = {"type": "presence", "userId": user_id, "online": online, "lastSeen": _iso(last_seen)}
    for uid in related_user_ids(user_id):
        if manager.is_user_online(uid):
            await manager.send_personal_message(payload, uid)


async def on_connected(user_id: str, was_online: bool):
    """Бірінші қосылым ашылды — достарға «желіде» деп хабарлау"""
    if not was_online:
        await _broadcast(user_id, True, None)


async def on_disconnected(user_id: str):
    """Соңғы қосылым жабылды — уақытты сақтап, «соңғы рет ... болды» деп хабарлау"""
    if manager.is_user_online(user_id):
        return  # басқа бетте/құрылғыда әлі ашық
    now = datetime.now()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            user.last_seen_at = now
            db.commit()
    finally:
        db.close()
    await _broadcast(user_id, False, now)
