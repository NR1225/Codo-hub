"""SQL Database setup with SQLAlchemy"""
from sqlalchemy import create_engine, Column, String, DateTime, Boolean, Text, Integer, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# Database file path
DB_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "kazakh_hub.db")

# Create SQLite engine
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()


class User(Base):
    """User model for SQL database"""
    __tablename__ = "users"
    
    id = Column(String(12), primary_key=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    phone = Column(String(20), unique=True, nullable=True, index=True)  # ескі SMS тіркелуінен қалған; енді толтырылмайды
    password_hash = Column(String(255), nullable=True)  # Nullable for backward compatibility
    avatar = Column(String(500), nullable=True)
    bio = Column(String(500), nullable=True)
    session_id = Column(String(36), nullable=True)
    refresh_token_hash = Column(String(255), nullable=True)
    totp_secret = Column(String(255), nullable=True)
    totp_enabled = Column(Boolean, default=False)
    recovery_codes = Column(Text, nullable=True)
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)  # Соңғы WebSocket қосылымы жабылған уақыт
    burkit_api_key = Column(Text, nullable=True)  # Бүркіттің Gemini кілті — шифрланған (utils/secret_box)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


def init_db():
    """Initialize database - create all tables"""
    Base.metadata.create_all(bind=engine)
    _ensure_user_columns()
    _ensure_vibecoding_columns()
    _ensure_group_message_columns()
    _drop_obsolete_tables()
    print(f"Database initialized at {DB_PATH}")


def _ensure_user_columns():
    """Idempotently add new columns to the existing `users` table.

    `Base.metadata.create_all` won't ALTER existing SQLite tables, so any
    columns added to the `User` model after the first run need an explicit
    migration here. Runs on every startup; safe because each ADD COLUMN is
    guarded by a presence check.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        # Fresh database: create_all already produced the full schema.
        return

    existing = {col["name"] for col in inspector.get_columns("users")}
    with engine.begin() as conn:
        if "failed_login_attempts" not in existing:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0")
            )
        if "locked_until" not in existing:
            conn.execute(text("ALTER TABLE users ADD COLUMN locked_until DATETIME"))
        if "phone" not in existing:
            # SQLite can't ADD COLUMN ... UNIQUE, so uniqueness comes from the index.
            conn.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR(20)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_phone ON users (phone)"))
        if "last_seen_at" not in existing:
            conn.execute(text("ALTER TABLE users ADD COLUMN last_seen_at DATETIME"))
        if "burkit_api_key" not in existing:
            conn.execute(text("ALTER TABLE users ADD COLUMN burkit_api_key TEXT"))


def _ensure_vibecoding_columns():
    """`vibecoding_projects` кестесіне кейін қосылған бағандарды қосу (идемпотентті)."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "vibecoding_projects" not in inspector.get_table_names():
        return

    existing = {col["name"] for col in inspector.get_columns("vibecoding_projects")}
    with engine.begin() as conn:
        if "folders" not in existing:
            conn.execute(text("ALTER TABLE vibecoding_projects ADD COLUMN folders TEXT NOT NULL DEFAULT '[]'"))
        if "notes_folder" not in existing:
            conn.execute(text("ALTER TABLE vibecoding_projects ADD COLUMN notes_folder VARCHAR(1024)"))


def _ensure_group_message_columns():
    """`chat_group_messages` кестесіне кейін қосылған бағандарды қосу (идемпотентті)."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "chat_group_messages" not in inspector.get_table_names():
        return

    existing = {col["name"] for col in inspector.get_columns("chat_group_messages")}
    with engine.begin() as conn:
        if "extra" not in existing:
            conn.execute(text("ALTER TABLE chat_group_messages ADD COLUMN extra TEXT NOT NULL DEFAULT '{}'"))


def _drop_obsolete_tables():
    """Қолданылмайтын кестелерді өшіру (SMS тіркелу алынып тасталды)."""
    from sqlalchemy import text

    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS sms_verifications"))


def get_db():
    """Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class PasswordReset(Base):
    """Password reset token storage"""
    __tablename__ = "password_resets"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(12), nullable=False, index=True)
    token = Column(String(255), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)


