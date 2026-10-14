"""Application configuration"""
import os

# JWT Configuration
_jwt_secret = os.getenv("JWT_SECRET")
if not _jwt_secret:
    raise EnvironmentError(
        "JWT_SECRET environment variable is required. "
        "Set it before starting the application. "
        "Example: export JWT_SECRET=$(python -c 'import secrets; print(secrets.token_hex(32))')"
    )
JWT_SECRET_KEY = _jwt_secret
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_EXPIRE", "30"))
JWT_REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("JWT_REFRESH_EXPIRE", "30"))
JWT_2FA_TEMP_TOKEN_EXPIRE_MINUTES = 5

# Per-account login brute-force protection (independent of the IP rate limiter)
LOGIN_MAX_ATTEMPTS = int(os.getenv("LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_LOCKOUT_MINUTES = int(os.getenv("LOGIN_LOCKOUT_MINUTES", "15"))

# SMTP / Email Configuration
SMTP_ENABLED = os.getenv("SMTP_ENABLED", "false").lower() == "true"
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Kazakh Hub")
RESET_PASSWORD_URL = os.getenv("RESET_PASSWORD_URL", "http://localhost:5173/reset-password")

# Data file paths
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
CODES_FILE = os.path.join(DATA_DIR, "codes.json")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
FRIENDS_FILE = os.path.join(DATA_DIR, "friends.json")
MESSAGES_FILE = os.path.join(DATA_DIR, "messages.json")
FRIEND_REQUESTS_FILE = os.path.join(DATA_DIR, "friendRequests.json")
SITE_CONFIG_FILE = os.path.join(DATA_DIR, "site_config.json")

# Ensure data directory exists
os.makedirs(DATA_DIR, exist_ok=True)

# File validation constants
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # 100MB
DANGEROUS_EXTENSIONS = [
    '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.jar',
    '.app', '.deb', '.pkg', '.rpm', '.msi', '.dmg', '.sh', '.ps1',
    '.bin', '.dll', '.so', '.dylib', '.sys', '.drv', '.ocx', '.cpl',
    '.php', '.asp', '.aspx', '.jsp', '.class',
    '.svg', '.svgz', '.xml', '.xhtml', '.xht', '.htm', '.html',
    '.js', '.mjs', '.cjs', '.ts',
    '.htaccess', '.htpasswd', '.env',
    '.py', '.rb', '.pl', '.cgi',
    '.sql', '.db', '.sqlite', '.sqlite3',
]

# Firestore sync availability
try:
    from firestore_sync import init_firestore, sync_code_to_firestore, sync_message_to_firestore, delete_code_from_firestore
    FIRESTORE_SYNC_AVAILABLE = True
    FIRESTORE_INIT = init_firestore
    FIRESTORE_SYNC_CODE = sync_code_to_firestore
    FIRESTORE_SYNC_MESSAGE = sync_message_to_firestore
    FIRESTORE_DELETE_CODE = delete_code_from_firestore
except ImportError:
    FIRESTORE_SYNC_AVAILABLE = False
    FIRESTORE_INIT = None
    FIRESTORE_SYNC_CODE = None
    FIRESTORE_SYNC_MESSAGE = None
    FIRESTORE_DELETE_CODE = None
    print("Warning: Firestore sync module not available. Real-time features will be disabled.")

