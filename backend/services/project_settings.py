"""Баптаулар → «Жобалар»: жаңа жобалардың әдепкі күйі (ашық/жабық)"""
from typing import Optional


def get_default_private(user_id: str) -> bool:
    from db import SessionLocal, User
    db = SessionLocal()
    try:
        row = db.query(User.projects_private).filter(User.id == user_id).first()
    finally:
        db.close()
    return bool(row and row[0])


def set_default_private(user_id: str, value: bool) -> bool:
    from db import SessionLocal, User
    db = SessionLocal()
    try:
        db.query(User).filter(User.id == user_id).update({User.projects_private: bool(value)})
        db.commit()
    finally:
        db.close()
    return bool(value)


def resolve_private(explicit: Optional[bool], user_id: str) -> bool:
    """Жүктеушінің нақты таңдауы болса — сол; болмаса — иесінің әдепкі баптауы"""
    if isinstance(explicit, bool):
        return explicit
    return get_default_private(user_id)
