"""Friend service for business logic"""
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime
from fastapi import HTTPException
from database import friends, friend_requests, save_friends, save_friend_requests
from services.user_lookup import find_public_user


# Жеке хабарлама құпиялығы: open — бәрі тікелей чатқа, closed — бейтаныстар «сұрауға», friends — тек достар
DM_PRIVACY = ("open", "closed", "friends")
DEFAULT_DM_PRIVACY = "closed"
FRIENDS_ONLY_DETAIL = "Бұл адам тек достарынан хабарлама қабылдайды"


class FriendService:
    """Service for friend-related operations"""

    @staticmethod
    def get_friend_request_by_id(request_id: str) -> Optional[Dict[str, Any]]:
        """Get a friend request by its ID"""
        return next((req for req in friend_requests if req['id'] == request_id), None)

    @staticmethod
    def get_friends(user_id: str) -> List[Dict[str, Any]]:
        """Get all friends for a user"""
        user_friends = friends.get(user_id, [])
        friends_list = []
        for friend_id in user_friends:
            friend = find_public_user(friend_id)
            if friend:
                friends_list.append({
                    'id': friend['id'],
                    'username': friend['username'],
                    'avatar': friend.get('avatar')
                })
        return friends_list
    
    @staticmethod
    def add_friend(user_id: str, friend_id: str) -> None:
        """Add a friend (bidirectional)"""
        if user_id == friend_id:
            raise ValueError("Cannot add yourself as a friend")

        if user_id not in friends:
            friends[user_id] = []

        if friend_id not in friends[user_id]:
            friends[user_id].append(friend_id)

        # Add reverse friendship (bidirectional)
        if friend_id not in friends:
            friends[friend_id] = []

        if user_id not in friends[friend_id]:
            friends[friend_id].append(user_id)

        save_friends()
    
    @staticmethod
    def remove_friend(user_id: str, friend_id: str) -> None:
        """Remove a friend (bidirectional)"""
        if user_id in friends:
            friends[user_id] = [id for id in friends[user_id] if id != friend_id]
            save_friends()
        
        if friend_id in friends:
            friends[friend_id] = [id for id in friends[friend_id] if id != user_id]
            save_friends()
    
    @staticmethod
    def are_friends(user_id: str, friend_id: str) -> bool:
        """Check if two users are friends"""
        user_friends = friends.get(user_id, [])
        return friend_id in user_friends

    @staticmethod
    def can_message(user_id: str, friend_id: str) -> bool:
        """Check if two users can message each other (friends or previous conversation)"""
        if user_id == friend_id:
            return True  # «Сақталған хабарламалар» — өзіне жазу

        if FriendService.are_friends(user_id, friend_id):
            return True

        # Бұрын хат жазысқан (қабылданбаған сұрау есептелмейді)
        from database import messages
        has_messages = any(
            ((msg.get('fromUserId') == user_id and msg.get('toUserId') == friend_id) or
             (msg.get('fromUserId') == friend_id and msg.get('toUserId') == user_id))
            and not msg.get('request')
            for msg in messages
        )
        return has_messages

    @staticmethod
    def get_dm_privacy(user_id: str) -> Optional[str]:
        """Қолданушының баптауы; қолданушы табылмаса — None"""
        from db import SessionLocal, User
        db = SessionLocal()
        try:
            row = db.query(User.dm_privacy).filter(User.id == user_id).first()
        finally:
            db.close()
        if row is None:
            return None
        return row[0] if row[0] in DM_PRIVACY else DEFAULT_DM_PRIVACY

    @staticmethod
    def set_dm_privacy(user_id: str, value: str) -> str:
        from db import SessionLocal, User
        if value not in DM_PRIVACY:
            raise HTTPException(status_code=400, detail="Белгісіз баптау")
        db = SessionLocal()
        try:
            db.query(User).filter(User.id == user_id).update({User.dm_privacy: value})
            db.commit()
        finally:
            db.close()
        return value

    @staticmethod
    def delivery_mode(sender_id: str, target_id: str) -> str:
        """Хабарлама қайда барады: 'direct' — чатқа, 'request' — сұрауға, 'blocked' — жіберуге болмайды"""
        if FriendService.can_message(sender_id, target_id):
            return "direct"
        privacy = FriendService.get_dm_privacy(target_id)
        if privacy == "open":
            return "direct"
        if privacy == "closed":
            return "request"
        return "blocked"

    @staticmethod
    def delivery_extra(sender_id: str, target_id: str) -> Dict[str, Any]:
        """create_message-ке берілетін белгі: сұрау болса {'request': True}; рұқсат жоқ болса — 403"""
        mode = FriendService.delivery_mode(sender_id, target_id)
        if mode == "blocked":
            if FriendService.get_dm_privacy(target_id) is None:
                raise HTTPException(status_code=404, detail="Қолданушы табылмады")
            raise HTTPException(status_code=403, detail=FRIENDS_ONLY_DETAIL)
        return {'request': True} if mode == "request" else {}
    
    @staticmethod
    def create_friend_request(from_user_id: str, to_user_id: str) -> Dict[str, Any]:
        """Create a friend request"""
        if from_user_id == to_user_id:
            raise ValueError("Cannot send friend request to yourself")
        
        # Check if already friends
        if FriendService.are_friends(from_user_id, to_user_id):
            raise ValueError("Already friends")
        
        # Check if request already exists
        existing_request = next((
            req for req in friend_requests
            if ((req.get('fromUserId') == from_user_id and req.get('toUserId') == to_user_id) or
                (req.get('fromUserId') == to_user_id and req.get('toUserId') == from_user_id)) and
               req.get('status') == 'pending'
        ), None)
        
        if existing_request:
            raise ValueError("Friend request already exists")
        
        new_request = {
            'id': str(uuid.uuid4()),
            'fromUserId': from_user_id,
            'toUserId': to_user_id,
            'status': 'pending',
            'createdAt': datetime.now().isoformat()
        }
        
        friend_requests.append(new_request)
        save_friend_requests()
        return new_request
    
    @staticmethod
    def get_friend_requests(user_id: str) -> List[Dict[str, Any]]:
        """Get all friend requests for a user"""
        requests = [
            req for req in friend_requests
            if (req.get('toUserId') == user_id and req.get('status') == 'pending') or
               (req.get('fromUserId') == user_id and req.get('status') == 'pending')
        ]
        
        requests_with_users = []
        for req in requests:
            other_user_id = req['fromUserId'] if req['fromUserId'] != user_id else req['toUserId']
            other_user = find_public_user(other_user_id)
            if other_user:
                requests_with_users.append({
                    **req,
                    'otherUser': {
                        'id': other_user['id'],
                        'username': other_user['username'],
                        'avatar': other_user.get('avatar')
                    },
                    'isIncoming': req.get('toUserId') == user_id
                })
        
        return requests_with_users
    
    @staticmethod
    def get_incoming_friend_requests(user_id: str) -> List[Dict[str, Any]]:
        """Get incoming friend requests for a user"""
        incoming_requests = [
            req for req in friend_requests
            if req.get('toUserId') == user_id and req.get('status') == 'pending'
        ]
        
        requests_with_users = []
        for req in incoming_requests:
            from_user = find_public_user(req['fromUserId'])
            if from_user:
                requests_with_users.append({
                    **req,
                    'fromUser': {
                        'id': from_user['id'],
                        'username': from_user['username'],
                        'avatar': from_user.get('avatar')
                    }
                })
        
        return requests_with_users
    
    @staticmethod
    def get_outgoing_friend_requests(user_id: str) -> List[Dict[str, Any]]:
        """Get outgoing friend requests for a user"""
        outgoing_requests = [
            req for req in friend_requests
            if req.get('fromUserId') == user_id and req.get('status') == 'pending'
        ]
        
        requests_with_users = []
        for req in outgoing_requests:
            to_user = find_public_user(req['toUserId'])
            if to_user:
                requests_with_users.append({
                    **req,
                    'toUser': {
                        'id': to_user['id'],
                        'username': to_user['username'],
                        'avatar': to_user.get('avatar')
                    }
                })
        
        return requests_with_users
    
    @staticmethod
    def get_incoming_friend_request_count(user_id: str) -> int:
        """Get count of incoming friend requests"""
        incoming_count = sum(
            1 for req in friend_requests
            if req.get('toUserId') == user_id and req.get('status') == 'pending'
        )
        return incoming_count
    
    @staticmethod
    def accept_friend_request(request_id: str) -> Dict[str, Any]:
        """Accept a friend request"""
        request = next((req for req in friend_requests if req['id'] == request_id), None)
        if not request:
            raise ValueError("Friend request not found")
        
        if request.get('status') != 'pending':
            raise ValueError("Request already processed")
        
        request['status'] = 'accepted'
        
        # Add to friends list
        FriendService.add_friend(request['fromUserId'], request['toUserId'])
        
        # Егер екінші жақтан да сұрау болса, оны да автоматты түрде қабылдау
        reverse_request = next((
            req for req in friend_requests
            if req.get('fromUserId') == request['toUserId'] and
               req.get('toUserId') == request['fromUserId'] and
               req.get('status') == 'pending'
        ), None)
        
        if reverse_request:
            reverse_request['status'] = 'accepted'
        
        save_friend_requests()
        return request
    
    @staticmethod
    def reject_friend_request(request_id: str) -> Dict[str, Any]:
        """Reject a friend request"""
        request = next((req for req in friend_requests if req['id'] == request_id), None)
        if not request:
            raise ValueError("Friend request not found")
        
        if request.get('status') != 'pending':
            raise ValueError("Request already processed")
        
        request['status'] = 'rejected'
        save_friend_requests()
        return request
    
    @staticmethod
    def cancel_friend_request(request_id: str, user_id: str) -> Dict[str, Any]:
        """Cancel a friend request (for outgoing requests)"""
        request = next((req for req in friend_requests if req['id'] == request_id), None)
        if not request:
            raise ValueError("Friend request not found")
        
        # Only allow canceling if user is the sender
        if request.get('fromUserId') != user_id:
            raise ValueError("You can only cancel your own friend requests")
        
        if request.get('status') != 'pending':
            raise ValueError("Request already processed")
        
        request['status'] = 'cancelled'
        save_friend_requests()
        return request

