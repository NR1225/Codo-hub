"""Code routes"""
from fastapi import APIRouter, HTTPException, Query, Depends, Request, File, Form, UploadFile
from typing import Optional, List
import json
import base64
import mimetypes
import time
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.formparsers import MultiPartException
from config import MAX_PROJECT_FILES, MAX_MANIFEST_BYTES
from models import CodeCreate, CodeUpdate, CommentCreate, CommentUpdate, ViewRequest, DeleteMultipleRequest
from services.code_service import CodeService
from utils.upload_rules import classify_upload_path, SKIP_MESSAGES
from utils.auth import get_current_user
from db import User
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.get("/codes")
@limiter.limit("30/minute")
async def get_codes(
    request: Request,
    folderId: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: Optional[int] = Query(0, ge=0),
    includeContent: Optional[bool] = Query(False)
):
    """Get codes, optionally filtered by folder with pagination support"""
    return CodeService.get_codes(folderId, limit=limit, offset=offset, include_content=includeContent)


@router.get("/codes/{code_id}")
@limiter.limit("60/minute")
async def get_code(request: Request, code_id: str, lite: bool = Query(False)):
    """Get a code by ID. lite=true — папка болса, ауыр content/folderStructure жіберілмейді"""
    code = CodeService.find_code_by_id(code_id)
    if not code:
        raise HTTPException(status_code=404, detail="Code file not found")
    if lite and code.get('isFolder'):
        return CodeService.to_lite(code)
    return code


@router.post("/codes")
@limiter.limit("10/minute")
async def create_code(request: Request, code_data: CodeCreate, user: User = Depends(get_current_user)):
    """Create a new code"""
    try:
        code_dict = code_data.model_dump()
        # Server-side ownership: never trust a client-supplied author; the
        # author is always the authenticated user (prevents attribution spoofing
        # and the ownership checks on edit/delete being set to someone else).
        code_dict['author'] = user.username
        # Жалғыз файл да папкадағыдай ережемен: тек код, пакет/кэш/құпия/бинарлы емес
        kind = classify_upload_path(code_dict.get('title') or '')
        if kind:
            raise ValueError(SKIP_MESSAGES[kind])
        return CodeService.create_code(code_dict)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import logging
        logging.getLogger("codo_hub").error(f"Code creation error: {e}")
        raise HTTPException(status_code=500, detail="Қате орын алды! Сервер қатесі.")


def _inner_path(path: str) -> str:
    """«жоба/src/a.py» → «src/a.py»: түбірлік папканың аты тексеріске кірмейді"""
    parts = path.replace('\\', '/').split('/', 1)
    return parts[1] if len(parts) == 2 else parts[0]


def _structure_skipped(key: str, value) -> bool:
    """Структурадағы өткізілген файл немесе қоқыс папкасы (node_modules т.б.)"""
    inner = _inner_path(key)
    if inner == key and '/' not in key.replace('\\', '/'):
        return False  # түбірлік папканың өзі
    if isinstance(value, dict) and value.get('type') == 'folder':
        return classify_upload_path(f"{inner}/_") == 'junk'
    return classify_upload_path(inner) is not None


# Сурет кеңейтімдері — content-ті data-URL (base64) ретінде сақтау үшін
_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico'}


