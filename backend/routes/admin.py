"""Әкімші панелі: мониторинг (/admin/monitoring беті).

Қорғаныс: тек ADMIN_USER_IDS тізіміндегі қолданушы. Басқаларға — 404 (панельдің бары да білінбейді).
Әкімшінің әр әрекеті (құлыпты алу, құрылғыларды ұмыту) журналға жазылады.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from config import ADMIN_USER_IDS
from db import User, get_db
from services import login_guard, monitoring
from utils.auth import get_current_user

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


def is_admin(user: Optional[User]) -> bool:
    return bool(user) and user.id in ADMIN_USER_IDS


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin(user):
        raise HTTPException(status_code=404, detail="Not Found")
    return user


@router.get("/admin/me")
@limiter.limit("60/minute")
async def admin_me(request: Request, user: User = Depends(get_current_user)):
    return {"isAdmin": is_admin(user)}


@router.get("/admin/monitoring/overview")
@limiter.limit("60/minute")
async def monitoring_overview(request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return monitoring.overview(db)


@router.get("/admin/monitoring/events")
@limiter.limit("120/minute")
async def monitoring_events(
    request: Request,
    kind: Optional[str] = Query(None, max_length=40),
    severity: Optional[str] = Query(None, pattern="^(info|warn|error)$"),
    userId: Optional[str] = Query(None, max_length=12),
    ip: Optional[str] = Query(None, max_length=64),
    beforeId: Optional[int] = Query(None, ge=1),
    limit: int = Query(100, ge=1, le=500),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return {"events": monitoring.list_events(db, kind, severity, userId, ip, beforeId, limit)}


@router.post("/admin/users/{user_id}/unlock")
@limiter.limit("30/minute")
async def unlock_user(request: Request, user_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Қате кірулерден құлыпталған аккаунтты ашу"""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.locked_until = None
    target.failed_login_attempts = 0
    db.commit()
    monitoring.record("admin_action", user_id=admin.id, ip=login_guard.client_ip(request),
                      detail={"action": "unlock", "target": target.id, "targetUsername": target.username})
    return {"ok": True}


@router.post("/admin/users/{user_id}/logout-everywhere")
@limiter.limit("30/minute")
async def logout_everywhere(request: Request, user_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Күдікті аккаунт: барлық сессияларды жабу және құрылғыларды ұмыту (келесі кіру — email кодымен)"""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.session_id = None
    target.refresh_token_hash = None
    db.commit()
    login_guard.forget_devices(db, target.id)
    monitoring.record("admin_action", user_id=admin.id, ip=login_guard.client_ip(request),
                      detail={"action": "logout_everywhere", "target": target.id, "targetUsername": target.username})
    return {"ok": True}
