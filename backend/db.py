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
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


def init_db():
    """Initialize database - create all tables"""
    Base.metadata.create_all(bind=engine)
    _ensure_user_columns()
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



