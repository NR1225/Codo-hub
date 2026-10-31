"""Сайт мониторингі: қауіпсіздік оқиғаларының журналы, сұраныс статистикасы, ескерту хаттары.

- record(): оқиғаны security_events кестесіне жазады (кіру, қате кіру, құлыптау, кодтар, 5xx...).
  Мониторинг қатесі ешқашан негізгі сұранысты құлатпайды.
- MetricsMiddleware: әр сұраныстың уақыты, статусы, маршруты — жадта, соңғы 60 минут.
- Ескерту: қысқа уақытта қате кірулер не 5xx көбейсе, ADMIN_ALERT_EMAIL-ге хат (30 мин сайын бір рет).
- overview(): әкімші панеліне (/api/admin/monitoring/overview) барлық көрсеткіштер.
"""
import json
import logging
import os
import re
import shutil
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Any, Deque, Dict, List, Optional, Tuple

logger = logging.getLogger("codo_hub")

STARTED_AT = time.time()
WINDOW_MINUTES = 60

# Қай оқиға қаншалықты маңызды (панельде түсімен көрінеді)
SEVERITY = {
    "login_ok": "info",
    "login_fail": "warn",
    "login_unknown_user": "warn",
    "account_locked": "error",
    "login_code_sent": "info",
    "login_code_fail": "warn",
    "login_code_locked": "error",
    "login_code_ok": "info",
    "new_device": "info",
    "register": "info",
    "register_code_fail": "warn",
    "password_changed": "info",
    "password_reset_requested": "info",
    "password_reset": "info",
    "2fa_fail": "warn",
    "2fa_enabled": "info",
    "2fa_disabled": "warn",
    "refresh_reuse": "error",
    "rate_limited": "warn",
    "server_error": "error",
    "alert": "error",
    "admin_action": "warn",
    "test_code_bypass": "warn",
    "email_change_requested": "info",
    "email_change_code_fail": "warn",
    "email_changed": "warn",
}

_lock = threading.Lock()
# Жиі қайталанатын оқиғаларды (429, бір маршруттағы 5xx) журналға минутына бір рет қана жазу
_dedupe: Dict[Tuple[str, str], float] = {}
# Ескерту ережелері үшін соңғы оқиғалар уақыты
_recent: Dict[str, Deque[Tuple[float, Optional[str]]]] = defaultdict(lambda: deque(maxlen=2000))
_last_alert: Dict[str, float] = {}

ALERT_COOLDOWN = 30 * 60
ALERT_RULES = [
    # (ереже, оқиға түрлері, терезе сек, жалпы шек, бір IP-ден шек)
    ("brute_force", ("login_fail", "login_unknown_user", "login_code_fail", "2fa_fail", "email_change_code_fail"), 300, 30, 10),
    ("server_errors", ("server_error",), 300, 10, None),
    ("refresh_reuse", ("refresh_reuse",), 600, 3, None),
]


def _now_naive() -> datetime:
    return datetime.utcnow()


def record(kind: str, *, user_id: Optional[str] = None, ip: Optional[str] = None,
           detail: Optional[Dict[str, Any]] = None, dedupe_key: Optional[str] = None) -> None:
    """Оқиғаны журналға жазу. Ешқашан exception лақтырмайды"""
    now = time.time()
    try:
        if dedupe_key is not None:
            key = (kind, dedupe_key)
            with _lock:
                if now - _dedupe.get(key, 0) < 60:
                    return
                _dedupe[key] = now
                if len(_dedupe) > 5000:
                    for k, t in list(_dedupe.items()):
                        if now - t > 60:
                            _dedupe.pop(k, None)

        from db import SecurityEvent, SessionLocal

        db = SessionLocal()
        try:
            db.add(SecurityEvent(
                kind=kind[:40],
                severity=SEVERITY.get(kind, "info"),
                user_id=(str(user_id)[:12] if user_id else None),
                ip=(ip or "")[:64] or None,
                detail=json.dumps(detail, ensure_ascii=False, default=str)[:4000] if detail else None,
            ))
            db.commit()
        finally:
            db.close()
    except Exception as e:  # мониторинг сайтты құлатпауы керек
        logger.warning("monitoring.record failed: %s", e)
        return

    if kind != "alert":
        with _lock:
            _recent[kind].append((now, ip))
        _check_alerts(kind, now)


