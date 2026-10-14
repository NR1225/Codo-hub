"""Contact form API - receive and store contact messages"""
import os
import json
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from config import DATA_DIR

limiter = Limiter(key_func=get_remote_address)

router = APIRouter()

CONTACT_MESSAGES_FILE = os.path.join(DATA_DIR, "contact_messages.json")

# Ensure data directory exists
os.makedirs(DATA_DIR, exist_ok=True)


class ContactMessage(BaseModel):
    name: str = Field(max_length=200)
    email: EmailStr
    subject: str = Field(max_length=200)
    message: str


def _load_messages() -> list:
    """Load contact messages from JSON file."""
    path = Path(CONTACT_MESSAGES_FILE)
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def _save_messages(messages: list):
    """Save contact messages to JSON file atomically."""
    path = Path(CONTACT_MESSAGES_FILE)
    temp_path = path.with_suffix(".tmp")
    try:
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(messages, f, ensure_ascii=False, indent=2)
        temp_path.replace(path)
    except OSError as e:
        raise HTTPException(status_code=500, detail="Failed to send message. Please try again later.")


@router.post("/contact")
@limiter.limit("1/minute")
async def submit_contact_form(request: Request, data: ContactMessage):
    """Submit a contact form message."""
    # Validate message length
    if len(data.message.strip()) < 10:
        raise HTTPException(status_code=400, detail="Message must be at least 10 characters long")
    if len(data.message) > 5000:
        raise HTTPException(status_code=400, detail="Message must be less than 5000 characters")
    if len(data.subject.strip()) < 3:
        raise HTTPException(status_code=400, detail="Subject must be at least 3 characters long")

    messages = _load_messages()

    new_message = {
        "id": f"msg_{len(messages) + 1}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
        "name": data.name.strip(),
        "email": data.email,
        "subject": data.subject.strip(),
        "message": data.message.strip(),
        "createdAt": datetime.utcnow().isoformat(),
        "read": False,
    }

    messages.append(new_message)
    _save_messages(messages)

    return {"success": True, "message": "Contact form submitted successfully"}