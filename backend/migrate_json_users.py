"""Migrate users from JSON files to SQL database"""
import json
import os
from db import SessionLocal, User


def migrate_json_users():
    """One-time migration of JSON-stored users to SQL database"""
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    users_file = os.path.join(data_dir, "users.json")

    if not os.path.exists(users_file):
        print("No users.json found, skipping migration")
        return

    db = SessionLocal()
    try:
        # Load JSON users
        with open(users_file, 'r', encoding='utf-8') as f:
            json_users = json.load(f)
        if not json_users:
            print("No users in users.json, skipping migration")
            return

        migrated = 0
        skipped = 0

        for user_data in json_users:
            email = user_data.get("email", "").strip().lower()
            user_id = str(user_data.get("id", "")).lstrip("0") or user_data.get("id", "")

            if not email:
                continue

            # Check if already in SQL
            existing = db.query(User).filter(
                (User.email == email) | (User.id == user_id)
            ).first()

            if existing:
                skipped += 1
                continue

            new_user = User(
                id=user_id,
                username=user_data.get("username", email.split("@")[0]),
                email=email,
                password_hash=None,  # кіру тек email кодымен
                avatar=user_data.get("avatar"),
                bio=user_data.get("bio"),
            )
            db.add(new_user)
            migrated += 1

        if migrated > 0:
            db.commit()
            print(f"Migrated {migrated} users from JSON to SQL (skipped {skipped})")
        else:
            print(f"No new users to migrate (skipped {skipped})")

    except Exception as e:
        print(f"Migration error: {e}")
        db.rollback()
    finally:
        db.close()