@router.post("/codes/folder")
@limiter.limit("30/minute")
async def create_folder(request: Request, user: User = Depends(get_current_user)):
    """Бүтін папканы бір сұраумен жүктеу.

    Frontend бір multipart сұрау жібереді:
      - manifest: JSON {folderName, title, description, tags, language,
        structure, files: [{path, name, language, isImage, size}]}
      - files: шикі File тізімі (manifest.files ретімен сәйкес келеді)

    Бет әр файл үшін жеке сұрау жасамайды (және файл мазмұнын оқымайды) —
    контейнер + барлық ішкі файлдарды сервер құрып шығарады.
    Форма қолмен оқылады: Starlette-тің әдепкі шегі (1000 файл, 1 МБ өріс) үлкен жобаға жетпейді.
    """
    started = time.perf_counter()
    try:
        try:
            form = await request.form(
                max_files=MAX_PROJECT_FILES, max_fields=10, max_part_size=MAX_MANIFEST_BYTES
            )
        except MultiPartException as e:
            raise HTTPException(status_code=400, detail=f"{e.message} (шегі: {MAX_PROJECT_FILES} файл)")
        manifest = form.get('manifest')
        files = [f for f in form.getlist('files') if isinstance(f, StarletteUploadFile)]
        if not isinstance(manifest, str):
            raise HTTPException(status_code=400, detail="manifest жоқ")
        try:
            manifest_data = json.loads(manifest)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="manifest JSON дұрыс емес")

        file_entries = manifest_data.get('files', [])
        if not file_entries:
            raise HTTPException(status_code=400, detail="Папка бос")

        if len(files) != len(file_entries):
            raise HTTPException(
                status_code=400,
                detail=f"Файлдар саны сәйкес келмейді: manifest={len(file_entries)}, "
                      f"жіберілген={len(files)}"
            )

        # Кэш/қоқыс (node_modules, __pycache__…) үнсіз, құпия (.env) мен бинарлы файлдар —
        # тізіммен өткізіледі. Тексеріс түбірлік папкасыз жолмен (жоба «build» деп аталуы мүмкін)
        pairs = []
        skipped: List[str] = []
        junk_skipped = 0
        for entry, upload in zip(file_entries, files):
            path = entry.get('path') or upload.filename or entry.get('name', 'file')
            kind = classify_upload_path(_inner_path(path))
            if kind == 'junk':
                junk_skipped += 1
            elif kind:
                skipped.append(path)
            else:
                pairs.append((entry, upload))
        if not pairs:
            raise HTTPException(
                status_code=400,
                detail="Жүктейтін файл қалмады: бәрі кэш, құпия немесе бинарлы файлдар"
                       + (f" ({', '.join(skipped[:10])})" if skipped else ""),
            )

        structure = {
            key: value for key, value in (manifest_data.get('structure') or {}).items()
            if not _structure_skipped(key, value)
        }

        # Контейнер мазмұны (структура метаақпараты)
        folder_content = json.dumps({
            'structure': structure,
            'fileCount': len(pairs),
        }, ensure_ascii=False, indent=2)

        folder_data = {
            'title': manifest_data.get('title') or manifest_data.get('folderName') or 'folder',
            'content': folder_content,
            'language': manifest_data.get('language') or 'folder',
            'author': user.username,
            'description': manifest_data.get('description'),
            'tags': manifest_data.get('tags') or ['folder'],
            'folderStructure': structure,
        }

        # Әр файл үшін контент дайындау (сервердің өзі оқиды — frontend оқымайды)
        files_data = []
        for entry, upload in pairs:
            raw = await upload.read()
            if raw is None:
                raw = b''
            path = entry.get('path') or upload.filename or entry.get('name', 'file')
            name = entry.get('name') or upload.filename or path.split('/')[-1]
            is_image = entry.get('isImage', False)

            if is_image:
                ext = '.' + (path.rsplit('.', 1)[-1].lower()
                             if '.' in path else '')
                mime = mimetypes.guess_type(name)[0] or 'image/png'
                if ext in _IMAGE_EXTENSIONS and mime == 'application/octet-stream':
                    mime = 'image/' + ext.lstrip('.')
                b64 = base64.b64encode(raw).decode('ascii')
                content = f"data:{mime};base64,{b64}"
            else:
                content = raw.decode('utf-8', errors='replace')

            files_data.append({
                'title': name,
                'content': content,
                'language': entry.get('language') or 'other',
                'author': user.username,
                'description': manifest_data.get('description'),
                'tags': ['folder-file'],
                'folderPath': path,
            })

        result = CodeService.create_folder_batch(folder_data, files_data)
        result['skipped'] = skipped
        result['junkSkipped'] = junk_skipped
        result['serverMs'] = round((time.perf_counter() - started) * 1000)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logging.getLogger("codo_hub").error(f"Folder upload error: {e}")
        raise HTTPException(status_code=500, detail="Қате орын алды! Сервер қатесі.")


@router.put("/codes/{code_id}")
@limiter.limit("20/minute")
async def update_code(request: Request, code_id: str, code_data: CodeUpdate, user: User = Depends(get_current_user)):
    """Update a code"""
    try:
        existing_code = CodeService.find_code_by_id(code_id)
        if not existing_code:
            raise HTTPException(status_code=404, detail="Code file not found")
        if existing_code.get('author') != user.username:
            raise HTTPException(status_code=403, detail="You can only edit your own codes")
        code_dict = {k: v for k, v in code_data.model_dump().items() if v is not None}
        return CodeService.update_code(code_id, code_dict)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/codes/{code_id}")
