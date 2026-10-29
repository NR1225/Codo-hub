"""Message service for business logic"""
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime
from fastapi import HTTPException
from database import messages, save_messages, FIRESTORE_SYNC_AVAILABLE, FIRESTORE_SYNC_MESSAGE
from websocket import manager
from services.message_extras import apply_vote, now_iso, toggle_reaction, validate_edit


class MessageService:
    """Service for message-related operations"""

    @staticmethod
    async def get_message_by_id(message_id: str) -> Optional[Dict[str, Any]]:
        """Get a message by its ID"""
        return next((msg for msg in messages if msg['id'] == message_id), None)

    @staticmethod
    def get_user_messages(user_id: str) -> List[Dict[str, Any]]:
        """Get all messages for a user"""
        user_messages = [
            msg for msg in messages
            if msg.get('fromUserId') == user_id or msg.get('toUserId') == user_id
        ]
        user_messages.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
        return user_messages
    
    @staticmethod
    def get_conversation(user_id: str, friend_id: str) -> List[Dict[str, Any]]:
        """Get conversation between two users"""
        conversation_messages = [
            msg for msg in messages
            if ((msg.get('fromUserId') == user_id and msg.get('toUserId') == friend_id) or
                (msg.get('fromUserId') == friend_id and msg.get('toUserId') == user_id))
            and user_id not in (msg.get('deletedFor') or [])
        ]
        conversation_messages.sort(key=lambda x: x.get('createdAt', ''))
        return conversation_messages

    @staticmethod
    async def create_message(from_user_id: str, to_user_id: str, content: str,
                           are_friends: bool, message_type: str = "text",
                           attachments: Optional[List[Dict[str, Any]]] = None,
                           metadata: Optional[Dict[str, Any]] = None,
                           extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a new message. `extra` — replyTo / forwardedFrom (message_extras)"""
        if not are_friends:
            raise ValueError("Тек достарға хабарлама жіберуге болады. Алдымен дос болыңыз.")

        # Өзіне жазылған хабарлама («Сақталған») бірден оқылған
        is_saved = from_user_id == to_user_id
        new_message = {
            'id': str(uuid.uuid4()),
            'fromUserId': from_user_id,
            'toUserId': to_user_id,
            'content': content.strip() if content else '',
            'type': message_type,
            'attachments': attachments or [],
            'metadata': metadata or {},
            'createdAt': datetime.now().isoformat(),
            'status': 'read' if is_saved else 'sent',
            'read': is_saved,
            'readAt': None,
            **(extra or {}),
        }

        messages.append(new_message)
        save_messages()
        
        # Firestore sync
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_MESSAGE:
            try:
                FIRESTORE_SYNC_MESSAGE(new_message)
            except Exception as e:
                print(f'Warning: Firestore sync failed for message: {e}')
        
        # Сұрау чатқа емес, алушының «Сұраулар» тізіміне түседі
        is_request = bool(new_message.get('request'))
        await manager.send_personal_message({
            'type': 'message_request' if is_request else 'new_message',
            'message': new_message
        }, to_user_id)

        # Update status to delivered if recipient is online
        if not is_saved and not is_request and manager.is_user_online(to_user_id):
            new_message['status'] = 'delivered'
            save_messages()
        
        return new_message
    
    @staticmethod
    async def mark_message_read(message_id: str) -> Dict[str, Any]:
        """Mark a message as read"""
        message = next((msg for msg in messages if msg['id'] == message_id), None)
        if not message:
            raise ValueError("Message not found")
        
        message['read'] = True
        message['status'] = 'read'
        message['readAt'] = datetime.now().isoformat()
        save_messages()
        
        # Firestore sync
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_MESSAGE:
            try:
                FIRESTORE_SYNC_MESSAGE(message)
            except Exception as e:
                print(f'Warning: Firestore sync failed for message read: {e}')
        
        # Notify sender via WebSocket that message was read
        await manager.send_personal_message({
            'type': 'message_read',
            'messageId': message_id,
            'readAt': message['readAt']
        }, message['fromUserId'])
        
        return message
    
    @staticmethod
    async def mark_conversation_read(user_id: str, friend_id: str) -> int:
        """Mark all messages in a conversation as read"""
        updated_count = 0
        for msg in messages:
            if msg.get('fromUserId') == friend_id and msg.get('toUserId') == user_id and not msg.get('read', False):
                msg['read'] = True
                msg['status'] = 'read'
                msg['readAt'] = datetime.now().isoformat()
                updated_count += 1
        
        if updated_count > 0:
            save_messages()
            
            # Notify sender via WebSocket
            await manager.send_personal_message({
                'type': 'messages_read',
                'userId': user_id,
                'count': updated_count
            }, friend_id)
            
            # Firestore sync
            if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_MESSAGE:
                try:
                    for msg in messages:
                        if msg.get('fromUserId') == friend_id and msg.get('toUserId') == user_id:
                            FIRESTORE_SYNC_MESSAGE(msg)
                except Exception as e:
                    print(f'Warning: Firestore sync failed: {e}')
        
        return updated_count
    
    @staticmethod
    def get_unread_count_for_chat(user_id: str, friend_id: str) -> int:
        """Get unread message count for a specific chat"""
        unread_messages = [
            msg for msg in messages
            if msg.get('fromUserId') == friend_id and
               msg.get('toUserId') == user_id and
               not msg.get('read', False) and
               not msg.get('request')
        ]
        return len(unread_messages)
    
    @staticmethod
    def get_total_unread_count(user_id: str) -> int:
        """Get total unread message count for a user"""
        unread_messages = [
            msg for msg in messages
            if msg.get('toUserId') == user_id and not msg.get('read', False) and not msg.get('request')
        ]
        return len(unread_messages)

    # ---------- Хабарлама әрекеттері (reply / edit / delete / react / pin) ----------

    @staticmethod
    def get_visible_message(message_id: str, user_id: str) -> Dict[str, Any]:
        """Қолданушы қатысатын және өзінен жоймаған хабарлама, әйтпесе 404"""
        msg = next((m for m in messages if m['id'] == message_id), None)
        if (
            not msg
            or user_id not in (msg.get('fromUserId'), msg.get('toUserId'))
            or user_id in (msg.get('deletedFor') or [])
        ):
            raise HTTPException(status_code=404, detail="Message not found")
        return msg

    @staticmethod
    async def _notify_both(msg: Dict[str, Any], payload: Dict[str, Any]):
        for uid in {msg.get('fromUserId'), msg.get('toUserId')}:
            if uid:
                await manager.send_personal_message(payload, uid)

    @staticmethod
    def _save_and_sync(msg: Dict[str, Any]):
        save_messages()
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_MESSAGE:
            try:
                FIRESTORE_SYNC_MESSAGE(msg)
            except Exception as e:
                print(f'Warning: Firestore sync failed for message: {e}')

    @staticmethod
    async def edit_message(message_id: str, user_id: str, content: str) -> Dict[str, Any]:
        msg = MessageService.get_visible_message(message_id, user_id)
        msg['content'] = validate_edit(msg, user_id, content)
        msg['editedAt'] = now_iso()
        MessageService._save_and_sync(msg)
        await MessageService._notify_both(msg, {'type': 'message_updated', 'message': msg})
        return msg

    @staticmethod
    async def delete_message(message_id: str, user_id: str, for_everyone: bool) -> Dict[str, Any]:
        msg = MessageService.get_visible_message(message_id, user_id)
        if for_everyone:
            if msg.get('fromUserId') != user_id:
                raise HTTPException(status_code=403, detail="Only the author can delete for everyone")
            messages[:] = [m for m in messages if m['id'] != message_id]
            save_messages()
            await MessageService._notify_both(msg, {'type': 'message_deleted', 'messageId': message_id})
        else:
            msg['deletedFor'] = list({*(msg.get('deletedFor') or []), user_id})
            save_messages()
            await manager.send_personal_message({'type': 'message_deleted', 'messageId': message_id}, user_id)
        return {'deleted': True, 'messageId': message_id, 'forEveryone': for_everyone}

    @staticmethod
    async def react(message_id: str, user_id: str, emoji: str) -> Dict[str, Any]:
        msg = MessageService.get_visible_message(message_id, user_id)
        msg['reactions'] = toggle_reaction(msg.get('reactions'), emoji, user_id)
        save_messages()
        await MessageService._notify_both(msg, {'type': 'message_updated', 'message': msg})
        return msg

    @staticmethod
    async def set_pinned(message_id: str, user_id: str, pinned: bool) -> Dict[str, Any]:
        msg = MessageService.get_visible_message(message_id, user_id)
        msg['pinned'] = bool(pinned)
        save_messages()
        await MessageService._notify_both(msg, {'type': 'message_updated', 'message': msg})
        return msg

    @staticmethod
    async def mark_listened(message_id: str, user_id: str) -> Dict[str, Any]:
        """Дауыстық хабарламаны алушы тыңдады — жіберушіге «тыңдалды» белгісі"""
        msg = MessageService.get_visible_message(message_id, user_id)
        if msg.get('type') != 'audio':
            raise HTTPException(status_code=400, detail="Only audio messages can be listened")
        if str(msg.get('toUserId')) != str(user_id) or msg.get('fromUserId') == msg.get('toUserId'):
            raise HTTPException(status_code=403, detail="Only the recipient can mark a message as listened")
        if not msg.get('listenedAt'):
            msg['listenedAt'] = now_iso()
            MessageService._save_and_sync(msg)
            await MessageService._notify_both(msg, {'type': 'message_updated', 'message': msg})
        return msg

    @staticmethod
    async def vote(message_id: str, user_id: str, option_ids: List[str]) -> Dict[str, Any]:
        msg = MessageService.get_visible_message(message_id, user_id)
        msg['votes'] = apply_vote(msg, msg.get('votes'), user_id, option_ids)
        save_messages()
        await MessageService._notify_both(msg, {'type': 'message_updated', 'message': msg})
        return msg

    # ---------- Хабарлама сұраулары (бейтаныстан келген, әлі қабылданбаған) ----------

    @staticmethod
    def list_requests(user_id: str) -> List[Dict[str, Any]]:
        """Маған келген сұраулар — жіберуші бойынша топталған, ең жаңасы бірінші"""
        from services.user_lookup import find_public_user

        groups: Dict[str, Dict[str, Any]] = {}
        for msg in messages:
            if msg.get('toUserId') != user_id or not msg.get('request') or user_id in (msg.get('deletedFor') or []):
                continue
            group = groups.setdefault(msg.get('fromUserId'), {'count': 0, 'lastMessage': None})
            group['count'] += 1
            if not group['lastMessage'] or msg.get('createdAt', '') > group['lastMessage'].get('createdAt', ''):
                group['lastMessage'] = msg

        result = []
        for sender_id, group in groups.items():
            sender = find_public_user(sender_id)
            if not sender:
                continue
            result.append({
                'user': {'id': sender['id'], 'username': sender['username'], 'avatar': sender.get('avatar')},
                'count': group['count'],
                'lastMessage': group['lastMessage'],
                'lastMessageTime': group['lastMessage'].get('createdAt', ''),
            })
        result.sort(key=lambda r: r['lastMessageTime'], reverse=True)
        return result

    @staticmethod
    async def accept_request(user_id: str, peer_id: str) -> int:
        """Сұрауды қабылдау: хабарламалар кәдімгі чатқа айналады"""
        accepted = []
        for msg in messages:
            if msg.get('fromUserId') == peer_id and msg.get('toUserId') == user_id and msg.get('request'):
                msg.pop('request', None)
                accepted.append(msg)
        if accepted:
            save_messages()
            for msg in accepted:
                if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_MESSAGE:
                    try:
                        FIRESTORE_SYNC_MESSAGE(msg)
                    except Exception as e:
                        print(f'Warning: Firestore sync failed for message: {e}')
            await manager.send_personal_message({'type': 'message_request_accepted', 'userId': user_id}, peer_id)
        return len(accepted)

    @staticmethod
    def decline_request(user_id: str, peer_id: str) -> int:
        """Сұраудан бас тарту: сол адамның қабылданбаған хабарламалары өшеді"""
        before = len(messages)
        messages[:] = [
            m for m in messages
            if not (m.get('fromUserId') == peer_id and m.get('toUserId') == user_id and m.get('request'))
        ]
        removed = before - len(messages)
        if removed:
            save_messages()
        return removed

    @staticmethod
    def clear_conversation(user_id: str, friend_id: str) -> int:
        """Delete all messages in a conversation for both users"""
        original_count = len(messages)
        messages[:] = [
            msg for msg in messages
            if not (
                (msg.get('fromUserId') == user_id and msg.get('toUserId') == friend_id) or
                (msg.get('fromUserId') == friend_id and msg.get('toUserId') == user_id)
            )
        ]
        deleted_count = original_count - len(messages)

        if deleted_count > 0:
            save_messages()

        return deleted_count

