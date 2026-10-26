"""Бүркіт — Google Gemini арқылы жұмыс істейтін код көмекшісі"""
import json
import logging
from typing import AsyncIterator, Optional

import httpx
from fastapi import HTTPException

from config import GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODELS, BURKIT_SHARED_KEY_USER_IDS
from db import User
from utils import secret_box

logger = logging.getLogger(__name__)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

SYSTEM_PROMPT = (
    "Сен — Бүркіт, Kazakh Hub сайтының Vibecoding редакторындағы код көмекшісісің. "
    "Қолданушы қай тілде жазса (қазақ, орыс, ағылшын), сол тілде жауап бер; белгісіз болса — қазақша. "
    "Жауабың қысқа әрі нақты болсын. Кодты әрқашан тілі көрсетілген ``` блогына сал "
    "(мысалы ```python). Тақырыптарға #, тізімдерге «- » қолдан; кестелер мен HTML қолданба."
)

# Жоба ашық болғанда: path= белгісі бар блокты frontend файлға өзі жазады
PROJECT_PROMPT = (
    "\n\nҚолданушының Vibecoding-те ашық жобасы бар. Жобадағы файлды жасау немесе өзгерту керек болса, "
    "файлдың ТОЛЫҚ соңғы мазмұнын тілі мен жолы көрсетілген блокқа жаз, мысалы:\n"
    "```python path=src/main.py\n<файлдың толық мәтіні>\n```\n"
    "Мұндай блок файлға автоматты түрде жазылады, сондықтан онда тек файлдың толық мәтіні болсын: "
    "қысқартпа, «...» немесе «өзгеріссіз қалады» деп қалдырма. Бар файлды өзгерткенде оның жолын "
    "төмендегі тізімдегідей дәл жаз. Файлға жазылмайтын мысал кодты path-сыз блокпен бер. "
    "Блоктан кейін не өзгергенін бір-екі сөйлеммен түсіндір."
)

# Ask режимі: жоба тек контекст, файлдарға жазылмайды
ASK_PROMPT = (
    "\n\nҚолданушының Vibecoding-те ашық жобасы бар (төменде). Сен тек сұраққа жауап бересің — "
    "файлдарға жаза алмайсың, сондықтан код блоктарына path= қоспа. Өзгеріс керек болса, "
    "қолданушыға Agent режимін қосуды ұсын."
)

# Жобаға байланысқан Notes (Obsidian) папкасы
NOTES_PROMPT = (
    "\n\nЖобаның Notes-тағы жазбалары (Obsidian сияқты: [[сілтеме]], #тег) — «{folder}» папкасы. "
    "Оларда жоспар, талаптар, шешімдер болуы мүмкін: код жазғанда соларға сүйен."
)
NOTES_AGENT_PROMPT = (
    " Жазбаны жасау немесе жаңарту керек болса (жоспар, шешімдер журналы, құжаттама), оның ТОЛЫҚ "
    "мәтінін мына блокқа жаз:\n```markdown note=\"Жазба атауы\"\n<жазбаның толық мәтіні>\n```\n"
    "Бар жазбаны өзгерткенде атауын дәл жаз. Атауда [ ] # | ^ \\ / : * ? \" < > таңбалары болмасын. "
    "Жазбаға тек қолданушы сұраса немесе жоспар/шешім сақтау анық пайдалы болса ғана жаз."
)


def key_hint(key: str) -> str:
    return f"…{key[-4:]}"


def resolve_key(user: User) -> tuple[Optional[str], str]:
    """Қолданушының кілті және оның көзі: own | shared | none"""
    if user.burkit_api_key:
        own = secret_box.decrypt(user.burkit_api_key)
        if own:
            return own, "own"
    if GEMINI_API_KEY and user.id in BURKIT_SHARED_KEY_USER_IDS:
        return GEMINI_API_KEY, "shared"
    return None, "none"


def _error_detail(status: int, body: bytes) -> tuple[int, str]:
    """Gemini қатесін қолданушыға түсінікті жауапқа айналдыру"""
    try:
        message = json.loads(body).get("error", {}).get("message", "")
    except (ValueError, AttributeError):
        message = ""
    if status in (400, 401, 403) and "key" in message.lower():
        return 400, "API кілті жарамсыз. Бүркіт баптауында кілтті тексеріңіз."
    if status == 429:
        return 429, "Gemini лимиті таусылды. Біраз күтіп, қайта көріңіз."
    if status in (500, 502, 503, 504):
        return 503, "Gemini қазір шамадан тыс жүктелген. Біраз күтіп, қайта көріңіз."
    logger.warning("Gemini error %s: %s", status, message[:300])
    return 502, "Gemini қате қайтарды. Қайта көріңіз."


