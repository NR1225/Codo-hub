"""Жобадағы құпия, база және тест деректерін қорғау.

Файлдың `content` өрісінде әрқашан ЖАРИЯ нұсқасы тұрады — оны терминал, іске қосу (/run),
Бүркіт, Firestore т.б. бәрі оқиды, сондықтан ешқайсысынан құпия ағып кетпейді:
  - secret   (.env, кілттер)  → мәндері бос үлгі: «VITE_FIREBASE_API_KEY=»
  - database (.db, .sqlite)   → бос база: тек кестелердің құрылымы (CREATE TABLE …)
  - .sql дамп (INSERT INTO …) → деректерсіз құрылымы
  - testdata (fixtures/, seed…)→ «тек жоба мүшелері көреді» деген белгі
Түпнұсқасы `privateContent` өрісінде шифрланып (utils/secret_box) сақталады және Firestore-ға
жіберілмейді. Оны кім көре алатынын `visibility` анықтайды:
  - owner   — тек жүктеген адам
  - members — жүктеген адам + ол қабылдаған жоба мүшелері
"""
import base64
import json
import os
import re
import sqlite3
import tempfile
from typing import Any, Dict, Optional, Union

from utils.secret_box import decrypt, encrypt
from utils.upload_rules import classify_upload_path

# Тест деректері жататын папкалар
TEST_DATA_DIRS = {
    "fixtures", "__fixtures__", "fixture", "testdata", "test_data", "test-data",
    "seed", "seeds", "seeders", "mock", "mocks", "__mocks__", "mock_data", "mock-data",
    "sample_data", "sample-data", "dummy_data", "dummy-data",
}
# Аты осындай файлдар да тест деректері (seed.sql, fixtures.json, mock_users.json…)
TEST_DATA_NAME_RE = re.compile(r"^(seed|seeds|fixture|fixtures|mock|mocks|dummy|sample[_-]?data|test[_-]?data)([._-]|$)")
# Деректер файлдары (код емес): тест папкасындағы .py/.js — тест коды, ол жария
DATA_EXTENSIONS = {
    ".json", ".jsonl", ".ndjson", ".csv", ".tsv", ".sql", ".yaml", ".yml", ".xml", ".txt",
    ".db", ".sqlite", ".sqlite3", ".db3", ".xls", ".xlsx", ".parquet",
}

# Мәтіндік құпия файлдар: KEY=VALUE пішінді — мәндері өшіріледі
# Кілт: айнымалы аты (VITE_API_KEY) немесе .npmrc-тегі «//registry/:_authToken»
_KEY_VALUE_RE = re.compile(r"^(\s*(?:export\s+)?(?:[A-Za-z_][\w.\-]*|//[^\s=]*)\s*=)(.*)$")
_SQL_DATA_RE = re.compile(r"^\s*(INSERT\s+INTO|COPY\s+\S+.*\bFROM\s+stdin)", re.IGNORECASE | re.MULTILINE)

# Бинарлы мазмұнның белгісі: алғашқы 8 КБ-та NUL байт бар
_BINARY_PROBE = 8192


def _ext(name: str) -> str:
    dot = name.rfind(".")
    return name[dot:].lower() if dot > 0 else ""


def is_binary(raw: bytes) -> bool:
    return b"\x00" in raw[:_BINARY_PROBE]


def data_url(raw: bytes, mime: str = "application/octet-stream") -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def is_test_data(path: str) -> bool:
    """Тест деректері ме: тест папкасындағы деректер файлы немесе seed/fixture/mock деп аталған файл"""
    parts = [p.lower() for p in path.replace("\\", "/").split("/") if p]
    if not parts:
        return False
    name = parts[-1]
    if _ext(name) not in DATA_EXTENSIONS:
        return False
    return any(p in TEST_DATA_DIRS for p in parts[:-1]) or bool(TEST_DATA_NAME_RE.match(name))


def _blank_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _blank_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_blank_json(v) for v in value]
    return ""


def redact_secret(name: str, text: str) -> str:
    """Құпия файлдың толтырылатын үлгісі: кілттері қалады, мәндері бос"""
    if _ext(name) == ".json":
        try:
            return json.dumps(_blank_json(json.loads(text)), ensure_ascii=False, indent=2)
        except ValueError:
            pass
    lines = text.splitlines()
    if lines and any(_KEY_VALUE_RE.match(line) for line in lines):
        out = []
        open_quote: Optional[str] = None
        for line in lines:
            # Көп жолды мәннің ішінде (KEY="-----BEGIN…) — тырнақша жабылғанша бәрі жасырылады
            if open_quote:
                if open_quote in line:
                    open_quote = None
                continue
            stripped = line.strip()
            if not stripped or stripped.startswith(("#", ";", "[")):
                out.append(line)
                continue
            match = _KEY_VALUE_RE.match(line)
            # KEY=VALUE емес жол — мүлде көрсетілмейді
            if not match:
                continue
            out.append(match.group(1).rstrip())
            value = match.group(2).strip()
            if value[:1] in ('"', "'") and value.count(value[0]) == 1:
                open_quote = value[0]
        return "\n".join(out) + "\n"
    return "# Құпия файл (кілт, сертификат) — мазмұны тек жүктеген адамға көрінеді\n"


