"""Чаттар тізімін реттеу (Telegram сияқты): бекіту, дыбысын өшіру, мұрағаттау.
Белгілер тек қолданушының өзіне көрінеді — сөйлесушіге ешнәрсе жіберілмейді."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from db import ChatGroupMember, ChatPref, SessionLocal
from services.friend_service import FriendService
from websocket import manager

MAX_PINNED = 5


def _to_dict(pref: ChatPref) -> Dict[str, Any]:
    return {
        "kind": pref.chat_kind,
        "id": pref.chat_id,
        "pinnedAt": pref.pinned_at.isoformat() if pref.pinned_at else None,
        "muted": bool(pref.muted),
        "archived": bool(pref.archived),
    }


def list_prefs(user_id: str) -> List[Dict[str, Any]]:
    db = SessionLocal()
    try:
        return [_to_dict(p) for p in db.query(ChatPref).filter(ChatPref.user_id == user_id).all()]
    finally:
        db.close()


async def update_pref(
    user_id: str,
    kind: str,
    chat_id: str,
    pinned: Optional[bool],
    muted: Optional[bool],
    archived: Optional[bool],
) -> Dict[str, Any]:
    db = SessionLocal()
    try:
        # Тек өз чатыма белгі қоя аламын
        if kind == "group":
            is_member = (
                db.query(ChatGroupMember)
                .filter(ChatGroupMember.group_id == chat_id, ChatGroupMember.user_id == user_id)
                .first()
            )
            if not is_member:
                raise HTTPException(status_code=404, detail="Chat not found")
        elif not FriendService.can_message(user_id, chat_id):
            raise HTTPException(status_code=404, detail="Chat not found")

        pref = (
            db.query(ChatPref)
            .filter(ChatPref.user_id == user_id, ChatPref.chat_kind == kind, ChatPref.chat_id == chat_id)
            .first()
        )
        if not pref:
            pref = ChatPref(user_id=user_id, chat_kind=kind, chat_id=chat_id, muted=False, archived=False)
            db.add(pref)

        if pinned is True and not pref.pinned_at:
            pinned_count = (
                db.query(ChatPref)
                .filter(ChatPref.user_id == user_id, ChatPref.pinned_at.isnot(None), ChatPref.archived.is_(False))
                .count()
            )
            if pinned_count >= MAX_PINNED:
                raise HTTPException(status_code=400, detail="pinned_limit")
            pref.pinned_at = datetime.now()
        elif pinned is False:
            pref.pinned_at = None
        if muted is not None:
            pref.muted = muted
        if archived is not None:
            pref.archived = archived
            if archived:
                pref.pinned_at = None  # мұрағаттағы чат бекітілген болмайды

        if not pref.pinned_at and not pref.muted and not pref.archived:
            db.delete(pref)
            result = {"kind": kind, "id": chat_id, "pinnedAt": None, "muted": False, "archived": False}
        else:
            result = None
        db.commit()
        if result is None:
            result = _to_dict(pref)
    finally:
        db.close()

    # Басқа ашық беттер/құрылғылар да жаңартылсын
    await manager.send_personal_message({"type": "chat_pref", "pref": result}, user_id)
    return result
