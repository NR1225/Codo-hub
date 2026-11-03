"""Әкімші панелінің қорғанысы.

Панельге кіру үшін төрт шарт бірге орындалуы керек:
1. Қолданушы ADMIN_USER_IDS тізімінде.
2. Сұраныс ADMIN_ALLOWED_IPS тізіміндегі IP-ден келген (тізім бос болса — шектеу жоқ).
3. Аккаунтта authenticator (2FA) қосулы (ADMIN_REQUIRE_2FA=false болса — міндетті емес).
4. Соңғы ADMIN_STEPUP_MINUTES минутта қайта расталған: authenticator коды (2FA қосулы болса)
   немесе поштаға келген код. Растау HttpOnly cookie береді, ол кіру сессиясына және IP-ге байланған.

1–2 орындалмаса — 404 (панельдің бары білінбейді). 3–4 орындалмаса — 403 және себебі:
`admin_2fa_required` немесе `admin_stepup_required` (сайт растау терезесін көрсетеді).
Әр сәтті кіру ADMIN_ALERT_EMAIL-ге (бос болса — әкімшінің өз поштасына) хатпен хабарланады.
"""
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from config import (
    ADMIN_ALERT_EMAIL, ADMIN_ALLOWED_IPS, ADMIN_IP_HEADER, ADMIN_REQUIRE_2FA, ADMIN_STEPUP_MINUTES,
    ADMIN_USER_IDS, SMTP_ENABLED,
)
from db import AdminChallenge, AdminSession, User
from services import monitoring

logger = logging.getLogger("codo_hub")

COOKIE = "admin_session"
COOKIE_PATH = "/api/admin"
CODE_TTL = timedelta(minutes=10)
RESEND_EVERY = timedelta(seconds=45)
MAX_ATTEMPTS = 5
LOCK_FOR = timedelta(minutes=15)

STEPUP_REQUIRED = "admin_stepup_required"
TWO_FA_REQUIRED = "admin_2fa_required"


def _now() -> datetime:
    return datetime.utcnow()


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _naive(dt: Optional[datetime]) -> Optional[datetime]:
    return dt.replace(tzinfo=None) if dt and dt.tzinfo else dt


# ---------- 1–2: кім және қайдан ----------

def request_ip(request: Request) -> Optional[str]:
    """Нақты IP. Прокси артында ADMIN_IP_HEADER-дің ең оң жақтағы мәні (оны прокси қосады,
    клиент жалған мән жазса да солға ығысып қалады)"""
    if ADMIN_IP_HEADER:
        raw = request.headers.get(ADMIN_IP_HEADER, "")
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else None


def ip_allowed(request: Request) -> bool:
    return not ADMIN_ALLOWED_IPS or request_ip(request) in ADMIN_ALLOWED_IPS


def is_admin_identity(user: Optional[User], request: Request) -> bool:
    """Тізімде бар және рұқсат етілген IP-ден келді (растау әлі тексерілмейді)"""
    return bool(user) and user.id in ADMIN_USER_IDS and ip_allowed(request)


def require_identity(user: User, request: Request) -> None:
    if not user or user.id not in ADMIN_USER_IDS:
        raise HTTPException(status_code=404, detail="Not Found")
    if not ip_allowed(request):
        monitoring.record("admin_denied", user_id=user.id, ip=request_ip(request),
                          detail={"reason": "ip_not_allowed"}, dedupe_key=f"{user.id}:{request_ip(request)}")
        raise HTTPException(status_code=404, detail="Not Found")


# ---------- 3–4: 2FA және қайта растау ----------

def method_for(user: User) -> Optional[str]:
    """totp — authenticator; email — поштаға код; None — алдымен 2FA қосу керек"""
    if user.totp_enabled and user.totp_secret:
        return "totp"
    return None if ADMIN_REQUIRE_2FA else "email"


def active_session(db: Session, user: User, request: Request) -> Optional[AdminSession]:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    row = db.query(AdminSession).filter(AdminSession.token_hash == _hash(token)).first()
    if not row or row.user_id != user.id:
        return None
    valid = (
        _naive(row.expires_at) > _now()
        and user.session_id is not None
        and hmac.compare_digest(row.session_id, user.session_id)  # шығып, қайта кірсе — растау жойылады
        and row.ip == request_ip(request)  # cookie басқа IP-ге көшірілсе — жарамсыз
    )
    if not valid:
        db.delete(row)
        db.commit()
        return None
    return row


