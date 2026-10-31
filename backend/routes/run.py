"""Жобаны кодты көру бетінде іске қосу: файлдарды нақты URL-мен беру.

Қауіпсіздік: жауаптарға main.py-дағы middleware «Content-Security-Policy: sandbox» қояды —
құжаттың origin-і бос болады, сондықтан жоба коды сайттың cookie/localStorage-іне,
API-ге қолданушы атынан қол жеткізе алмайды (тікелей ашылса да).
"""
import base64
import hashlib
import hmac
import re
import time
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from slowapi import Limiter
from slowapi.util import get_remote_address

from services.code_run_service import run_info, serve
from services.code_service import CodeService
from utils.auth import get_optional_user
from db import User
from config import JWT_SECRET_KEY

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


# Жабық жоба: /run/<id>/~<қолданушы>.<мерзімі>.<қолтаңба>/<жол>. iframe кіру токенін жібермейді,
# сондықтан қарап отырған адам жолдың өзінде жазылады — сервер қол қойғандықтан оны ешкім
# қолдан жасай алмайды, ал рұқсат (иесі/мүшесі) әр сұраныста қайта тексеріледі
RUN_TOKEN_TTL = 6 * 3600
_RUN_TOKEN_RE = re.compile(r"^~([A-Za-z0-9_-]+)\.(\d{1,12})\.([0-9a-f]{32})$")


def _run_sig(code_id: str, user_part: str, exp: str) -> str:
    msg = f"run:{code_id}:{user_part}:{exp}".encode()
    return hmac.new(JWT_SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()[:32]


def run_token(code_id: str, username: str) -> str:
    user_part = base64.urlsafe_b64encode(username.encode()).decode().rstrip("=")
    exp = str(int(time.time()) + RUN_TOKEN_TTL)
    return f"~{user_part}.{exp}.{_run_sig(code_id, user_part, exp)}"


def _split_token(code_id: str, path: str) -> Tuple[Optional[str], str]:
    """Жолдың басындағы қолтаңбалы сегмент → (қолданушы аты не None, қалған жол)"""
    first, _, rest = path.partition("/")
    match = _RUN_TOKEN_RE.match(first)
    if not match:
        return None, path
    user_part, exp, sig = match.groups()
    if int(exp) < time.time() or not hmac.compare_digest(sig, _run_sig(code_id, user_part, exp)):
        return None, rest
    try:
        username = base64.urlsafe_b64decode(user_part + "=" * (-len(user_part) % 4)).decode()
    except (ValueError, UnicodeDecodeError):
        return None, rest
    return username, rest


def _code(code_id: str) -> dict:
    code = CodeService.find_code_by_id(code_id)
    # Жобаның ішкі файлы емес, жобаның өзі (немесе жеке файл) болуы керек
    if not code or code.get("folderId"):
        raise HTTPException(status_code=404, detail="Code file not found")
    return code


@router.get("/codes/{code_id}/run-info")
@limiter.limit("60/minute")
async def get_run_info(request: Request, code_id: str, viewer: Optional[User] = Depends(get_optional_user)):
    """Қалай іске қосылады: web (кіру файлы) / terminal / none.
    Жабық жобаны бөтен адам іске қоса алмайды; көре алатын адамға runToken беріледі —
    /run/ жолының басына қойылады (iframe токенсіз сұрайды)"""
    code = _code(code_id)
    username = viewer.username if viewer else None
    if not CodeService.can_view(code, username):
        raise HTTPException(status_code=404, detail="Code file not found")
    info = run_info(code)
    if code.get("isPrivate") and username:
        info["runToken"] = run_token(code["id"], username)
    return info


@router.get("/run/{code_id}/{path:path}")
@limiter.limit("1200/minute")
async def get_run_file(request: Request, code_id: str, path: str, file: Optional[str] = Query(None, max_length=1024)):
    code = _code(code_id)
    username, path = _split_token(code["id"], path)
    if not CodeService.can_view(code, username):
        raise HTTPException(status_code=404, detail="File not found")
    result = serve(code, path, file)
    if result is None:
        raise HTTPException(status_code=404, detail="File not found")
    data, mime = result
    return Response(content=data, media_type=mime, headers={"Cache-Control": "private, no-store" if code.get("isPrivate") else "no-cache"})
