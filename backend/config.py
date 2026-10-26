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

# Cloudflare Turnstile CAPTCHA (register + login). Empty = disabled (local dev).
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY", "")

# HSTS: sent only on HTTPS requests (see docs/SECURITY-HSTS.md).
# Start small (1 day), raise to 31536000 once everything works over HTTPS.
HSTS_MAX_AGE = int(os.getenv("HSTS_MAX_AGE", "86400"))
HSTS_INCLUDE_SUBDOMAINS = os.getenv("HSTS_INCLUDE_SUBDOMAINS", "false").lower() == "true"

# SMTP / Email Configuration
SMTP_ENABLED = os.getenv("SMTP_ENABLED", "false").lower() == "true"
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Kazakh Hub")
RESET_PASSWORD_URL = os.getenv("RESET_PASSWORD_URL", "http://localhost:5173/reset-password")

# ── Vibecoding terminal (PTY) hardening ──
# The terminal hands an authenticated user a real shell on the server, so it is
# sandboxed and capped. Each session runs in a per-user workspace directory with
# a scrubbed environment (no app secrets), resource limits (Unix), and strict
# session/idle/lifetime caps. Set TERMINAL_ENABLED=false to turn it off entirely.
TERMINAL_ENABLED = os.getenv("TERMINAL_ENABLED", "true").lower() == "true"
TERMINAL_WORKSPACE_DIR = os.getenv(
    "TERMINAL_WORKSPACE_DIR",
    os.path.join(os.path.dirname(__file__), "data", "terminal_workspaces"),
)
TERMINAL_MAX_SESSIONS_PER_USER = int(os.getenv("TERMINAL_MAX_SESSIONS_PER_USER", "5"))
TERMINAL_MAX_SESSIONS_TOTAL = int(os.getenv("TERMINAL_MAX_SESSIONS_TOTAL", "50"))
TERMINAL_IDLE_TIMEOUT_SECONDS = int(os.getenv("TERMINAL_IDLE_TIMEOUT_SECONDS", "900"))      # 15 min
TERMINAL_MAX_LIFETIME_SECONDS = int(os.getenv("TERMINAL_MAX_LIFETIME_SECONDS", "3600"))     # 1 hour
TERMINAL_OUTPUT_QUEUE_MAX = int(os.getenv("TERMINAL_OUTPUT_QUEUE_MAX", "1000"))
TERMINAL_MAX_INPUT_BYTES = int(os.getenv("TERMINAL_MAX_INPUT_BYTES", "4096"))               # per message
TERMINAL_INPUT_RATE_MAX = int(os.getenv("TERMINAL_INPUT_RATE_MAX", "200"))                  # messages / window
TERMINAL_INPUT_RATE_WINDOW = int(os.getenv("TERMINAL_INPUT_RATE_WINDOW", "10"))             # seconds
# Memory/CPU/process/file caps applied per session on Unix via setrlimit.
TERMINAL_RLIMIT_CPU_SECONDS = int(os.getenv("TERMINAL_RLIMIT_CPU_SECONDS", "120"))
TERMINAL_RLIMIT_MEM_MB = int(os.getenv("TERMINAL_RLIMIT_MEM_MB", "512"))
TERMINAL_RLIMIT_NPROC = int(os.getenv("TERMINAL_RLIMIT_NPROC", "64"))
TERMINAL_RLIMIT_FSIZE_MB = int(os.getenv("TERMINAL_RLIMIT_FSIZE_MB", "100"))

# ── Бүркіт (Google Gemini) ──
# Әр қолданушы өз кілтін енгізеді (базада шифрланып сақталады). Сервердің ортақ
# кілті (GEMINI_API_KEY) тек BURKIT_SHARED_KEY_USER_IDS тізіміндегі аккаунттарға
# беріледі — ID бойынша, өйткені username ауыстыруға болады.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
# Негізгі модель бос болмаса (503) немесе лимиті таусылса (429) — кезекпен осылар сұралады
GEMINI_FALLBACK_MODELS = [
    m.strip() for m in os.getenv("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash-lite").split(",") if m.strip()
]
BURKIT_SHARED_KEY_USER_IDS = {
    uid.strip() for uid in os.getenv("BURKIT_SHARED_KEY_USER_IDS", "").split(",") if uid.strip()
}
# Қолданушы кілттерін шифрлайтын құпия. Бос болса — JWT_SECRET-тен алынады
# (онда JWT_SECRET ауысса, сақталған кілттерді қайта енгізу керек болады).
BURKIT_ENCRYPTION_KEY = os.getenv("BURKIT_ENCRYPTION_KEY", "") or JWT_SECRET_KEY

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

