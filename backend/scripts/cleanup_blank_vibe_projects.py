"""Vibecoding-тегі бос жобаларды тазалау (бір реттік).

Бос жоба: файлы да, папкасы да жоқ және аты әдепкі күйінде («Project N») — «+» басылып,
ішінде ештеңе жасалмай қалған жобалар. Бірге өшеді: жобаның Notes папкасы (ішінде жазба
болмаса ғана) және терминал папкасы.

    python scripts/cleanup_blank_vibe_projects.py            # тек көрсетеді (ештеңе өзгермейді)
    python scripts/cleanup_blank_vibe_projects.py --apply    # сақтық көшірме жасап, өшіреді
"""
import argparse
import json
import os
import re
import shutil
import sys
from collections import Counter
from datetime import datetime

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)
# services пакеті config-ті жүктейді; скрипт токен жасамайды — кілт тек импорт өтуі үшін
os.environ.setdefault("JWT_SECRET", "cleanup-script-not-used")

from db import DB_PATH, Note, SessionLocal, User, VibecodingProject  # noqa: E402
from services import terminal_workspace  # noqa: E402
from services.note_service import NoteService  # noqa: E402

DEFAULT_NAME_RE = re.compile(r"^Project \d+$")


def _load_list(raw):
    try:
        value = json.loads(raw or "[]")
    except ValueError:
        return []
    return value if isinstance(value, list) else []


def is_blank(project: VibecodingProject) -> bool:
    return (
        not _load_list(project.files)
        and not _load_list(project.folders)
        and bool(DEFAULT_NAME_RE.match((project.name or "").strip()))
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="шынымен өшіру (әйтпесе тек тізім)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        blank = [p for p in db.query(VibecodingProject).all() if is_blank(p)]
        users = {u.id: u.username for u in db.query(User.id, User.username)}
        if not blank:
            print("Бос жоба табылмады.")
            return
        per_user = Counter(users.get(p.owner_id, p.owner_id) for p in blank)
        print(f"Бос жобалар: {len(blank)}")
        for name, count in per_user.most_common():
            print(f"  {name}: {count}")
        if not args.apply:
            print("\nӨшіру үшін: --apply")
            return

        backup = f"{DB_PATH}.bak-blank-vibe-{datetime.now():%Y%m%d-%H%M%S}"
        shutil.copy2(DB_PATH, backup)
        print(f"\nСақтық көшірме: {backup}")

        targets = [(p.id, p.owner_id, p.notes_folder) for p in blank]
        for p in blank:
            db.delete(p)
        db.commit()

        notes_removed = 0
        for project_id, owner_id, folder in targets:
            if folder:
                has_notes = db.query(Note.id).filter(
                    Note.owner_id == owner_id,
                    (Note.folder == folder) | Note.folder.like(f"{folder}/%"),
                ).first()
                if not has_notes and folder in NoteService.folders(db, owner_id):
                    NoteService.delete_folder(db, owner_id, folder)
                    notes_removed += 1
            terminal_workspace.remove(owner_id, project_id)

        print(f"Өшірілді: {len(targets)} жоба, {notes_removed} бос Notes папкасы.")
        print("Backend іске қосулы болса, оны қайта іске қосу міндетті емес (жобалар әр сұрауда базадан оқылады).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
