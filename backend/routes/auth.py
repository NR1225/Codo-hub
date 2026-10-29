"""Authentication routes"""
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from models import (
    UserRegister, UserLogin, FirebaseLogin, ChangePassword,
    ForgotPasswordRequest, ResetPasswordRequest, RegisterVerify, RegisterResend,
    TwoFASetupVerify, TwoFADisable, TwoFALoginVerify,
)
from db import get_db, User, PasswordReset, PendingRegistration
from utils.password import hash_password, verify_password, hash_refresh_token, verify_refresh_token
from utils.auth import (
    create_access_token, create_refresh_token, create_temp_2fa_token,
    decode_token, get_current_user,
)
from utils.captcha import verify_captcha
from config import LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MINUTES
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
router = APIRouter()


def _naive_utc(dt):
    """Coerce a datetime to naive UTC.

    SQLAlchemy's SQLite DateTime column returns offset-naive datetimes even
    when an offset-aware value was stored, so comparing an aware `now` against
    a stored value raises. Normalise both sides to naive UTC before comparing.
    """
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


# Cookie settings for refresh token
REFRESH_TOKEN_COOKIE = "refresh_token"
CSRF_TOKEN_COOKIE = "csrf_token"
COOKIE_MAX_AGE = 30 * 24 * 60 * 60  # 30 days in seconds
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"  # MUST be "true" in production with HTTPS
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "strict")


def _set_refresh_token_cookie(response: JSONResponse, refresh_token: str) -> JSONResponse:
    """Set HttpOnly cookie with refresh token and a CSRF double-submit cookie."""
    # Generate a random CSRF token for double-submit cookie pattern
    csrf_token = secrets.token_hex(32)
    response.set_cookie(
        key=REFRESH_TOKEN_COOKIE,
        value=refresh_token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/api/auth",
    )
    # CSRF token cookie: readable by JS (not HttpOnly) so the frontend can
    # send it back as a custom header. Same lifetime as the refresh token.
    # Path must be "/" so document.cookie can read it from any frontend page.
    # (The double-submit pattern requires the frontend to read this cookie
    # and send it as a header — a restricted path would hide it from JS.)
    response.set_cookie(
        key=CSRF_TOKEN_COOKIE,
        value=csrf_token,
        max_age=COOKIE_MAX_AGE,
        httponly=False,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )
    # Remove the legacy csrf_token cookie that older builds set on /api/auth
    # (invisible to document.cookie, so it shadowed the real one).
    response.delete_cookie(key=CSRF_TOKEN_COOKIE, path="/api/auth")
    return response


def _clear_refresh_token_cookie(response: JSONResponse) -> JSONResponse:
    """Clear the refresh token and CSRF cookies on logout."""
    response.delete_cookie(
        key=REFRESH_TOKEN_COOKIE,
        path="/api/auth",
    )
    response.delete_cookie(
        key=CSRF_TOKEN_COOKIE,
        path="/",
    )
    response.delete_cookie(key=CSRF_TOKEN_COOKIE, path="/api/auth")
    return response


def generate_user_id() -> str:
    return ''.join([str(secrets.randbelow(10)) for _ in range(12)])


def _user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "avatar": user.avatar,
        "bio": user.bio,
        "totp_enabled": user.totp_enabled,
    }


def _create_tokens(user: User, db: Session) -> dict:
    session_id = str(uuid.uuid4())
    user.session_id = session_id

    access_token = create_access_token(
        data={"sub": user.id, "username": user.username, "session_id": session_id}
    )
    refresh_token = create_refresh_token(data={"sub": user.id})

    # Store refresh token hash for validation
    user.refresh_token_hash = hash_refresh_token(refresh_token)
    db.commit()

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


REGISTRATION_CODE_TTL_MINUTES = 10
REGISTRATION_CODE_MAX_ATTEMPTS = 5
REGISTRATION_CODE_RESEND_SECONDS = 60


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _new_registration_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _send_registration_code(email: str, code: str, username: str) -> None:
    from utils.email import send_verification_code_email
    if not send_verification_code_email(to_email=email, code=code, username=username):
        import logging
        logging.getLogger("codo_hub").warning(
            "Registration code email could not be sent to %s (SMTP may not be configured)", email,
        )