def _check_alerts(kind: str, now: float) -> None:
    for rule, kinds, window, total_limit, ip_limit in ALERT_RULES:
        if kind not in kinds:
            continue
        with _lock:
            hits = [(t, ip) for k in kinds for (t, ip) in _recent[k] if now - t <= window]
            if now - _last_alert.get(rule, 0) < ALERT_COOLDOWN:
                continue
            per_ip: Dict[str, int] = defaultdict(int)
            for _, ip in hits:
                if ip:
                    per_ip[ip] += 1
            top_ip, top_count = max(per_ip.items(), key=lambda x: x[1], default=(None, 0))
            fired = len(hits) >= total_limit or (ip_limit is not None and top_count >= ip_limit)
            if not fired:
                continue
            _last_alert[rule] = now
        detail = {"rule": rule, "count": len(hits), "windowSeconds": window, "topIp": top_ip, "topIpCount": top_count}
        record("alert", ip=top_ip, detail=detail)
        threading.Thread(target=_send_alert_email, args=(detail,), daemon=True).start()


def _send_alert_email(detail: Dict[str, Any]) -> None:
    from config import ADMIN_ALERT_EMAIL, SMTP_ENABLED

    if not ADMIN_ALERT_EMAIL:
        return
    titles = {
        "brute_force": "Құпия сөзді теру әрекеті (brute force)",
        "server_errors": "Серверде қателер көбейді (5xx)",
        "refresh_reuse": "Ұрланған сессия токенін қолдану әрекеті",
    }
    title = titles.get(detail["rule"], detail["rule"])
    text = (
        f"Codo Hub мониторингі: {title}\n\n"
        f"Соңғы {detail['windowSeconds'] // 60} минутта: {detail['count']} оқиға\n"
        f"Ең белсенді IP: {detail.get('topIp') or '—'} ({detail.get('topIpCount', 0)})\n\n"
        "Толығырақ: сайттағы /admin/monitoring беті.\n"
    )
    if not SMTP_ENABLED:
        logger.warning("ALERT (SMTP өшірулі): %s", text)
        return
    from utils.email import _send_email

    html = "<pre style=\"font-family:Consolas,monospace;font-size:14px\">" + \
        text.replace("&", "&amp;").replace("<", "&lt;") + "</pre>"
    _send_email(ADMIN_ALERT_EMAIL, f"⚠ Codo Hub: {title}", html, text)


# ───────────────────────── Сұраныс статистикасы ─────────────────────────

class _Minute:
    __slots__ = ("count", "c4xx", "c5xx", "latencies", "routes")

    def __init__(self):
        self.count = 0
        self.c4xx = 0
        self.c5xx = 0
        self.latencies: List[float] = []
        # маршрут → [саны, жалпы ms, ең ұзақ ms, қате саны]
        self.routes: Dict[str, List[float]] = {}


_minutes: Dict[int, _Minute] = {}


