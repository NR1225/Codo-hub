"""Терминалдан жүктеуге арналған CLI кілттері (codo_…).

Кілт тек жасалған сәтте бір рет көрсетіледі; базада SHA-256 хэші ғана сақталады.
Кілт тек жоба жүктеуге жарайды (utils/auth.get_upload_user) — аккаунт баптауларына, чатқа т.б. кірмейді.
Пароль ауысса немесе қалпына келтірілсе — барлық кілт жойылады.

`codo login` (device flow, GitHub CLI сияқты): терминал start → браузерде /cli/login?code=… бетінде
қолданушы «Рұқсат беру» басады (approve) → терминал poll арқылы кілтті алады. Кілт базаға
ашық түрде жазылмайды: ол poll сәтінде жасалып, бірден терминалға беріледі.
"""
import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from db import CliLoginRequest, CliToken, User

TOKEN_PREFIX = "codo_"
MAX_TOKENS_PER_USER = 10
# last_used_at әр сұрауда емес, осынша секундта бір рет жазылады (бөліктеп жүктеуде базаны жүктемейді)
_TOUCH_INTERVAL_SECONDS = 60
LOGIN_TTL_SECONDS = 600
# Экрандағы код: шатастыратын таңбаларсыз (0/O, 1/I/L жоқ), мыс. «KQ7D-M4XP»
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_SITE_RE = re.compile(r"https?://[A-Za-z0-9.\-]+(:\d+)?")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() + "Z" if value else None  # UTC — браузер жергілікті уақытқа аударады


def _to_dict(row: CliToken) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "prefix": row.prefix,
        "createdAt": _iso(row.created_at),
        "lastUsedAt": _iso(row.last_used_at),
    }


class CliTokenService:
    @staticmethod
    def is_cli_token(token: Optional[str]) -> bool:
        return bool(token) and token.startswith(TOKEN_PREFIX)

    @staticmethod
    def list_tokens(db: Session, user_id: str) -> List[dict]:
        rows = (
            db.query(CliToken)
            .filter(CliToken.user_id == user_id)
            .order_by(CliToken.created_at.desc())
            .all()
        )
        return [_to_dict(row) for row in rows]

    @staticmethod
    def create_token(db: Session, user_id: str, name: str, site: Optional[str] = None) -> dict:
        name = (name or "").strip()[:60] or "terminal"
        site = (site or "").strip().rstrip("/")
        if not _SITE_RE.fullmatch(site):
            site = None
        count = db.query(CliToken).filter(CliToken.user_id == user_id).count()
        if count >= MAX_TOKENS_PER_USER:
            raise ValueError(f"Ең көбі {MAX_TOKENS_PER_USER} кілт жасауға болады — ескісін өшіріңіз")
        token = TOKEN_PREFIX + secrets.token_urlsafe(32)
        row = CliToken(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=name,
            prefix=token[:12],
            token_hash=_hash(token),
            site=site,
            created_at=_now(),
        )
        db.add(row)
        db.commit()
        return {**_to_dict(row), "token": token}

    @staticmethod
    def revoke_token(db: Session, user_id: str, token_id: str) -> bool:
        deleted = (
            db.query(CliToken)
            .filter(CliToken.id == token_id, CliToken.user_id == user_id)
            .delete()
        )
        db.commit()
        return deleted > 0

    @staticmethod
    def revoke_all(db: Session, user_id: str) -> None:
        """Пароль ауысқанда/аккаунт өшкенде — commit-ті шақырушы жасайды"""
        db.query(CliToken).filter(CliToken.user_id == user_id).delete()

    @staticmethod
    def resolve(db: Session, token: str) -> Optional[tuple]:
        """(User, CliToken) немесе None"""
        row = db.query(CliToken).filter(CliToken.token_hash == _hash(token)).first()
        if row is None:
            return None
        user = db.query(User).filter(User.id == row.user_id).first()
        if user is None:
            return None
        now = _now()
        if row.last_used_at is None or (now - row.last_used_at).total_seconds() > _TOUCH_INTERVAL_SECONDS:
            row.last_used_at = now
            db.commit()
        return user, row

    # ---------- codo login (device flow) ----------

    @staticmethod
    def start_login(db: Session, device_name: str) -> dict:
        now = _now()
        db.query(CliLoginRequest).filter(CliLoginRequest.expires_at < now).delete()
        secret = secrets.token_urlsafe(32)
        while True:
            raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
            code = f"{raw[:4]}-{raw[4:]}"
            if not db.query(CliLoginRequest).filter(CliLoginRequest.user_code == code).first():
                break
        db.add(CliLoginRequest(
            id=_hash(secret),
            user_code=code,
            device_name=(device_name or "").strip()[:60] or "terminal",
            created_at=now,
            expires_at=now + timedelta(seconds=LOGIN_TTL_SECONDS),
        ))
        db.commit()
        return {"secret": secret, "code": code, "expiresIn": LOGIN_TTL_SECONDS}

    @staticmethod
    def _pending(db: Session, code: str) -> CliLoginRequest:
        code = (code or "").strip().upper()
        row = db.query(CliLoginRequest).filter(CliLoginRequest.user_code == code).first()
        if row is None or row.expires_at < _now():
            raise ValueError("Код жарамсыз немесе мерзімі өтті — терминалда codo login-ды қайта іске қосыңыз")
        return row

    @staticmethod
    def login_info(db: Session, code: str) -> dict:
        row = CliTokenService._pending(db, code)
        return {"code": row.user_code, "deviceName": row.device_name, "approved": row.user_id is not None}

    @staticmethod
    def approve_login(db: Session, user_id: str, code: str, site: Optional[str]) -> dict:
        row = CliTokenService._pending(db, code)
        if row.user_id is not None and row.user_id != user_id:
            raise ValueError("Бұл кодқа басқа аккаунт рұқсат берген")
        site = (site or "").strip().rstrip("/")
        row.user_id = user_id
        row.site = site if _SITE_RE.fullmatch(site) else None
        db.commit()
        return {"deviceName": row.device_name}

    @staticmethod
    def poll_login(db: Session, secret: str) -> dict:
        """pending | expired | approved (+ token, username, site) — approved бір рет қана беріледі"""
        row = db.query(CliLoginRequest).filter(CliLoginRequest.id == _hash(secret or "")).first()
        if row is None or row.expires_at < _now():
            return {"status": "expired"}
        if row.user_id is None:
            return {"status": "pending"}
        user = db.query(User).filter(User.id == row.user_id).first()
        db.delete(row)
        if user is None:
            db.commit()
            return {"status": "expired"}
        # Сол құрылғыдан қайта кірсе — ескі кілті ауыстырылады (кілттер шегіне толып қалмауы үшін)
        db.query(CliToken).filter(CliToken.user_id == user.id, CliToken.name == row.device_name).delete()
        db.commit()
        created = CliTokenService.create_token(db, user.id, row.device_name, row.site)
        return {"status": "approved", "token": created["token"], "username": user.username, "site": row.site}
