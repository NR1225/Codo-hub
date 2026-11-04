"""Сайт терминалындағы `git push` / `git pull` — логинсіз.

Қолданушы сайтта GitHub-ты қосқан болса (Профиль → GitHub, OAuth `repo` рұқсаты), терминал
ашылғанда git-ке credential helper беріледі: github.com сұраған кезде сол токен автоматты
қолданылады, логин/пароль сұралмайды. Қосылмаған болса — helper не істеу керектігін айтады.

Токен жоба папкаларынан тыс, қолданушының түбір папкасындағы жасырын `.codo/` ішінде
(жобаға, git-ке, редакторға түспейді). GitHub ажыратылса — файл өшіріледі.
"""
import logging
import os
from typing import Dict, Optional

from services.terminal_workspace import user_root

logger = logging.getLogger("codo_hub.git_credentials")

GITHUB_HOST = "https://github.com"


def _dir(user_id: str) -> str:
    return os.path.join(user_root(user_id), ".codo")


def token_path(user_id: str) -> str:
    return os.path.join(_dir(user_id), "github-token")


def _load_token(user_id: str) -> Optional[str]:
    """Қолданушының GitHub токені (шифрланған күйінде DB-да)"""
    try:
        from db import SessionLocal, User
        from utils import secret_box
    except Exception:  # pragma: no cover
        return None
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.github_token:
            return None
        return secret_box.decrypt(user.github_token) or None
    except Exception as e:
        logger.warning("GitHub token load failed for %s: %s", user_id, e)
        return None
    finally:
        db.close()


def forget(user_id: str) -> None:
    """GitHub ажыратылғанда — терминалдағы токен файлын өшіру"""
    try:
        os.remove(token_path(user_id))
    except OSError:
        pass


def _write_token(user_id: str, token: Optional[str]) -> str:
    path = token_path(user_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if token:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(token)
    else:
        forget(user_id)
    return path


def _sh_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def apply(env: Dict[str, str], user_id: str, lang: str = "en") -> None:
    """Терминал ортасына git credential helper қосу (GIT_CONFIG_COUNT арқылы — қолданушының
    ~/.gitconfig-ын өзгертпейді, тек осы сессияда)"""
    path = _write_token(user_id, _load_token(user_id)).replace("\\", "/")
    if lang == "kk":
        hint = ("Codo: GitHub-қа логинсіз push жасау үшін сайтта GitHub-ты қосыңыз "
                "(Профиль → GitHub байланысы) — қосылған соң push бірден жұмыс істейді.")
    elif lang == "ru":
        hint = ("Codo: чтобы делать push в GitHub без логина, подключите GitHub на сайте "
                "(Профиль → GitHub) — после подключения push сразу заработает.")
    else:
        hint = ("Codo: to push to GitHub without logging in, connect GitHub on the site "
                "(Profile → GitHub) — push works right after connecting.")
    # git helper-ді sh арқылы іске қосады (Windows-та да — Git for Windows-тың sh-ы)
    helper = (
        "!f() { test \"$1\" = get || exit 0; "
        f"t=$(cat {_sh_quote(path)} 2>/dev/null); "
        "if [ -n \"$t\" ]; then echo username=x-access-token; echo \"password=$t\"; "
        f"else echo {_sh_quote(hint)} >&2; fi; }}; f"
    )
    base = int(env.get("GIT_CONFIG_COUNT", "0") or 0)
    pairs = [
        # Алдымен github.com үшін басқа helper-лерді (Windows Credential Manager т.б.) өшіреміз,
        # әйтпесе олар терезе ашып, логин сұрайды
        (f"credential.{GITHUB_HOST}.helper", ""),
        (f"credential.{GITHUB_HOST}.helper", helper),
        (f"credential.{GITHUB_HOST}.useHttpPath", "false"),
    ]
    for i, (key, value) in enumerate(pairs, start=base):
        env[f"GIT_CONFIG_KEY_{i}"] = key
        env[f"GIT_CONFIG_VALUE_{i}"] = value
    env["GIT_CONFIG_COUNT"] = str(base + len(pairs))
