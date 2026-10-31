"""JWT authentication utilities"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from jose import jwt, JWTError

from config import (
    JWT_SECRET_KEY, JWT_ALGORITHM,
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_REFRESH_TOKEN_EXPIRE_DAYS,
    JWT_2FA_TEMP_TOKEN_EXPIRE_MINUTES,
)
from db import get_db, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(days=JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    )
    # jti makes every refresh token unique even when minted in the same second
    # (same `sub`, same `exp`), so rotation actually produces a distinct token
    # and reuse detection can tell an old token from the new one.
    to_encode.update({"exp": expire, "type": "refresh", "jti": secrets.token_hex(16)})
    return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_temp_2fa_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_2FA_TEMP_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "2fa_temp"})
    return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


def resolve_access_user(token: str, db: Session) -> User:
    """Validate an access JWT and return the live User, or raise HTTPException(401).

    Single source of truth for access-token validation, shared by
    ``get_current_user``, ``get_optional_user`` and the WebSocket handlers.
    """
    payload = decode_token(token)  # raises 401 on JWTError / expired
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id: str = payload.get("sub")
    token_session_id: str = payload.get("session_id")
    if user_id is None or token_session_id is None:
        # Defensive: every access token minted by _create_tokens carries a
        # session_id. A token without one is malformed or a legacy/forged token.
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    # Strict session check. Previous logic used a falsy guard
    # (`if session_id and user.session_id and ...`) which let tokens through
    # after logout / password change / reset (where user.session_id is None).
    # Now: user.session_id is None  => session revoked => reject
    #      token_session_id != stored => logged in elsewhere => reject
    if user.session_id is None or token_session_id != user.session_id:
        raise HTTPException(
            status_code=401,
            detail="Session invalidated. Please log in again.",
        )

    return user


def _remember_viewer(request: Optional[Request], user: Optional[User]) -> None:
    """Жауаптағы файл сілтемелеріне кімнің атынан қол қою керегін есте сақтау
    (utils/signed_route.py — SignedMediaRoute)"""
    if request is not None and user is not None:
        request.state.viewer_id = str(user.id)


async def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    user = resolve_access_user(token, db)
    _remember_viewer(request, user)
    return user


async def get_optional_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
) -> Optional[User]:
    if token is None:
        return None
    try:
        user = resolve_access_user(token, db)
    except HTTPException:
        return None
    _remember_viewer(request, user)
    return user


async def get_upload_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Жоба жүктеу маршруттары үшін: сайттағы access JWT немесе терминалдың CLI кілті (codo_…).
    CLI кілті тек осы dependency бар маршруттарда жарайды"""
    from services.cli_token_service import CliTokenService

    if CliTokenService.is_cli_token(token):
        resolved = CliTokenService.resolve(db, token)
        if resolved is None:
            raise HTTPException(
                status_code=401,
                detail="CLI кілті жарамсыз немесе өшірілген",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user, row = resolved
        user.cli_site = row.site  # /cli/whoami үшін: CLI жобаның сайттағы сілтемесін шығарады
        return user
    return resolve_access_user(token, db)


async def verify_user_access(
    user_id: str,
    current_user: User = Depends(get_current_user),
) -> User:
    """Verify that the authenticated user matches the requested user_id.
    Raises 403 Forbidden if they don't match."""
    if str(current_user.id) != str(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you can only access your own resources",
        )
    return current_user