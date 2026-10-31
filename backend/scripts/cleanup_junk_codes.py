"""Жобалар бетіндегі бұрын жүктелген қоқысты тазалау (бір реттік).

utils/upload_rules.py ережесі бойынша кэш/қоқыс (node_modules, __pycache__, .git, .DS_Store…),
құпия (.env, кілттер) және бинарлы файлдарды кодтар кестесінен өшіреді, жобалардың
құрылымынан (folderStructure) да алып тастайды.

    python scripts/cleanup_junk_codes.py            # тек көрсетеді (ештеңе өзгермейді)
    python scripts/cleanup_junk_codes.py --apply    # сақтық көшірме жасап, өшіреді

Backend іске қосулы болса — тазалағаннан кейін оны қайта іске қосыңыз (кодтар жадта тұрады).
Firestore қосулы болса, ондағы көшірмелер бұл скриптпен өшпейді.
"""
import argparse
import json
import os
import sqlite3
import sys
from collections import Counter
from datetime import datetime

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from utils.upload_rules import classify_upload_path  # noqa: E402

DB_PATH = os.path.join(BACKEND, "data", "codo_hub.db")


def project_root(structure: dict, paths: list) -> str | None:
    """Жолдар бір түбірлік папкадан басталса («жоба/src/a.py») — оның аты; ескі жүктеулерде түбір жоқ"""
    keys = [k.replace("\\", "/") for k in list(structure) + paths if k]
    if not keys:
        return None
    root = keys[0].split("/", 1)[0]
    if all(k == root or k.startswith(f"{root}/") for k in keys) and any("/" in k for k in keys):
        return root
    return None


def inner_path(path: str, root: str | None) -> str:
    """«жоба/src/a.py» → «src/a.py»: жобаның өз аты (түбір) тексеріске кірмейді"""
    path = path.replace("\\", "/")
    if root and path.startswith(f"{root}/"):
        return path[len(root) + 1:]
    return path


def structure_skipped(key: str, value, root: str | None) -> bool:
    if root and key.replace("\\", "/") == root:
        return False  # түбірлік папканың өзі
    inner = inner_path(key, root)
    if isinstance(value, dict) and value.get("type") == "folder":
        return classify_upload_path(f"{inner}/_") == "junk"
    return classify_upload_path(inner) == "junk"


def backup(db_path: str) -> str:
    folder = os.path.join(os.path.dirname(db_path), "backups")
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, f"codo_hub-{datetime.now():%Y%m%d-%H%M%S}.db")
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(target)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="шынымен өшіру (әйтпесе тек тізім)")
    parser.add_argument("--db", default=DB_PATH)
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    rows = conn.execute("select id, folder_id, data from codes").fetchall()
    containers = {}
    doomed = []
    by_kind = Counter()
    by_project = Counter()
    children: dict[str, list] = {}
    for code_id, folder_id, data in rows:
        d = json.loads(data)
        if d.get("isFolder"):
            containers[code_id] = d
        elif folder_id:
            children.setdefault(folder_id, []).append(d.get("folderPath") or "")
    roots = {
        cid: project_root(d.get("folderStructure") or {}, children.get(cid, []))
        for cid, d in containers.items()
    }
    for code_id, folder_id, data in rows:
        d = json.loads(data)
        if d.get("isFolder"):
            continue
        path = d.get("folderPath") or d.get("title") or ""
        kind = classify_upload_path(inner_path(path, roots.get(folder_id)) if folder_id else path)
        # Құпия/база/бинарлы файлдар енді қорғалып сақталады — тек қоқыс жойылады
        if kind != "junk":
            continue
        doomed.append(code_id)
        by_kind[kind] += 1
        title = containers.get(folder_id, {}).get("title", "(жеке файл)") if folder_id else "(жеке файл)"
        by_project[title] += 1
        if kind != "junk":
            print(f"  {kind}: «{title}» → {path}")

    print(f"Барлық жазба: {len(rows)}. Өшірілетіні: {len(doomed)} ({dict(by_kind)})")
    for title, n in by_project.most_common():
        print(f"  {n:6d}  «{title}»")

    # Жобалардың құрылымынан да алып тастаймыз
    updates = []
    for code_id, d in containers.items():
        structure = d.get("folderStructure") or {}
        kept = {k: v for k, v in structure.items() if not structure_skipped(k, v, roots.get(code_id))}
        if len(kept) == len(structure):
            continue
        d["folderStructure"] = kept
        try:
            content = json.loads(d.get("content") or "{}")
            if isinstance(content, dict) and "structure" in content:
                content["structure"] = kept
                content["fileCount"] = sum(1 for v in kept.values() if isinstance(v, dict) and v.get("type") == "file")
                d["content"] = json.dumps(content, ensure_ascii=False, indent=2)
        except ValueError:
            pass
        updates.append((code_id, d))
        print(f"  құрылым: «{d.get('title')}» {len(structure)} → {len(kept)} жазба")

    if not args.apply:
        print("\nЕштеңе өзгертілмеді. Өшіру үшін: --apply")
        return
    if not doomed and not updates:
        print("Тазалайтын ештеңе жоқ.")
        return

    print(f"\nСақтық көшірме: {backup(args.db)}")
    with conn:
        for i in range(0, len(doomed), 500):
            chunk = doomed[i:i + 500]
            conn.execute(f"delete from codes where id in ({','.join('?' * len(chunk))})", chunk)
        for code_id, d in updates:
            conn.execute("update codes set data = ? where id = ?", (json.dumps(d, ensure_ascii=False), code_id))
    conn.close()
    print(f"Дайын: {len(doomed)} файл өшірілді, {len(updates)} жобаның құрылымы жаңартылды.")
    print("Backend іске қосулы болса — қазір қайта іске қосыңыз.")


if __name__ == "__main__":
    main()
