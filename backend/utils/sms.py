"""SMS verification helpers: phone normalisation, code hashing, sending, Firebase check"""
import hashlib
import hmac
import logging
import re
import secrets

import httpx

from config import (
    JWT_SECRET_KEY,
    SMS_PROVIDER,
    MOBIZON_API_KEY,
    MOBIZON_API_DOMAIN,
    MOBIZON_SENDER,
)

logger = logging.getLogger("kazakh_hub")


def normalize_phone(raw: str) -> str:
    """Return the phone in E.164 (`+77011234567`) or raise ValueError.

    Kazakhstan numbers may be typed as 8 701 ..., 7701..., 701... (10 digits);
    anything else must already carry its country code.
    """
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 11 and digits.startswith("8"):
        digits = "7" + digits[1:]
    elif len(digits) == 10 and digits.startswith("7"):
        digits = "7" + digits
    if not 10 <= len(digits) <= 15:
        raise ValueError("Invalid phone number")
    return "+" + digits


def generate_sms_code() -> str:
    return "".join(str(secrets.randbelow(10)) for _ in range(6))


def hash_sms_code(phone: str, code: str) -> str:
    # Keyed hash: a leaked DB row can't be brute-forced offline without the secret.
    return hmac.new(JWT_SECRET_KEY.encode(), f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def verify_sms_code(phone: str, code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_sms_code(phone, code), code_hash)


def send_sms(phone: str, text: str) -> bool:
    """Send an SMS via the configured backend provider. Returns True on success."""
    if SMS_PROVIDER == "console":
        logger.warning("SMS_PROVIDER=console — SMS to %s: %s", phone, text)
        return True

    if SMS_PROVIDER == "mobizon":
        if not MOBIZON_API_KEY:
            logger.error("MOBIZON_API_KEY is not set")
            return False
        params = {
            "output": "json",
            "api": "v1",
            "apiKey": MOBIZON_API_KEY,
        }
        data = {"recipient": phone.lstrip("+"), "text": text}
        if MOBIZON_SENDER:
            data["from"] = MOBIZON_SENDER
        try:
            resp = httpx.post(
                f"https://{MOBIZON_API_DOMAIN}/service/message/sendsmsmessage",
                params=params,
                data=data,
                timeout=10,
            )
            body = resp.json()
        except (httpx.HTTPError, ValueError) as e:
            logger.error("Mobizon request failed: %s", e)
            return False
        if body.get("code") != 0:
            logger.error("Mobizon error %s: %s", body.get("code"), body.get("message"))
            return False
        return True

    logger.error("SMS_PROVIDER=%s cannot send SMS from the backend", SMS_PROVIDER)
    return False


def verify_firebase_phone_token(id_token: str) -> str:
    """Verify a Firebase Auth ID token from phone sign-in; return its E.164 phone.

    Raises ValueError if the token is invalid or carries no phone number.
    """
    try:
        import firebase_admin
        from firebase_admin import auth as fb_auth
    except ImportError:
        raise ValueError("Firebase Admin SDK not installed")

    if not firebase_admin._apps:
        # firestore_sync.init_firestore normally initialises the default app
        # from serviceAccountKey.json at startup.
        raise ValueError("Firebase Admin is not initialised (serviceAccountKey.json missing?)")

    try:
        claims = fb_auth.verify_id_token(id_token)
    except Exception as e:
        raise ValueError(f"Invalid Firebase token: {e}")

    phone = claims.get("phone_number")
    if not phone:
        raise ValueError("Firebase token has no phone number")
    return normalize_phone(phone)
