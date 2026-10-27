"""Vibecoding жобасы ↔ Notes (Obsidian) байланысы.

Әр жобаға қолданушының vault-ында бір папка автоматты түрде беріледі: «Vibecoding/<жоба аты>».
Байланыс жоба ID-і бойынша сақталады (vibecoding_projects.notes_folder), сондықтан жоба
атын ауыстырса да, папка сол күйі қалады. Бүркіт осы папкадағы жазбаларды оқиды және
Agent режимінде оларға жаза алады."""
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from db import Note, VibecodingProject
from services.note_service import NoteService, clean_folder, clean_title

NOTES_ROOT = "Vibecoding"
# Бүркітке жіберілетін жазбалардың жалпы көлемі (символ)
MAX_NOTES_CHARS = 60_000


def _folder_name(project_name: str) -> str:
    # «/» папканы бөліп жібермесін; бос атау болмасын
    name = re.sub(r"[\\/]+", "-", project_name or "").strip() or "Жоба"
    return clean_folder(f"{NOTES_ROOT}/{name[:150]}")


def ensure_folder(db: Session, project: VibecodingProject) -> str:
    """Жобаның Notes папкасы: жоқ болса — жасайды (басқа жобаның папкасымен қақтығыспайтындай),
    қолданушы өшіріп тастаса — қайта жасайды."""
    existing = NoteService.folders(db, project.owner_id)
    if not project.notes_folder:
        taken = {
            f for (f,) in db.query(VibecodingProject.notes_folder)
            .filter(VibecodingProject.owner_id == project.owner_id, VibecodingProject.notes_folder.isnot(None))
        }
        base = _folder_name(project.name)
        folder, n = base, 2
        while folder in taken:
            folder, n = f"{base} ({n})", n + 1
        project.notes_folder = folder
        db.commit()
    if project.notes_folder not in existing:
        NoteService.create_folder(db, project.owner_id, project.notes_folder)
    return project.notes_folder


def get_project(db: Session, owner_id: str, project_id: Optional[str]) -> Optional[VibecodingProject]:
    if not project_id:
        return None
    return (
        db.query(VibecodingProject)
        .filter(VibecodingProject.id == project_id, VibecodingProject.owner_id == owner_id)
        .first()
    )


def _in_folder(owner_id: str, folder: str):
    return (Note.owner_id == owner_id) & ((Note.folder == folder) | Note.folder.startswith(folder + "/"))


def list_notes(db: Session, owner_id: str, folder: str) -> List[Note]:
    """Папкадағы (ішкі папкаларымен) Markdown жазбалары — соңғы өзгергені бірінші"""
    return (
        db.query(Note)
        .filter(_in_folder(owner_id, folder), Note.kind == "note")
        .order_by(Note.updated_at.desc())
        .all()
    )


def notes_context(db: Session, owner_id: str, folder: str) -> List[Dict[str, Any]]:
    """Бүркітке: атауы + мазмұны (көлем шегіне дейін, асқандары — тек атауымен)"""
    budget = MAX_NOTES_CHARS
    out = []

    def add(title: str, content: str):
        nonlocal budget
        if len(content) <= budget:
            budget -= len(content)
            out.append({"title": title, "content": content})
        else:
            out.append({"title": title, "content": None})

    own = list_notes(db, owner_id, folder)
    for note in own:
        title = note.title if note.folder == folder else f"{note.folder[len(folder) + 1:]}/{note.title}"
        add(title, note.content or "")

    # Жоба жазбалары [[сілтеме]] арқылы папкадан тыс жазбаларға сілтесе — оларды да береміз (бір деңгей)
    linked = {
        m.strip().casefold()
        for note in own
        for m in WIKILINK.findall(note.content or "")
    }
    if linked:
        seen = {n.id for n in own}
        others = (
            db.query(Note)
            .filter(Note.owner_id == owner_id, Note.kind == "note")
            .order_by(Note.updated_at.desc())
            .all()
        )
        for note in others:
            if note.id in seen or note.title.casefold() not in linked:
                continue
            seen.add(note.id)
            path = f"{note.folder}/{note.title}" if note.folder else note.title
            add(f"{path} (жоба жазбасы сілтейді)", note.content or "")
    return out


# [[Атау]], [[Атау|бүркеншік]], [[Атау#тақырып]] → «Атау»
WIKILINK = re.compile(r"\[\[([^\]|#^]+)")


def upsert_note(db: Session, owner_id: str, folder: str, title: str, content: str) -> Dict[str, Any]:
    """Жобаның папкасындағы жазбаны атауы бойынша жаңарту, жоқ болса — жасау.
    previous — бұрынғы мазмұн («Қайтару» үшін), жаңа жазбада None."""
    title = clean_title(title)
    # SQLite lower() кириллицаны кішірейтпейді — атауды Python-да салыстырамыз
    note = next(
        (
            n for n in db.query(Note).filter(Note.owner_id == owner_id, Note.folder == folder, Note.kind == "note")
            if n.title.casefold() == title.casefold()
        ),
        None,
    )
    if note:
        previous = note.content or ""
        result = NoteService.update_note(db, owner_id, note.id, content=content)
        return {"id": result["id"], "title": result["title"], "created": False, "previous": previous}
    result = NoteService.create_note(db, owner_id, title, folder, "note", content)
    return {"id": result["id"], "title": result["title"], "created": True, "previous": None}
