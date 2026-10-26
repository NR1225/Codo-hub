"""Кодтар, жеке хабарламалар, достар және ескі қолданушылар қоймасы.

Сервистер жадтағы тізімдермен (`codes`, `messages`, ...) жұмыс істейді және
оларды орнында өзгертеді. `save_*` функциялары жадтағы күйді SQLite-қа
(db.py: codes, direct_messages, ...) синхрондайды: тек өзгерген жазбалар
жазылады, жоғалғандары өшіріледі — бәрі бір транзакцияда.

Бұрын бұл деректер backend/data/*.json файлдарында тұрған. Алғашқы іске
қосуда кесте бос болса, JSON импортталып, файл `*.json.migrated` болып
қайта аталады (сақтық көшірме ретінде қалады).
"""
import json
import logging
import os
from typing import Any, Callable, Dict, List

from config import (
    CODES_FILE, USERS_FILE, FRIENDS_FILE,
    MESSAGES_FILE, FRIEND_REQUESTS_FILE, FIRESTORE_SYNC_AVAILABLE,
    FIRESTORE_SYNC_CODE, FIRESTORE_SYNC_MESSAGE, FIRESTORE_DELETE_CODE
)
from db import (
    SessionLocal, CodeRecord, DirectMessageRecord, FriendRequestRecord,
    FriendListRecord, LegacyUserRecord,
)

logger = logging.getLogger("kazakh_hub")

# Global data storage
codes: List[Dict[str, Any]] = []
users: List[Dict[str, Any]] = []  # ескі users.json қолданушылары (тек көрсету үшін)
friends: Dict[str, List[str]] = {}
messages: List[Dict[str, Any]] = []
friend_requests: List[Dict[str, Any]] = []


class _Collection:
    """Жадтағы бір коллекция мен оның SQL кестесі арасындағы көпір.

    `_saved` — соңғы сақталған күй: {id: (seq, json)}. Сақтағанда жадтағы
    әр жазба осымен салыстырылады, сондықтан 1 код өзгерсе, 1 жол жазылады.
    """

    def __init__(self, name: str, model, json_file: str, columns: Callable[[Any], Dict[str, Any]]):
        self.name = name
        self.model = model
        self.json_file = json_file
        self.columns = columns
        self._saved: Dict[str, tuple] = {}
        self._next_seq = 0

    def load(self) -> List[tuple]:
        """[(id, value)] — seq бойынша реттелген. Кесте бос болса, JSON-нан импорттайды."""
        db = SessionLocal()
        try:
            rows = db.query(self.model.id, self.model.seq, self.model.data).order_by(self.model.seq).all()
        finally:
            db.close()

        if not rows and os.path.exists(self.json_file):
            return self._import_json()

        if rows and os.path.exists(self.json_file):
            logger.warning("%s: SQLite-та деректер бар, %s еленбейді", self.name, self.json_file)

        self._saved = {r.id: (r.seq, r.data) for r in rows}
        self._next_seq = (rows[-1].seq + 1) if rows else 0
        return [(r.id, json.loads(r.data)) for r in rows]

    def _import_json(self) -> List[tuple]:
        with open(self.json_file, "r", encoding="utf-8") as f:
            raw = json.load(f)
        items = list(raw.items()) if isinstance(raw, dict) else [(str(x.get("id")), x) for x in raw if x.get("id") is not None]
        self._saved = {}
        self._next_seq = 0
        self.sync(items)
        os.replace(self.json_file, self.json_file + ".migrated")
        logger.info("%s: %d жазба %s файлынан SQLite-қа көшірілді", self.name, len(items), os.path.basename(self.json_file))
        return items

    def sync(self, items: List[tuple]) -> tuple:
        """Жадтағы [(id, value)] күйін кестеге жазады. (өзгерген id-лер, өшірілген id-лер) қайтарады."""
        current: Dict[str, str] = {}
        values: Dict[str, Any] = {}
        for key, value in items:
            current[key] = json.dumps(value, ensure_ascii=False)
            values[key] = value

        changed = [k for k, s in current.items() if k not in self._saved or self._saved[k][1] != s]
        removed = [k for k in self._saved if k not in current]
        if not changed and not removed:
            return [], []

        saved = dict(self._saved)
        next_seq = self._next_seq
        db = SessionLocal()
        try:
            for key in changed:
                if key in saved:
                    seq = saved[key][0]
                else:
                    seq = next_seq
                    next_seq += 1
                db.merge(self.model(id=key, seq=seq, data=current[key], **self.columns(values[key])))
                saved[key] = (seq, current[key])
            for i in range(0, len(removed), 500):
                chunk = removed[i:i + 500]
                db.query(self.model).filter(self.model.id.in_(chunk)).delete(synchronize_session=False)
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

        for key in removed:
            saved.pop(key, None)
        self._saved = saved
        self._next_seq = next_seq
        return changed, removed


