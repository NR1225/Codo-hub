"""GitHub-тан жобаны сілтеме арқылы жүктеу.

Браузер codeload.github.com-нан ZIP-ті тікелей ала алмайды (CORS жоқ), сондықтан сервер
репозиторийдің архивін жүктеп, сол күйінде қайтарады. Әрі қарай фронт оны
кәдімгі ZIP сияқты өңдейді: қоқыс алынып тасталады, қорғалған файлдар белгіленеді.

Жабық репо үшін қолданушы GitHub профилін OAuth арқылы қосады (/github/connect →
github.com → фронттың /github/callback беті → POST /github/callback). Токен базада
шифрланып сақталады және тек сол қолданушының сұрауларында қолданылады.
"""
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
from urllib.parse import quote, urlencode, urlparse

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from config import (
    GITHUB_ARCHIVE_MAX_BYTES, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_TOKEN,
    JWT_ALGORITHM, JWT_SECRET_KEY, SITE_URL,
)
from db import User, get_db
from utils import secret_box
from utils.auth import get_current_user

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

API = "https://api.github.com"
# Архив тек осы хосттардан келеді — басқа жерге redirect болса, тоқтаймыз
ALLOWED_HOSTS = {"api.github.com", "codeload.github.com"}
OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
REPO_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
# /tree/<ref>/<subdir> ішінде ref-тің өзінде «/» болуы мүмкін — ең ұзынынан бастап тексереміз
MAX_REF_ATTEMPTS = 6
# Жабық репоны оқу үшін OAuth App-та «repo» рұқсаты керек (тек-оқу рұқсаты OAuth App-та жоқ)
OAUTH_SCOPE = "repo"
STATE_TTL = timedelta(minutes=10)
STATE_AUDIENCE = "github-connect"


def parse_github_url(raw: str) -> Tuple[str, str, List[str]]:
    """owner, repo және /tree/ (немесе /blob/) кейінгі бөліктерін қайтарады.
    Қабылданады: https://github.com/o/r, github.com/o/r.git, git@github.com:o/r.git, o/r"""
    url = raw.strip()
    if url.startswith("git@github.com:"):
        url = "https://github.com/" + url[len("git@github.com:"):]
    elif not re.match(r"^[a-z]+://", url, re.I):
        url = ("https://" + url) if url.lower().startswith(("github.com/", "www.github.com/")) else "https://github.com/" + url

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or (parsed.hostname or "").lower() not in ("github.com", "www.github.com"):
        raise HTTPException(status_code=400, detail="github_invalid_url")

    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="github_invalid_url")
    owner, repo = parts[0], parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not OWNER_RE.match(owner) or not REPO_RE.match(repo) or repo in (".", ".."):
        raise HTTPException(status_code=400, detail="github_invalid_url")

    rest = parts[3:] if len(parts) > 3 and parts[2] in ("tree", "blob") else []
    return owner, repo, rest


def _headers(token: Optional[str], accept: str = "application/vnd.github+json") -> dict:
    """token — қолданушының OAuth токені; жоқ болса серверлік GITHUB_TOKEN (тек ашық репо)"""
    headers = {"Accept": accept, "User-Agent": "Codo-Hub", "X-GitHub-Api-Version": "2022-11-28"}
    if token or GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {token or GITHUB_TOKEN}"
    return headers


def _user_token(user: User) -> Optional[str]:
    return secret_box.decrypt(user.github_token) if user.github_token else None


def _raise_for_api(resp: httpx.Response) -> None:
    if resp.status_code == 401:
        # Токенді қолданушы GitHub-та қайтарып алған — профильді қайта қосу керек
        raise HTTPException(status_code=409, detail="github_token_invalid")
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="github_not_found")
    if resp.status_code in (403, 429) and resp.headers.get("x-ratelimit-remaining") == "0":
        raise HTTPException(status_code=429, detail="github_rate_limited")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="github_unavailable")


async def _resolve_ref(
    client: httpx.AsyncClient, token: Optional[str], owner: str, repo: str, rest: List[str],
) -> Tuple[Optional[str], str]:
    """(commit sha, ішкі папка). rest бос болса — әдепкі тармақ (sha=None)"""
    if not rest:
        return None, ""
    for i in range(min(len(rest), MAX_REF_ATTEMPTS), 0, -1):
        candidate = "/".join(rest[:i])
        resp = await client.get(
            f"{API}/repos/{owner}/{repo}/commits/{quote(candidate, safe='')}",
            headers=_headers(token, "application/vnd.github.sha"),
        )
        if resp.status_code == 200:
            return resp.text.strip(), "/".join(rest[i:])
        if resp.status_code not in (404, 422):
            _raise_for_api(resp)
    raise HTTPException(status_code=404, detail="github_ref_not_found")


