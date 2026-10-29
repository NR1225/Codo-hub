"""Validation utility functions"""
import re
import unicodedata
from config import MAX_CONTENT_LENGTH
from utils.upload_rules import classify_upload_path, SKIP_MESSAGES


def validate_email(email: str) -> str:
    """Simple email validation"""
    if not email or '@' not in email:
        raise ValueError('Invalid email format')
    parts = email.split('@')
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError('Invalid email format')
    if '.' not in parts[1]:
        raise ValueError('Invalid email format')
    return email


def validate_file_on_server(title: str, content: str, path: str | None = None):
    """Жобалар бетіне жүктелетін файлды тексеру. Код мәтін ретінде сақталады, сондықтан өтеді;
    кэш/қоқыс, құпия (.env, кілттер) және бинарлы файлдар өтпейді (utils/upload_rules.py)."""
    skip =classify_upload_path(path or title)
    if skip:
        return {'valid': False, 'error': f'{SKIP_MESSAGES[skip]}: {path or title}', 'skip': skip}

    # Check content size
    if content and len(content) > MAX_CONTENT_LENGTH:
        return {'valid': False, 'error': f'Файл өлшемі тым үлкен. Максималды өлшем: {MAX_CONTENT_LENGTH / (1024 * 1024)}MB'}

    # Мазмұн бойынша «қауіпті» үлгілер (javascript:, on…=, eval) тексерілмейді: код мәтін ретінде
    # сақталып, мәтін ретінде көрсетіледі, ал HTML жобалар sandbox iframe-де ғана іске қосылады.
    # Бұрынғы тексеріс қалыпты файлдарды үнсіз тастап кететін (CSS-тегі `[data-section=…]`,
    # кодтағы 'javascript:' жолы), ал <script>-і бар HTML-ді бәрібір өткізетін.
    return {'valid': True}


# Control characters and invisible/zero-width chars to strip from usernames.
# Allows any visible symbol (letters, digits, punctuation, emoji, spaces, etc.)
# but keeps the value single-line and free of trick characters.
_USERNAME_STRIP_RE = re.compile(
    r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f"   # C0 controls (keep \t, \n handled below)
    r"\u200b-\u200f\u202a-\u202e\u2060-\u2064"          # zero-width / bidi overrides
    r"\ufeff]"
)
_USERNAME_WS_RE = re.compile(r'[\t\r\n\f\v]+')


def normalize_username(value: str | None) -> str | None:
    """Normalize a username to be permissive yet safe.

    Allows any visible symbol (any script, punctuation, emoji, spaces, dots,
    hyphens, apostrophes …) while:
      - converting tabs/newlines to spaces,
      - stripping control / zero-width / bidi-override characters,
      - collapsing runs of whitespace to a single space,
      - trimming leading/trailing whitespace,
      - rejecting empty or whitespace-only values.
    """
    if value is None:
        return None

    v = str(value)
    # Tabs / newlines / form feeds → single spaces
    v = _USERNAME_WS_RE.sub(' ', v)
    # Remove control / invisible / bidi characters
    v = _USERNAME_STRIP_RE.sub('', v)
    # Collapse multiple spaces into one and trim
    v = re.sub(r' {2,}', ' ', v).strip()

    if not v:
        raise ValueError('Username cannot be empty')

    # Final hard guard: reject any remaining control character
    for ch in v:
        if unicodedata.category(ch).startswith('C'):
            raise ValueError('Username contains an invalid character')
    return v

