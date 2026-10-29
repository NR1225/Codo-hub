"""Қолданушы құпияларын (мысалы, Бүркіттің API кілтін) базада шифрлап сақтау"""
import base64
import hashlib
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from config import BURKIT_ENCRYPTION_KEY


def _derive(prefix: bytes) -> Fernet:
    return Fernet(base64.urlsafe_b64encode(
        hashlib.sha256(prefix + BURKIT_ENCRYPTION_KEY.encode()).digest()
    ))


# Құпиядан Fernet кілтін шығару; префикс бұл кілтті JWT қолтаңбасынан бөліп тұрады.
# Жаңа жазбалар codo-hub кілтімен шифрланады, ескі kazakh-hub жазбалары да ашылады.
_fernet = MultiFernet([_derive(b"codo-hub:secret-box:"), _derive(b"kazakh-hub:secret-box:")])


def encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt(token: str) -> Optional[str]:
    """Шифрды ашу; құпия ауысқан немесе дерек бүлінген болса — None"""
    try:
        return _fernet.decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return None