@router.get("/github/archive")
@limiter.limit("10/minute")
async def github_archive(
    request: Request,
    url: str = Query(..., min_length=3, max_length=500),
    user: User = Depends(get_current_user),
):
    """GitHub репозиторийінің ZIP архиві (профиль қосылған болса — жабығы да).
    X-Repo-* тақырыптары: жоба аты, ішкі папка, ref"""
    owner, repo, rest = parse_github_url(url)
    try:
        return await _download(_user_token(user), owner, repo, rest)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="github_unavailable")


async def _download(token: Optional[str], owner: str, repo: str, rest: List[str]) -> Response:
    timeout = httpx.Timeout(120, connect=10)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        meta = await client.get(f"{API}/repos/{owner}/{repo}", headers=_headers(token))
        _raise_for_api(meta)
        info = meta.json()
        # GitHub-тағы size — КБ; архив одан әдетте кіші, бірақ анық үлкен репоны бірден тоқтатамыз
        if int(info.get("size") or 0) * 1024 > GITHUB_ARCHIVE_MAX_BYTES * 4:
            raise HTTPException(status_code=413, detail="github_too_large")

        sha, subdir = await _resolve_ref(client, token, owner, repo, rest)
        ref = sha or info.get("default_branch") or "HEAD"

        # zipball → codeload-қа 302; redirect-ті қолмен өтіп, хостты тексереміз
        target = f"{API}/repos/{owner}/{repo}/zipball/{quote(ref, safe='')}"
        for _ in range(4):
            req = client.build_request("GET", target, headers=_headers(token))
            resp = await client.send(req, stream=True)
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("location", "")
                await resp.aclose()
                if urlparse(location).hostname not in ALLOWED_HOSTS or urlparse(location).scheme != "https":
                    raise HTTPException(status_code=502, detail="github_unavailable")
                target = location
                continue
            break
        else:
            raise HTTPException(status_code=502, detail="github_unavailable")

        try:
            if resp.status_code != 200:
                _raise_for_api(resp)
            declared = int(resp.headers.get("content-length") or 0)
            if declared > GITHUB_ARCHIVE_MAX_BYTES:
                raise HTTPException(status_code=413, detail="github_too_large")
            chunks: List[bytes] = []
            total = 0
            async for chunk in resp.aiter_bytes():
                total += len(chunk)
                if total > GITHUB_ARCHIVE_MAX_BYTES:
                    raise HTTPException(status_code=413, detail="github_too_large")
                chunks.append(chunk)
        finally:
            await resp.aclose()

    return Response(
        content=b"".join(chunks),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{repo}.zip"',
            "X-Repo-Name": info.get("name") or repo,
            "X-Repo-Subdir": quote(subdir),
            "X-Repo-Ref": quote(ref),
            "Cache-Control": "no-store",
        },
    )


# ---------- Профильді қосу (OAuth) ----------

class GithubCallback(BaseModel):
    code: str = Field(min_length=1, max_length=200)
    state: str = Field(min_length=1, max_length=2000)


def _configured() -> bool:
    return bool(GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)


def _status(user: User) -> dict:
    return {
        "configured": _configured(),
        "connected": bool(user.github_token),
        "login": user.github_login if user.github_token else None,
    }


def _redirect_uri() -> str:
    return f"{SITE_URL}/github/callback"


@router.get("/github/status")
@limiter.limit("60/minute")
async def github_status(request: Request, user: User = Depends(get_current_user)):
    return _status(user)


