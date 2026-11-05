"""Validation utility functions"""
import re
from config import MAX_CONTENT_LENGTH
from utils.upload_rules import classify_upload_path, is_skipped, SKIP_MESSAGES


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
    """Жобалар бетіне жүктелетін файлды тексеру: тек кэш/қоқыс пен .exe өтпейді (utils/upload_rules.py).
    Құпия, база және тест деректері өтеді — оларды utils/protected_files.py қорғайды."""
    skip = classify_upload_path(path or title)
    if is_skipped(skip):
        return {'valid': False, 'error': f'{SKIP_MESSAGES[skip]}: {path or title}', 'skip': skip}

    # Check content size
    if content and len(content) > MAX_CONTENT_LENGTH:
        return {'valid': False, 'error': f'Файл өлшемі тым үлкен. Максималды өлшем: {MAX_CONTENT_LENGTH / (1024 * 1024)}MB'}

    # Мазмұн бойынша «қауіпті» үлгілер (javascript:, on…=, eval) тексерілмейді: код мәтін ретінде
    # сақталып, мәтін ретінде көрсетіледі, ал HTML жобалар sandbox iframe-де ғана іске қосылады.
    # Бұрынғы тексеріс қалыпты файлдарды үнсіз тастап кететін (CSS-тегі `[data-section=…]`,
    # кодтағы 'javascript:' жолы), ал <script>-і бар HTML-ді бәрібір өткізетін.
    return {'valid': True}