@router.post("/auth/register")
@limiter.limit("3/minute")
async def register(request: Request, user_data: UserRegister, db: Session = Depends(get_db)):
    try:
        if not await verify_captcha(user_data.captcha_token, get_remote_address(request)):
            raise HTTPException(status_code=400, detail="Captcha verification failed")
        if not user_data.username or not user_data.username.strip():
            raise HTTPException(status_code=400, detail="Username is required")
        if not user_data.email or not user_data.email.strip():
            raise HTTPException(status_code=400, detail="Email is required")
        if not user_data.password or not user_data.password.strip():
            raise HTTPException(status_code=400, detail="Password is required")
        if len(user_data.password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        if not any(c.isupper() for c in user_data.password):
            raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in user_data.password):
            raise HTTPException(status_code=400, detail="Password must contain at least one digit")

        username = user_data.username.strip()
        email = user_data.email.strip().lower()

        existing_user = db.query(User).filter(
            (User.email == email) | (User.username == username)
        ).first()
        if existing_user:
            raise HTTPException(status_code=409, detail="User already exists")

        # Аккаунт әзірге ашылмайды: деректер email кодымен расталғанша күтеді
        now = _utcnow()
        code = _new_registration_code()
        pending = db.query(PendingRegistration).filter(PendingRegistration.email == email).first()
        if not pending:
            pending = PendingRegistration(email=email)
            db.add(pending)
        pending.username = username
        pending.password_hash = hash_password(user_data.password)
        pending.code_hash = hash_refresh_token(code)
        pending.attempts = 0
        pending.last_sent_at = now
        pending.expires_at = now + timedelta(minutes=REGISTRATION_CODE_TTL_MINUTES)
        db.commit()

        _send_registration_code(email, code, username)
        return {"verification_required": True, "email": email}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import logging
        logging.getLogger("codo_hub").error(f"Registration error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Registration failed")


