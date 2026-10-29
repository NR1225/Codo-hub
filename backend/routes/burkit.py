"""Бүркіт (Gemini) — кілтті басқару және сөйлесу (streaming)"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from config import GEMINI_MODEL
from db import User, get_db
from services import burkit_service, project_notes
from utils import secret_box
from utils.auth import get_current_user

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


class BurkitKeyUpdate(BaseModel):
    apiKey: str = Field(min_length=20, max_length=200, pattern=r"^[A-Za-z0-9._\-]+$")


class BurkitAttachment(BaseModel):
    """Хабарға тіркелген файл: сурет/PDF — base64 (Gemini өзі көреді), мәтін файлы — мазмұнымен"""
    name: str = Field(min_length=1, max_length=512)
    mimeType: str = Field(max_length=100, pattern=r"^[\w.+\-]+/[\w.+\-]+$")
    data: Optional[str] = Field(default=None, max_length=6_000_000, pattern=r"^[A-Za-z0-9+/=]*$")
    text: Optional[str] = Field(default=None, max_length=100_000)


class BurkitChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)
    files: list[BurkitAttachment] = Field(default_factory=list, max_length=100)


# Gemini тікелей қабылдайтын түрлер және бір сұраудағы тіркемелердің жалпы көлемі
INLINE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", "application/pdf"}
MAX_INLINE_CHARS = 14_000_000
MAX_ATTACHED_TEXT = 300_000


class BurkitProjectFile(BaseModel):
    path: str = Field(min_length=1, max_length=512)
    # Көлем шегінен асқан файлдар тек жолымен келеді
    content: Optional[str] = Field(default=None, max_length=100_000)


class BurkitEditorState(BaseModel):
    path: str = Field(max_length=512)
    line: int = Field(ge=0, le=10_000_000)
    column: int = Field(ge=0, le=10_000_000)
    selection: Optional[str] = Field(default=None, max_length=10_000)


class BurkitWorkspace(BaseModel):
    """Vibecoding бетінің ағымдағы күйі: Бүркіт қолданушы не істеп жатқанын көреді"""
    events: list[str] = Field(default_factory=list, max_length=100)
    terminal: Optional[str] = Field(default=None, max_length=15_000)
    terminalConnected: bool = False
    preview: Optional[str] = Field(default=None, max_length=512)
    previewConsole: list[str] = Field(default_factory=list, max_length=200)
    editor: Optional[BurkitEditorState] = None
    problems: list[str] = Field(default_factory=list, max_length=100)
    openFiles: list[str] = Field(default_factory=list, max_length=200)


# Бір сұраудағы жоба файлдарының жалпы көлемі (символ)
MAX_PROJECT_CHARS = 200_000


class BurkitSiteProject(BaseModel):
    name: str = Field(max_length=200)
    current: Optional[bool] = None
    shared: Optional[bool] = None


class BurkitCatalogItem(BaseModel):
    id: str = Field(max_length=64)
    title: str = Field(max_length=200)
    author: Optional[str] = Field(default=None, max_length=60)
    language: Optional[str] = Field(default=None, max_length=30)


class BurkitSite(BaseModel):
    """Сайттағы жобалармен жұмыс үшін: менің жобаларым, жарияланғандар, достар, топтар, соңғы жобалар"""
    projects: list[BurkitSiteProject] = Field(default_factory=list, max_length=100)
    published: list[str] = Field(default_factory=list, max_length=100)
    friends: list[str] = Field(default_factory=list, max_length=200)
    groups: list[str] = Field(default_factory=list, max_length=100)
    catalog: list[BurkitCatalogItem] = Field(default_factory=list, max_length=50)


class BurkitChatRequest(BaseModel):
    messages: list[BurkitChatMessage] = Field(min_length=1, max_length=40)
    fileName: Optional[str] = Field(default=None, max_length=512)
    fileContent: Optional[str] = Field(default=None, max_length=100_000)
    projectName: Optional[str] = Field(default=None, max_length=200)
    # Серверге сақталған жоба болса — оның Notes папкасындағы жазбалар да жіберіледі
    projectId: Optional[str] = Field(default=None, max_length=64)
    projectFiles: list[BurkitProjectFile] = Field(default_factory=list, max_length=500)
    # agent — Бүркіт path= блоктарымен жоба файлдарына жазады; ask — тек жауап береді
    # site — басты беттегі Бүркіт (сайт бойынша көмекші, жобасыз)
    mode: Literal["agent", "ask", "site"] = "ask"
    workspace: Optional[BurkitWorkspace] = None
    # Сайт интерфейсінің тілі — Бүркіт осы тілде жауап береді
    uiLanguage: Optional[Literal["kk", "ru", "en"]] = None
    # @ арқылы атап өтілген файлдар/папкалар
    mentions: list[str] = Field(default_factory=list, max_length=50)
    site: Optional[BurkitSite] = None
    # home — басты беттегі Бүркіт (жобамен жұмыс істесе де — терминалсыз)
    surface: Literal["vibecoding", "home"] = "vibecoding"


class BurkitInlineRequest(BaseModel):
    """Ctrl+K: ашық файлдың startLine..endLine жолдарын нұсқау бойынша қайта жазу"""
    path: str = Field(min_length=1, max_length=512)
    content: str = Field(max_length=100_000)
    startLine: int = Field(ge=1, le=1_000_000)
    endLine: int = Field(ge=0, le=1_000_000)
    instruction: str = Field(min_length=1, max_length=4_000)
    uiLanguage: Optional[Literal["kk", "ru", "en"]] = None


def _status(user: User) -> dict:
    key, source = burkit_service.resolve_key(user)
    return {
        "provider": "gemini",
        "model": GEMINI_MODEL,
        "source": source,
        # Ортақ кілттің ұшын да көрсетпейміз
        "keyHint": burkit_service.key_hint(key) if source == "own" else None,
    }


@router.get("/burkit/status")
@limiter.limit("60/minute")
async def get_status(request: Request, user: User = Depends(get_current_user)):
    return _status(user)


@router.put("/burkit/key")
@limiter.limit("10/minute")
async def set_key(
    request: Request,
    body: BurkitKeyUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    key = body.apiKey.strip()
    if not await burkit_service.validate_key(key):
        raise HTTPException(status_code=400, detail="API кілті жарамсыз. Кілтті aistudio.google.com-нан қайта көшіріңіз.")
    db_user = db.query(User).filter(User.id == user.id).first()
    db_user.burkit_api_key = secret_box.encrypt(key)
    db.commit()
    return _status(db_user)


@router.delete("/burkit/key")
@limiter.limit("10/minute")
async def delete_key(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.id == user.id).first()
    db_user.burkit_api_key = None
    db.commit()
    return _status(db_user)


class ProjectNoteWrite(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(max_length=200_000)


def _linked_folder(db: Session, user: User, project_id: str) -> str:
    project = project_notes.get_project(db, user.id, project_id)
    if not project:
        # Жоба әлі серверге сақталмаған (немесе басқа біреудікі)
        raise HTTPException(status_code=404, detail="Жоба серверде табылмады")
    return project_notes.ensure_folder(db, project)


@router.get("/burkit/project-notes/{project_id}")
@limiter.limit("60/minute")
async def get_project_notes(
    request: Request, project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Жобаға байланысқан Notes папкасы және ондағы жазбалар"""
    folder = _linked_folder(db, user, project_id)
    notes = project_notes.list_notes(db, user.id, folder)
    return {"folder": folder, "notes": [{"id": n.id, "title": n.title, "folder": n.folder} for n in notes]}


