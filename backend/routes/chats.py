"""Chat routes"""
from fastapi import APIRouter, Depends, Path, Query, Request
from pydantic import BaseModel, Field
from models import ChatPrefUpdate
from services.chat_service import ChatService
from services.friend_service import FriendService
from services.message_service import MessageService
from services import chat_prefs_service, presence_service
from utils.auth import get_current_user, verify_user_access
from db import User
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.get("/chats/{user_id}")
@limiter.limit("30/minute")
async def get_chats(request: Request, user_id: str, current_user: User = Depends(verify_user_access)):
    """Get list of all chats (conversations) for a user (only own chats)"""
    return ChatService.get_chats(user_id)


class ChatSettingsBody(BaseModel):
    dmPrivacy: str = Field(pattern=r"^(open|closed|friends)$")


@router.get("/chat-settings")
@limiter.limit("60/minute")
async def get_chat_settings(request: Request, user: User = Depends(get_current_user)):
    """Кім жаза алады: open | closed | friends"""
    return {"dmPrivacy": FriendService.get_dm_privacy(user.id)}


@router.put("/chat-settings")
@limiter.limit("30/minute")
async def update_chat_settings(request: Request, body: ChatSettingsBody, user: User = Depends(get_current_user)):
    return {"dmPrivacy": FriendService.set_dm_privacy(user.id, body.dmPrivacy)}


@router.get("/message-requests")
@limiter.limit("60/minute")
async def list_message_requests(request: Request, user: User = Depends(get_current_user)):
    """Бейтаныстардан келген, әлі қабылданбаған хабарламалар"""
    return MessageService.list_requests(user.id)


@router.post("/message-requests/{peer_id}/accept")
@limiter.limit("30/minute")
async def accept_message_request(request: Request, peer_id: str = Path(max_length=64), user: User = Depends(get_current_user)):
    return {"accepted": await MessageService.accept_request(user.id, peer_id)}


@router.post("/message-requests/{peer_id}/decline")
@limiter.limit("30/minute")
async def decline_message_request(request: Request, peer_id: str = Path(max_length=64), user: User = Depends(get_current_user)):
    return {"declined": MessageService.decline_request(user.id, peer_id)}


@router.get("/presence")
@limiter.limit("60/minute")
async def get_presence(
    request: Request,
    ids: str = Query("", max_length=4000),
    user: User = Depends(get_current_user),
):
    """{userId: {online, lastSeen}} — тек достар, хат жазысқандар және топтастар үшін"""
    user_ids = [i for i in ids.split(",") if i][:200]
    return presence_service.get_presence(user.id, user_ids)


@router.get("/chat-prefs")
@limiter.limit("60/minute")
async def get_chat_prefs(request: Request, user: User = Depends(get_current_user)):
    """Бекітілген / дыбысы өшірілген / мұрағаттағы чаттар"""
    return chat_prefs_service.list_prefs(user.id)


@router.put("/chat-prefs/{kind}/{chat_id}")
@limiter.limit("60/minute")
async def update_chat_pref(
    request: Request,
    body: ChatPrefUpdate,
    kind: str = Path(pattern=r"^(dm|group)$"),
    chat_id: str = Path(max_length=64),
    user: User = Depends(get_current_user),
):
    return await chat_prefs_service.update_pref(user.id, kind, chat_id, body.pinned, body.muted, body.archived)
