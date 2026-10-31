"""Құпия сөзсіз кіру: пошта не логин → поштаға 6 таңбалы код → кіру.

Ережелер:
- Әр кіруде код сұралады (құпия сөз жоқ). Google арқылы кірсе де.
- TOTP 2FA қосулы болса, email кодынан кейін TOTP коды да сұралады.
- Код 3 минут жарамды. Қайта сұралса, алдыңғы код бірден жарамсыз болады (хэші ауысады).
- Бір кодқа 5 әрекет. Аккаунт бойынша кодтар 10 рет қате енгізілсе — аккаунт 15 минутқа құлыпталады.
- Бір аккаунтқа 60 секундта бір ғана код жіберіледі (біреудің поштасын хатпен толтыруға болмайды).
- Код тек сұралған браузерде ғана расталады: HttpOnly cookie «device_id» (серверде тек SHA-256 хэші).
  Бұрын кірмеген құрылғы болса, хатта «жаңа құрылғы» деп ескертіледі.
- Жоқ пошта енгізілсе — жалған challenge қайтарылады: пошта сайтта бар-жоғы білінбейді.
- Тест аккаунттары (TEST_ACCOUNTS, тек ALLOW_TEST_ACCOUNT_CODES=true және production емес кезде)
  кез келген 6 таңбалы кодпен кіреді. Әкімшілерге ешқашан жұмыс істемейді.
"""
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional, Tuple

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from config import (
    ADMIN_USER_IDS, ALLOW_TEST_ACCOUNT_CODES, LOGIN_LOCKOUT_MINUTES, LOGIN_MAX_ATTEMPTS, TEST_ACCOUNTS,
)
from db import LoginChallenge, TrustedDevice, User
from services import monitoring
from utils.password import hash_refresh_token, verify_refresh_token

DEVICE_COOKIE = "device_id"
DEVICE_COOKIE_MAX_AGE = 400 * 24 * 3600  # браузерлер бұдан ұзағын рұқсат етпейді
LOGIN_CODE_TTL_SECONDS = 3 * 60
LOGIN_CODE_MAX_ATTEMPTS = 5
LOGIN_CODE_RESEND_SECONDS = 60
ACCOUNT_MAX_CODE_FAILS = LOGIN_MAX_ATTEMPTS * 2  # барлық кодтар бойынша → аккаунт құлыпталады


def _utcnow() -> datetime:
    return datetime.utcnow()


