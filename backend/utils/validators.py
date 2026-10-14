"""Validation utility functions"""
import re
import unicodedata
from config import MAX_CONTENT_LENGTH, DANGEROUS_EXTENSIONS


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


def validate_file_on_server(title: str, content: str):
    """Validate file on server side"""
    # Check file extension
    ext = title.lower()[title.rfind('.'):] if '.' in title else ''
    if ext in DANGEROUS_EXTENSIONS:
        return {'valid': False, 'error': f'Қауіпті файл түрі блокталды: {ext}'}
    
    # Check content size
    if content and len(content) > MAX_CONTENT_LENGTH:
        return {'valid': False, 'error': f'Файл өлшемі тым үлкен. Максималды өлшем: {MAX_CONTENT_LENGTH / (1024 * 1024)}MB'}
    
    # Determine file type for context-aware validation
    code_extensions = ['.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.r', '.m', '.pl', '.sh', '.bash', '.zsh', '.fish']
    html_extensions = ['.html', '.htm', '.xhtml']
    web_extensions = ['.css', '.scss', '.sass', '.less']
    
    is_code_file = ext in code_extensions
    is_html_file = ext in html_extensions
    is_web_file = ext in web_extensions or is_html_file
    
    # Check for potentially malicious content patterns
    # HTML/JS-specific patterns - check in non-web files
    if not is_web_file:
        html_js_patterns = [
            re.compile(r'<script[^>]*>[\s\S]*?</script>', re.IGNORECASE),
            re.compile(r'javascript:', re.IGNORECASE),
        ]
        for pattern in html_js_patterns:
            if pattern.search(content):
                return {'valid': False, 'error': 'Файлда қауіпті контент табылды'}
    
    # HTML event handlers - check in non-code files (suspicious in code files too, but less critical)
    # Allow in code files as they might be part of string literals or comments
    if not is_code_file:
        event_handler_pattern = re.compile(r'on\w+\s*=', re.IGNORECASE)
        if event_handler_pattern.search(content):
            return {'valid': False, 'error': 'Файлда қауіпті контент табылды'}
    
    # eval() and exec() are legitimate functions in many programming languages
    # Only check for them in non-code files where they might be suspicious
    if not is_code_file:
        eval_exec_patterns = [
            re.compile(r'eval\s*\(', re.IGNORECASE),
            re.compile(r'exec\s*\(', re.IGNORECASE),
        ]
        for pattern in eval_exec_patterns:
            if pattern.search(content):
                return {'valid': False, 'error': 'Файлда қауіпті контент табылды'}
    
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

