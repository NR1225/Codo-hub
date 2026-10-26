"""Cloudflare Turnstile CAPTCHA тексерісі (тіркелу және кіру).

TURNSTILE_SECRET_KEY бос болса, CAPTCHA өшірулі: тексеріс әрқашан өтеді
(жергілікті даму). Прод-та кілтті орнатыңыз.
"""
import logging
from typing import Optional

import httpx

from config import TURNSTILE_SECRET_KEY

logger = logging.getLogger("kazakh_hub")

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_captcha(token: Optional[str], remote_ip: Optional[str] = None) -> bool:
    if not TURNSTILE_SECRET_KEY:
        return True
    if not token:
        return False

    data = {"secret": TURNSTILE_SECRET_KEY, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(SITEVERIFY_URL, data=data)
        result = resp.json()
    except Exception as e:
        # Cloudflare қолжетімсіз болса — қауіпсіз жақта қаламыз (өткізбейміз).
        logger.warning("Turnstile verification error: %s", e)
        return False

    if not result.get("success"):
        logger.info("Turnstile rejected token: %s", result.get("error-codes"))
        return False
    return True