@router.put("/burkit/project-notes/{project_id}")
@limiter.limit("30/minute")
async def write_project_note(
    request: Request,
    project_id: str,
    body: ProjectNoteWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Бүркіт (Agent) жобаның папкасына жазба жазады; previous — «Қайтару» үшін"""
    folder = _linked_folder(db, user, project_id)
    return project_notes.upsert_note(db, user.id, folder, body.title, body.content)


@router.post("/burkit/chat")
@limiter.limit("20/minute")
async def chat(
    request: Request, body: BurkitChatRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    key, _ = burkit_service.resolve_key(user)
    if not key:
        raise HTTPException(status_code=403, detail="Бүркітті қолдану үшін Gemini API кілтіңізді енгізіңіз.")
    if body.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="Соңғы хабар қолданушыдан болуы керек.")
    if sum(len(f.content or "") for f in body.projectFiles) > MAX_PROJECT_CHARS:
        raise HTTPException(status_code=413, detail="Жоба файлдары тым үлкен.")
    files = [f for m in body.messages for f in m.files]
    if any(f.data is not None and f.mimeType not in INLINE_MIME_TYPES for f in files):
        raise HTTPException(status_code=400, detail="Бұл файл түрін Бүркітке жіберу мүмкін емес.")
    if sum(len(f.data or "") for f in files) > MAX_INLINE_CHARS or sum(len(f.text or "") for f in files) > MAX_ATTACHED_TEXT:
        raise HTTPException(status_code=413, detail="Тіркелген файлдар тым үлкен.")

    notes_folder, notes = None, None
    project = project_notes.get_project(db, user.id, body.projectId)
    if project:
        try:
            notes_folder = project_notes.ensure_folder(db, project)
            notes = project_notes.notes_context(db, user.id, notes_folder)
        except HTTPException:
            db.rollback()

    payload = burkit_service.build_payload(
        [m.model_dump() for m in body.messages],
        body.fileName,
        body.fileContent,
        body.projectName,
        [f.model_dump() for f in body.projectFiles],
        agent=body.mode == "agent",
        notes_folder=notes_folder,
        notes=notes,
        workspace=body.workspace.model_dump() if body.workspace else None,
        ui_language=body.uiLanguage,
        mentions=[m[:512] for m in body.mentions],
        site=body.site.model_dump() if body.site else None,
        site_mode=body.mode == "site" or body.surface == "home",
        home=body.surface == "home",
    )
    chunks = await burkit_service.open_stream(key, payload)
    return StreamingResponse(
        chunks,
        media_type="text/plain; charset=utf-8",
        # Прокси (nginx) жауапты буферлемей, бірден жіберсін
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/burkit/inline")
@limiter.limit("30/minute")
async def inline_edit(request: Request, body: BurkitInlineRequest, user: User = Depends(get_current_user)):
    """Ctrl+K: белгіленген жолдардың орнына келетін код (толық жауап, streaming-сіз)"""
    key, _ = burkit_service.resolve_key(user)
    if not key:
        raise HTTPException(status_code=403, detail="Бүркітті қолдану үшін Gemini API кілтіңізді енгізіңіз.")
    lines = body.content.count("\n") + 1
    if body.startLine > lines + 1 or body.endLine > lines:
        raise HTTPException(status_code=400, detail="Жолдар файлдан тыс.")
    payload = burkit_service.build_inline_payload(
        body.path, body.content, body.startLine, body.endLine, body.instruction, body.uiLanguage
    )
    chunks = await burkit_service.open_stream(key, payload)
    text = "".join([part async for part in chunks])
    return {"code": burkit_service.strip_fences(text)}
