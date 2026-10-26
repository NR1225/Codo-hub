"""Жазбалар (Obsidian сияқты) — бизнес-логика (SQL: notes, note_vaults).
Әр қолданушының vault-ы жеке: барлық сұраулар owner_id бойынша сүзіледі."""
import json
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from db import Note, NoteVault

MAX_NOTES_PER_USER = 2000
MAX_NOTE_BYTES = 1024 * 1024  # бір жазба — 1MB
MAX_FOLDERS = 1000
NOTE_KINDS = ("note", "canvas")

# [[Мақсат]], [[Мақсат#Тақырып]], [[Мақсат|Көрінетін мәтін]]
WIKILINK_RE = re.compile(r"\[\[([^\[\]|#\n]+)(#[^\[\]|\n]*)?(\|[^\[\]\n]*)?\]\]")
# #тег — алдында әріп/сан/«/» болмауы керек; кемінде бір әріп болуы керек (#2026 — тег емес)
TAG_RE = re.compile(r"(?<![\w/#&])#([\w\-/]*[^\W\d_][\w\-/]*)")
CODE_FENCE_RE = re.compile(r"```.*?(```|$)", re.S)
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
# Атауға тыйым салынған таңбалар (Obsidian сияқты): сілтеме синтаксисін бұзады
BAD_TITLE_CHARS = re.compile(r"[\[\]#|^\\/:*?\"<>]")


def _iso(value: Optional[datetime]) -> str:
    return value.isoformat() + "Z" if value else ""


def _load_list(raw: Optional[str]) -> list:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return value if isinstance(value, list) else []


def clean_folder(path: Optional[str]) -> str:
    """'/a//b/ ' → 'a/b'; '..' және '.' бөліктері алынып тасталады"""
    parts = [p.strip() for p in (path or "").replace("\\", "/").split("/")]
    parts = [p for p in parts if p and p not in (".", "..")]
    folder = "/".join(parts)
    if len(folder) > 1024:
        raise HTTPException(status_code=400, detail="Папка жолы тым ұзын")
    return folder


def clean_title(title: str) -> str:
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Атауы бос болмауы керек")
    if BAD_TITLE_CHARS.search(title):
        raise HTTPException(status_code=400, detail="Атауда [ ] # | ^ \\ / : * ? \" < > таңбалары болмауы керек")
    return title[:200]


def _strip_code(content: str) -> str:
    return INLINE_CODE_RE.sub("", CODE_FENCE_RE.sub("", content))


def extract_links(kind: str, content: str) -> List[str]:
    """Жазбадағы [[сілтеме]] нысандары; canvas-та — жазба карточкаларының атаулары"""
    if kind == "canvas":
        try:
            data = json.loads(content or "{}")
        except ValueError:
            return []
        nodes = data.get("nodes") if isinstance(data, dict) else None
        targets = [n.get("note") for n in nodes or [] if isinstance(n, dict) and n.get("type") == "note"]
        text = " ".join(n.get("text", "") for n in nodes or [] if isinstance(n, dict) and n.get("type") == "text")
        targets += [m.group(1).strip() for m in WIKILINK_RE.finditer(text)]
    else:
        targets = [m.group(1).strip() for m in WIKILINK_RE.finditer(_strip_code(content))]
    result: List[str] = []
    for target in targets:
        if isinstance(target, str) and target and target not in result:
            result.append(target[:300])
    return result


def extract_tags(kind: str, content: str) -> List[str]:
    if kind != "note":
        return []
    result: List[str] = []
    for match in TAG_RE.finditer(_strip_code(content)):
        tag = match.group(1).strip("/").lower()
        if tag and tag not in result:
            result.append(tag[:100])
    return result


