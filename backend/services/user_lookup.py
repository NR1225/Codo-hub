"""Қолданушының ашық деректерін табу (id, username, avatar).

Тіркелген қолданушылар SQL-де (db.User) сақталады; ескі users.json тек
көшірілмеген қолданушылар үшін қосалқы көз ретінде қалады.
"""
from typing import Any, Dict, Optional

from database import users as json_users
from db import SessionLocal, User


def find_public_user(user_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    db = SessionLocal()
    try:
        row = db.query(User).filter(User.id == user_id).first()
        if row:
            return {"id": row.id, "username": row.username, "avatar": row.avatar}
    finally:
        db.close()
    legacy = next((u for u in json_users if u.get("id") == user_id), None)
    if legacy:
        return {"id": legacy["id"], "username": legacy.get("username", ""), "avatar": legacy.get("avatar")}
    return None
