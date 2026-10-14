"""Message routes"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends, Request
from typing import Optional
import json
from models import MessageCreate
from services.message_service import MessageService
from services.friend_service import FriendService
from utils.auth import get_current_user, verify_user_access
from db import User
import os
from datetime import datetime
from config import DANGEROUS_EXTENSIONS, MAX_FILE_SIZE
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

# Create uploads directory if it doesn't exist
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(f"{UPLOAD_DIR}/images", exist_ok=True)
os.makedirs(f"{UPLOAD_DIR}/audio", exist_ok=True)
os.makedirs(f"{UPLOAD_DIR}/video", exist_ok=True)
os.makedirs(f"{UPLOAD_DIR}/files", exist_ok=True)


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
        can_message = FriendService.can_message(user.id, message_data.toUserId)
        message = await MessageService.create_message(
            from_user_id=user.id,
            to_user_id=message_data.toUserId,
            content=message_data.content or "",
            are_friends=can_message,
            message_type=message_data.type or "text",
            attachments=message_data.attachments,
            metadata=message_data.metadata
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
    metadata: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
):
    """Upload a file and create a message with attachment"""
    try:
        # Validate file extension
        if file.filename:
            file_ext = os.path.splitext(file.filename)[1].lower()
            if file_ext in DANGEROUS_EXTENSIONS:
                raise HTTPException(status_code=400, detail=f"File type '{file_ext}' is not allowed")

            # Double-check: verify content type matches extension for images
            if file.content_type and file.content_type.startswith('image/'):
                import filetype
                content_bytes = await file.read()
                await file.seek(0)  # Reset position after reading
                kind = filetype.guess(content_bytes)
                if kind is None:
                    # Could not determine file type from magic bytes — reject for safety
                    raise HTTPException(
                        status_code=400,
                        detail="Could not verify file type. Only valid image files are accepted."
                    )
                elif kind.mime != file.content_type:
                    # Content type doesn't match actual file content
                    raise HTTPException(
                        status_code=400,
                        detail="File content does not match the declared file type"
                    )

        # Read file content with size check
        content_bytes = await file.read()
        if len(content_bytes) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"File size exceeds maximum allowed size")

        # Verify messaging permission
        can_message = FriendService.can_message(user.id, toUserId)
        if not can_message:
            raise HTTPException(status_code=403, detail="Тек достарға хабарлама жіберуге болады. Алдымен дос болыңыз.")

        # Determine upload directory based on message type
        upload_subdir = {
            "image": "images",
            "audio": "audio",
            "video": "video",
            "file": "files"
        }.get(messageType, "files")

        upload_path = f"{UPLOAD_DIR}/{upload_subdir}"
        os.makedirs(upload_path, exist_ok=True)

        # Generate unique filename (sanitize to prevent path traversal)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_filename = os.path.basename(file.filename) if file.filename else "upload"
        safe_filename = safe_filename.replace("..", "").replace("/", "").replace("\\", "")
        file_extension = os.path.splitext(safe_filename)[1] if safe_filename else ""
        unique_filename = f"{timestamp}_{safe_filename}"
        file_path = os.path.join(upload_path, unique_filename)

        # Verify path is within upload directory
        upload_dir_abs = os.path.abspath(UPLOAD_DIR)
        file_path_abs = os.path.abspath(file_path)
        if not file_path_abs.startswith(upload_dir_abs):
            raise HTTPException(status_code=400, detail="Invalid file path")

        # Save file
        with open(file_path, "wb") as buffer:
            buffer.write(content_bytes)

        # Get file size
        file_size = len(content_bytes)

        # Create attachment object
        attachment = {
            "filename": safe_filename,
            "url": f"/api/uploads/{upload_subdir}/{unique_filename}",
            "size": file_size,
            "mimeType": file.content_type or "application/octet-stream"
        }

        # Parse metadata if provided
        metadata_dict = {}
        if metadata:
            try:
                metadata_dict = json.loads(metadata)
            except:
                pass

        # Create message
        message = await MessageService.create_message(
            from_user_id=user.id,
            to_user_id=toUserId,
            content=content or "",
            are_friends=can_message,
            message_type=messageType,
            attachments=[attachment],
            metadata=metadata_dict
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

