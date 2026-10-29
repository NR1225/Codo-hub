"""Жобаны кодты көру бетінде іске қосу: файлдарды нақты URL-мен беру.

Қауіпсіздік: жауаптарға main.py-дағы middleware «Content-Security-Policy: sandbox» қояды —
құжаттың origin-і бос болады, сондықтан жоба коды сайттың cookie/localStorage-іне,
API-ге қолданушы атынан қол жеткізе алмайды (тікелей ашылса да).
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from slowapi import Limiter
from slowapi.util import get_remote_address

from services.code_run_service import run_info, serve
from services.code_service import CodeService

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


def _code(code_id: str) -> dict:
    code = CodeService.find_code_by_id(code_id)
    # Жобаның ішкі файлы емес, жобаның өзі (немесе жеке файл) болуы керек
    if not code or code.get("folderId"):
        raise HTTPException(status_code=404, detail="Code file not found")
    return code


@router.get("/codes/{code_id}/run-info")
@limiter.limit("60/minute")
async def get_run_info(request: Request, code_id: str):
    """Қалай іске қосылады: web (кіру файлы) / terminal / none"""
    return run_info(_code(code_id))


@router.get("/run/{code_id}/{path:path}")
@limiter.limit("1200/minute")
async def get_run_file(request: Request, code_id: str, path: str, file: Optional[str] = Query(None, max_length=1024)):
    result = serve(_code(code_id), path, file)
    if result is None:
        raise HTTPException(status_code=404, detail="File not found")
    data, mime = result
    return Response(content=data, media_type=mime, headers={"Cache-Control": "no-cache"})
