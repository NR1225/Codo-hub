"""Password hashing utilities using bcrypt"""
import hashlib
import hmac
import secrets

import bcrypt


def hash_password(password: str) -> str:
    """Hash a password using bcrypt"""
    if not password:
        return ""
    # bcrypt has a 72-byte limit, truncate if necessary
    pwd_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a hash"""
    if not password or not password_hash:
        return False
    try:
        pwd_bytes = password.encode('utf-8')[:72]
        return bcrypt.checkpw(pwd_bytes, password_hash.encode('utf-8'))
    except Exception:
        return False


# --- Refresh-token hashing ---
# Refresh tokens are long JWTs, not user passwords. bcrypt silently truncates
# input to 72 bytes, and two refresh tokens for the same user share their
# first ~72 bytes (JWT header + `sub` + the start of `exp`), so bcrypt would
# treat an old (rotated) token and the new one as equal — defeating rotation
# and reuse detection. Use a full-length SHA-256 instead.
# Legacy bcrypt-hashed refresh tokens (stored before this change, prefixed
# `$2`) are still accepted on verify so existing sessions aren't force-logged-
# out; rotation then rewrites them to the SHA-256 scheme.


def _pepper() -> bytes:
    """Server secret used to key the refresh-token hash (HMAC-SHA256).

    Falls back to a constant if JWT_SECRET isn't importable yet (e.g. during
    module import ordering); the DB is never accessed in that fallback path.
    """
    try:
        from config import JWT_SECRET_KEY
        return (JWT_SECRET_KEY or "").encode("utf-8")
    except Exception:
        return b"kazakh-hub-refresh-pepper"


def hash_refresh_token(token: str) -> str:
    """Hash a refresh token with HMAC-SHA256 (keyed with the JWT secret)."""
    if not token:
        return ""
    return hmac.new(_pepper(), token.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_refresh_token(token: str, stored_hash: str) -> bool:
    """Verify a refresh token against the stored hash.

    Accepts both the new HMAC-SHA256 scheme and legacy bcrypt hashes so
    existing sessions keep working until their next rotation.
    """
    if not token or not stored_hash:
        return False
    # Legacy bcrypt refresh-token hashes start with $2 (e.g. $2a$, $2b$).
    if stored_hash.startswith("$2"):
        return verify_password(token, stored_hash)
    expected = hash_refresh_token(token)
    return secrets.compare_digest(expected, stored_hash)
