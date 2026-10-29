"""Хабарламаны бағыттау (forward): жеке чаттан не топтан → достарға және топтарға"""
from typing import Any, Dict, List

from fastapi import HTTPException

from db import SessionLocal
from services.friend_service import FriendService
from services.group_service import GroupService, _public_users
from services.message_extras import forward_origin
from services.message_service import MessageService
from services.user_lookup import find_public_user


async def forward_message(user_id: str, body) -> Dict[str, Any]:
    db = SessionLocal()
    try:
        # 1. Бастапқы хабарламаны оқу құқығын тексеру
        if body.sourceKind == "dm":
            source = MessageService.get_visible_message(body.messageId, user_id)
        else:
            if not body.sourceGroupId:
                raise HTTPException(status_code=400, detail="sourceGroupId is required")
            row, _ = GroupService.get_visible_message(db, body.sourceGroupId, body.messageId, user_id)
            source = GroupService.message_to_dict(row, _public_users(db, [row.from_user_id]))

        sender = find_public_user(source.get("fromUserId"))
        extra = {"forwardedFrom": forward_origin(source, sender["username"] if sender else None)}
        content = source.get("content") or ""
        message_type = source.get("type") or "text"
        attachments = source.get("attachments") or []
        metadata = source.get("metadata") or {}

        # 2. Әр мақсатқа көшірме жіберу; біреуі сәтсіз болса, қалғандары жіберіле береді
        results: List[Dict[str, Any]] = []
        for target in body.targets:
            try:
                if target.kind == "dm":
                    msg = await MessageService.create_message(
                        from_user_id=user_id,
                        to_user_id=target.id,
                        content=content,
                        are_friends=True,
                        message_type=message_type,
                        attachments=attachments,
                        metadata=metadata,
                        extra={**extra, **FriendService.delivery_extra(user_id, target.id)},
                    )
                else:
                    msg = await GroupService.send_message(
                        db, target.id, user_id, content, message_type, attachments, metadata, extra
                    )
                results.append({"kind": target.kind, "id": target.id, "ok": True, "messageId": msg["id"]})
            except HTTPException as e:
                results.append({"kind": target.kind, "id": target.id, "ok": False, "error": e.detail})
            except ValueError as e:
                results.append({"kind": target.kind, "id": target.id, "ok": False, "error": str(e)})

        if not any(r["ok"] for r in results):
            raise HTTPException(status_code=400, detail="Message could not be forwarded")
        return {"results": results}
    finally:
        db.close()
