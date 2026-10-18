"""API routes"""
from fastapi import APIRouter
from . import auth, codes, users, messages, friends, chats, config as config_routes, contact, vibecoding, groups

# Create main router
api_router = APIRouter(prefix="/api")

# Include all route modules (websocket is included separately in main.py)
api_router.include_router(config_routes.router, tags=["config"])
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(codes.router, tags=["codes"])
api_router.include_router(users.router, tags=["users"])
api_router.include_router(messages.router, tags=["messages"])
api_router.include_router(friends.router, tags=["friends"])
api_router.include_router(chats.router, tags=["chats"])
api_router.include_router(contact.router, tags=["contact"])
api_router.include_router(vibecoding.router, tags=["vibecoding"])
api_router.include_router(groups.router, tags=["groups"])

__all__ = ["api_router"]