def _naive(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is not None:
        return dt.replace(tzinfo=None) - (dt.utcoffset() or timedelta())
    return dt


def client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def device_label(request: Request) -> str:
    """User-Agent-тен қысқа атау: «Chrome · Windows»"""
    ua = request.headers.get("user-agent", "")
    browser = next((name for key, name in (
        ("Edg/", "Edge"), ("OPR/", "Opera"), ("YaBrowser", "Yandex"), ("Firefox/", "Firefox"),
        ("Chrome/", "Chrome"), ("Safari/", "Safari"),
    ) if key in ua), "Браузер")
    os_name = next((name for key, name in (
        ("Windows", "Windows"), ("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"),
        ("Mac OS X", "macOS"), ("Linux", "Linux"),
    ) if key in ua), "")
    return f"{browser} · {os_name}" if os_name else browser


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def read_device(request: Request) -> Tuple[str, bool]:
    """(cookie мәні, жаңа ма). Cookie жоқ не бұзылған болса — жаңасы жасалады"""
    value = request.cookies.get(DEVICE_COOKIE) or ""
    if len(value) == 64 and all(c in "0123456789abcdef" for c in value):
        return value, False
    return secrets.token_hex(32), True


def set_device_cookie(response: JSONResponse, value: str) -> None:
    from routes.auth import COOKIE_SAMESITE, COOKIE_SECURE

    response.set_cookie(
        key=DEVICE_COOKIE, value=value, max_age=DEVICE_COOKIE_MAX_AGE,
        httponly=True, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, path="/api/auth",
    )


def _find_device(db: Session, user_id: str, device_value: str) -> Optional[TrustedDevice]:
    return (
        db.query(TrustedDevice)
        .filter(TrustedDevice.user_id == user_id, TrustedDevice.device_hash == _hash(device_value))
        .first()
    )


def mask_email(email: str) -> str:
    name, _, domain = (email or "").partition("@")
    if not domain:
        return "***"
    shown = name[:2] if len(name) > 3 else name[:1]
    return f"{shown}{'*' * max(3, len(name) - len(shown))}@{domain}"


def is_test_account(user: User) -> bool:
    if not ALLOW_TEST_ACCOUNT_CODES or not TEST_ACCOUNTS or user.id in ADMIN_USER_IDS:
        return False
    return (user.username or "").lower() in TEST_ACCOUNTS or (user.email or "").lower() in TEST_ACCOUNTS


def _send_code(user: User, code: str, reason: str, label: str, ip: Optional[str]) -> None:
    if is_test_account(user):
        return  # тест аккаунты: хат жіберілмейді, кез келген код жарайды
    from utils.email import send_in_background, send_login_code_email

    send_in_background(send_login_code_email, user.email, code, user.username, reason, label, ip)


def _check_locked(user: User, ip: Optional[str]) -> None:
    now = _utcnow()
    if user.locked_until and _naive(user.locked_until) > now:
        retry_after = int((_naive(user.locked_until) - now).total_seconds())
        monitoring.record("login_fail", user_id=user.id, ip=ip, detail={"locked": True})
        raise HTTPException(
            status_code=429,
            detail="Account temporarily locked due to too many failed attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )


def fake_challenge(email: str) -> dict:
    """Жоқ пошта: шынайы жауаппен бірдей пішін, бірақ ешқандай код жіберілмейді"""
    return {
        "requires_email_code": True,
        "challenge_id": secrets.token_urlsafe(32),
        "reason": "new_device",
        "email": mask_email(email),
        "expires_in": LOGIN_CODE_TTL_SECONDS,
        "resend_in": LOGIN_CODE_RESEND_SECONDS,
    }


def start_login(db: Session, request: Request, user: User) -> dict:
    """Кіру басталды: поштаға код. Клиентке қайтарылатын жауап (_device — cookie-ге)"""
    ip = client_ip(request)
    _check_locked(user, ip)
    now = _utcnow()
    # Бір аккаунтқа 60 секундта бір код — поштаны хатпен толтыруға болмайды
    last = (
        db.query(LoginChallenge)
        .filter(LoginChallenge.user_id == user.id)
        .order_by(LoginChallenge.last_sent_at.desc())
        .first()
    )
    if last is not None:
        wait = LOGIN_CODE_RESEND_SECONDS - int((now - _naive(last.last_sent_at)).total_seconds())
        if wait > 0:
            raise HTTPException(status_code=429, detail=f"Please wait {wait} seconds", headers={"Retry-After": str(wait)})

    device_value, _ = read_device(request)
    reason = "login" if _find_device(db, user.id, device_value) else "new_device"
    label = device_label(request)
    # Бір құрылғыда бір ғана күтіп тұрған код
    db.query(LoginChallenge).filter(
        LoginChallenge.user_id == user.id, LoginChallenge.device_hash == _hash(device_value)
    ).delete()
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = LoginChallenge(
        id=secrets.token_urlsafe(32),
        user_id=user.id,
        device_hash=_hash(device_value),
        reason=reason,
        code_hash=hash_refresh_token(code),
        attempts=0,
        ip=ip,
        label=label,
        last_sent_at=now,
        expires_at=now + timedelta(seconds=LOGIN_CODE_TTL_SECONDS),
    )
    db.add(challenge)
    db.commit()
    _send_code(user, code, reason, label, ip)
    monitoring.record("login_code_sent", user_id=user.id, ip=ip, detail={"reason": reason, "device": label})
    if reason == "new_device":
        monitoring.record("new_device", user_id=user.id, ip=ip, detail={"device": label})
    return {
        "requires_email_code": True,
        "challenge_id": challenge.id,
        "reason": reason,
        "email": mask_email(user.email),
        "expires_in": LOGIN_CODE_TTL_SECONDS,
        "resend_in": LOGIN_CODE_RESEND_SECONDS,
        "_device": device_value,
    }


def _load(db: Session, request: Request, challenge_id: str) -> Tuple[LoginChallenge, str]:
    device_value, _ = read_device(request)
    challenge = db.query(LoginChallenge).filter(LoginChallenge.id == challenge_id).first()
    # Код сұралған браузерден ғана расталады
    if not challenge or not secrets.compare_digest(challenge.device_hash, _hash(device_value)):
        raise HTTPException(status_code=400, detail="Login code expired")
    return challenge, device_value


def _account_fail(db: Session, user: Optional[User], ip: Optional[str]) -> None:
    """Аккаунт бойынша қате кодтар санағышы: шекке жетсе — құлыптау"""
    if not user:
        return
    user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
    if user.failed_login_attempts >= ACCOUNT_MAX_CODE_FAILS:
        user.locked_until = _utcnow() + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
        user.failed_login_attempts = 0
        db.query(LoginChallenge).filter(LoginChallenge.user_id == user.id).delete()
        monitoring.record("account_locked", user_id=user.id, ip=ip, detail={"minutes": LOGIN_LOCKOUT_MINUTES})


def verify(db: Session, request: Request, challenge_id: str, code: str) -> User:
    challenge, device_value = _load(db, request, challenge_id)
    ip = client_ip(request)
    user = db.query(User).filter(User.id == challenge.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="Login code expired")
    _check_locked(user, ip)
    if _utcnow() > _naive(challenge.expires_at):
        db.delete(challenge)
        db.commit()
        raise HTTPException(status_code=400, detail="Login code expired")
    if (challenge.attempts or 0) >= LOGIN_CODE_MAX_ATTEMPTS:
        db.delete(challenge)
        db.commit()
        monitoring.record("login_code_locked", user_id=user.id, ip=ip)
        raise HTTPException(status_code=429, detail="Too many attempts")

    test_bypass = False
    if not verify_refresh_token(code, challenge.code_hash):
        if is_test_account(user):
            test_bypass = True
        else:
            challenge.attempts = (challenge.attempts or 0) + 1
            left = LOGIN_CODE_MAX_ATTEMPTS - challenge.attempts
            if left <= 0:
                db.delete(challenge)
            _account_fail(db, user, ip)
            db.commit()
            monitoring.record("login_code_fail", user_id=user.id, ip=ip, detail={"attemptsLeft": max(0, left)})
            raise HTTPException(status_code=400, detail="Invalid login code")

    device = _find_device(db, user.id, device_value)
    if not device:
        device = TrustedDevice(id=secrets.token_hex(18), user_id=user.id, device_hash=_hash(device_value))
        db.add(device)
    device.label = challenge.label
    device.ip = ip
    device.logins_since_code = (device.logins_since_code or 0) + 1
    device.last_login_at = _utcnow()
    user.failed_login_attempts = 0
    user.locked_until = None
    reason = challenge.reason
    db.delete(challenge)
    db.commit()
    if test_bypass:
        monitoring.record("test_code_bypass", user_id=user.id, ip=ip)
    monitoring.record("login_code_ok", user_id=user.id, ip=ip, detail={"reason": reason})
    return user


def resend(db: Session, request: Request, challenge_id: str) -> dict:
    challenge, _ = _load(db, request, challenge_id)
    now = _utcnow()
    wait = LOGIN_CODE_RESEND_SECONDS - int((now - _naive(challenge.last_sent_at)).total_seconds())
    if wait > 0:
        raise HTTPException(status_code=429, detail=f"Please wait {wait} seconds", headers={"Retry-After": str(wait)})
    user = db.query(User).filter(User.id == challenge.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="Login code expired")
    _check_locked(user, client_ip(request))
    code = f"{secrets.randbelow(1_000_000):06d}"
    # Хэш ауысады — бұрын жіберілген код (кешігіп келсе де) енді жарамайды
    challenge.code_hash = hash_refresh_token(code)
    challenge.attempts = 0
    challenge.last_sent_at = now
    challenge.expires_at = now + timedelta(seconds=LOGIN_CODE_TTL_SECONDS)
    db.commit()
    _send_code(user, code, challenge.reason, challenge.label or "", challenge.ip)
    monitoring.record("login_code_sent", user_id=user.id, ip=client_ip(request), detail={"reason": challenge.reason, "resend": True})
    return {"message": "Login code sent", "expires_in": LOGIN_CODE_TTL_SECONDS, "resend_in": LOGIN_CODE_RESEND_SECONDS}


def remember_device(db: Session, request: Request, user: User) -> str:
    """Тіркелу коды осы браузерде расталды — құрылғы таныс болады. Cookie мәнін қайтарады"""
    device_value, _ = read_device(request)
    device = _find_device(db, user.id, device_value)
    if not device:
        device = TrustedDevice(id=secrets.token_hex(18), user_id=user.id, device_hash=_hash(device_value))
        db.add(device)
    device.label = device_label(request)
    device.ip = client_ip(request)
    device.logins_since_code = (device.logins_since_code or 0) + 1
    device.last_login_at = _utcnow()
    db.commit()
    return device_value


def forget_devices(db: Session, user_id: str) -> None:
    """Әкімші «барлық құрылғыдан шығарды» — күтіп тұрған кодтар мен құрылғылар өшеді"""
    db.query(TrustedDevice).filter(TrustedDevice.user_id == user_id).delete()
    db.query(LoginChallenge).filter(LoginChallenge.user_id == user_id).delete()
    db.commit()