_codes = _Collection("codes", CodeRecord, CODES_FILE,
                     lambda c: {"author": c.get("author"), "folder_id": c.get("folderId")})
_messages = _Collection("messages", DirectMessageRecord, MESSAGES_FILE,
                        lambda m: {"from_user_id": m.get("fromUserId"), "to_user_id": m.get("toUserId")})
_friend_requests = _Collection("friend_requests", FriendRequestRecord, FRIEND_REQUESTS_FILE,
                               lambda r: {"from_user_id": r.get("fromUserId"), "to_user_id": r.get("toUserId")})
_friends = _Collection("friends", FriendListRecord, FRIENDS_FILE, lambda _: {})
_users = _Collection("legacy_users", LegacyUserRecord, USERS_FILE, lambda _: {})


def _by_id(items: List[Dict[str, Any]]) -> List[tuple]:
    return [(str(x["id"]), x) for x in list(items) if x.get("id") is not None]


def load_data():
    """Барлық коллекцияны SQLite-тан жадқа жүктеу (қажет болса JSON-нан бір рет көшіріп)"""
    for collection, target in ((_codes, codes), (_messages, messages),
                               (_friend_requests, friend_requests), (_users, users)):
        try:
            loaded = [value for _, value in collection.load()]
        except Exception as e:
            logger.error("Error loading %s: %s", collection.name, e)
            raise
        target.clear()
        target.extend(loaded)

    try:
        loaded_friends = dict(_friends.load())
    except Exception as e:
        logger.error("Error loading friends: %s", e)
        raise
    friends.clear()
    friends.update(loaded_friends)


def save_codes():
    """Кодтарды SQLite-қа сақтау; өзгергендерін Firestore-ға синхрондау"""
    changed, _ = _codes.sync(_by_id(codes))
    if changed and FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
        changed_ids = set(changed)
        try:
            for code in codes:
                if str(code.get("id")) in changed_ids:
                    FIRESTORE_SYNC_CODE(code)
        except Exception as e:
            logger.warning("Firestore sync failed: %s", e)


def save_users():
    """Ескі қолданушыларды сақтау"""
    _users.sync(_by_id(users))


def save_friends():
    """Достар тізімдерін сақтау"""
    _friends.sync([(str(k), v) for k, v in list(friends.items())])


def save_messages():
    """Жеке хабарламаларды SQLite-қа сақтау; өзгергендерін Firestore-ға синхрондау"""
    changed, _ = _messages.sync(_by_id(messages))
    if changed and FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_MESSAGE:
        changed_ids = set(changed)
        try:
            for message in messages:
                if str(message.get("id")) in changed_ids:
                    FIRESTORE_SYNC_MESSAGE(message)
        except Exception as e:
            logger.warning("Firestore messages sync failed: %s", e)


def save_friend_requests():
    """Достық өтінімдерін сақтау"""
    _friend_requests.sync(_by_id(friend_requests))
