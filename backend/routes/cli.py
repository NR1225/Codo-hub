"""Терминалдан жүктеу: CLI кілттерін басқару және codo.py скриптін беру.

Кілттерді тек сайттағы сессия басқарады (get_current_user) — CLI кілтімен жаңа кілт жасауға болмайды.
Жүктеудің өзі /codes/folder және /codes/{id}/files арқылы (utils/auth.get_upload_user).
"""
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from config import SITE_URL
from db import User, get_db
from services.cli_token_service import CliTokenService
from utils import upload_rules
from utils.auth import get_current_user, get_upload_user

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

_SCRIPT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cli", "codo.py")


def _cli_rules() -> dict:
    return {
        "junkDirs": sorted(upload_rules.JUNK_DIRS),
        "junkDirSuffixes": list(upload_rules.JUNK_DIR_SUFFIXES),
        "junkFiles": sorted(upload_rules.JUNK_FILES),
        "junkExtensions": sorted(upload_rules.JUNK_EXTENSIONS),
        "junkNameSuffixes": list(upload_rules.JUNK_NAME_SUFFIXES),
        "executableExtensions": sorted(upload_rules.EXECUTABLE_EXTENSIONS),
    }


class CliTokenCreate(BaseModel):
    name: str = Field(default="terminal", max_length=60)
    site: str = Field(default="", max_length=200)  # window.location.origin


@router.get("/cli/tokens")
@limiter.limit("30/minute")
async def list_cli_tokens(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"tokens": CliTokenService.list_tokens(db, user.id)}


@router.post("/cli/tokens")
@limiter.limit("10/minute")
async def create_cli_token(
    request: Request, body: CliTokenCreate,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Жаңа кілт — token өрісі тек осы жауапта бір рет беріледі"""
    try:
        return CliTokenService.create_token(db, user.id, body.name, body.site)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/cli/tokens/{token_id}")
@limiter.limit("30/minute")
async def revoke_cli_token(
    request: Request, token_id: str,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    if not CliTokenService.revoke_token(db, user.id, token_id):
        raise HTTPException(status_code=404, detail="Кілт табылмады")
    return {"message": "ok"}


class CliLoginStart(BaseModel):
    deviceName: str = Field(default="terminal", max_length=60)


class CliLoginApprove(BaseModel):
    code: str = Field(max_length=16)
    site: str = Field(default="", max_length=200)  # window.location.origin


class CliLoginPoll(BaseModel):
    secret: str = Field(max_length=100)


@router.post("/cli/login/start")
@limiter.limit("10/minute")
async def cli_login_start(request: Request, body: CliLoginStart, db: Session = Depends(get_db)):
    """codo login: терминал осыны шақырып, браузерде url-ді ашады"""
    result = CliTokenService.start_login(db, body.deviceName)
    result["url"] = f"{SITE_URL}/cli/login?code={result['code']}"
    return result


@router.get("/cli/login/{code}")
@limiter.limit("30/minute")
async def cli_login_info(request: Request, code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return CliTokenService.login_info(db, code)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/cli/login/approve")
@limiter.limit("10/minute")
async def cli_login_approve(
    request: Request, body: CliLoginApprove,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Тек сайттағы сессиямен: «Рұқсат беру» батырмасы"""
    try:
        return CliTokenService.approve_login(db, user.id, body.code, body.site)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/cli/login/poll")
@limiter.limit("60/minute")
async def cli_login_poll(request: Request, body: CliLoginPoll, db: Session = Depends(get_db)):
    return CliTokenService.poll_login(db, body.secret)


@router.get("/cli/whoami")
@limiter.limit("30/minute")
async def cli_whoami(request: Request, user: User = Depends(get_upload_user)):
    """codo: кілттің кімдікі екенін тексеру; site — жоба сілтемесі үшін (кілт CLI-дікі болса)"""
    return {"id": user.id, "username": user.username, "site": getattr(user, "cli_site", None)}


@router.get("/cli/codo.py")
@limiter.limit("30/minute")
async def download_cli(request: Request):
    """codo.py скрипті — сервер адресі ішіне жазылып беріледі (--api керек емес)"""
    try:
        with open(_SCRIPT_PATH, encoding="utf-8") as f:
            script = f.read()
    except OSError:
        raise HTTPException(status_code=404, detail="CLI script not found")
    # Cloud Run TLS-ті алдында аяқтайды, сондықтан схеманы X-Forwarded-Proto-дан аламыз
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("host") or request.url.netloc
    script = script.replace("__CODO_API_URL__", f"{scheme}://{host}/api", 1)
    # Қоқыс ережелерінің жалғыз көзі — utils/upload_rules.py (JSON жолы Python жолы ретінде де жарамды)
    script = script.replace('"__CODO_RULES__"', json.dumps(json.dumps(_cli_rules())), 1)
    # «irm … | python -»: Windows PowerShell 5.1 құбырға ASCII жібереді — қазақ әріптері «?» болмауы
    # үшін ASCII емес таңбалар \uXXXX түрінде беріледі (скриптте bytes/raw жолдарда кириллица жоқ)
    script = script.encode("ascii", "backslashreplace").decode("ascii")
    return Response(
        content=script,
        media_type="text/x-python; charset=ascii",
        headers={"Content-Disposition": 'attachment; filename="codo.py"'},
    )