@limiter.limit("20/minute")
async def delete_code(request: Request, code_id: str, user: User = Depends(get_current_user)):
    """Delete a code"""
    try:
        existing_code = CodeService.find_code_by_id(code_id)
        if not existing_code:
            raise HTTPException(status_code=404, detail="Code file not found")
        if existing_code.get('author') != user.username:
            raise HTTPException(status_code=403, detail="You can only delete your own codes")
        CodeService.delete_code(code_id)
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=204)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/codes/delete-multiple")
@limiter.limit("10/minute")
async def delete_multiple_codes(request: Request, delete_request: DeleteMultipleRequest, user: User = Depends(get_current_user)):
    """Delete multiple codes"""
    if not delete_request.ids or len(delete_request.ids) == 0:
        raise HTTPException(status_code=400, detail="IDs array required")

    # Verify ownership of all codes
    for code_id in delete_request.ids:
        existing_code = CodeService.find_code_by_id(code_id)
        if existing_code and existing_code.get('author') != user.username:
            raise HTTPException(status_code=403, detail=f"You can only delete your own codes")

    deleted_count = CodeService.delete_multiple_codes(delete_request.ids)
    return {"message": f"{deleted_count} код(тар) жойылды", "deletedCount": deleted_count}


@router.post("/codes/{code_id}/like")
@limiter.limit("30/minute")
async def like_code(request: Request, code_id: str, user: User = Depends(get_current_user)):
    """Like a code"""
    try:
        return CodeService.like_code(code_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/codes/{code_id}/unlike")
@limiter.limit("30/minute")
async def unlike_code(request: Request, code_id: str, user: User = Depends(get_current_user)):
    """Unlike a code"""
    try:
        return CodeService.unlike_code(code_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/codes/{code_id}/view")
@limiter.limit("60/minute")
async def view_code(request: Request, code_id: str, view_request: ViewRequest):
    """Increment view count for a code"""
    try:
        return CodeService.view_code(code_id, view_request.userId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/codes/{code_id}/comments")
@limiter.limit("10/minute")
async def add_comment(request: Request, code_id: str, comment_data: CommentCreate, user: User = Depends(get_current_user)):
    """Add a comment to a code"""
    try:
        return CodeService.add_comment(code_id, user.username, comment_data.content, comment_data.parentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/codes/{code_id}/comments/{comment_id}")
@limiter.limit("20/minute")
async def update_comment(request: Request, code_id: str, comment_id: str, comment_data: CommentUpdate, user: User = Depends(get_current_user)):
    """Update a comment (only by comment author)"""
    try:
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise HTTPException(status_code=404, detail="Code file not found")
        # Verify the user is the comment author
        comment = next((c for c in code.get('comments', []) if c['id'] == comment_id), None)
        if not comment:
            raise HTTPException(status_code=404, detail="Comment not found")
        if comment.get('author') != user.username:
            raise HTTPException(status_code=403, detail="You can only edit your own comments")
        return CodeService.update_comment(code_id, comment_id, comment_data.content)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/codes/{code_id}/comments/{comment_id}")
@limiter.limit("20/minute")
async def delete_comment(request: Request, code_id: str, comment_id: str, user: User = Depends(get_current_user)):
    """Delete a comment (only by comment author)"""
    try:
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise HTTPException(status_code=404, detail="Code file not found")
        # Verify the user is the comment author or code author
        comment = next((c for c in code.get('comments', []) if c['id'] == comment_id), None)
        if not comment:
            raise HTTPException(status_code=404, detail="Comment not found")
        if comment.get('author') != user.username and code.get('author') != user.username:
            raise HTTPException(status_code=403, detail="You can only delete your own comments")
        return CodeService.delete_comment(code_id, comment_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/codes/{code_id}/comments/{comment_id}/like")
@limiter.limit("30/minute")
async def like_comment(request: Request, code_id: str, comment_id: str, user: User = Depends(get_current_user)):
    """Like/unlike a comment"""
    try:
        return CodeService.like_comment(code_id, comment_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))