class VibecodingProject(Base):
    """Vibecoding бетінде жасалған жоба — тек иесіне көрінеді"""
    __tablename__ = "vibecoding_projects"

    id = Column(String(64), primary_key=True)
    owner_id = Column(String(12), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    files = Column(Text, nullable=False, default="[]")  # JSON: [{id, name, path, content, language}]
    folders = Column(Text, nullable=False, default="[]")  # JSON: ["src", "src/utils"] — бос папкалар да сақталады
    notes_folder = Column(String(1024), nullable=True)  # Notes-тағы байланысқан папка (services/project_notes.py)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ChatGroup(Base):
    """Топтық чат"""
    __tablename__ = "chat_groups"

    id = Column(String(36), primary_key=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500), nullable=True)
    avatar = Column(String(500), nullable=True)
    owner_id = Column(String(12), nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ChatGroupMember(Base):
    """Топ мүшесі: рөлі (owner | admin | member) және соңғы оқыған уақыты"""
    __tablename__ = "chat_group_members"

    group_id = Column(String(36), primary_key=True)
    user_id = Column(String(12), primary_key=True, index=True)
    role = Column(String(16), nullable=False, default="member")
    joined_at = Column(DateTime, default=func.now())
    last_read_at = Column(DateTime, nullable=True)


class ChatGroupMessage(Base):
    """Топ хабарламасы. type='system' — мүше қосылды/шықты сияқты оқиғалар (metadata.event)"""
    __tablename__ = "chat_group_messages"

    id = Column(String(36), primary_key=True)
    group_id = Column(String(36), nullable=False, index=True)
    from_user_id = Column(String(12), nullable=False)
    content = Column(Text, nullable=False, default="")
    type = Column(String(20), nullable=False, default="text")
    attachments = Column(Text, nullable=False, default="[]")  # JSON
    meta = Column("metadata", Text, nullable=False, default="{}")  # JSON
    # JSON: replyTo, forwardedFrom, editedAt, reactions, pinned, deletedFor (services/message_extras.py)
    extra = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=func.now(), index=True)


class CodeRecord(Base):
    """Код/папка. `data` — сервистер қолданатын толық JSON құжат; қалған бағандар іздеу үшін."""
    __tablename__ = "codes"

    id = Column(String(64), primary_key=True)
    seq = Column(Integer, nullable=False, index=True)  # жадтағы тізімдегі рет
    author = Column(String(64), nullable=True, index=True)
    folder_id = Column(String(64), nullable=True, index=True)
    data = Column(Text, nullable=False)


class DirectMessageRecord(Base):
    """Жеке (1:1) хабарлама"""
    __tablename__ = "direct_messages"

    id = Column(String(64), primary_key=True)
    seq = Column(Integer, nullable=False, index=True)
    from_user_id = Column(String(64), nullable=True, index=True)
    to_user_id = Column(String(64), nullable=True, index=True)
    data = Column(Text, nullable=False)


class FriendRequestRecord(Base):
    """Достық өтінімі"""
    __tablename__ = "friend_requests"

    id = Column(String(64), primary_key=True)
    seq = Column(Integer, nullable=False, index=True)
    from_user_id = Column(String(64), nullable=True, index=True)
    to_user_id = Column(String(64), nullable=True, index=True)
    data = Column(Text, nullable=False)


class FriendListRecord(Base):
    """Қолданушының достар тізімі (`data` — id-лер JSON массиві)"""
    __tablename__ = "friend_lists"

    id = Column(String(64), primary_key=True)  # user_id
    seq = Column(Integer, nullable=False, index=True)
    data = Column(Text, nullable=False)


class LegacyUserRecord(Base):
    """Ескі users.json-дағы қолданушылар — тек атын/аватарын көрсету үшін (кіре алмайды)"""
    __tablename__ = "legacy_users"

    id = Column(String(64), primary_key=True)
    seq = Column(Integer, nullable=False, index=True)
    data = Column(Text, nullable=False)


class ChatPref(Base):
    """Қолданушының чатқа қойған белгілері: бекітілген, дыбысы өшірілген, мұрағатталған.
    chat_kind: 'dm' (chat_id — досының id-і) | 'group' (chat_id — топ id-і)"""
    __tablename__ = "chat_prefs"

    user_id = Column(String(12), primary_key=True)
    chat_kind = Column(String(8), primary_key=True)
    chat_id = Column(String(64), primary_key=True)
    pinned_at = Column(DateTime, nullable=True)
    muted = Column(Boolean, nullable=False, default=False)
    archived = Column(Boolean, nullable=False, default=False)


class Note(Base):
    """Жазбалар (Obsidian сияқты) — әр қолданушының жеке vault-ы, тек иесіне көрінеді.
    kind: 'note' (Markdown) | 'canvas' (JSON). links/tags — content-тен есептеледі (services/note_service.py)"""
    __tablename__ = "notes"

    id = Column(String(36), primary_key=True)
    owner_id = Column(String(12), nullable=False, index=True)
    folder = Column(String(1024), nullable=False, default="")  # "" — түбір, "Жобалар/2026"
    title = Column(String(200), nullable=False)
    kind = Column(String(16), nullable=False, default="note")
    content = Column(Text, nullable=False, default="")
    links = Column(Text, nullable=False, default="[]")  # JSON: ["Басқа жазба", ...] — [[сілтеме]] нысандары
    tags = Column(Text, nullable=False, default="[]")  # JSON: ["идея", "жоба/kazakh-hub"]
    starred = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class NoteVault(Base):
    """Қолданушы vault-ының баптаулары: бос папкалар да сақталады"""
    __tablename__ = "note_vaults"

    owner_id = Column(String(12), primary_key=True)
    folders = Column(Text, nullable=False, default="[]")  # JSON: ["Жобалар", "Жобалар/2026"]
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
