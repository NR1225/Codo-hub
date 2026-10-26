"""Қолданушы құпияларын (мысалы, Бүркіттің API кілтін) базада шифрлап сақтау"""
import base64
import hashlib
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from config import BURKIT_ENCRYPTION_KEY

# Құпиядан Fernet кілтін шығару; префикс бұл кілтті JWT қолтаңбасынан бөліп тұрады
_fernet = Fernet(base64.urlsafe_b64encode(
    hashlib.sha256(b"kazakh-hub:secret-box:" + BURKIT_ENCRYPTION_KEY.encode()).digest()
))


def encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt(token: str) -> Optional[str]:
    """Шифрды ашу; құпия ауысқан немесе дерек бүлінген болса — None"""
    try:
        return _fernet.decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return None
