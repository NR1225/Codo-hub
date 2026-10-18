"""Топтық чат — бизнес-логика (SQL: chat_groups, chat_group_members, chat_group_messages)"""
import json
import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from db import ChatGroup, ChatGroupMember, ChatGroupMessage, User
from websocket import manager
from services.message_extras import EXTRA_KEYS, apply_vote, now_iso, toggle_reaction, validate_edit

MAX_GROUP_MEMBERS = 200
MANAGER_ROLES = ("owner", "admin")


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _load(raw: Optional[str], fallback):
    try:
        value = json.loads(raw) if raw else fallback
        return value if isinstance(value, type(fallback)) else fallback
    except (TypeError, ValueError):
        return fallback


def _public_users(db: Session, user_ids: Iterable[str]) -> Dict[str, Dict[str, Any]]:
    ids = list({uid for uid in user_ids if uid})
    if not ids:
        return {}
    rows = db.query(User).filter(User.id.in_(ids)).all()
    return {u.id: {"id": u.id, "username": u.username, "avatar": u.avatar} for u in rows}


class GroupService:
    """Топ құру, мүшелер, рөлдер және хабарламалар"""

    # ---------- Көмекшілер ----------

    @staticmethod
    def get_group_or_404(db: Session, group_id: str) -> ChatGroup:
        group = db.query(ChatGroup).filter(ChatGroup.id == group_id).first()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        return group

    @staticmethod
    def get_membership(db: Session, group_id: str, user_id: str) -> Optional[ChatGroupMember]:
        return (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.group_id == group_id, ChatGroupMember.user_id == user_id)
            .first()
        )

    @staticmethod
    def require_member(db: Session, group_id: str, user_id: str) -> ChatGroupMember:
        GroupService.get_group_or_404(db, group_id)
        member = GroupService.get_membership(db, group_id, user_id)
        if not member:
            # Мүше емес адамға топтың бар-жоғын да ашпаймыз
            raise HTTPException(status_code=404, detail="Group not found")
        return member

    @staticmethod
    def member_ids(db: Session, group_id: str) -> List[str]:
        rows = db.query(ChatGroupMember.user_id).filter(ChatGroupMember.group_id == group_id).all()
        return [r[0] for r in rows]

    @staticmethod
    def message_to_dict(msg: ChatGroupMessage, users: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        extra = _load(msg.extra, {})
        return {
            **{k: extra[k] for k in EXTRA_KEYS if k in extra},
            "id": msg.id,
            "groupId": msg.group_id,
            "fromUserId": msg.from_user_id,
            "toUserId": None,
            "sender": users.get(msg.from_user_id),
            "content": msg.content or "",
            "type": msg.type or "text",
            "attachments": _load(msg.attachments, []),
            "metadata": _load(msg.meta, {}),
            "createdAt": _iso(msg.created_at),
            "read": True,
            "status": "sent",
        }

    @staticmethod
    async def broadcast(db: Session, group_id: str, payload: Dict[str, Any], exclude: Optional[str] = None):
        for uid in GroupService.member_ids(db, group_id):
            if uid != exclude:
                await manager.send_personal_message(payload, uid)

    @staticmethod
    def _add_message(
        db: Session,
        group_id: str,
        from_user_id: str,
        content: str = "",
        message_type: str = "text",
        attachments: Optional[List[Dict[str, Any]]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> ChatGroupMessage:
        msg = ChatGroupMessage(
            id=str(uuid.uuid4()),
            group_id=group_id,
            from_user_id=from_user_id,
            content=(content or "").strip(),
            type=message_type,
            attachments=json.dumps(attachments or [], ensure_ascii=False),
            meta=json.dumps(metadata or {}, ensure_ascii=False),
            extra=json.dumps(extra or {}, ensure_ascii=False),
            # Жеке чат хабарламаларымен бірдей — жергілікті уақыт
            created_at=datetime.now(),
        )
        db.add(msg)
        return msg

    @staticmethod
    async def post_system(db: Session, group_id: str, actor_id: str, event: str, **extra) -> Dict[str, Any]:
        """Жүйелік хабарлама (мүше қосылды, шықты, атауы өзгерді...) — мәтінін frontend аударады"""
        msg = GroupService._add_message(
            db, group_id, actor_id, message_type="system", metadata={"event": event, **extra}
        )
        db.commit()
        users = _public_users(db, [actor_id, *extra.get("userIds", [])])
        data = GroupService.message_to_dict(msg, users)
        data["metadata"]["users"] = users
        await GroupService.broadcast(db, group_id, {"type": "group_message", "groupId": group_id, "message": data})
        return data

    # ---------- Оқу ----------

    @staticmethod
    def list_groups(db: Session, user_id: str) -> List[Dict[str, Any]]:
        memberships = db.query(ChatGroupMember).filter(ChatGroupMember.user_id == user_id).all()
        if not memberships:
            return []
        group_ids = [m.group_id for m in memberships]
        groups = {g.id: g for g in db.query(ChatGroup).filter(ChatGroup.id.in_(group_ids)).all()}

        counts = dict(
            db.query(ChatGroupMember.group_id, func.count(ChatGroupMember.user_id))
            .filter(ChatGroupMember.group_id.in_(group_ids))
            .group_by(ChatGroupMember.group_id)
            .all()
        )

        result = []
        for m in memberships:
            group = groups.get(m.group_id)
            if not group:
                continue
            recent = (
                db.query(ChatGroupMessage)
                .filter(ChatGroupMessage.group_id == group.id)
                .order_by(ChatGroupMessage.created_at.desc())
                .limit(20)
                .all()
            )
            # «Өзімнен жойылған» хабарламалар тізім алдында көрсетілмейді
            last = next((r for r in recent if user_id not in _load(r.extra, {}).get("deletedFor", [])), None)
            since = m.last_read_at or m.joined_at
            unread_q = db.query(func.count(ChatGroupMessage.id)).filter(
                ChatGroupMessage.group_id == group.id,
                ChatGroupMessage.from_user_id != user_id,
                ChatGroupMessage.type != "system",
            )
            if since:
                unread_q = unread_q.filter(ChatGroupMessage.created_at > since)
            unread = unread_q.scalar() or 0

            users = _public_users(db, [last.from_user_id] if last else [])
            result.append(
                {
                    **GroupService.group_summary(group),
                    "myRole": m.role,
                    "memberCount": counts.get(group.id, 0),
                    "lastMessage": GroupService.message_to_dict(last, users) if last else None,
                    "lastMessageTime": _iso(last.created_at) if last else _iso(group.created_at),
                    "unreadCount": unread,
                }
            )
        result.sort(key=lambda g: g["lastMessageTime"] or "", reverse=True)
        return result

    @staticmethod
    def group_summary(group: ChatGroup) -> Dict[str, Any]:
        return {
            "id": group.id,
            "name": group.name,
            "description": group.description,
            "avatar": group.avatar,
            "ownerId": group.owner_id,
            "createdAt": _iso(group.created_at),
        }

    @staticmethod
    def group_details(db: Session, group_id: str, user_id: str) -> Dict[str, Any]:
        me = GroupService.require_member(db, group_id, user_id)
        group = GroupService.get_group_or_404(db, group_id)
        members = db.query(ChatGroupMember).filter(ChatGroupMember.group_id == group_id).all()
        users = _public_users(db, [m.user_id for m in members])
        role_order = {"owner": 0, "admin": 1, "member": 2}
        member_list = [
            {**users[m.user_id], "role": m.role, "joinedAt": _iso(m.joined_at)}
            for m in members
            if m.user_id in users
        ]
        member_list.sort(key=lambda x: (role_order.get(x["role"], 3), x["username"].lower()))
        return {**GroupService.group_summary(group), "myRole": me.role, "members": member_list}

    @staticmethod
    def get_messages(db: Session, group_id: str, user_id: str, limit: int = 200, before: Optional[str] = None):
        GroupService.require_member(db, group_id, user_id)
        q = db.query(ChatGroupMessage).filter(ChatGroupMessage.group_id == group_id)
        if before:
            try:
                q = q.filter(ChatGroupMessage.created_at < datetime.fromisoformat(before))
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid 'before' value")
        rows = q.order_by(ChatGroupMessage.created_at.desc()).limit(limit).all()
        rows.reverse()
        rows = [r for r in rows if user_id not in _load(r.extra, {}).get("deletedFor", [])]

        sender_ids = {r.from_user_id for r in rows}
        for r in rows:
            if r.type == "system":
                sender_ids.update(_load(r.meta, {}).get("userIds", []))
        users = _public_users(db, sender_ids)
        out = []
        for r in rows:
            data = GroupService.message_to_dict(r, users)
            if r.type == "system":
                data["metadata"]["users"] = {uid: users[uid] for uid in [r.from_user_id, *data["metadata"].get("userIds", [])] if uid in users}
            out.append(data)
        return out

    # ---------- Жазу ----------

    @staticmethod
    def _valid_user_ids(db: Session, user_ids: Iterable[str]) -> List[str]:
        ids = list(dict.fromkeys(uid for uid in user_ids if uid))
        if not ids:
            return []
        found = {r[0] for r in db.query(User.id).filter(User.id.in_(ids)).all()}
        return [uid for uid in ids if uid in found]

    @staticmethod
    async def create_group(db: Session, owner_id: str, name: str, member_ids: List[str], description: Optional[str] = None):
        name = name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Group name is required")
        members = [uid for uid in GroupService._valid_user_ids(db, member_ids) if uid != owner_id]
        if len(members) + 1 > MAX_GROUP_MEMBERS:
            raise HTTPException(status_code=400, detail="Too many members")

        now = datetime.now()
        group = ChatGroup(
            id=str(uuid.uuid4()),
            name=name,
            description=(description or "").strip() or None,
            owner_id=owner_id,
            created_at=now,
            updated_at=now,
        )
        db.add(group)
        db.add(ChatGroupMember(group_id=group.id, user_id=owner_id, role="owner", joined_at=now, last_read_at=now))
        for uid in members:
            db.add(ChatGroupMember(group_id=group.id, user_id=uid, role="member", joined_at=now))
        db.commit()

        await GroupService.post_system(db, group.id, owner_id, "created", name=name, userIds=members)
        await GroupService.broadcast(db, group.id, {"type": "group_updated", "groupId": group.id})
        return GroupService.group_details(db, group.id, owner_id)

    @staticmethod
    async def update_group(db: Session, group_id: str, user_id: str, name: Optional[str], description: Optional[str]):
        me = GroupService.require_member(db, group_id, user_id)
        if me.role not in MANAGER_ROLES:
            raise HTTPException(status_code=403, detail="Only group admins can edit the group")
        group = GroupService.get_group_or_404(db, group_id)

        renamed = None
        if name is not None:
            name = name.strip()
            if not name:
                raise HTTPException(status_code=400, detail="Group name is required")
            if name != group.name:
                renamed = name
                group.name = name
        if description is not None:
            group.description = description.strip() or None
        group.updated_at = datetime.now()
        db.commit()

        if renamed:
            await GroupService.post_system(db, group_id, user_id, "renamed", name=renamed)
        await GroupService.broadcast(db, group_id, {"type": "group_updated", "groupId": group_id})
        return GroupService.group_details(db, group_id, user_id)

    @staticmethod
    async def add_members(db: Session, group_id: str, user_id: str, user_ids: List[str]):
        me = GroupService.require_member(db, group_id, user_id)
        if me.role not in MANAGER_ROLES:
            raise HTTPException(status_code=403, detail="Only group admins can add members")
        existing = set(GroupService.member_ids(db, group_id))
        new_ids = [uid for uid in GroupService._valid_user_ids(db, user_ids) if uid not in existing]
        if not new_ids:
            return GroupService.group_details(db, group_id, user_id)
        if len(existing) + len(new_ids) > MAX_GROUP_MEMBERS:
            raise HTTPException(status_code=400, detail="Too many members")

        now = datetime.now()
        for uid in new_ids:
            db.add(ChatGroupMember(group_id=group_id, user_id=uid, role="member", joined_at=now))
        db.commit()

        await GroupService.post_system(db, group_id, user_id, "added", userIds=new_ids)
        await GroupService.broadcast(db, group_id, {"type": "group_updated", "groupId": group_id})
        return GroupService.group_details(db, group_id, user_id)

    @staticmethod
    async def remove_member(db: Session, group_id: str, user_id: str, target_id: str):
        """Мүшені шығару немесе өзі шығу (target_id == user_id)"""
        me = GroupService.require_member(db, group_id, user_id)
        target = GroupService.get_membership(db, group_id, target_id)
        if not target:
            raise HTTPException(status_code=404, detail="Member not found")

        leaving = target_id == user_id
        if not leaving:
            if me.role == "owner":
                pass
            elif me.role == "admin" and target.role == "member":
                pass
            else:
                raise HTTPException(status_code=403, detail="Not allowed to remove this member")

        db.delete(target)
        db.commit()

        remaining = (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.group_id == group_id)
            .order_by(ChatGroupMember.joined_at.asc())
            .all()
        )
        if not remaining:
            # Соңғы адам шықты — топ толығымен жойылады
            GroupService._delete_group_rows(db, group_id)
            await manager.send_personal_message({"type": "group_removed", "groupId": group_id}, target_id)
            return {"deleted": True}

        # Ие кетсе — иелік ең алғашқы админге, ол болмаса ең алғашқы мүшеге өтеді
        if target.role == "owner":
            heir = next((m for m in remaining if m.role == "admin"), remaining[0])
            heir.role = "owner"
            group = GroupService.get_group_or_404(db, group_id)
            group.owner_id = heir.user_id
            db.commit()

        await manager.send_personal_message({"type": "group_removed", "groupId": group_id}, target_id)
        await GroupService.post_system(db, group_id, user_id, "left" if leaving else "removed", userIds=[target_id])
        await GroupService.broadcast(db, group_id, {"type": "group_updated", "groupId": group_id})
        return {"deleted": False}

    @staticmethod
    async def set_role(db: Session, group_id: str, user_id: str, target_id: str, role: str):
        me = GroupService.require_member(db, group_id, user_id)
        if me.role != "owner":
            raise HTTPException(status_code=403, detail="Only the group owner can change roles")
        if role not in ("admin", "member"):
            raise HTTPException(status_code=400, detail="Invalid role")
        target = GroupService.get_membership(db, group_id, target_id)
        if not target or target.role == "owner":
            raise HTTPException(status_code=404, detail="Member not found")
        if target.role != role:
            target.role = role
            db.commit()
            await GroupService.post_system(db, group_id, user_id, "role", role=role, userIds=[target_id])
            await GroupService.broadcast(db, group_id, {"type": "group_updated", "groupId": group_id})
        return GroupService.group_details(db, group_id, user_id)

    @staticmethod
    def _delete_group_rows(db: Session, group_id: str):
        db.query(ChatGroupMessage).filter(ChatGroupMessage.group_id == group_id).delete()
        db.query(ChatGroupMember).filter(ChatGroupMember.group_id == group_id).delete()
        db.query(ChatGroup).filter(ChatGroup.id == group_id).delete()
        db.commit()

    @staticmethod
    async def delete_group(db: Session, group_id: str, user_id: str):
        me = GroupService.require_member(db, group_id, user_id)
        if me.role != "owner":
            raise HTTPException(status_code=403, detail="Only the group owner can delete the group")
        member_ids = GroupService.member_ids(db, group_id)
        GroupService._delete_group_rows(db, group_id)
        for uid in member_ids:
            await manager.send_personal_message({"type": "group_removed", "groupId": group_id}, uid)

    @staticmethod
    async def send_message(
        db: Session,
        group_id: str,
        user_id: str,
        content: str,
        message_type: str = "text",
        attachments: Optional[List[Dict[str, Any]]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        me = GroupService.require_member(db, group_id, user_id)
        if message_type == "system":
            raise HTTPException(status_code=400, detail="Invalid message type")
        if message_type == "text" and not (content or "").strip():
            raise HTTPException(status_code=400, detail="Text messages require content")

        msg = GroupService._add_message(db, group_id, user_id, content, message_type, attachments, metadata, extra)
        # Өз хабарламам — оқылған деп есептеледі
        me.last_read_at = msg.created_at
        db.commit()

        data = GroupService.message_to_dict(msg, _public_users(db, [user_id]))
        await GroupService.broadcast(db, group_id, {"type": "group_message", "groupId": group_id, "message": data})
        return data

    # ---------- Хабарлама әрекеттері (reply / edit / delete / react / pin) ----------

    @staticmethod
    def get_visible_message(db: Session, group_id: str, message_id: str, user_id: str):
        """Мүшеге көрінетін хабарлама (row, member), әйтпесе 404"""
        me = GroupService.require_member(db, group_id, user_id)
        row = (
            db.query(ChatGroupMessage)
            .filter(ChatGroupMessage.id == message_id, ChatGroupMessage.group_id == group_id)
            .first()
        )
        if not row or row.type == "system" or user_id in _load(row.extra, {}).get("deletedFor", []):
            raise HTTPException(status_code=404, detail="Message not found")
        return row, me

    @staticmethod
    async def _save_and_broadcast(db: Session, row: ChatGroupMessage, extra: Dict[str, Any]) -> Dict[str, Any]:
        row.extra = json.dumps(extra, ensure_ascii=False)
        db.commit()
        data = GroupService.message_to_dict(row, _public_users(db, [row.from_user_id]))
        await GroupService.broadcast(db, row.group_id, {"type": "group_message_updated", "groupId": row.group_id, "message": data})
        return data

    @staticmethod
    async def edit_message(db: Session, group_id: str, message_id: str, user_id: str, content: str):
        row, _ = GroupService.get_visible_message(db, group_id, message_id, user_id)
        row.content = validate_edit({"fromUserId": row.from_user_id, "type": row.type}, user_id, content)
        extra = _load(row.extra, {})
        extra["editedAt"] = now_iso()
        return await GroupService._save_and_broadcast(db, row, extra)

    @staticmethod
    async def delete_message(db: Session, group_id: str, message_id: str, user_id: str, for_everyone: bool):
        row, me = GroupService.get_visible_message(db, group_id, message_id, user_id)
        if for_everyone:
            if row.from_user_id != user_id and me.role not in MANAGER_ROLES:
                raise HTTPException(status_code=403, detail="Only the author or an admin can delete for everyone")
            db.delete(row)
            db.commit()
            await GroupService.broadcast(db, group_id, {"type": "group_message_deleted", "groupId": group_id, "messageId": message_id})
        else:
            extra = _load(row.extra, {})
            extra["deletedFor"] = list({*extra.get("deletedFor", []), user_id})
            row.extra = json.dumps(extra, ensure_ascii=False)
            db.commit()
            await manager.send_personal_message(
                {"type": "group_message_deleted", "groupId": group_id, "messageId": message_id}, user_id
            )
        return {"deleted": True, "messageId": message_id, "forEveryone": for_everyone}

    @staticmethod
    async def react(db: Session, group_id: str, message_id: str, user_id: str, emoji: str):
        row, _ = GroupService.get_visible_message(db, group_id, message_id, user_id)
        extra = _load(row.extra, {})
        extra["reactions"] = toggle_reaction(extra.get("reactions"), emoji, user_id)
        return await GroupService._save_and_broadcast(db, row, extra)

    @staticmethod
    async def set_pinned(db: Session, group_id: str, message_id: str, user_id: str, pinned: bool):
        row, me = GroupService.get_visible_message(db, group_id, message_id, user_id)
        if me.role not in MANAGER_ROLES:
            raise HTTPException(status_code=403, detail="Only admins can pin messages")
        extra = _load(row.extra, {})
        extra["pinned"] = bool(pinned)
        return await GroupService._save_and_broadcast(db, row, extra)

    @staticmethod
    async def vote(db: Session, group_id: str, message_id: str, user_id: str, option_ids: List[str]):
        row, _ = GroupService.get_visible_message(db, group_id, message_id, user_id)
        extra = _load(row.extra, {})
        message = {"type": row.type, "metadata": _load(row.meta, {})}
        extra["votes"] = apply_vote(message, extra.get("votes"), user_id, option_ids)
        return await GroupService._save_and_broadcast(db, row, extra)

    @staticmethod
    async def mark_listened(db: Session, group_id: str, message_id: str, user_id: str):
        """Дауыстық хабарламаны авторынан басқа біреу алғаш тыңдады — барлығына «тыңдалды» белгісі"""
        row, _ = GroupService.get_visible_message(db, group_id, message_id, user_id)
        if row.type != "audio":
            raise HTTPException(status_code=400, detail="Only audio messages can be listened")
        if row.from_user_id == user_id:
            raise HTTPException(status_code=403, detail="The author cannot mark own message as listened")
        extra = _load(row.extra, {})
        if extra.get("listenedAt"):
            return GroupService.message_to_dict(row, _public_users(db, [row.from_user_id]))
        extra["listenedAt"] = now_iso()
        return await GroupService._save_and_broadcast(db, row, extra)

    @staticmethod
    def mark_read(db: Session, group_id: str, user_id: str):
        me = GroupService.require_member(db, group_id, user_id)
        me.last_read_at = datetime.now()
        db.commit()
        return {"ok": True}