@router.get("/github/connect")
@limiter.limit("10/minute")
async def github_connect_url(
    request: Request,
    popup: bool = Query(False),
    returnTo: str = Query("/", max_length=300),
    user: User = Depends(get_current_user),
):
    """github.com-дағы рұқсат бетінің сілтемесі. state — осы қолданушыға байланған, 10 минуттық.
    popup — қосылым жеке терезеде (callback беті өзін жабады), әйтпесе returnTo-ға қайтамыз"""
    if not _configured():
        raise HTTPException(status_code=503, detail="github_not_configured")
    # Тек сайттың ішкі жолы — басқа доменге бағыттауға болмайды
    if not returnTo.startswith("/") or returnTo.startswith("//") or "\\" in returnTo:
        returnTo = "/"
    state = jwt.encode(
        {
            "sub": user.id,
            "aud": STATE_AUDIENCE,
            "nonce": secrets.token_urlsafe(12),
            "exp": datetime.now(timezone.utc) + STATE_TTL,
            "popup": popup,
            "ret": returnTo,
        },
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )
    query = urlencode({
        "client_id": GITHUB_CLIENT_ID,
        "redirect_uri": _redirect_uri(),
        "scope": OAUTH_SCOPE,
        "state": state,
        "allow_signup": "false",
    })
    return {"url": f"https://github.com/login/oauth/authorize?{query}"}


@router.post("/github/callback")
@limiter.limit("10/minute")
async def github_callback(
    request: Request,
    body: GithubCallback,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """GitHub қайтарған code-ты токенге айырбастап, қолданушыға шифрлап сақтау"""
    if not _configured():
        raise HTTPException(status_code=503, detail="github_not_configured")
    try:
        claims = jwt.decode(body.state, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM], audience=STATE_AUDIENCE)
    except jwt.PyJWTError:
        raise HTTPException(status_code=400, detail="github_state_invalid")
    # Басқа аккаунтта басталған қосылымды бұл аккаунтқа жазбаймыз
    if claims.get("sub") != user.id:
        raise HTTPException(status_code=400, detail="github_state_invalid")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=10)) as client:
            resp = await client.post(
                "https://github.com/login/oauth/access_token",
                headers={"Accept": "application/json", "User-Agent": "Codo-Hub"},
                data={
                    "client_id": GITHUB_CLIENT_ID,
                    "client_secret": GITHUB_CLIENT_SECRET,
                    "code": body.code,
                    "redirect_uri": _redirect_uri(),
                },
            )
            token = resp.json().get("access_token") if resp.status_code == 200 else None
            if not token:
                # bad_verification_code — код ескірген не бұрын қолданылған
                raise HTTPException(status_code=400, detail="github_code_invalid")
            me = await client.get(f"{API}/user", headers=_headers(token))
            _raise_for_api(me)
            login = me.json().get("login")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="github_unavailable")

    db_user = db.query(User).filter(User.id == user.id).first()
    db_user.github_token = secret_box.encrypt(token)
    db_user.github_login = login
    db.commit()
    return {**_status(db_user), "popup": bool(claims.get("popup")), "returnTo": claims.get("ret") or "/"}


@router.delete("/github/connect")
@limiter.limit("10/minute")
async def github_disconnect(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Профильді ажырату: токен базадан өшіріледі және GitHub-та да қайтарылады"""
    token = _user_token(user)
    if token and _configured():
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.request(
                    "DELETE",
                    f"{API}/applications/{GITHUB_CLIENT_ID}/grant",
                    auth=(GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET),
                    headers={"Accept": "application/vnd.github+json", "User-Agent": "Codo-Hub"},
                    json={"access_token": token},
                )
        except httpx.HTTPError:
            pass  # GitHub-та қайтару сәтсіз болса да, бізде токен қалмайды
    db_user = db.query(User).filter(User.id == user.id).first()
    db_user.github_token = None
    db_user.github_login = None
    db.commit()
    return _status(db_user)


@router.get("/github/repos")
@limiter.limit("30/minute")
async def github_repos(request: Request, user: User = Depends(get_current_user)):
    """Қосылған профильдің репозиторийлері (жабықтары да) — соңғы өзгергені бірінші"""
    token = _user_token(user)
    if not token:
        raise HTTPException(status_code=400, detail="github_not_connected")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=10)) as client:
            resp = await client.get(
                f"{API}/user/repos",
                headers=_headers(token),
                params={"sort": "pushed", "per_page": 100, "affiliation": "owner,collaborator,organization_member"},
            )
            _raise_for_api(resp)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="github_unavailable")
    return {
        "repos": [
            {
                "fullName": r.get("full_name"),
                "url": r.get("html_url"),
                "private": bool(r.get("private")),
                "description": r.get("description"),
                "language": r.get("language"),
            }
            for r in resp.json()
            if isinstance(r, dict)
        ]
    }
