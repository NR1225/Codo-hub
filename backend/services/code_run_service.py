"""Жүктелген жобаны (кодты) кодты көру бетінің өзінде іске қосу.

Веб-жобалар (HTML/CSS/JS) — файлдары /api/run/<id>/<жол> арқылы нақты URL-мен беріледі,
сондықтан браузер тек керегін жүктейді: үлкен жобада да, ES модульдерінде (import),
суреттерде, fetch('data.json')-да, беттер арасындағы сілтемелерде жұмыс істейді.
Қалғандары (Python, Node, Go…) — қолданушының терминалында (терминал файлдарды өзі алады).
"""
import base64
import html
import json
import mimetypes
import posixpath
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from database import codes

# Браузерде ашылмайтын жобалардың белгілері — болса терминалда іске қосылады
TERMINAL_MARKERS = {
    "package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml",
    "pom.xml", "build.gradle", "Makefile", "manage.py",
}
TERMINAL_EXTS = (".py", ".go", ".rs", ".java", ".c", ".cpp", ".cc", ".rb", ".php", ".ts", ".kt", ".cs")

# Бір жобаның индексі: id → (codes тізімінің ұзындығы, уақыты, {жол: код}). Бет жүктелгенде
# ондаған файл сұралады — әр сұрауда барлық кодтарды қарамау үшін қысқа уақытқа сақталады.
_index_cache: Dict[str, Tuple[int, float, Dict[str, Dict[str, Any]]]] = {}
INDEX_TTL = 10.0

# iframe ішіндегі console / қателерді ата-бетке жіберетін көпір (Vibecoding-тегімен бірдей).
# Құжаттың origin-і бос (sandbox), сондықтан localStorage қате берсе — жадтағы нұсқасы қойылады.
BRIDGE = """<script>(function(){
var T='code-run';
function fmt(v){try{if(v instanceof Error)return v.stack||String(v);if(typeof v==='object'&&v!==null)return JSON.stringify(v,null,2);return String(v);}catch(e){return String(v);}}
function send(level,args){try{parent.postMessage({source:T,type:'console',level:level,text:Array.prototype.map.call(args,fmt).join(' ')},'*');}catch(e){}}
['log','info','warn','error','debug'].forEach(function(l){var o=console[l];console[l]=function(){send(l,arguments);return o&&o.apply(console,arguments);};});
window.addEventListener('error',function(e){send('error',[e.message+(e.lineno?' ('+e.lineno+':'+e.colno+')':'')]);});
window.addEventListener('unhandledrejection',function(e){send('error',['Unhandled promise rejection: '+fmt(e.reason)]);});
function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null;},setItem:function(k,v){d[k]=String(v);},removeItem:function(k){delete d[k];},clear:function(){d={};},key:function(i){return Object.keys(d)[i]||null;},get length(){return Object.keys(d).length;}};}
['localStorage','sessionStorage'].forEach(function(n){try{window[n].length;}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true});}catch(e2){}}});
try{parent.postMessage({source:T,type:'page',path:location.pathname},'*');}catch(e){}
})();</script>"""

JS_RUNNER = "__run__.html"

LANG_EXT = {
    "python": ".py", "javascript": ".js", "typescript": ".ts", "html": ".html", "css": ".css",
    "java": ".java", "c": ".c", "cpp": ".cpp", "c++": ".cpp", "go": ".go", "rust": ".rs",
    "php": ".php", "ruby": ".rb", "csharp": ".cs", "kotlin": ".kt", "json": ".json", "markdown": ".md",
}


def _is_html(path: str) -> bool:
    return path.lower().endswith((".html", ".htm"))


def _is_js(path: str) -> bool:
    return path.lower().endswith((".js", ".mjs"))