def _replace_links(content: str, old: str, new: str) -> str:
    """[[old]] / [[old#h]] / [[old|alias]] / [[папка/old]] → new атауымен"""
    def repl(m: re.Match) -> str:
        target = m.group(1).strip()
        base = target.split("/")[-1]
        if base.lower() != old.lower():
            return m.group(0)
        prefix = target[: len(target) - len(base)]
        return f"[[{prefix}{new}{m.group(2) or ''}{m.group(3) or ''}]]"

    return WIKILINK_RE.sub(repl, content)


def _replace_canvas_links(content: str, old: str, new: str) -> str:
    """Canvas: жазба карточкаларының `note` өрісі және мәтін карточкаларындағы [[сілтемелер]]"""
    try:
        data = json.loads(content or "{}")
    except ValueError:
        return content
    if not isinstance(data, dict) or not isinstance(data.get("nodes"), list):
        return content
    for node in data["nodes"]:
        if not isinstance(node, dict):
            continue
        target = node.get("note")
        if node.get("type") == "note" and isinstance(target, str) and target.split("/")[-1].lower() == old.lower():
            node["note"] = target[: len(target) - len(target.split("/")[-1])] + new
        if node.get("type") == "text" and isinstance(node.get("text"), str):
            node["text"] = _replace_links(node["text"], old, new)
    return json.dumps(data, ensure_ascii=False)