def _observe(route: str, method: str, status: int, ms: float) -> None:
    minute = int(time.time() // 60)
    with _lock:
        bucket = _minutes.get(minute)
        if bucket is None:
            bucket = _minutes[minute] = _Minute()
            for old in [m for m in _minutes if m <= minute - WINDOW_MINUTES]:
                _minutes.pop(old, None)
        bucket.count += 1
        if 400 <= status < 500:
            bucket.c4xx += 1
        elif status >= 500:
            bucket.c5xx += 1
        if len(bucket.latencies) < 2000:
            bucket.latencies.append(ms)
        key = f"{method} {route}"
        stat = bucket.routes.get(key)
        if stat is None:
            if len(bucket.routes) >= 300:
                return
            stat = bucket.routes[key] = [0, 0.0, 0.0, 0]
        stat[0] += 1
        stat[1] += ms
        stat[2] = max(stat[2], ms)
        if status >= 500:
            stat[3] += 1


_ID_SEGMENT = re.compile(r"^(\d+|[0-9a-fA-F-]{8,}|[A-Za-z0-9_-]{20,}|~.*|fork-.*)$")


def _normalize_path(path: str) -> str:
    """/api/codes/16b3ddbb-.../run-info → /api/codes/{id}/run-info (ID-лер бір маршрутқа жиналады).
    Файл жолдары (/api/uploads/..., /api/run/...) қысқартылады"""
    parts = path.split("/")
    for prefix in ("uploads", "run"):
        if len(parts) > 3 and parts[1] == "api" and parts[2] == prefix:
            return f"/api/{prefix}/{{path}}"
    return "/".join("{id}" if _ID_SEGMENT.match(p) else p for p in parts)[:200]


class MetricsMiddleware:
    """Таза ASGI middleware (стрим жауаптарды бұзбайды): уақыт, статус, маршрут шаблоны.
    Өңделмеген exception — журналға server_error ретінде жазылып, әрі қарай лақтырылады"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api"):
            return await self.app(scope, receive, send)

        start = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
            await send(message)

        error: Optional[BaseException] = None
        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as e:
            error = e
            raise
        finally:
            ms = (time.perf_counter() - start) * 1000
            route_obj = scope.get("route")
            route = getattr(route_obj, "path", None)
            if route and not route.startswith("/api"):
                route = "/api" + route
            route = route or _normalize_path(scope.get("path", ""))
            method = scope.get("method", "GET")
            status = 500 if error else status_holder["status"]
            if method != "OPTIONS":
                _observe(route, method, status, ms)
            client = scope.get("client")
            ip = client[0] if client else None
            if status >= 500:
                record("server_error", ip=ip, dedupe_key=f"{method} {route}", detail={
                    "route": f"{method} {route}", "status": status,
                    "error": f"{type(error).__name__}: {str(error)[:300]}" if error else None,
                })
            elif status == 429:
                record("rate_limited", ip=ip, dedupe_key=ip or "-", detail={"route": f"{method} {route}"})


# ───────────────────────── Әкімші панеліне ─────────────────────────

def _percentile(values: List[float], q: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    idx = min(len(values) - 1, max(0, int(round(q * (len(values) - 1)))))
    return round(values[idx], 1)


def _dir_size(path: str, limit: int = 200_000) -> int:
    total = 0
    seen = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
            seen += 1
            if seen >= limit:
                return total
    return total


_size_cache: Dict[str, Tuple[float, int]] = {}


def _cached_dir_size(path: str) -> int:
    hit = _size_cache.get(path)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    size = _dir_size(path) if os.path.isdir(path) else 0
    _size_cache[path] = (time.time(), size)
    return size


def _process_memory_mb() -> Optional[float]:
    try:
        import psutil  # type: ignore

        return round(psutil.Process().memory_info().rss / 1024 / 1024, 1)
    except Exception:
        pass
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)
    except OSError:
        pass
    return None


def _cpu_percent() -> Optional[float]:
    try:
        import psutil  # type: ignore

        return psutil.cpu_percent(interval=None)
    except Exception:
        return None


def overview(db) -> Dict[str, Any]:
    from db import DB_PATH, SecurityEvent, User
    from sqlalchemy import func

    now_minute = int(time.time() // 60)
    with _lock:
        buckets = {m: b for m, b in _minutes.items() if m > now_minute - WINDOW_MINUTES}
        series = []
        latencies: List[float] = []
        routes: Dict[str, List[float]] = {}
        total = c4 = c5 = 0
        for m in range(now_minute - WINDOW_MINUTES + 1, now_minute + 1):
            b = buckets.get(m)
            series.append({
                "t": datetime.utcfromtimestamp(m * 60).isoformat() + "Z",
                "requests": b.count if b else 0,
                "errors": b.c5xx if b else 0,
                "clientErrors": b.c4xx if b else 0,
            })
            if not b:
                continue
            total += b.count
            c4 += b.c4xx
            c5 += b.c5xx
            latencies.extend(b.latencies)
            for key, (cnt, tot, mx, err) in b.routes.items():
                agg = routes.setdefault(key, [0, 0.0, 0.0, 0])
                agg[0] += cnt
                agg[1] += tot
                agg[2] = max(agg[2], mx)
                agg[3] += err

    top_routes = sorted(
        ({"route": k, "count": int(v[0]), "avgMs": round(v[1] / v[0], 1) if v[0] else 0,
          "maxMs": round(v[2], 1), "errors": int(v[3])} for k, v in routes.items()),
        key=lambda r: r["count"], reverse=True,
    )
    slow_routes = sorted(top_routes, key=lambda r: r["avgMs"], reverse=True)[:8]

    since = _now_naive() - timedelta(hours=24)
    counts = dict(
        db.query(SecurityEvent.kind, func.count(SecurityEvent.id))
        .filter(SecurityEvent.created_at >= since)
        .group_by(SecurityEvent.kind)
        .all()
    )
    top_ips = [
        {"ip": ip, "count": cnt}
        for ip, cnt in db.query(SecurityEvent.ip, func.count(SecurityEvent.id))
        .filter(SecurityEvent.created_at >= since, SecurityEvent.severity != "info", SecurityEvent.ip.isnot(None))
        .group_by(SecurityEvent.ip)
        .order_by(func.count(SecurityEvent.id).desc())
        .limit(8)
        .all()
    ]
    now = _now_naive()
    locked_now = db.query(func.count(User.id)).filter(User.locked_until.isnot(None), User.locked_until > now).scalar() or 0

    try:
        from websocket.manager import manager

        ws_users = len(manager.active_connections)
        ws_connections = sum(len(v) for v in manager.active_connections.values())
    except Exception:
        ws_users = ws_connections = 0
    try:
        from services.terminal_service import terminal_manager

        terminals = len(getattr(terminal_manager, "sessions", {}) or {})
    except Exception:
        terminals = None

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        disk = shutil.disk_usage(backend_dir)
        disk_info = {"totalGb": round(disk.total / 1e9, 1), "freeGb": round(disk.free / 1e9, 1),
                     "usedPercent": round(disk.used / disk.total * 100, 1)}
    except OSError:
        disk_info = None

    return {
        "generatedAt": now.isoformat() + "Z",
        "uptimeSeconds": int(time.time() - STARTED_AT),
        "requests": {
            "total": total,
            "clientErrors": c4,
            "serverErrors": c5,
            "errorRate": round(c5 / total * 100, 2) if total else 0,
            "p50Ms": _percentile(latencies, 0.5),
            "p95Ms": _percentile(latencies, 0.95),
            "p99Ms": _percentile(latencies, 0.99),
            "series": series,
            "topRoutes": top_routes[:10],
            "slowRoutes": slow_routes,
        },
        "security24h": {
            "loginOk": counts.get("login_ok", 0),
            "loginFail": counts.get("login_fail", 0) + counts.get("login_unknown_user", 0),
            "accountLocked": counts.get("account_locked", 0),
            "codesSent": counts.get("login_code_sent", 0),
            "codeFails": counts.get("login_code_fail", 0),
            "newDevices": counts.get("new_device", 0),
            "registrations": counts.get("register", 0),
            "rateLimited": counts.get("rate_limited", 0),
            "serverErrors": counts.get("server_error", 0),
            "refreshReuse": counts.get("refresh_reuse", 0),
            "alerts": counts.get("alert", 0),
            "lockedAccountsNow": locked_now,
            "byKind": counts,
            "topIps": top_ips,
        },
        "users": {
            "total": db.query(func.count(User.id)).scalar() or 0,
            "onlineNow": ws_users,
            "wsConnections": ws_connections,
            "activeTerminals": terminals,
        },
        "system": {
            "memoryMb": _process_memory_mb(),
            "cpuPercent": _cpu_percent(),
            "disk": disk_info,
            "dbSizeMb": round(os.path.getsize(DB_PATH) / 1024 / 1024, 2) if os.path.exists(DB_PATH) else None,
            "uploadsSizeMb": round(_cached_dir_size(os.path.join(backend_dir, "uploads")) / 1024 / 1024, 1),
            "pid": os.getpid(),
        },
    }


def list_events(db, kind: Optional[str], severity: Optional[str], user_id: Optional[str], ip: Optional[str],
                before_id: Optional[int], limit: int) -> List[Dict[str, Any]]:
    from db import SecurityEvent, User

    q = db.query(SecurityEvent)
    if kind:
        q = q.filter(SecurityEvent.kind == kind)
    if severity:
        q = q.filter(SecurityEvent.severity == severity)
    if user_id:
        q = q.filter(SecurityEvent.user_id == user_id)
    if ip:
        q = q.filter(SecurityEvent.ip == ip)
    if before_id:
        q = q.filter(SecurityEvent.id < before_id)
    rows = q.order_by(SecurityEvent.id.desc()).limit(limit).all()
    ids = {r.user_id for r in rows if r.user_id}
    names = {u.id: u.username for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    out = []
    for r in rows:
        try:
            detail = json.loads(r.detail) if r.detail else None
        except ValueError:
            detail = r.detail
        out.append({
            "id": r.id,
            "at": r.created_at.isoformat() + "Z" if r.created_at else None,
            "kind": r.kind,
            "severity": r.severity,
            "userId": r.user_id,
            "username": names.get(r.user_id),
            "ip": r.ip,
            "detail": detail,
        })
    return out


def purge_old() -> int:
    from config import SECURITY_EVENTS_RETENTION_DAYS
    from db import LoginChallenge, SecurityEvent, SessionLocal

    db = SessionLocal()
    try:
        cutoff = _now_naive() - timedelta(days=SECURITY_EVENTS_RETENTION_DAYS)
        n = db.query(SecurityEvent).filter(SecurityEvent.created_at < cutoff).delete()
        db.query(LoginChallenge).filter(LoginChallenge.expires_at < _now_naive()).delete()
        db.commit()
        return n
    finally:
        db.close()
