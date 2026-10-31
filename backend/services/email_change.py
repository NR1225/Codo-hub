"""Поштаны ауыстыру — екі кодпен.

Кіру тек email кодымен, яғни пошта = аккаунт. Сондықтан:
- код ҚАЗІРГІ поштаға да (иесі растайды), ЖАҢА поштаға да (пошта шынымен оныкі) жіберіледі;
- екеуі бір мезетте енгізіледі; 3 минут жарамды; қайта сұралса — ескі кодтар жарамсыз;
- 5 қате әрекеттен кейін сұраныс жойылады;
- ауысқан соң: ескі поштаға хабар, басқа құрылғылардағы сессиялар жабылады, ағымдағысы қалады.
Тест аккаунттары (TEST_ACCOUNTS) — кез келген код.
"""
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from db import EmailChange, User
from services import login_guard, monitoring
from utils.password import hash_refresh_token, verify_refresh_token

CODE_TTL_SECONDS = 3 * 60
RESEND_SECONDS = 60
MAX_ATTEMPTS = 5
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _now() -> datetime:
    return datetime.utcnow()


def _code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _send(user: User, old_code: str, new_code: str, new_email: str) -> None:
    if login_guard.is_test_account(user):
        return
    from utils.email import send_email_change_code, send_in_background

    send_in_background(send_email_change_code, user.email, old_code, user.username, "old", new_email)
    send_in_background(send_email_change_code, new_email, new_code, user.username, "new", new_email)


def _response(row: EmailChange, user: User) -> dict:
    return {
        "oldEmail": login_guard.mask_email(user.email),
        "newEmail": row.new_email,
        "expires_in": CODE_TTL_SECONDS,
        "resend_in": RESEND_SECONDS,
    }


def start(db: Session, request: Request, user: User, new_email: str) -> dict:
    new_email = (new_email or "").strip().lower()
    if not _EMAIL_RE.match(new_email) or len(new_email) > 255:
        raise HTTPException(status_code=400, detail="Invalid email")
    if new_email == (user.email or "").lower():
        raise HTTPException(status_code=400, detail="This is already your email")
    if db.query(User).filter(User.email == new_email, User.id != user.id).first():
        raise HTTPException(status_code=409, detail="Email already in use by another user")

    now = _now()
    row = db.query(EmailChange).filter(EmailChange.user_id == user.id).first()
    if row:
        wait = RESEND_SECONDS - int((now - row.last_sent_at).total_seconds())
        if wait > 0:
            raise HTTPException(status_code=429, detail=f"Please wait {wait} seconds")
    else:
        row = EmailChange(user_id=user.id)
        db.add(row)
    old_code, new_code = _code(), _code()
    row.new_email = new_email
    row.old_code_hash = hash_refresh_token(old_code)
    row.new_code_hash = hash_refresh_token(new_code)
    row.attempts = 0
    row.last_sent_at = now
    row.expires_at = now + timedelta(seconds=CODE_TTL_SECONDS)
    db.commit()
    _send(user, old_code, new_code, new_email)
    monitoring.record("email_change_requested", user_id=user.id, ip=login_guard.client_ip(request),
                      detail={"newEmail": login_guard.mask_email(new_email)})
    return _response(row, user)


def resend(db: Session, request: Request, user: User) -> dict:
    row = db.query(EmailChange).filter(EmailChange.user_id == user.id).first()
    if not row:
        raise HTTPException(status_code=400, detail="Email change expired")
    return start(db, request, user, row.new_email)


def cancel(db: Session, user: User) -> None:
    db.query(EmailChange).filter(EmailChange.user_id == user.id).delete()
    db.commit()


def confirm(db: Session, request: Request, user: User, old_code: str, new_code: str) -> User:
    ip = login_guard.client_ip(request)
    row = db.query(EmailChange).filter(EmailChange.user_id == user.id).first()
    if not row or _now() > row.expires_at:
        if row:
            db.delete(row)
            db.commit()
        raise HTTPException(status_code=400, detail="Email change expired")
    if (row.attempts or 0) >= MAX_ATTEMPTS:
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=429, detail="Too many attempts")

    ok = verify_refresh_token(old_code, row.old_code_hash) and verify_refresh_token(new_code, row.new_code_hash)
    test_bypass = not ok and login_guard.is_test_account(user)
    if not ok and not test_bypass:
        row.attempts = (row.attempts or 0) + 1
        if row.attempts >= MAX_ATTEMPTS:
            db.delete(row)
        db.commit()
        monitoring.record("email_change_code_fail", user_id=user.id, ip=ip)
        raise HTTPException(status_code=400, detail="Invalid confirmation code")

    # Код күтіп тұрғанда басқа біреу осы поштамен тіркеліп үлгеруі мүмкін
    if db.query(User).filter(User.email == row.new_email, User.id != user.id).first():
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=409, detail="Email already in use by another user")

    old_email = user.email
    user.email = row.new_email
    # Басқа құрылғылар қайта кіруі керек (ағымдағы сессия қалады): құрылғылар мен кодтар ұмытылады
    db.delete(row)
    db.commit()
    from db import LoginChallenge, TrustedDevice

    db.query(LoginChallenge).filter(LoginChallenge.user_id == user.id).delete()
    db.query(TrustedDevice).filter(TrustedDevice.user_id == user.id).delete()
    db.commit()
    db.refresh(user)

    if not login_guard.is_test_account(user):
        from utils.email import send_email_changed_notice, send_in_background

        send_in_background(send_email_changed_notice, old_email, user.username, user.email)
    if test_bypass:
        monitoring.record("test_code_bypass", user_id=user.id, ip=ip, detail={"flow": "email_change"})
    monitoring.record("email_changed", user_id=user.id, ip=ip, detail={
        "from": login_guard.mask_email(old_email), "to": login_guard.mask_email(user.email)})
    return user


def pending(db: Session, user: User) -> Optional[dict]:
    row = db.query(EmailChange).filter(EmailChange.user_id == user.id).first()
    if not row or _now() > row.expires_at:
        return None
    left = int((row.expires_at - _now()).total_seconds())
    resend_in = max(0, RESEND_SECONDS - int((_now() - row.last_sent_at).total_seconds()))
    return {**_response(row, user), "expires_in": left, "resend_in": resend_in}