def require_full(db: Session, user: User, request: Request) -> None:
    require_identity(user, request)
    if method_for(user) is None:
        raise HTTPException(status_code=403, detail=TWO_FA_REQUIRED)
    if not active_session(db, user, request):
        raise HTTPException(status_code=403, detail=STEPUP_REQUIRED)


def status(db: Session, user: Optional[User], request: Request) -> Dict[str, Any]:
    """/admin/me жауабы: әкімші емес болса — тек isAdmin=false (басқа ештеңе ашылмайды)"""
    if not is_admin_identity(user, request):
        return {"isAdmin": False}
    method = method_for(user)
    session = active_session(db, user, request) if method else None
    return {
        "isAdmin": True,
        "method": method,
        "requires2fa": method is None,
        "verified": bool(session),
        "expiresAt": (_naive(session.expires_at).isoformat() + "Z") if session else None,
    }


def _challenge(db: Session, user: User) -> AdminChallenge:
    row = db.query(AdminChallenge).filter(AdminChallenge.user_id == user.id).first()
    if not row:
        row = AdminChallenge(user_id=user.id, attempts=0)
        db.add(row)
    return row


def _check_lock(row: AdminChallenge) -> None:
    if row.locked_until and _naive(row.locked_until) > _now():
        retry = int((_naive(row.locked_until) - _now()).total_seconds())
        raise HTTPException(status_code=429, detail="Тым көп қате әрекет. Кейінірек қайталаңыз.",
                            headers={"Retry-After": str(retry)})


def start(db: Session, user: User, request: Request) -> Dict[str, Any]:
    """Растауды бастау: email әдісінде код жібереді, authenticator-да ештеңе жібермейді"""
    require_identity(user, request)
    method = method_for(user)
    if method is None:
        raise HTTPException(status_code=403, detail=TWO_FA_REQUIRED)
    row = _challenge(db, user)
    _check_lock(row)
    if method == "email":
        if row.last_sent_at and _now() - _naive(row.last_sent_at) < RESEND_EVERY and row.code_hash:
            db.commit()
            return {"method": method, "sent": False}
        code = f"{secrets.randbelow(1_000_000):06d}"
        row.code_hash = _hash(f"{user.id}:{code}")
        row.expires_at = _now() + CODE_TTL
        row.last_sent_at = _now()
        row.attempts = 0
        db.commit()
        _send_code(user, code, request)
        return {"method": method, "sent": True}
    db.commit()
    return {"method": method, "sent": False}


def verify(db: Session, user: User, request: Request, code: str) -> str:
    """Кодты тексеріп, жаңа әкімші сессиясын жасайды; cookie мәнін қайтарады"""
    from utils.totp import verify_totp_code

    require_identity(user, request)
    method = method_for(user)
    if method is None:
        raise HTTPException(status_code=403, detail=TWO_FA_REQUIRED)
    row = _challenge(db, user)
    _check_lock(row)
    code = (code or "").strip().replace(" ", "")

    if method == "totp":
        ok = bool(code) and code != row.last_totp and verify_totp_code(user.totp_secret, code)
    else:
        ok = (
            bool(row.code_hash) and row.expires_at is not None and _naive(row.expires_at) > _now()
            and hmac.compare_digest(row.code_hash, _hash(f"{user.id}:{code}"))
        )

    ip = request_ip(request)
    if not ok:
        row.attempts = (row.attempts or 0) + 1
        locked = row.attempts >= MAX_ATTEMPTS
        if locked:
            row.locked_until = _now() + LOCK_FOR
            row.attempts = 0
            row.code_hash = None
        db.commit()
        monitoring.record("admin_login_fail", user_id=user.id, ip=ip, detail={"method": method, "locked": locked})
        if locked:
            _notify(user, request, failed=True)
            raise HTTPException(status_code=429, detail="Тым көп қате әрекет. 15 минуттан соң қайталаңыз.")
        raise HTTPException(status_code=400, detail="Код қате немесе мерзімі өткен")

    row.attempts = 0
    row.locked_until = None
    row.code_hash = None
    if method == "totp":
        row.last_totp = code

    # Бұрынғы сессияларын жабамыз — бір уақытта бір ғана растау
    db.query(AdminSession).filter(AdminSession.user_id == user.id).delete()
    db.query(AdminSession).filter(AdminSession.expires_at < _now()).delete()
    token = secrets.token_urlsafe(32)
    from services.login_guard import device_label
    db.add(AdminSession(
        token_hash=_hash(token), user_id=user.id, session_id=user.session_id or "",
        ip=ip, label=device_label(request)[:200], expires_at=_now() + timedelta(minutes=ADMIN_STEPUP_MINUTES),
    ))
    db.commit()
    monitoring.record("admin_login", user_id=user.id, ip=ip, detail={"method": method, "device": device_label(request)})
    _notify(user, request, failed=False)
    return token


