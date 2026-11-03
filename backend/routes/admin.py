"""Әкімші панелі: мониторинг (/admin/monitoring беті).

Қорғаныс (services/admin_guard.py): ADMIN_USER_IDS тізімі + ADMIN_ALLOWED_IPS + міндетті 2FA +
қайта растау (authenticator/email коды, ADMIN_STEPUP_MINUTES минутқа HttpOnly cookie).
Тізімде жоқ немесе басқа IP-ден келгенге — 404 (панельдің бары да білінбейді).
Әкімшінің әр әрекеті (құлыпты алу, құрылғыларды ұмыту) журналға жазылады.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from config import ADMIN_USER_IDS
from db import User, get_db
from services import admin_guard, login_guard, monitoring
from utils.auth import get_current_user

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


def is_admin(user: Optional[User]) -> bool:
    return bool(user) and user.id in ADMIN_USER_IDS


def require_admin(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """Тізімде + рұқсат етілген IP + 2FA + қайта расталған (services/admin_guard.py)"""
    admin_guard.require_full(db, user, request)
    return user


@router.get("/admin/me")
@limiter.limit("60/minute")
async def admin_me(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return admin_guard.status(db, user, request)


class StepUpVerify(BaseModel):
    code: str = Field(..., min_length=6, max_length=12)


@router.post("/admin/stepup/start")
@limiter.limit("10/minute")
async def admin_stepup_start(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Әкімші панеліне кірер алдындағы растау: email әдісінде код жіберіледі"""
    return admin_guard.start(db, user, request)


@router.post("/admin/stepup/verify")
@limiter.limit("10/minute")
async def admin_stepup_verify(request: Request, body: StepUpVerify, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    token = admin_guard.verify(db, user, request, body.code)
    response = JSONResponse(admin_guard.status_after_verify())
    admin_guard.set_cookie(response, token)
    return response


@router.post("/admin/stepup/end")
@limiter.limit("30/minute")
async def admin_stepup_end(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Панельден шығу (растауды жою)"""
    admin_guard.end(db, user, request)
    response = JSONResponse({"ok": True})
    admin_guard.clear_cookie(response)
    return response


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
