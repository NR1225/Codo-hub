"""User routes"""
from fastapi import APIRouter, HTTPException, Query, Depends, Request
from sqlalchemy.orm import Session
from typing import Optional
from models import UserUpdate
from database import codes, friends, messages, friend_requests, save_users, save_codes, save_friends, save_messages, save_friend_requests
from db import get_db, User
from utils.auth import get_current_user
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.get("/user")
@limiter.limit("30/minute")
async def get_current_user_endpoint(
    request: Request,
    email: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get user by email or user_id (requires authentication, email hidden for non-self)."""
    if user_id:
        sql_user = db.query(User).filter(User.id == user_id).first()
        if sql_user:
            # Only show email if requesting own profile
            if str(current_user.id) == str(user_id):
                return {
                    "id": sql_user.id,
                    "username": sql_user.username,
                    "email": sql_user.email,
                    "avatar": sql_user.avatar,
                    "bio": sql_user.bio,
                    "totp_enabled": sql_user.totp_enabled,
                }
            return {
                "id": sql_user.id,
                "username": sql_user.username,
                "avatar": sql_user.avatar,
                "bio": sql_user.bio,
            }

    if email:
        sql_user = db.query(User).filter(User.email == email.strip().lower()).first()
        if sql_user:
            # Only show email if requesting own profile
            if str(current_user.id) == str(sql_user.id):
                return {
                    "id": sql_user.id,
                    "username": sql_user.username,
                    "email": sql_user.email,
                    "avatar": sql_user.avatar,
                    "bio": sql_user.bio,
                    "totp_enabled": sql_user.totp_enabled,
                }
            return {
                "id": sql_user.id,
                "username": sql_user.username,
                "avatar": sql_user.avatar,
                "bio": sql_user.bio,
            }

    if user_id or email:
        raise HTTPException(status_code=404, detail="User not found")

    raise HTTPException(status_code=400, detail="Email or user_id parameter is required")


@router.get("/users/avatars")
@limiter.limit("60/minute")
async def get_avatars(request: Request, usernames: str = Query(""), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Бірнеше қолданушының аватары бір сұраумен: {username: avatar} (аватары жоқтар кірмейді)"""
    names = list({n.strip() for n in usernames.split(",") if n.strip()})[:100]
    if not names:
        return {}
    rows = db.query(User.username, User.avatar).filter(User.username.in_(names)).all()
    return {username: avatar for username, avatar in rows if avatar}


@router.get("/users/search")
@limiter.limit("20/minute")
async def search_users(request: Request, query: Optional[str] = Query(None), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Search users by username or email (requires authentication)"""
    if not query:
        return []

    search_term = query.strip().lower()
    # Escape LIKE wildcards to prevent injection
    escaped_term = search_term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    from sqlalchemy import func
    sql_users = db.query(User).filter(
        (func.lower(User.username).contains(escaped_term)) |
        (func.lower(User.email).contains(escaped_term)) |
        (func.lower(User.id).contains(escaped_term))
    ).limit(50).all()

    return [
        {
            "id": user.id,
            "username": user.username,
            "avatar": user.avatar,
        }
        for user in sql_users
    ]


@router.get("/users/{user_id}")
@limiter.limit("30/minute")
async def get_user(request: Request, user_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get user by ID (requires authentication, email hidden for non-self)"""
    sql_user = db.query(User).filter(User.id == user_id).first()
    if sql_user:
        # Only show email if requesting own profile
        if str(current_user.id) == str(user_id):
            return {
                "id": sql_user.id,
                "username": sql_user.username,
                "email": sql_user.email,
                "avatar": sql_user.avatar,
                "bio": sql_user.bio,
            }
        # Public profile - hide email
        return {
            "id": sql_user.id,
            "username": sql_user.username,
            "avatar": sql_user.avatar,
            "bio": sql_user.bio,
        }
    raise HTTPException(status_code=404, detail="User not found")


@router.get("/users/by-username/{username}")
@limiter.limit("30/minute")
async def get_user_by_username(request: Request, username: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get user by username (requires authentication, email hidden for non-self)"""
    sql_user = db.query(User).filter(User.username == username).first()
    if sql_user:
        # Only show email if requesting own profile
        if str(current_user.id) == str(sql_user.id):
            return {
                "id": sql_user.id,
                "username": sql_user.username,
                "email": sql_user.email,
                "avatar": sql_user.avatar,
                "bio": sql_user.bio,
            }
        # Public profile - hide email
        return {
            "id": sql_user.id,
            "username": sql_user.username,
            "avatar": sql_user.avatar,
            "bio": sql_user.bio,
        }
    raise HTTPException(status_code=404, detail="User not found")


@router.put("/user")
@limiter.limit("10/minute")
async def update_user(
    request: Request,
    user_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update user profile (requires authentication)"""
    try:
        if user_data.username is not None and user_data.username.strip():
            existing = db.query(User).filter(
                User.username == user_data.username.strip(),
                User.id != current_user.id,
            ).first()
            if existing:
                raise ValueError("Username already in use by another user")
            current_user.username = user_data.username.strip()

        if user_data.email is not None and user_data.email.strip():
            existing = db.query(User).filter(
                User.email == user_data.email.strip().lower(),
                User.id != current_user.id,
            ).first()
            if existing:
                raise ValueError("Email already in use by another user")
            current_user.email = user_data.email.strip().lower()

        if user_data.avatar is not None:
            if user_data.avatar == '':
                current_user.avatar = None
            elif isinstance(user_data.avatar, str) and user_data.avatar.startswith('data:image'):
                # Validate avatar size (max 1MB after base64 encoding, ~750KB raw)
                if len(user_data.avatar) > 1_400_000:  # ~1MB base64 string
                    raise ValueError("Avatar image is too large. Maximum size is 1MB.")
                current_user.avatar = user_data.avatar
            else:
                raise ValueError("Invalid avatar format")

        if user_data.bio is not None:
            current_user.bio = user_data.bio.strip() if user_data.bio else None

        db.commit()
        db.refresh(current_user)

        return {
            "id": current_user.id,
            "username": current_user.username,
            "email": current_user.email,
            "avatar": current_user.avatar,
            "bio": current_user.bio,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f'Error updating user profile: {e}')
        db.rollback()
        raise HTTPException(status_code=500, detail="Internal server error while updating profile")


@router.delete("/user")
@limiter.limit("5/minute")
async def delete_user(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete user account (requires authentication)"""
    try:
        user_id_to_delete = current_user.id
        username = current_user.username

        # Delete user's codes first (before SQL delete to avoid orphaned data)
        codes[:] = [code for code in codes if code.get('author') != username]
        save_codes()

        # Delete user from friends lists
        if user_id_to_delete in friends:
            del friends[user_id_to_delete]
        for friend_user_id in friends:
            if friends[friend_user_id]:
                friends[friend_user_id] = [id for id in friends[friend_user_id] if id != user_id_to_delete]
        save_friends()

        # Delete user's messages
        messages[:] = [msg for msg in messages if msg.get('fromUserId') != user_id_to_delete and msg.get('toUserId') != user_id_to_delete]
        save_messages()

        # Delete friend requests involving this user
        friend_requests[:] = [req for req in friend_requests if req.get('fromUserId') != user_id_to_delete and req.get('toUserId') != user_id_to_delete]
        save_friend_requests()

        # Remove user from likes and comments in remaining codes
        for code in codes:
            if 'likes' in code:
                code['likes'] = [id for id in code['likes'] if id != user_id_to_delete]
            if 'comments' in code:
                code['comments'] = [
                    comment for comment in code['comments']
                    if comment.get('author') != username
                ]
                for comment in code['comments']:
                    if 'likes' in comment:
                        comment['likes'] = [id for id in comment['likes'] if id != user_id_to_delete]
                    if 'replies' in comment:
                        comment['replies'] = [reply for reply in comment['replies'] if reply.get('author') != username]
        save_codes()

        # Now delete from SQL database
        db.delete(current_user)
        db.commit()

        return {"message": "Account deleted successfully"}
    except Exception as e:
        print(f'Error deleting account: {e}')
        raise HTTPException(status_code=500, detail="Internal server error while deleting account")