async def validate_key(key: str) -> bool:
    """Кілтті модельдер тізімін сұрап тексеру (квота жұмсамайды)"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{GEMINI_BASE_URL}/models",
                params={"pageSize": 1},
                headers={"x-goog-api-key": key},
            )
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Google-ға қосылу мүмкін болмады. Қайта көріңіз.")
    return resp.status_code == 200


def build_payload(
    messages: list[dict],
    file_name: Optional[str],
    file_content: Optional[str],
    project_name: Optional[str] = None,
    project_files: Optional[list[dict]] = None,
    agent: bool = False,
    notes_folder: Optional[str] = None,
    notes: Optional[list[dict]] = None,
) -> dict:
    system = SYSTEM_PROMPT
    if project_name is not None:
        system += (PROJECT_PROMPT if agent else ASK_PROMPT) + f"\n\nЖоба: {project_name}\n"
        files = project_files or []
        if files:
            system += "Жобаның файлдары:\n" + "\n".join(f"- {f['path']}" for f in files)
            # Мазмұны берілген файлдар (ашық файлдан басқасы — көлем шегіне дейін)
            for f in files:
                if f.get("content") is not None and f["path"] != file_name:
                    system += f"\n\nФайл {f['path']}:\n```\n{f['content']}\n```"
        else:
            system += "Жоба әзірге бос."
    if notes_folder is not None:
        system += NOTES_PROMPT.format(folder=notes_folder) + (NOTES_AGENT_PROMPT if agent else "")
        if notes:
            for n in notes:
                if n["content"] is None:
                    system += f"\n\nЖазба «{n['title']}» (тым үлкен, мәтіні берілмеді)"
                else:
                    system += f"\n\nЖазба «{n['title']}»:\n~~~markdown\n{n['content']}\n~~~"
        else:
            system += "\nПапка әзірге бос."
    if file_name and file_content is not None:
        system += f"\n\nҚолданушының ашық файлы — {file_name}:\n```\n{file_content}\n```"
    return {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in messages
        ],
    }


async def open_stream(key: str, payload: dict) -> AsyncIterator[str]:
    """Gemini-ге streaming сұрау ашады. Қате болса — жауап басталмай тұрып HTTPException
    лақтырады; сәтті болса — мәтін бөліктерін беретін генератор қайтарады."""
    client = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10))
    models = [GEMINI_MODEL] + [m for m in GEMINI_FALLBACK_MODELS if m != GEMINI_MODEL]
    for i, model in enumerate(models):
        request = client.build_request(
            "POST",
            f"{GEMINI_BASE_URL}/models/{model}:streamGenerateContent",
            params={"alt": "sse"},
            headers={"x-goog-api-key": key},
            json=payload,
        )
        try:
            resp = await client.send(request, stream=True)
        except httpx.HTTPError as e:
            logger.warning("Gemini %s request failed: %r", model, e)
            if i + 1 < len(models):
                continue
            await client.aclose()
            raise HTTPException(status_code=503, detail="Gemini-ге қосылу мүмкін болмады. Қайта көріңіз.")
        if resp.status_code == 200:
            break

        body = await resp.aread()
        await resp.aclose()
        # Жүктелу (5xx) немесе модель лимиті (429) — келесі модельмен қайталау
        if resp.status_code in (429, 500, 502, 503, 504) and i + 1 < len(models):
            logger.info("Gemini %s returned %s, falling back to %s", model, resp.status_code, models[i + 1])
            continue
        await client.aclose()
        status, detail = _error_detail(resp.status_code, body)
        raise HTTPException(status_code=status, detail=detail)

    async def chunks() -> AsyncIterator[str]:
        try:
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                try:
                    data = json.loads(line[5:])
                except ValueError:
                    continue
                for cand in data.get("candidates", [])[:1]:
                    for part in cand.get("content", {}).get("parts", []):
                        if part.get("text") and not part.get("thought"):
                            yield part["text"]
        except httpx.HTTPError:
            yield "\n\n⚠️ Жауап үзіліп қалды. Қайта көріңіз."
        finally:
            await resp.aclose()
            await client.aclose()

    return chunks()
