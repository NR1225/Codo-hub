"""Жергілікті тексеруге арналған тест жобалары (тек dev дерекқорына!).

Тест аккаунттарының (test1, test2…) атынан бірнеше жоба жасайды: пікірлер (жауаптарымен),
лайктар мен қаралымдар қоса. Танымалдығы әртүрлі: танымал (басты беттегі Бүркіттің ұсынысына
шығады), орташа және жаңа (ешкім көрмеген — ұсынысқа шықпайды). Атаулары кәдімгі жобалардай,
өшіру үшін тек жасырын «test-data» тегімен белгіленеді.

Жобалардың файлдары scripts/test_projects/ ішінде — бәрі шынымен жұмыс істейді: HTML/JS
жобалары Vibecoding-тегі «Іске қосу» батырмасымен ашылады, Python калькуляторы — терминалда
(`python main.py`, тесттері: `python -m unittest`).

    python scripts/seed_test_codes.py            # жасау (бұрынғы тест жобалары алдымен өшіріледі)
    python scripts/seed_test_codes.py --remove   # тест жобаларын өшіру

Backend іске қосулы болса — кейін оны қайта іске қосыңыз (кодтар жадта тұрады).
"""
import argparse
import json
import os
import sqlite3
import uuid
from datetime import datetime, timedelta

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BACKEND, "data", "codo_hub.db")
PROJECTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_projects")
TAG = "test-data"

LANG = {".py": "python", ".js": "javascript", ".html": "html", ".css": "css", ".md": "markdown"}


def lang_of(name: str) -> str:
    return LANG.get(os.path.splitext(name)[1], "other")


def iso(days_ago: float) -> str:
    return (datetime.now() - timedelta(days=days_ago)).isoformat()


def read_project(slug: str) -> dict:
    """test_projects/<slug> ішіндегі файлдар: {"src/game.js": "..."}"""
    base = os.path.join(PROJECTS_DIR, slug)
    files = {}
    for folder, dirs, names in os.walk(base):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        for name in sorted(names):
            path = os.path.join(folder, name)
            with open(path, encoding="utf-8") as f:
                files[os.path.relpath(path, base).replace(os.sep, "/")] = f.read()
    if not files:
        raise SystemExit(f"Жоба файлдары жоқ: {base}")
    return files


def comment(author: str, text: str, days_ago: float, likes: list, parent: str | None = None) -> dict:
    return {
        "id": str(uuid.uuid4()), "author": author, "content": text, "createdAt": iso(days_ago),
        "replies": [], "likes": likes, "parentId": parent,
    }


def code(title, content, language, author, description, days_ago, likes, views, viewed_by, comments, **extra) -> dict:
    return {
        "id": str(uuid.uuid4()), "title": title, "content": content, "language": language, "author": author,
        "description": description, "tags": extra.pop("tags", [language, TAG]), "likes": likes, "comments": comments,
        "folderId": None, "folderPath": None, "isFolder": False, "folderStructure": None,
        "views": views, "viewedBy": viewed_by, "createdAt": iso(days_ago), "updatedAt": iso(days_ago), **extra,
    }


def project(title, slug, language, author, description, days_ago, likes, views, viewed_by, comments, category) -> list:
    """Папка-жоба (Upload-тағы пішінмен: жолдар түбірлік папка атымен басталады) + оның файлдары"""
    files = read_project(slug)
    structure = {title: {"type": "folder", "name": title}}
    for path, content in files.items():
        parts = path.split("/")
        for i in range(1, len(parts)):
            sub = "/".join(parts[:i])
            structure.setdefault(f"{title}/{sub}", {"type": "folder", "name": parts[i - 1]})
        structure[f"{title}/{path}"] = {
            "type": "file", "name": parts[-1], "size": len(content.encode()), "language": lang_of(path),
        }
    folder = code(
        title, json.dumps({"structure": structure, "fileCount": len(files)}, ensure_ascii=False, indent=2),
        language, author, description, days_ago, likes, views, viewed_by, comments,
        isFolder=True, folderStructure=structure, tags=["folder", f"category:{category}", TAG],
    )
    items = [folder]
    for path, content in files.items():
        child = code(path.split("/")[-1], content, lang_of(path), author, description, days_ago, [], 0, [], [],
                     tags=["folder-file", TAG])
        child["folderId"] = folder["id"]
        child["folderPath"] = f"{title}/{path}"
        items.append(child)
    return items


def is_test(data: dict) -> bool:
    return TAG in (data.get("tags") or [])


def remove(conn: sqlite3.Connection) -> int:
    rows = conn.execute("select id, folder_id, data from codes").fetchall()
    test_ids = {cid for cid, _, data in rows if is_test(json.loads(data))}
    doomed = [cid for cid, folder_id, _ in rows if cid in test_ids or folder_id in test_ids]
    with conn:
        for i in range(0, len(doomed), 500):
            chunk = doomed[i:i + 500]
            conn.execute(f"delete from codes where id in ({','.join('?' * len(chunk))})", chunk)
    return len(doomed)


