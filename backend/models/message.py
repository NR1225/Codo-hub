"""Message-related Pydantic models"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class MessageCreate(BaseModel):
    fromUserId: str = Field(max_length=50)
    toUserId: str = Field(max_length=50)
    content: str = Field(max_length=5000)
    type: Optional[str] = Field(default="text", max_length=20, pattern=r'^(text|image|audio|video|file|sticker|emoji|location|project|poll)$')
    attachments: Optional[List[Dict[str, Any]]] = None  # List of attachment objects
    metadata: Optional[Dict[str, Any]] = None  # Additional metadata (location, sticker info, etc.)
    replyToId: Optional[str] = Field(default=None, max_length=64)


class MessageEdit(BaseModel):
    content: str = Field(max_length=5000)


class ReactionToggle(BaseModel):
    emoji: str = Field(max_length=16)


class PinToggle(BaseModel):
    pinned: bool


class PollVote(BaseModel):
    """Бос тізім — дауысты қайтарып алу"""
    optionIds: List[str] = Field(default_factory=list, max_length=10)


class ChatPrefUpdate(BaseModel):
    pinned: Optional[bool] = None
    muted: Optional[bool] = None
    archived: Optional[bool] = None


class ForwardTarget(BaseModel):
    kind: str = Field(pattern=r'^(dm|group)$')
    id: str = Field(max_length=64)


class ForwardRequest(BaseModel):
    sourceKind: str = Field(pattern=r'^(dm|group)$')
    sourceGroupId: Optional[str] = Field(default=None, max_length=64)
    messageId: str = Field(max_length=64)
    targets: List[ForwardTarget] = Field(min_length=1, max_length=20)
