"""Message routes"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends, Request, Query
from typing import Optional
import json
from models import MessageCreate, MessageEdit, ReactionToggle, PinToggle, ForwardRequest, PollVote
from services.message_service import MessageService
from services.message_extras import build_poll_metadata, build_sticker_metadata, reply_snapshot
from services.user_lookup import find_public_user
from services.forward_service import forward_message
from services.friend_service import FriendService
from services.upload_service import dm_scope, save_chat_attachment, strip_client_attachments
from services.project_card import build_project_metadata
from utils.auth import get_current_user, verify_user_access
from utils.signed_route import SignedMediaRoute
from db import SessionLocal, User
from slowapi import Limiter
from slowapi.util import get_remote_address

# Жауаптағы файл сілтемелері қарап отырған адамға қол қойылып беріледі
router = APIRouter(route_class=SignedMediaRoute)
limiter = Limiter(key_func=get_remote_address)


def _reply_extra(user_id: str, peer_id: str, reply_to_id: Optional[str]) -> dict:
    """replyToId → {'replyTo': үзінді}; хабарлама осы сөйлесуде болуы керек"""
    if not reply_to_id:
        return {}
    source = MessageService.get_visible_message(reply_to_id, user_id)
    if peer_id not in (source.get('fromUserId'), source.get('toUserId')):
        raise HTTPException(status_code=400, detail="Reply target is not in this conversation")
    sender = find_public_user(source.get('fromUserId'))
    return {'replyTo': reply_snapshot(source, sender['username'] if sender else None)}



@router.get("/messages/{user_id}")
@limiter.limit("30/minute")
async def get_messages(request: Request, user_id: str, current_user: User = Depends(verify_user_access)):
    """Get all messages for a user (only own messages)"""
    return MessageService.get_user_messages(user_id)


@router.get("/messages/{user_id}/{friend_id}")
@limiter.limit("30/minute")
async def get_conversation(request: Request, user_id: str, friend_id: str, current_user: User = Depends(verify_user_access)):
    """Get conversation between two users (only own conversations)"""
    return MessageService.get_conversation(user_id, friend_id)


@router.post("/messages")
@limiter.limit("30/minute")
async def create_message(request: Request, message_data: MessageCreate, user: User = Depends(get_current_user)):
    """Create a new message"""
    if not message_data.toUserId:
        raise HTTPException(status_code=400, detail="Missing required fields")

    # For non-text messages, content can be empty
    if message_data.type == "text" and not message_data.content:
        raise HTTPException(status_code=400, detail="Text messages require content")

    try:
        # Тікелей чатқа ма, «сұрауға» ма — алушының баптауы бойынша; рұқсат жоқ болса 403
        delivery = FriendService.delivery_extra(user.id, message_data.toUserId)
        metadata = message_data.metadata
        if isinstance(metadata, dict):
            metadata.pop("storyReply", None)  # сторис үзіндісін тек сервер толтырады
            metadata.pop("storyShare", None)
        content = message_data.content or ""
        if message_data.type == "poll":
            metadata = build_poll_metadata(metadata)
            content = metadata["question"]
        if message_data.type == "sticker":
            metadata = build_sticker_metadata(metadata)
            content = ""
        if message_data.type == "project":
            # Жоба картасының деректерін сервер толтырады
            db = SessionLocal()
            try:
                metadata = build_project_metadata(db, user.id, message_data.metadata)
            finally:
                db.close()
        message = await MessageService.create_message(
            from_user_id=user.id,
            to_user_id=message_data.toUserId,
            content=content,
            are_friends=True,
            message_type=message_data.type or "text",
            attachments=strip_client_attachments(message_data.attachments),
            metadata=metadata,
            extra={**_reply_extra(user.id, message_data.toUserId, message_data.replyToId), **delivery},
        )
        return message
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.post("/messages/upload")
@limiter.limit("10/minute")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    toUserId: str = Form(...),
    messageType: str = Form("file"),
    content: Optional[str] = Form(None),
    metadata: Optional[str] = Form(None, max_length=4000),
    replyToId: Optional[str] = Form(None, max_length=64),
    user: User = Depends(get_current_user),
):
    """Upload a file and create a message with attachment"""
    try:
        # Алдымен рұқсатты тексереміз — рұқсат жоқ болса файл сақталмайды
        delivery = FriendService.delivery_extra(user.id, toUserId)
        reply_extra = _reply_extra(user.id, toUserId, replyToId)

        attachment = await save_chat_attachment(file, messageType, dm_scope(user.id, toUserId))

        # Parse metadata if provided
        metadata_dict = {}
        if metadata:
            try:
                metadata_dict = json.loads(metadata)
            except:
                pass
        if isinstance(metadata_dict, dict):
            metadata_dict.pop("storyReply", None)
            metadata_dict.pop("storyShare", None)

        # Create message
        message = await MessageService.create_message(
            from_user_id=user.id,
            to_user_id=toUserId,
            content=content or "",
            are_friends=True,
            message_type=messageType,
            attachments=[attachment],
            metadata=metadata_dict,
            extra={**reply_extra, **delivery},
        )

        return message
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="File upload failed. Please try again.")


@router.put("/messages/{message_id}/read")
@limiter.limit("30/minute")
async def mark_message_read(request: Request, message_id: str, user: User = Depends(get_current_user)):
    """Mark a message as read (only the recipient can mark)"""
    try:
        # Verify the authenticated user is the recipient of this message
        message = await MessageService.get_message_by_id(message_id)
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
        if str(user.id) != str(message.get('toUserId')):
            raise HTTPException(status_code=403, detail="Only the recipient can mark a message as read")
        return await MessageService.mark_message_read(message_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/messages/{user_id}/{friend_id}/mark-read")
@limiter.limit("30/minute")
async def mark_conversation_read(request: Request, user_id: str, friend_id: str, current_user: User = Depends(verify_user_access)):
    """Mark all messages in a conversation as read (only own conversations)"""
    updated_count = await MessageService.mark_conversation_read(user_id, friend_id)
    return {'message': f'{updated_count} messages marked as read', 'count': updated_count}


@router.get("/messages/{user_id}/{friend_id}/unread-count")
@limiter.limit("30/minute")
async def get_unread_count_for_chat(request: Request, user_id: str, friend_id: str, current_user: User = Depends(verify_user_access)):
    """Get unread message count for a specific chat (only own chats)"""
    unread_count = MessageService.get_unread_count_for_chat(user_id, friend_id)
    return {'unreadCount': unread_count, 'chatId': friend_id}


@router.get("/messages/{user_id}/unread-count")
@limiter.limit("30/minute")
async def get_total_unread_count(request: Request, user_id: str, current_user: User = Depends(verify_user_access)):
    """Get total unread message count for a user (only own count)"""
    total_count = MessageService.get_total_unread_count(user_id)
    return {'totalUnreadCount': total_count}


@router.delete("/messages/{user_id}/{friend_id}")
@limiter.limit("10/minute")
async def clear_conversation(request: Request, user_id: str, friend_id: str, current_user: User = Depends(verify_user_access)):
    """Delete all messages in a conversation (only own conversations)"""
    deleted_count = MessageService.clear_conversation(user_id, friend_id)
    return {'message': 'Conversation cleared', 'deletedCount': deleted_count}



# ---------- Хабарлама әрекеттері ----------

@router.patch("/messages/{message_id}")
@limiter.limit("30/minute")
async def edit_message(request: Request, message_id: str, body: MessageEdit, user: User = Depends(get_current_user)):
    """Өз хабарламасының мәтінін өзгерту"""
    return await MessageService.edit_message(message_id, user.id, body.content)


@router.delete("/messages/{message_id}")
@limiter.limit("30/minute")
async def delete_message(
    request: Request,
    message_id: str,
    scope: str = Query("me", pattern=r"^(me|all)$"),
    user: User = Depends(get_current_user),
):
    """scope=me — тек өзімнен, scope=all — екеуінен де (тек автор)"""
    return await MessageService.delete_message(message_id, user.id, scope == "all")


@router.post("/messages/{message_id}/reactions")
@limiter.limit("60/minute")
async def react_to_message(request: Request, message_id: str, body: ReactionToggle, user: User = Depends(get_current_user)):
    return await MessageService.react(message_id, user.id, body.emoji)


@router.post("/messages/{message_id}/pin")
@limiter.limit("30/minute")
async def pin_message(request: Request, message_id: str, body: PinToggle, user: User = Depends(get_current_user)):
    return await MessageService.set_pinned(message_id, user.id, body.pinned)


@router.post("/messages/{message_id}/listened")
@limiter.limit("60/minute")
async def mark_listened(request: Request, message_id: str, user: User = Depends(get_current_user)):
    """Дауыстық хабарламаны тыңдадым (тек алушы)"""
    return await MessageService.mark_listened(message_id, user.id)


@router.post("/messages/{message_id}/vote")
@limiter.limit("60/minute")
async def vote_in_poll(request: Request, message_id: str, body: PollVote, user: User = Depends(get_current_user)):
    """Сауалнамаға дауыс беру; optionIds бос болса — дауысты қайтарып алу"""
    return await MessageService.vote(message_id, user.id, body.optionIds)


@router.post("/messages/forward")
@limiter.limit("20/minute")
async def forward(request: Request, body: ForwardRequest, user: User = Depends(get_current_user)):
    """Хабарламаны (жеке чаттан не топтан) достарға және топтарға бағыттау"""
    return await forward_message(user.id, body)