@router.post("/auth/register/verify")
@limiter.limit("10/minute")
async def verify_registration(request: Request, body: RegisterVerify, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    pending = db.query(PendingRegistration).filter(PendingRegistration.email == email).first()
    if not pending:
        raise HTTPException(status_code=400, detail="Verification code expired")
    if _utcnow() > _naive_utc(pending.expires_at):
        db.delete(pending)
        db.commit()
        raise HTTPException(status_code=400, detail="Verification code expired")
    if (pending.attempts or 0) >= REGISTRATION_CODE_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many attempts")
    if not verify_refresh_token(body.code, pending.code_hash):
        pending.attempts = (pending.attempts or 0) + 1
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid verification code")

    # Код күтіп тұрғанда басқа біреу осы email/атпен тіркеліп үлгеруі мүмкін
    existing_user = db.query(User).filter(
        (User.email == email) | (User.username == pending.username)
    ).first()
    if existing_user:
        db.delete(pending)
        db.commit()
        raise HTTPException(status_code=409, detail="User already exists")

    try:
        user_id = generate_user_id()
        while db.query(User).filter(User.id == user_id).first():
            user_id = generate_user_id()

        new_user = User(
            id=user_id,
            username=pending.username,
            email=email,
            password_hash=pending.password_hash,
            avatar=None,
        )
        db.add(new_user)
        db.delete(pending)
        db.commit()
    except Exception as e:
        import logging
        logging.getLogger("codo_hub").error(f"Registration error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Registration failed")

    # Email расталды, аккаунт ашылды — құпия сөзді қайта сұрамай бірден кіргіземіз
    tokens = _create_tokens(new_user, db)
    response = JSONResponse(content={
        "message": "User registered successfully",
        "email": email,
        "username": new_user.username,
        "user": _user_dict(new_user),
        "access_token": tokens["access_token"],
        "token_type": "bearer",
    })
    _set_refresh_token_cookie(response, tokens["refresh_token"])
    return response


@router.post("/auth/register/resend")
@limiter.limit("3/minute")
async def resend_registration_code(request: Request, body: RegisterResend, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    pending = db.query(PendingRegistration).filter(PendingRegistration.email == email).first()
    if not pending:
        raise HTTPException(status_code=400, detail="Verification code expired")

    now = _utcnow()
    wait = REGISTRATION_CODE_RESEND_SECONDS - int((now - _naive_utc(pending.last_sent_at)).total_seconds())
    if wait > 0:
        raise HTTPException(status_code=429, detail=f"Please wait {wait} seconds")

    code = _new_registration_code()
    pending.code_hash = hash_refresh_token(code)
    pending.attempts = 0
    pending.last_sent_at = now
    pending.expires_at = now + timedelta(minutes=REGISTRATION_CODE_TTL_MINUTES)
    db.commit()

    _send_registration_code(email, code, pending.username)
    return {"message": "Verification code sent"}


@router.post("/auth/login")
@limiter.limit("5/minute")
async def login(request: Request, login_data: UserLogin, db: Session = Depends(get_db)):
    if not login_data.email and not login_data.username:
        raise HTTPException(status_code=400, detail="Email or username required")
    if not login_data.password:
        raise HTTPException(status_code=400, detail="Password is required")
    if not await verify_captcha(login_data.captcha_token, get_remote_address(request)):
        raise HTTPException(status_code=400, detail="Captcha verification failed")

    user = None
    if login_data.email:
        user = db.query(User).filter(User.email == login_data.email.strip().lower()).first()
    elif login_data.username:
        user = db.query(User).filter(User.username == login_data.username.strip()).first()

    if not user:
        # No per-account tracking for unknown accounts; the IP rate limiter covers it.
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Per-account brute-force lockout (independent of the IP rate limiter).
    # Use naive UTC: SQLAlchemy's SQLite DateTime drops tzinfo on read, so
    # comparing an offset-aware `now` against the stored value would raise.
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if user.locked_until and _naive_utc(user.locked_until) > now:
        retry_after = int((user.locked_until - now).total_seconds())
        raise HTTPException(
            status_code=429,
            detail="Account temporarily locked due to too many failed attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    if not user.password_hash or not verify_password(login_data.password, user.password_hash):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= LOGIN_MAX_ATTEMPTS:
            user.locked_until = now + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
            user.failed_login_attempts = 0  # fresh attempts after the lock expires
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Password verified: clear counters before issuing any tokens (also before
    # the 2FA temp token, since the password is proven at this point).
    user.failed_login_attempts = 0
    user.locked_until = None
    db.commit()

    # If 2FA is enabled, return a temp token instead of real tokens
    if user.totp_enabled:
        temp_token = create_temp_2fa_token(data={"sub": user.id})
        return {
            "requires_2fa": True,
            "temp_token": temp_token,
            "user_id": user.id,
        }

    tokens = _create_tokens(user, db)
    response = JSONResponse(content={
        "user": _user_dict(user),
        "access_token": tokens["access_token"],
        "token_type": "bearer",
    })
    _set_refresh_token_cookie(response, tokens["refresh_token"])
    return response


def _verify_firebase_id_token(token: str) -> dict:
    """Firebase ID token-ін Google-дың ашық кілттерімен тексеру (service account керек емес)."""
    from google.oauth2 import id_token as google_id_token
    from google.auth.transport import requests as google_requests

    project_id = os.getenv("FIREBASE_PROJECT_ID", "")
    if not project_id:
        raise HTTPException(status_code=503, detail="Firebase sign-in is not configured")
    try:
        claims = google_id_token.verify_firebase_token(token, google_requests.Request(), audience=project_id)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Firebase token")
    if not claims or claims.get("iss") != f"https://securetoken.google.com/{project_id}":
        raise HTTPException(status_code=401, detail="Invalid Firebase token")
    return claims


def _unique_username(db: Session, *candidates: str) -> str:
    """Google атынан/email-ден UserRegister үлгісіне сай бос username құрастыру."""
    base = ""
    for raw in candidates:
        cleaned = re.sub(r"[^a-zA-Z0-9_Ѐ-ӿ]", "", (raw or "").replace(" ", "_"))[:40]
        if len(cleaned) >= 2:
            base = cleaned
            break
    if not base:
        base = "user"
    username = base
    while db.query(User).filter(User.username == username).first():
        username = f"{base}_{secrets.randbelow(10_000):04d}"
    return username


@router.post("/auth/firebase")
@limiter.limit("10/minute")
async def firebase_login(request: Request, body: FirebaseLogin, db: Session = Depends(get_db)):
    """Firebase (Google) арқылы кіру/тіркелу: аккаунт email бойынша табылады немесе жаңадан ашылады."""
    claims = await run_in_threadpool(_verify_firebase_id_token, body.id_token)

    email = (claims.get("email") or "").strip().lower()
    # Расталмаған email-мен бөтен аккаунтқа кіріп кетпес үшін
    if not email or not claims.get("email_verified"):
        raise HTTPException(status_code=400, detail="Email is not verified")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        try:
            user_id = generate_user_id()
            while db.query(User).filter(User.id == user_id).first():
                user_id = generate_user_id()
            user = User(
                id=user_id,
                username=_unique_username(db, claims.get("name", ""), email.split("@")[0]),
                email=email,
                password_hash=None,  # құпия сөзді кейін "Құпия сөзді ұмыттыңыз ба?" арқылы қоюға болады
                avatar=None,
            )
            db.add(user)
            db.commit()
        except Exception as e:
            import logging
            logging.getLogger("codo_hub").error(f"Firebase registration error: {e}")
            db.rollback()
            raise HTTPException(status_code=500, detail="Registration failed")

    if user.totp_enabled:
        temp_token = create_temp_2fa_token(data={"sub": user.id})
        return {
            "requires_2fa": True,
            "temp_token": temp_token,
            "user_id": user.id,
        }

    tokens = _create_tokens(user, db)
    response = JSONResponse(content={
        "user": _user_dict(user),
        "access_token": tokens["access_token"],
        "token_type": "bearer",
    })
    _set_refresh_token_cookie(response, tokens["refresh_token"])
    return response


@router.post("/auth/refresh")
@limiter.limit("20/minute")
async def refresh_token(request: Request, db: Session = Depends(get_db)):
    # CSRF protection: double-submit cookie pattern
    csrf_cookie = request.cookies.get(CSRF_TOKEN_COOKIE)
    csrf_header = request.headers.get("X-CSRF-Token")
    if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_cookie, csrf_header):
        raise HTTPException(status_code=403, detail="CSRF validation failed")

    # Read refresh token from HttpOnly cookie
    refresh_token_value = request.cookies.get(REFRESH_TOKEN_COOKIE)

    if not refresh_token_value:
        raise HTTPException(status_code=401, detail="Refresh token required")

    try:
        payload = decode_token(refresh_token_value)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Validate the refresh token hash. A mismatch means either the token was
    # already rotated (stale), or it was forged. We can't tell the two apart,
    # so treat ANY mismatch as reuse and revoke the whole session — this also
    # kills the live access token (strict session check in resolve_access_user).
    if not user.refresh_token_hash or not verify_refresh_token(refresh_token_value, user.refresh_token_hash):
        user.session_id = None
        user.refresh_token_hash = None
        db.commit()
        response = JSONResponse(status_code=401, content={"detail": "Refresh token revoked"})
        _clear_refresh_token_cookie(response)
        return response

    # Defensive: never mint an access token with a None session_id.
    if user.session_id is None:
        user.refresh_token_hash = None
        db.commit()
        response = JSONResponse(status_code=401, content={"detail": "Session revoked"})
        _clear_refresh_token_cookie(response)
        return response

    # Issue new access token (keeps the existing session_id, so the live
    # access token stays valid across refreshes).
    access_token = create_access_token(
        data={"sub": user.id, "username": user.username, "session_id": user.session_id}
    )

    # Refresh token rotation: issue a new refresh token so the session
    # never expires as long as the user is active (refreshing every 5 min).
    # The old refresh token is invalidated by overwriting its hash.
    new_refresh_token = create_refresh_token(data={"sub": user.id})
    user.refresh_token_hash = hash_refresh_token(new_refresh_token)
    db.commit()

    response = JSONResponse(content={
        "access_token": access_token,
        "token_type": "bearer",
    })
    # Set the new refresh token cookie (replaces the old one)
    _set_refresh_token_cookie(response, new_refresh_token)
    return response


@router.post("/auth/logout")
@limiter.limit("30/minute")
async def logout(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.session_id = None
    user.refresh_token_hash = None
    db.commit()
    response = JSONResponse(content={"message": "Logged out successfully"})
    _clear_refresh_token_cookie(response)
    return response


@router.post("/auth/change-password")
@limiter.limit("5/minute")
async def change_password(
    request: Request,
    body: ChangePassword,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not body.currentPassword:
        raise HTTPException(status_code=400, detail="Current password is required")
    if len(body.newPassword) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if not any(c.isupper() for c in body.newPassword):
        raise HTTPException(status_code=400, detail="New password must contain at least one uppercase letter")
    if not any(c.isdigit() for c in body.newPassword):
        raise HTTPException(status_code=400, detail="New password must contain at least one digit")

    if not user.password_hash or not verify_password(body.currentPassword, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    user.password_hash = hash_password(body.newPassword)
    # Invalidate sessions after password change
    user.session_id = None
    user.refresh_token_hash = None
    db.commit()

    return {"message": "Password changed successfully. Please log in again."}


@router.post("/auth/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(request: Request, forgot_request: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == forgot_request.email.strip().lower()).first()
    if not user:
        # Don't reveal whether email exists
        return {"message": "If the email exists, a reset link has been sent."}

    token = secrets.token_urlsafe(32)
    reset = PasswordReset(
        id=str(uuid.uuid4()),
        user_id=user.id,
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    db.add(reset)
    db.commit()

    # Send password reset email
    from utils.email import send_password_reset_email
    email_sent = send_password_reset_email(
        to_email=user.email,
        token=token,
        username=user.username,
    )

    if not email_sent:
        import logging
        logging.getLogger("codo_hub").warning(
            "Password reset email could not be sent to %s. "
            "SMTP may not be configured. Reset token: %s",
            user.email, token,
        )

    return {
        "message": "If the email exists, a reset link has been sent.",
    }


@router.post("/auth/reset-password")
@limiter.limit("5/minute")
async def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not any(c.isupper() for c in body.new_password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not any(c.isdigit() for c in body.new_password):
        raise HTTPException(status_code=400, detail="Password must contain at least one digit")

    reset_entry = db.query(PasswordReset).filter(
        PasswordReset.token == body.token,
        PasswordReset.used == False,
    ).first()

    if not reset_entry:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    if reset_entry.expires_at and datetime.now(timezone.utc).replace(tzinfo=None) > _naive_utc(reset_entry.expires_at):
        raise HTTPException(status_code=400, detail="Reset token has expired")

    user = db.query(User).filter(User.id == reset_entry.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = hash_password(body.new_password)
    user.session_id = None
    user.refresh_token_hash = None
    reset_entry.used = True
    db.commit()

    return {"message": "Password reset successfully"}


# ── 2FA endpoints ──

@router.post("/auth/2fa/setup")
@limiter.limit("5/minute")
async def setup_2fa(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is already enabled")

    from utils.totp import generate_totp_secret, get_totp_uri

    secret = generate_totp_secret()
    user.totp_secret = secret
    db.commit()

    uri = get_totp_uri(secret, user.email)
    return {
        "secret": secret,
        "uri": uri,
    }


@router.post("/auth/2fa/verify-setup")
@limiter.limit("5/minute")
async def verify_2fa_setup(
    request: Request,
    two_fa_request: TwoFASetupVerify,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from utils.totp import verify_totp_code, generate_recovery_codes, hash_recovery_code
    import json

    if not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA not set up. Call /auth/2fa/setup first.")

    if not verify_totp_code(user.totp_secret, two_fa_request.code):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    user.totp_enabled = True
    codes = generate_recovery_codes()
    user.recovery_codes = json.dumps([hash_recovery_code(c) for c in codes])
    db.commit()

    return {
        "message": "2FA enabled successfully",
        "recovery_codes": codes,
    }


@router.post("/auth/2fa/disable")
@limiter.limit("5/minute")
async def disable_2fa(
    request: Request,
    two_fa_request: TwoFADisable,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled")

    if not user.password_hash or not verify_password(two_fa_request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect password")

    user.totp_secret = None
    user.totp_enabled = False
    user.recovery_codes = None
    db.commit()

    return {"message": "2FA disabled successfully"}


@router.post("/auth/2fa/verify")
@limiter.limit("5/minute")
async def verify_2fa_login(request: Request, two_fa_request: TwoFALoginVerify, db: Session = Depends(get_db)):
    from utils.totp import verify_totp_code, verify_recovery_code
    import json

    try:
        payload = decode_token(two_fa_request.temp_token)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Invalid or expired 2FA token")

    if payload.get("type") != "2fa_temp":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.totp_enabled:
        raise HTTPException(status_code=401, detail="User not found or 2FA not enabled")

    # Check TOTP code first
    code_valid = False
    if user.totp_secret and verify_totp_code(user.totp_secret, two_fa_request.code):
        code_valid = True
    else:
        # Check recovery codes
        if user.recovery_codes:
            try:
                stored_codes = json.loads(user.recovery_codes)
                for i, hashed in enumerate(stored_codes):
                    if verify_recovery_code(two_fa_request.code, hashed):
                        # Remove used recovery code
                        stored_codes.pop(i)
                        user.recovery_codes = json.dumps(stored_codes) if stored_codes else None
                        db.commit()
                        code_valid = True
                        break
            except (json.JSONDecodeError, ValueError):
                pass

    if not code_valid:
        raise HTTPException(status_code=400, detail="Invalid 2FA code")

    tokens = _create_tokens(user, db)
    response = JSONResponse(content={
        "user": _user_dict(user),
        "access_token": tokens["access_token"],
        "token_type": "bearer",
    })
    _set_refresh_token_cookie(response, tokens["refresh_token"])
    return response