def status_after_verify() -> Dict[str, Any]:
    expires = _now() + timedelta(minutes=ADMIN_STEPUP_MINUTES)
    return {"ok": True, "verified": True, "expiresAt": expires.isoformat() + "Z"}


def end(db: Session, user: User, request: Request) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        db.query(AdminSession).filter(AdminSession.token_hash == _hash(token)).delete()
    db.query(AdminSession).filter(AdminSession.user_id == user.id).delete()
    db.commit()


def set_cookie(response: JSONResponse, token: str) -> None:
    from routes.auth import COOKIE_SAMESITE, COOKIE_SECURE

    response.set_cookie(
        key=COOKIE, value=token, max_age=ADMIN_STEPUP_MINUTES * 60,
        httponly=True, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, path=COOKIE_PATH,
    )


def clear_cookie(response: JSONResponse) -> None:
    from routes.auth import COOKIE_SAMESITE, COOKIE_SECURE

    response.delete_cookie(key=COOKIE, path=COOKIE_PATH, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, httponly=True)


# ---------- Хаттар ----------

def _send_code(user: User, code: str, request: Request) -> None:
    from utils.email import _send_email, _simple_html, send_in_background

    if not SMTP_ENABLED:
        logger.warning("Әкімші коды (SMTP өшірулі) %s: %s", user.username, code)
        return
    from services.login_guard import device_label

    lines = [f"Сәлем, {user.username}!", "Әкімші панеліне кіру үшін растау коды:",
             f"Құрылғы: {device_label(request)} · IP: {request_ip(request) or '—'}"]
    warning = "Егер бұл сіз болмасаңыз — кодты ешкімге бермеңіз және құпия деректеріңізді ауыстырыңыз."
    html = _simple_html("Әкімші панеліне кіру", lines, code=code, warning=warning)
    text = "\n".join(lines) + f"\n\nКод: {code}\n\n{warning}\n"
    send_in_background(_send_email, user.email, "Codo Hub: әкімші панеліне кіру коды", html, text)


def _notify(user: User, request: Request, failed: bool) -> None:
    """Әкімші панеліне кіру (немесе құлыпталу) туралы хат"""
    from services.login_guard import device_label

    to = ADMIN_ALERT_EMAIL or user.email
    title = "Әкімші панеліне кіру бұғатталды (5 қате код)" if failed else "Әкімші панеліне кірді"
    lines = [
        f"Аккаунт: @{user.username} ({user.id})",
        f"Уақыты (UTC): {_now():%Y-%m-%d %H:%M:%S}",
        f"IP: {request_ip(request) or '—'}",
        f"Құрылғы: {device_label(request)}",
    ]
    warning = "Бұл сіз болмасаңыз — бірден аккаунттың құпия деректерін ауыстырып, барлық сессиялардан шығыңыз."
    if not SMTP_ENABLED or not to:
        logger.warning("ADMIN %s: %s", title, " · ".join(lines))
        return
    from utils.email import _send_email, _simple_html, send_in_background

    html = _simple_html(title, lines, warning=warning)
    text = f"{title}\n\n" + "\n".join(lines) + f"\n\n{warning}\n"
    send_in_background(_send_email, to, f"⚠ Codo Hub: {title}", html, text)