def project_files(code: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Жобаның файлдары: {"src/game.js": код}. Жолдар жобаның түбірлік папкасынсыз.

    Жүктелген жобалардың folderPath-ы әдетте «Жоба/src/a.js» болады, ескілерінде түбір жоқ.
    """
    if not code.get("isFolder"):
        name = posixpath.basename(str(code.get("title") or "").replace("\\", "/")) or "main"
        if "." not in name:
            # Атауы файл аты емес («Калькулятор») — кеңейтімді тілінен аламыз
            name = f"main{LANG_EXT.get(str(code.get('language') or '').lower(), '.txt')}"
        return {name: code}

    cached = _index_cache.get(code["id"])
    if cached and cached[0] == len(codes) and time.monotonic() - cached[1] < INDEX_TTL:
        return cached[2]

    children = [c for c in codes if c.get("folderId") == code["id"]]
    paths = [str(c.get("folderPath") or c.get("title") or "").replace("\\", "/").strip("/") for c in children]
    root = paths[0].split("/", 1)[0] if paths else ""
    strip = bool(root) and all(p.startswith(f"{root}/") for p in paths)
    index: Dict[str, Dict[str, Any]] = {}
    for child, path in zip(children, paths):
        rel = path[len(root) + 1:] if strip else path
        if rel:
            index[rel] = child
    _index_cache[code["id"]] = (len(codes), time.monotonic(), index)
    return index


def _depth_key(path: str) -> Tuple[int, str]:
    return path.count("/"), path.lower()


def _has_dependencies(package_json: Optional[str]) -> bool:
    """package.json-да тәуелділіктер бар — жоба құрастыруды (npm) қажет етеді"""
    try:
        pkg = json.loads(package_json or "{}")
    except ValueError:
        return False
    return isinstance(pkg, dict) and any(pkg.get(k) for k in ("dependencies", "devDependencies"))


def pick_entry(paths: List[str], package_json: Optional[str] = None) -> Tuple[str, Optional[str]]:
    """(түрі, кіру файлы): web — браузерде, terminal — терминалда, none — іске қосатын ештеңе жоқ

    Түбірдегі index.html — статикалық сайт (егер npm тәуелділіктері болмаса: Vite/React
    жобасының index.html-і құрастырусыз ашылмайды). Python/Node/… белгілері болса — терминал
    (Flask-тың templates/*.html-і сайт емес).
    """
    html = sorted((p for p in paths if _is_html(p)), key=_depth_key)
    root_index = next((p for p in html if p.lower() in ("index.html", "index.htm")), None)
    if root_index and not _has_dependencies(package_json):
        return "web", root_index
    names = {p for p in paths if "/" not in p}
    if names & TERMINAL_MARKERS or any(p.lower().endswith(TERMINAL_EXTS) for p in paths):
        return "terminal", None
    if html:
        index = [p for p in html if posixpath.basename(p).lower() in ("index.html", "index.htm")]
        return "web", (index or html)[0]
    js = sorted((p for p in paths if _is_js(p)), key=_depth_key)
    if js:
        return "web", js[0]
    return "none", None


def run_info(code: Dict[str, Any]) -> Dict[str, Any]:
    files = project_files(code)
    paths = sorted(files, key=_depth_key)
    pkg = files.get("package.json")
    kind, entry = pick_entry(paths, pkg.get("content") if pkg else None)
    if kind == "web" and entry and _is_js(entry):
        entry = f"{JS_RUNNER}?file={quote(entry)}"
    return {
        "kind": kind,
        "entry": entry,
        "paths": paths[:5000],
        "packageJson": pkg.get("content") if pkg else None,
    }


def _content_bytes(code: Dict[str, Any]) -> Tuple[bytes, Optional[str]]:
    """Файлдың байттары; суреттер data-URL (base64) ретінде сақталады"""
    content = code.get("content") or ""
    if content.startswith("data:") and ";base64," in content[:200]:
        head, b64 = content.split(",", 1)
        try:
            return base64.b64decode(b64), head[5:].split(";", 1)[0] or None
        except ValueError:
            pass
    return content.encode("utf-8"), None


def _inject_bridge(doc: str) -> str:
    """Көпір басқа скрипттерден бұрын орындалуы керек (<head> жоқ болса — DOCTYPE-тан кейін)"""
    lower = doc.lower()
    head = re.search(r"<head(\s[^>]*)?>", lower)
    if head:
        return doc[:head.end()] + BRIDGE + doc[head.end():]
    if lower.lstrip().startswith("<!doctype"):
        end = lower.find(">")
        return doc[:end + 1] + BRIDGE + doc[end + 1:]
    return BRIDGE + doc


def _js_runner_page(file: str) -> str:
    """Жалғыз JS файлды бос бетте орындау — нәтижесі консольде"""
    # Runner жобаның түбірінде тұр, сондықтан src — файлдың толық жолы
    src = html.escape(quote(file), quote=True)
    module = ' type="module"' if file.lower().endswith(".mjs") else ""
    return (
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>'
        f'<script{module} src="{src}"></script></body></html>'
    )


def serve(code: Dict[str, Any], path: str, file_param: Optional[str] = None) -> Optional[Tuple[bytes, str]]:
    """Жоба ішіндегі файл: (байттар, MIME). Табылмаса — None."""
    path = posixpath.normpath("/" + (path or "")).lstrip("/")
    files = project_files(code)

    if path == JS_RUNNER:
        if not file_param or file_param not in files or not _is_js(file_param):
            return None
        return _inject_bridge(_js_runner_page(file_param)).encode("utf-8"), "text/html; charset=utf-8"

    if not path:
        pkg = files.get("package.json")
        kind, entry = pick_entry(list(files), pkg.get("content") if pkg else None)
        if kind != "web" or not entry or not _is_html(entry):
            return None
        path = entry
    target = files.get(path)
    if target is None and not path.lower().endswith((".html", ".htm")):
        # «/about» → «about.html» немесе «about/index.html»
        target = files.get(f"{path}.html") or files.get(f"{path}/index.html".lstrip("/"))
    if target is None:
        return None

    data, data_mime = _content_bytes(target)
    mime = data_mime or mimetypes.guess_type(path)[0] or "text/plain"
    if path.lower().endswith(".mjs"):
        mime = "text/javascript"
    if mime.startswith("text/") or mime in ("application/javascript", "application/json", "image/svg+xml"):
        if mime == "application/javascript":
            mime = "text/javascript"
        mime += "; charset=utf-8"
    if _is_html(path):
        data = _inject_bridge(data.decode("utf-8", errors="replace")).encode("utf-8")
    return data, mime


def terminal_files(code: Dict[str, Any], viewer: Optional[str] = None) -> List[Dict[str, Any]]:
    """Терминал папкасына жазылатын файлдар (суреттер мен бинарлы файлдарсыз).

    Терминал — қолданушының өз папкасы, сондықтан қорғалған файлдың түпнұсқасы (.env, нақты
    .sqlite база, тест деректері) рұқсаты барға (иесі; тест деректерін — мүшелер) жазылады.
    Қалғандарына — жария нұсқасы (бос үлгі / бос база құрылымы).
    """
    from services.code_service import CodeService
    from utils.protected_files import restore_original

    out: List[Dict[str, Any]] = []
    for path, child in project_files(code).items():
        if child.get("privateContent") and CodeService.can_see_private(child, viewer):
            original = restore_original(child)
            if isinstance(original, bytes):
                out.append({"path": path, "bytes": original})
                continue
            if original is not None:
                out.append({"path": path, "content": original})
                continue
        content = child.get("content") or ""
        if content.startswith("data:") and ";base64," in content[:200]:
            continue
        out.append({"path": path, "content": content})
    return out
