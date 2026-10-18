"""Хабарлама әрекеттеріне ортақ көмекшілер (жеке чат пен топқа бірдей):
жауап (reply) үзіндісі, реакциялар, бағыттау (forward) белгісі.

Хабарламадағы қосымша өрістер:
  replyTo       {id, fromUserId, senderName, type, preview}
  forwardedFrom {userId, username}
  editedAt      ISO уақыт
  reactions     {emoji: [userId, ...]}
  pinned        bool
  deletedFor    [userId, ...]  — «өзімнен жою»
  votes         {optionId: [userId, ...]}  — сауалнама дауыстары (type='poll')
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

REACTION_EMOJIS = ("👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "🙏", "👎", "💯")
EXTRA_KEYS = ("replyTo", "forwardedFrom", "editedAt", "reactions", "pinned", "votes", "listenedAt")
PREVIEW_LEN = 140
NON_EDITABLE_TYPES = ("system", "project", "location", "sticker", "poll")
POLL_MAX_OPTIONS = 10


def now_iso() -> str:
    return datetime.now().isoformat()


def reply_snapshot(source: Dict[str, Any], sender_name: Optional[str]) -> Dict[str, Any]:
    """Жауап берілген хабарламаның қысқа көшірмесі — түпнұсқа кейін өзгерсе де көрініп тұрады"""
    content = (source.get("content") or "").strip()
    return {
        "id": source["id"],
        "fromUserId": source.get("fromUserId"),
        "senderName": sender_name or "",
        "type": source.get("type") or "text",
        "preview": content[:PREVIEW_LEN],
    }


def toggle_reaction(reactions: Optional[Dict[str, List[str]]], emoji: str, user_id: str) -> Dict[str, List[str]]:
    """Бір қолданушыда бір реакция: сол эмодзи қайта басылса — алынады, басқасы басылса — ауысады"""
    if emoji not in REACTION_EMOJIS:
        raise HTTPException(status_code=400, detail="Unsupported reaction")
    reactions = {k: list(v) for k, v in (reactions or {}).items() if isinstance(v, list)}
    had_same = user_id in reactions.get(emoji, [])
    for key in list(reactions):
        if user_id in reactions[key]:
            reactions[key].remove(user_id)
        if not reactions[key]:
            del reactions[key]
    if not had_same:
        reactions.setdefault(emoji, []).append(user_id)
    return reactions


def forward_origin(source: Dict[str, Any], sender_name: Optional[str]) -> Dict[str, Any]:
    """Бағытталған хабарлама қайта бағытталса — алғашқы авторы сақталады"""
    if isinstance(source.get("forwardedFrom"), dict):
        return source["forwardedFrom"]
    return {"userId": source.get("fromUserId"), "username": sender_name or ""}


def validate_edit(message: Dict[str, Any], user_id: str, content: str) -> str:
    if message.get("fromUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the author can edit a message")
    if (message.get("type") or "text") in NON_EDITABLE_TYPES:
        raise HTTPException(status_code=400, detail="This message cannot be edited")
    content = (content or "").strip()
    if (message.get("type") or "text") == "text" and not content:
        raise HTTPException(status_code=400, detail="Text messages require content")
    return content


def build_poll_metadata(metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Сауалнаманы тексеріп тазалау: сұрақ + 2..10 бірегей жауап, бірнеше жауапқа рұқсат"""
    metadata = metadata or {}
    question = str(metadata.get("question") or "").strip()[:300]
    if not question:
        raise HTTPException(status_code=400, detail="Poll question is required")
    options: List[Dict[str, str]] = []
    seen = set()
    for raw in metadata.get("options") or []:
        text = str(raw.get("text") if isinstance(raw, dict) else raw or "").strip()[:100]
        if text and text.lower() not in seen:
            seen.add(text.lower())
            options.append({"id": str(len(options)), "text": text})
    if not 2 <= len(options) <= POLL_MAX_OPTIONS:
        raise HTTPException(status_code=400, detail="A poll needs 2 to 10 different options")
    return {"question": question, "options": options, "multiple": bool(metadata.get("multiple"))}


def apply_vote(message: Dict[str, Any], votes: Optional[Dict[str, List[str]]], user_id: str, option_ids: List[str]):
    """Қолданушының дауысын ауыстыру (бос тізім — дауысты алып тастау)"""
    if (message.get("type") or "text") != "poll":
        raise HTTPException(status_code=400, detail="This message is not a poll")
    meta = message.get("metadata") or {}
    valid = {o.get("id") for o in meta.get("options") or []}
    chosen = list(dict.fromkeys(option_ids))
    if any(o not in valid for o in chosen):
        raise HTTPException(status_code=400, detail="Unknown poll option")
    if len(chosen) > 1 and not meta.get("multiple"):
        raise HTTPException(status_code=400, detail="Only one option can be chosen")
    votes = {k: [u for u in v if u != user_id] for k, v in (votes or {}).items() if isinstance(v, list)}
    for option_id in chosen:
        votes.setdefault(option_id, []).append(user_id)
    return {k: v for k, v in votes.items() if v}
