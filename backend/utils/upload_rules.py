"""Жобалар бетіне (кодтар) жүктелетін файлдардың ережесі.

Код мәтін ретінде сақталып, мәтін ретінде көрсетіледі (ешқашан орындалмайды), сондықтан
.py, .js, .html сияқты код файлдары өтеді. Өтпейтіндері:
  - junk    — кэш, тәуелділіктер, жүйе қоқысы (node_modules, __pycache__, .git, .DS_Store…): үнсіз өткізіледі
  - secret  — құпия файлдар (.env, кілттер, сертификаттар): қолданушыға айтылып, өткізіледі
  - blocked — бинарлы/орындалатын файлдар (.exe, .dll…): қолданушыға айтылып, өткізіледі

frontend/src/utils/uploadRules.ts — дәл осы ереже (браузер қоқысты серверге жібермеуі үшін).
Чат тіркемелерінің ережесі бөлек: config.DANGEROUS_EXTENSIONS (олар нақты файл болып беріледі).
"""
from typing import Literal, Optional

UploadSkip = Literal["junk", "secret", "blocked"]

# Ішіндегінің бәрі қоқыс болатын папкалар
JUNK_DIRS = {
    "node_modules", "bower_components", "jspm_packages",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".nox", ".ipynb_checkpoints",
    ".venv", "venv", ".git", ".svn", ".hg",
    ".next", ".nuxt", ".svelte-kit", ".angular", ".expo", ".parcel-cache", ".turbo", ".vercel",
    ".cache", ".gradle", ".dart_tool", ".idea", "coverage", ".nyc_output",
    "dist", "build", "out", "target", "obj", ".output",
    "vendor", "site-packages", ".eggs", ".pnpm-store", ".yarn", "pods", "deriveddata",
    ".vs", ".vscode", ".terraform", ".serverless", ".docusaurus", ".sass-cache",
    "htmlcov", ".hypothesis", "__macosx",
}
# Аты осылармен аяқталатын папкалар да қоқыс (Python пакет метадеректері)
JUNK_DIR_SUFFIXES = (".egg-info", ".dist-info")

JUNK_FILES = {
    ".ds_store", "thumbs.db", "desktop.ini", "npm-debug.log", "yarn-error.log", ".eslintcache", ".coverage",
    # Пакет менеджерлерінің lock-файлдары — код емес, тәуелділіктер тізімінің автогенерациясы
    "package-lock.json", ".package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
    "poetry.lock", "pipfile.lock", "pdm.lock", "uv.lock", "composer.lock", "cargo.lock", "gemfile.lock",
    "go.sum", "packages.lock.json", "pubspec.lock", "podfile.lock", ".pnp.cjs", ".pnp.loader.mjs",
}
JUNK_EXTENSIONS = {
    ".pyc", ".pyo", ".pyd", ".log", ".swp", ".swo", ".tmp", ".bak", ".orig", ".tsbuildinfo", ".map", ".lock", ".pdb",
    # Архивтер мен пакеттер
    ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".rar", ".7z", ".whl", ".egg", ".nupkg", ".gem", ".vsix", ".crx", ".iso",
    # Қаріптер, медиа, құжаттар — код емес
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".mp4", ".webm", ".mov", ".avi", ".mkv",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".psd", ".ai", ".sketch", ".fig",
}
# Минификацияланған/бандл кітапханалар — бөтен пакеттің көшірмесі
JUNK_NAME_SUFFIXES = (".min.js", ".min.mjs", ".min.css", ".bundle.js", ".chunk.js")

# Құпия файлдар: .env (үлгілерінен басқасы), кілттер, токендер
SECRET_FILES = {
    ".env", ".htpasswd", ".npmrc", ".pypirc", ".netrc", ".git-credentials",
    "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
    # Firebase / Google Cloud кілттері
    "serviceaccountkey.json", "credentials.json", "client_secret.json",
}
ENV_TEMPLATE_SUFFIXES = {"example", "sample", "template", "dist", "defaults"}
SECRET_EXTENSIONS = {".pem", ".key", ".p12", ".pfx", ".keystore", ".jks", ".kdbx"}

# Бинарлы немесе орындалатын файлдар — мәтін ретінде мағынасы жоқ, қауіпті болуы мүмкін
BLOCKED_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".com", ".pif", ".scr", ".vbs", ".jar", ".msi", ".dmg", ".app",
    ".deb", ".rpm", ".pkg", ".apk", ".bin", ".dll", ".so", ".dylib", ".sys", ".drv", ".ocx",
    ".cpl", ".class", ".o", ".obj", ".a", ".lib", ".db", ".sqlite", ".sqlite3",
}


def _ext(name: str) -> str:
    dot = name.rfind(".")
    return name[dot:] if dot > 0 else ""


def classify_upload_path(path: str) -> Optional[UploadSkip]:
    """Файл жолы бойынша: None — өтеді, әйтпесе неге өткізілетіні"""
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    if not parts:
        return None
    lowered = [p.lower() for p in parts]
    if any(p in JUNK_DIRS or p.endswith(JUNK_DIR_SUFFIXES) for p in lowered[:-1]):
        return "junk"
    name = lowered[-1]
    ext = _ext(name)
    if name in JUNK_FILES or ext in JUNK_EXTENSIONS or name.endswith(JUNK_NAME_SUFFIXES):
        return "junk"
    if name in SECRET_FILES or ext in SECRET_EXTENSIONS:
        return "secret"
    if name.startswith(".env.") and name[5:] not in ENV_TEMPLATE_SUFFIXES:
        return "secret"
    if ext in BLOCKED_EXTENSIONS:
        return "blocked"
    return None


SKIP_MESSAGES = {
    "junk": "Кэш/қоқыс файлы жүктелмейді",
    "secret": "Құпия файл (.env, кілт) жүктелмейді",
    "blocked": "Бинарлы немесе орындалатын файл жүктелмейді",
}