def seed(conn: sqlite3.Connection) -> list:
    users = dict(conn.execute("select username, id from users").fetchall())
    needed = ["test1", "test2", "Test"]
    missing = [u for u in needed if u not in users]
    if missing:
        raise SystemExit(f"Тест аккаунттары жоқ: {', '.join(missing)}")
    # Лайк/қаралым қоятындар — тек тест аккаунттары (нақты адамдар емес)
    testers = [uid for name, uid in users.items() if name.lower().startswith(("test", "t_", "uitest"))]
    others = [u for u in users if u.lower().startswith(("test_", "t_"))][:6] or ["test1", "test2"]

    def likers(n: int, skip: str) -> list:
        return [uid for uid in testers if uid != users[skip]][:n]

    items = []

    # 1. Танымал — басты беттегі Бүркіттің ұсынысына шығады (лайк×3 + қаралым ең көп)
    calc_comments = [
        comment(others[0], "Керемет! eval-сыз жазылғаны ұнады.", 5.5, likers(4, "test1")),
        comment("test2", "Дәреже амалы бар ма?", 5, likers(2, "test1")),
        comment(others[1 % len(others)], "Бірінші сабаққа тамаша мысал, unittest-тері де бар 👍", 4, []),
    ]
    calc_comments.append(comment("test1", "Иә: 2 ** 10 деп жазыңыз.", 4.8, likers(1, "test1"),
                                 parent=calc_comments[1]["id"]))
    items += project(
        "Калькулятор", "calculator", "python", "test1",
        "Консольдік калькулятор: ast арқылы қауіпсіз есептейді, тесттерімен", 6,
        likers(15, "test1"), 420, likers(12, "test1"), calc_comments, "Құрал",
    )

    # 2. Орташа
    items += project(
        "Todo тізімі", "todo", "javascript", "test2",
        "Қосу, белгілеу, өшіру, сүзгі — localStorage-қа сақталады", 3,
        likers(4, "test2"), 60, likers(5, "test2"),
        [
            comment("test1", "localStorage-тан басқа сақтау жолы бар ма?", 2.5, []),
            comment(others[2 % len(others)], "Сүзгісі ыңғайлы екен", 2, likers(1, "test2")),
        ],
        "Құрал",
    )

    # 3. Жаңа — ешкім көрмеген, ұсынысқа шықпайды
    items += project(
        "Кофе үйі — лендинг", "landing", "html", "Test",
        "Кофехана лендингі: мәзір, себет, брондау формасы", 0.05, [], 0, [], [], "Веб-сайт",
    )

    # 4. Аз танымал
    items += project(
        "CSS жүктеу анимациялары", "css-loaders", "css", others[0],
        "Төрт жүктеу анимациясы — тек CSS", 1, likers(1, others[0]), 5, [], [], "Дизайн",
    )

    # 5. Танымал ойын
    items += project(
        "Жылан ойыны", "snake", "javascript", "test1",
        "Canvas-та жылан ойыны: тамақ, ұпай, рекорд, жылдамдау", 2,
        likers(9, "test1"), 210, likers(8, "test1"),
        [
            comment("test2", "Рекордым 34 😄 Жылдамдағаны қызық екен", 1.5, likers(3, "test1")),
            comment(others[0], "WASD-пен де ойнауға болатыны ұнады", 1.2, []),
            comment("Test", "Код таза жазылған, рақмет", 1, likers(1, "test1")),
        ],
        "Ойын",
    )

    seq = (conn.execute("select max(seq) from codes").fetchone()[0] or 0) + 1
    with conn:
        for i, item in enumerate(items):
            conn.execute(
                "insert into codes (id, seq, author, folder_id, data) values (?, ?, ?, ?, ?)",
                (item["id"], seq + i, item["author"], item["folderId"], json.dumps(item, ensure_ascii=False)),
            )
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--remove", action="store_true", help="тест жобаларын өшіру")
    parser.add_argument("--db", default=DB_PATH)
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    removed = remove(conn)
    if args.remove:
        print(f"Өшірілді: {removed} тест жазбасы.")
        return
    items = seed(conn)
    print(f"Бұрынғы тест жазбалары өшірілді: {removed}. Жасалды: {len(items)}")
    for item in items:
        if item["folderId"]:
            continue
        files = sum(1 for child in items if child["folderId"] == item["id"])
        score = len(item["likes"]) * 3 + item["views"]
        print(f"  «{item['title']}» ({item['author']}): {files} файл, {len(item['likes'])} лайк, "
              f"{item['views']} қаралым, {len(item['comments'])} пікір, танымалдық {score}")
    print("Backend іске қосулы болса — қазір қайта іске қосыңыз.")


if __name__ == "__main__":
    main()
