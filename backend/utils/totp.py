"""TOTP (Time-based One-Time Password) utilities for 2FA"""
import secrets
import pyotp
from utils.password import hash_password, verify_password


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str) -> str:
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name="Codo Hub")


def verify_totp_code(secret: str, code: str) -> bool:
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


def generate_recovery_codes(count: int = 8) -> list:
    return [secrets.token_hex(4).upper() for _ in range(count)]


def hash_recovery_code(code: str) -> str:
    return hash_password(code)


def verify_recovery_code(code: str, hashed: str) -> bool:
    return verify_password(code, hashed)