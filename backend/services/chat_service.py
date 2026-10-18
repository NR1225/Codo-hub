"""Chat service for business logic"""
from typing import List, Dict, Any
from database import messages, friends
from services.user_lookup import find_public_user


class ChatService:
    """Service for chat-related operations"""
    
    @staticmethod
    def get_chats(user_id: str) -> List[Dict[str, Any]]:
        """Get list of all chats (conversations) for a user"""
        # Get all unique conversation partners from messages
        conversation_partners = set()
        for msg in messages:
            if msg.get('fromUserId') == user_id:
                conversation_partners.add(msg.get('toUserId'))
            elif msg.get('toUserId') == user_id:
                conversation_partners.add(msg.get('fromUserId'))
        
        # Get all friends
        user_friends = friends.get(user_id, [])
        for friend_id in user_friends:
            conversation_partners.add(friend_id)
        
        chats = []
        for partner_id in conversation_partners:
            partner = find_public_user(partner_id)
            if not partner:
                continue
            
            # Get conversation messages
            conversation_messages = [
                msg for msg in messages
                if ((msg.get('fromUserId') == user_id and msg.get('toUserId') == partner_id) or
                    (msg.get('fromUserId') == partner_id and msg.get('toUserId') == user_id))
                and user_id not in (msg.get('deletedFor') or [])
            ]
            
            # Get last message if exists
            last_message = None
            last_message_time = ''
            if conversation_messages:
                last_message = max(conversation_messages, key=lambda x: x.get('createdAt', ''))
                last_message_time = last_message.get('createdAt', '')
            
            # Count unread messages
            unread_count = sum(
                1 for msg in conversation_messages
                if msg.get('toUserId') == user_id and not msg.get('read', False)
            )
            
            chats.append({
                'partnerId': partner_id,
                'partner': {
                    'id': partner['id'],
                    'username': partner['username'],
                    'avatar': partner.get('avatar')
                },
                'lastMessage': last_message,
                'unreadCount': unread_count,
                'lastMessageTime': last_message_time
            })
        
        # Sort: active chats by time desc (newest first), then friends by name asc
        active_chats = sorted(
            [c for c in chats if c.get('lastMessage')],
            key=lambda x: x.get('lastMessageTime', '') or '',
            reverse=True  # Newest first
        )
        inactive_chats = sorted(
            [c for c in chats if not c.get('lastMessage')],
            key=lambda x: x.get('partner', {}).get('username', '').lower()  # A-Z
        )
        return active_chats + inactive_chats