class NoteService:
    @staticmethod
    def to_meta(note: Note) -> Dict[str, Any]:
        return {
            "id": note.id,
            "title": note.title,
            "folder": note.folder or "",
            "kind": note.kind,
            "links": _load_list(note.links),
            "tags": _load_list(note.tags),
            "starred": bool(note.starred),
            "size": len(note.content or ""),
            "createdAt": _iso(note.created_at),
            "updatedAt": _iso(note.updated_at),
        }

    @staticmethod
    def to_dict(note: Note) -> Dict[str, Any]:
        return {**NoteService.to_meta(note), "content": note.content or ""}

    # ---------- Vault ----------

    @staticmethod
    def get_vault(db: Session, owner_id: str) -> NoteVault:
        vault = db.query(NoteVault).filter(NoteVault.owner_id == owner_id).first()
        if not vault:
            vault = NoteVault(owner_id=owner_id, folders="[]")
            db.add(vault)
            db.flush()
        return vault

    @staticmethod
    def folders(db: Session, owner_id: str) -> List[str]:
        """Сақталған папкалар + жазбалары бар папкалар (ата-аналарымен бірге), сұрыпталған"""
        vault = db.query(NoteVault).filter(NoteVault.owner_id == owner_id).first()
        folders = set(_load_list(vault.folders) if vault else [])
        for (folder,) in db.query(Note.folder).filter(Note.owner_id == owner_id).distinct():
            if folder:
                folders.add(folder)
        expanded = set()
        for folder in folders:
            parts = folder.split("/")
            for i in range(1, len(parts) + 1):
                expanded.add("/".join(parts[:i]))
        return sorted(expanded, key=str.lower)

    @staticmethod
    def _save_folders(db: Session, owner_id: str, folders: List[str]) -> None:
        unique = sorted({f for f in folders if f}, key=str.lower)
        if len(unique) > MAX_FOLDERS:
            raise HTTPException(status_code=400, detail="Папкалар саны шегіне жетті")
        vault = NoteService.get_vault(db, owner_id)
        vault.folders = json.dumps(unique, ensure_ascii=False)
        vault.updated_at = datetime.utcnow()

    @staticmethod
    def vault_snapshot(db: Session, owner_id: str) -> Dict[str, Any]:
        notes = (
            db.query(Note)
            .filter(Note.owner_id == owner_id)
            .order_by(Note.updated_at.desc())
            .all()
        )
        return {"notes": [NoteService.to_meta(n) for n in notes], "folders": NoteService.folders(db, owner_id)}

    @staticmethod
    def create_folder(db: Session, owner_id: str, path: str) -> Dict[str, Any]:
        folder = clean_folder(path)
        if not folder:
            raise HTTPException(status_code=400, detail="Папка атауы бос")
        current = NoteService.folders(db, owner_id)
        NoteService._save_folders(db, owner_id, current + [folder])
        db.commit()
        return {"folders": NoteService.folders(db, owner_id)}

    @staticmethod
    def rename_folder(db: Session, owner_id: str, old: str, new: str) -> Dict[str, Any]:
        old, new = clean_folder(old), clean_folder(new)
        if not old or not new:
            raise HTTPException(status_code=400, detail="Папка жолы бос")
        if new == old or new.startswith(old + "/"):
            raise HTTPException(status_code=400, detail="Папканы өз ішіне жылжытуға болмайды")

        def moved(path: str) -> str:
            return new + path[len(old):] if path == old or path.startswith(old + "/") else path

        notes = db.query(Note).filter(Note.owner_id == owner_id).all()
        taken = {(n.folder, n.title.lower(), n.kind) for n in notes if not (n.folder == old or n.folder.startswith(old + "/"))}
        for note in notes:
            if note.folder == old or note.folder.startswith(old + "/"):
                if (moved(note.folder), note.title.lower(), note.kind) in taken:
                    raise HTTPException(status_code=409, detail=f"«{note.title}» атты жазба мақсатты папкада бар")
        for note in notes:
            target = moved(note.folder)
            if target != note.folder:
                note.folder = target
        NoteService._save_folders(db, owner_id, [moved(f) for f in NoteService.folders(db, owner_id)])
        db.commit()
        return NoteService.vault_snapshot(db, owner_id)

    @staticmethod
    def delete_folder(db: Session, owner_id: str, path: str) -> Dict[str, Any]:
        folder = clean_folder(path)
        if not folder:
            raise HTTPException(status_code=400, detail="Папка жолы бос")
        inside = lambda p: p == folder or p.startswith(folder + "/")  # noqa: E731
        for note in db.query(Note).filter(Note.owner_id == owner_id).all():
            if inside(note.folder):
                db.delete(note)
        db.flush()
        NoteService._save_folders(db, owner_id, [f for f in NoteService.folders(db, owner_id) if not inside(f)])
        db.commit()
        return NoteService.vault_snapshot(db, owner_id)

    # ---------- Жазбалар ----------

    @staticmethod
    def get_owned(db: Session, owner_id: str, note_id: str) -> Note:
        note = db.query(Note).filter(Note.id == note_id).first()
        if not note or note.owner_id != owner_id:
            # Басқа біреудің жазбасы — бар екенін де ашпаймыз
            raise HTTPException(status_code=404, detail="Жазба табылмады")
        return note

    @staticmethod
    def _title_taken(db: Session, owner_id: str, folder: str, title: str, kind: str, exclude_id: Optional[str] = None) -> bool:
        query = db.query(Note.id, Note.title).filter(
            Note.owner_id == owner_id, Note.folder == folder, Note.kind == kind
        )
        return any(t.lower() == title.lower() and i != exclude_id for i, t in query)

    @staticmethod
    def _unique_title(db: Session, owner_id: str, folder: str, title: str, kind: str) -> str:
        candidate, n = title, 1
        while NoteService._title_taken(db, owner_id, folder, candidate, kind):
            candidate = f"{title} {n}"
            n += 1
        return candidate

    @staticmethod
    def _set_content(note: Note, content: str) -> None:
        if len(content.encode("utf-8")) > MAX_NOTE_BYTES:
            raise HTTPException(status_code=413, detail="Жазба тым үлкен (максимум 1MB)")
        if note.kind == "canvas" and content:
            try:
                json.loads(content)
            except ValueError:
                raise HTTPException(status_code=400, detail="Canvas деректері дұрыс JSON емес")
        note.content = content
        note.links = json.dumps(extract_links(note.kind, content), ensure_ascii=False)
        note.tags = json.dumps(extract_tags(note.kind, content), ensure_ascii=False)

    @staticmethod
    def create_note(db: Session, owner_id: str, title: str, folder: str, kind: str, content: str) -> Dict[str, Any]:
        if kind not in NOTE_KINDS:
            raise HTTPException(status_code=400, detail="Жазба түрі дұрыс емес")
        if db.query(Note).filter(Note.owner_id == owner_id).count() >= MAX_NOTES_PER_USER:
            raise HTTPException(status_code=400, detail="Жазбалар саны шегіне жетті")
        folder = clean_folder(folder)
        title = NoteService._unique_title(db, owner_id, folder, clean_title(title), kind)
        note = Note(id=str(uuid.uuid4()), owner_id=owner_id, folder=folder, title=title, kind=kind)
        NoteService._set_content(note, content or ("" if kind == "note" else '{"nodes":[],"edges":[]}'))
        db.add(note)
        db.commit()
        db.refresh(note)
        return NoteService.to_dict(note)

    @staticmethod
    def update_note(
        db: Session,
        owner_id: str,
        note_id: str,
        *,
        title: Optional[str] = None,
        folder: Optional[str] = None,
        content: Optional[str] = None,
        starred: Optional[bool] = None,
        update_links: bool = True,
    ) -> Dict[str, Any]:
        note = NoteService.get_owned(db, owner_id, note_id)
        old_title = note.title
        new_title = clean_title(title) if title is not None else note.title
        new_folder = clean_folder(folder) if folder is not None else note.folder
        if (new_title.lower() != note.title.lower() or new_folder != note.folder) and NoteService._title_taken(
            db, owner_id, new_folder, new_title, note.kind, exclude_id=note.id
        ):
            raise HTTPException(status_code=409, detail="Бұл папкада осындай атты жазба бар")

        note.title, note.folder = new_title, new_folder
        if content is not None:
            NoteService._set_content(note, content)
        if starred is not None:
            note.starred = starred
        note.updated_at = datetime.utcnow()

        changed: List[Note] = []
        if update_links and new_title != old_title:
            # Атауы өзгерді — басқа жазбалардағы [[ескі атау]] сілтемелерін жаңарту
            for other in db.query(Note).filter(Note.owner_id == owner_id, Note.id != note.id).all():
                if old_title.lower() not in (l.split("/")[-1].lower() for l in _load_list(other.links)):
                    continue
                if other.kind == "canvas":
                    updated = _replace_canvas_links(other.content or "", old_title, new_title)
                else:
                    updated = _replace_links(other.content or "", old_title, new_title)
                if updated != other.content:
                    NoteService._set_content(other, updated)
                    changed.append(other)
        db.commit()
        db.refresh(note)
        result = NoteService.to_dict(note)
        result["updatedNotes"] = [NoteService.to_meta(n) for n in changed]
        return result

    @staticmethod
    def delete_note(db: Session, owner_id: str, note_id: str) -> None:
        note = NoteService.get_owned(db, owner_id, note_id)
        db.delete(note)
        db.commit()

    @staticmethod
    def search(db: Session, owner_id: str, query: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Атауы мен мәтіні бойынша іздеу (регистрге тәуелсіз) — үзіндісімен"""
        q = query.strip().lower()
        if not q:
            return []
        results = []
        for note in db.query(Note).filter(Note.owner_id == owner_id, Note.kind == "note").all():
            content = note.content or ""
            in_title = q in note.title.lower()
            idx = content.lower().find(q)
            if not in_title and idx < 0:
                continue
            snippet = ""
            if idx >= 0:
                start = max(0, idx - 60)
                snippet = ("…" if start else "") + content[start: idx + len(q) + 80].replace("\n", " ")
            results.append({
                "id": note.id,
                "title": note.title,
                "folder": note.folder or "",
                "snippet": snippet,
                "score": (2 if in_title else 0) + (1 if idx >= 0 else 0),
                "updatedAt": _iso(note.updated_at),
            })
        results.sort(key=lambda r: (-r["score"], r["title"].lower()))
        return results[:limit]