def _with_sqlite(raw: bytes, fn):
    """Байттарды уақытша файлға жазып, sqlite3 арқылы оқу. Дұрыс база болмаса — None"""
    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
        try:
            return fn(conn)
        finally:
            conn.close()
    except sqlite3.DatabaseError:
        return None
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def sqlite_schema(raw: bytes) -> Optional[str]:
    """Бос база: тек кестелердің, индекстердің құрылымы — бірде-бір жол деректерсіз"""
    def read(conn):
        rows = conn.execute(
            "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' "
            "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name"
        ).fetchall()
        return "\n\n".join(f"{sql.strip()};" for (sql,) in rows)
    return _with_sqlite(raw, read)


def sqlite_dump(raw: bytes) -> Optional[str]:
    """Базаның толық SQL дампы (құрылымы + деректері) — тек рұқсаты барларға"""
    return _with_sqlite(raw, lambda conn: "\n".join(conn.iterdump()))


def sqlite_from_dump(dump: str) -> Optional[bytes]:
    """SQL дамптан қайтадан нақты SQLite файлын құру (иесінің терминалы үшін)"""
    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    try:
        conn = sqlite3.connect(tmp)
        try:
            conn.executescript(dump)
            conn.commit()
        finally:
            conn.close()
        with open(tmp, "rb") as f:
            return f.read()
    except sqlite3.DatabaseError:
        return None
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def restore_original(code: Dict[str, Any]) -> Union[str, bytes, None]:
    """Қорғалған файлдың түпнұсқасы диск үшін: мәтін немесе байттар (база — нақты .sqlite файлы).
    Рұқсатты шақырушы тексереді (CodeService.can_see_private)"""
    token = code.get("privateContent")
    original = decrypt(token) if token else None
    if original is None:
        return None
    match = re.match(r"^data:[^,;]*;base64,", original)
    if match:
        return base64.b64decode(original[match.end():])
    path = str(code.get("folderPath") or code.get("title") or "")
    if code.get("protection") == "database" and classify_upload_path(path) == "database":
        return sqlite_from_dump(original)
    return original


def strip_sql_data(text: str) -> str:
    """SQL дамптан деректерді (INSERT INTO …; және COPY … FROM stdin блоктары) алып тастау"""
    out = []
    skip_until: Optional[str] = None
    for line in text.splitlines():
        if skip_until == ";":
            if line.rstrip().endswith(";"):
                skip_until = None
            continue
        if skip_until == "\\.":
            if line.strip() == "\\.":
                skip_until = None
            continue
        if re.match(r"^\s*INSERT\s+INTO", line, re.IGNORECASE):
            if not line.rstrip().endswith(";"):
                skip_until = ";"
            continue
        if re.match(r"^\s*COPY\s+\S+.*\bFROM\s+stdin", line, re.IGNORECASE):
            skip_until = "\\."
            continue
        out.append(line)
    return "\n".join(out).strip() + "\n\n-- Деректер жасырылған: тек рұқсаты барлар көреді\n"


def protect_file(path: str, raw: bytes, is_image: bool = False) -> Dict[str, Any]:
    """Жүктелген файлды сақтауға дайындау.

    path — жобаның ішкі жолы (түбірлік папкасыз) немесе файл аты.
    Қайтарады: {content, privateContent?, visibility?, protection?}
    """
    name = path.replace("\\", "/").rsplit("/", 1)[-1]
    kind = classify_upload_path(path)
    test = is_test_data(path)
    members_or_owner = "members" if test else "owner"

    if kind == "secret":
        if is_binary(raw):
            # .p12, .keystore сияқты бинарлы кілттер
            return {
                "content": "# Құпия файл (кілт, сертификат) — мазмұны тек жүктеген адамға көрінеді\n",
                "privateContent": encrypt(data_url(raw)),
                "visibility": "owner",
                "protection": "secret",
            }
        text = raw.decode("utf-8", errors="replace")
        return {
            "content": redact_secret(name, text),
            "privateContent": encrypt(text),
            "visibility": "owner",
            "protection": "secret",
        }

    if kind == "database":
        schema = sqlite_schema(raw)
        if schema is None:
            # SQLite емес база — құрылымын оқи алмаймыз, түпнұсқасы тек иесіне
            return {
                "content": "-- Деректер базасы: құрылымы оқылмады, мазмұны жасырылған\n",
                "privateContent": encrypt(data_url(raw)),
                "visibility": members_or_owner,
                "protection": "database",
            }
        dump = sqlite_dump(raw) or schema
        return {
            "content": f"-- Бос база: тек құрылымы көрсетілген, деректер жасырылған\n\n{schema}\n",
            "privateContent": encrypt(dump),
            "visibility": members_or_owner,
            "protection": "database",
        }

    if is_image:
        return {"content": None}  # суретті шақырушы өзі data-URL етеді

    if kind == "binary" or is_binary(raw):
        if test:
            return {
                "content": "# Тест деректері — тек жоба мүшелері көреді\n",
                "privateContent": encrypt(data_url(raw)),
                "visibility": "members",
                "protection": "testdata",
            }
        return {"content": data_url(raw)}

    text = raw.decode("utf-8", errors="replace")

    if _ext(name) == ".sql" and _SQL_DATA_RE.search(text):
        return {
            "content": strip_sql_data(text),
            "privateContent": encrypt(text),
            "visibility": members_or_owner,
            "protection": "database",
        }

    if test:
        return {
            "content": "# Тест деректері — тек жоба мүшелері көреді\n",
            "privateContent": encrypt(text),
            "visibility": "members",
            "protection": "testdata",
        }

    return {"content": text}
