"""Dev-сервер үшін DevTools проксиі.

Терминалда іске қосылған dev-сервер (Vite, Next, CRA …) сайттан басқа портта жұмыс істейді,
сондықтан Vibecoding «Көрініс» панелі оның консолі мен желі сұрауларын көре алмайды.
Бұл прокси өз портында тыңдап, барлық сұрауларды 127.0.0.1:<порт>-қа жібереді де,
HTML жауаптарға DevTools көпірін (dev_proxy_bridge.js) енгізеді. WebSocket (HMR) өзгеріссіз өтеді.

Қауіпсіздік:
• проксиді тек кірген қолданушы ашады; әр проксидің өз құпия токені бар —
  алғашқы /__codo_auth?t=… сұрауы HttpOnly cookie орнатады, онсыз барлық сұрау 403;
• жүйелік / дерекқор порттарына және сайттың өз портына жіберілмейді;
• біраз уақыт қолданылмаған прокси жабылады.
"""
from __future__ import annotations

import asyncio
import gzip
import logging
import os
import re
import secrets
import time
import zlib
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, quote

logger = logging.getLogger("codo_hub.dev_proxy")

BIND_HOST = os.getenv("DEV_PROXY_HOST", "0.0.0.0")
IDLE_TIMEOUT = 30 * 60
MAX_PROXIES_PER_USER = 4
MAX_HEAD_BYTES = 64 * 1024
MAX_BODY_BYTES = 50 * 1024 * 1024
MAX_HTML_BYTES = 20 * 1024 * 1024
CONNECT_TIMEOUT = 5.0

BRIDGE_PATH = "/__codo_bridge.js"
AUTH_PATH = "/__codo_auth"
BRIDGE_TAG = b'<script src="/__codo_bridge.js"></script>'

# Dev-сервер бола алмайтын, бірақ жергілікті машинада ашық болуы мүмкін қызметтер
BLOCKED_PORTS = {
    2375, 2376, 2379, 2380, 3306, 5432, 5984, 6379, 6443, 7474, 8086, 9042, 9200, 9300,
    11211, 15672, 27017, 27018, 28017, 50070,
}

_BRIDGE_JS: Optional[bytes] = None


def _bridge_js() -> bytes:
    global _BRIDGE_JS
    if _BRIDGE_JS is None:
        _BRIDGE_JS = (Path(__file__).with_name("dev_proxy_bridge.js")).read_bytes()
    return _BRIDGE_JS


def port_allowed(port: int) -> bool:
    if port < 1024 or port > 65535 or port in BLOCKED_PORTS:
        return False
    own = int(os.getenv("PORT", "3000") or 3000)
    return port != own


# ── HTTP көмекшілері ──

Headers = List[Tuple[str, str]]


def _parse_head(raw: bytes) -> Tuple[str, Headers]:
    lines = raw.decode("latin-1").split("\r\n")
    first = lines[0]
    headers: Headers = []
    for line in lines[1:]:
        if not line:
            continue
        name, sep, value = line.partition(":")
        if sep:
            headers.append((name.strip(), value.strip()))
    return first, headers


def _get(headers: Headers, name: str) -> Optional[str]:
    lname = name.lower()
    for k, v in headers:
        if k.lower() == lname:
            return v
    return None


def _drop(headers: Headers, *names: str) -> Headers:
    low = {n.lower() for n in names}
    return [(k, v) for k, v in headers if k.lower() not in low]


def _build_head(first: str, headers: Headers) -> bytes:
    return (first + "\r\n" + "".join(f"{k}: {v}\r\n" for k, v in headers) + "\r\n").encode("latin-1")


async def _read_chunked(reader: asyncio.StreamReader, limit: int) -> bytes:
    out = bytearray()
    while True:
        line = await reader.readuntil(b"\r\n")
        size = int(line.split(b";", 1)[0].strip() or b"0", 16)
        if size == 0:
            while (await reader.readuntil(b"\r\n")) != b"\r\n":
                pass
            return bytes(out)
        out += await reader.readexactly(size)
        await reader.readexactly(2)
        if len(out) > limit:
            raise ValueError("body too large")


async def _read_body(reader: asyncio.StreamReader, headers: Headers, limit: int, until_eof: bool) -> bytes:
    te = (_get(headers, "transfer-encoding") or "").lower()
    if "chunked" in te:
        return await _read_chunked(reader, limit)
    cl = _get(headers, "content-length")
    if cl is not None:
        n = int(cl)
        if n > limit:
            raise ValueError("body too large")
        return await reader.readexactly(n) if n else b""
    if not until_eof:
        return b""
    out = bytearray()
    while True:
        chunk = await reader.read(65536)
        if not chunk:
            return bytes(out)
        out += chunk
        if len(out) > limit:
            raise ValueError("body too large")


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionError, OSError, asyncio.IncompleteReadError):
        pass


def _close(writer: Optional[asyncio.StreamWriter]) -> None:
    if writer is None:
        return
    try:
        writer.close()
    except Exception:
        pass


async def _respond(writer: asyncio.StreamWriter, status: str, body: bytes = b"",
                   headers: Optional[Headers] = None, ctype: str = "text/plain; charset=utf-8") -> None:
    hdrs: Headers = [("Content-Type", ctype), ("Content-Length", str(len(body))),
                     ("Cache-Control", "no-store"), ("Connection", "close")]
    hdrs += headers or []
    writer.write(_build_head(f"HTTP/1.1 {status}", hdrs) + body)
    try:
        await writer.drain()
    except (ConnectionError, OSError):
        pass


_HEAD_RE = re.compile(rb"<head(\s[^>]*)?>", re.I)
_HTML_RE = re.compile(rb"<html(\s[^>]*)?>", re.I)


def _inject(html: bytes) -> bytes:
    for rx in (_HEAD_RE, _HTML_RE):
        m = rx.search(html, 0, 8192)
        if m:
            return html[: m.end()] + BRIDGE_TAG + html[m.end():]
    return BRIDGE_TAG + html


class DevProxy:
    def __init__(self, user_id: str, target_port: int):
        self.user_id = user_id
        self.target_port = target_port
        self.token = secrets.token_urlsafe(24)
        self.port = 0
        self.server: Optional[asyncio.base_events.Server] = None
        self.last_used = time.monotonic()

    @property
    def cookie_name(self) -> str:
        return f"codo_px_{self.port}"

    async def start(self) -> None:
        self.server = await asyncio.start_server(self._handle, host=BIND_HOST, port=0, limit=MAX_HEAD_BYTES * 2)
        self.port = self.server.sockets[0].getsockname()[1]

    def close(self) -> None:
        if self.server:
            self.server.close()
            self.server = None

    def _authorized(self, headers: Headers) -> bool:
        raw = _get(headers, "cookie") or ""
        for part in raw.split(";"):
            name, _, value = part.strip().partition("=")
            if name == self.cookie_name and secrets.compare_digest(value, self.token):
                return True
        return False

    def _strip_cookie(self, headers: Headers) -> Headers:
        raw = _get(headers, "cookie")
        if raw is None:
            return headers
        kept = [p.strip() for p in raw.split(";") if p.strip() and not p.strip().startswith(self.cookie_name + "=")]
        headers = _drop(headers, "cookie")
        if kept:
            headers.append(("Cookie", "; ".join(kept)))
        return headers

    async def _open_upstream(self):
        last: Optional[Exception] = None
        for host in ("127.0.0.1", "::1"):
            try:
                return await asyncio.wait_for(asyncio.open_connection(host, self.target_port), CONNECT_TIMEOUT)
            except (OSError, asyncio.TimeoutError) as e:
                last = e
        raise ConnectionError(str(last))

    async def _handle(self, cr: asyncio.StreamReader, cw: asyncio.StreamWriter) -> None:
        uw: Optional[asyncio.StreamWriter] = None
        try:
            try:
                raw = await asyncio.wait_for(cr.readuntil(b"\r\n\r\n"), 60)
            except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError, OSError):
                return
            if len(raw) > MAX_HEAD_BYTES:
                await _respond(cw, "431 Request Header Fields Too Large")
                return
            self.last_used = time.monotonic()
            first, headers = _parse_head(raw[:-4])
            parts = first.split(" ")
            if len(parts) != 3:
                await _respond(cw, "400 Bad Request")
                return
            method, target, _version = parts
            path, _, query = target.partition("?")

            if path == AUTH_PATH:
                q = parse_qs(query)
                token = (q.get("t") or [""])[0]
                nxt = (q.get("next") or ["/"])[0]
                if not nxt.startswith("/") or nxt.startswith("//"):
                    nxt = "/"
                if not secrets.compare_digest(token, self.token):
                    await _respond(cw, "403 Forbidden", b"Invalid proxy token")
                    return
                await _respond(cw, "302 Found", headers=[
                    ("Location", quote(nxt, safe="/?&=#%:+,;@!$'()*~-._")),
                    ("Set-Cookie", f"{self.cookie_name}={self.token}; Path=/; HttpOnly; SameSite=Lax"),
                ])
                return

            if not self._authorized(headers):
                await _respond(cw, "403 Forbidden", b"Codo Hub dev proxy: not authorized")
                return

            if path == BRIDGE_PATH:
                await _respond(cw, "200 OK", _bridge_js(), ctype="application/javascript; charset=utf-8")
                return

            upgrade = _get(headers, "upgrade") is not None
            origin_host = f"localhost:{self.target_port}"
            headers = self._strip_cookie(headers)
            headers = _drop(headers, "host", "proxy-connection", "keep-alive")
            headers.insert(0, ("Host", origin_host))
            if _get(headers, "origin"):
                headers = _drop(headers, "origin") + [("Origin", f"http://{origin_host}")]
            ref = _get(headers, "referer")
            if ref:
                headers = _drop(headers, "referer") + [("Referer", re.sub(r"^https?://[^/]+", f"http://{origin_host}", ref))]

            body = b""
            if not upgrade:
                try:
                    body = await _read_body(cr, headers, MAX_BODY_BYTES, until_eof=False)
                except (ValueError, asyncio.IncompleteReadError):
                    await _respond(cw, "413 Payload Too Large")
                    return
                headers = _drop(headers, "transfer-encoding", "content-length", "connection", "accept-encoding")
                if body or method.upper() in ("POST", "PUT", "PATCH"):
                    headers.append(("Content-Length", str(len(body))))
                headers += [("Accept-Encoding", "identity"), ("Connection", "close")]

            try:
                ur, uw = await self._open_upstream()
            except ConnectionError:
                await _respond(cw, "502 Bad Gateway",
                               f"Dev server on port {self.target_port} is not reachable".encode())
                return

            uw.write(_build_head(first, headers) + body)
            await uw.drain()

            if upgrade:
                # WebSocket (HMR) — екі бағытқа да өзгеріссіз
                tasks = [asyncio.create_task(_pipe(cr, uw)), asyncio.create_task(_pipe(ur, cw))]
                _done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for t in pending:
                    t.cancel()
                return

            resp_raw = await ur.readuntil(b"\r\n\r\n")
            status_line, rh = _parse_head(resp_raw[:-4])
            status_code = int((status_line.split(" ") + ["0", "0"])[1] or 0)
            rh = _drop(rh, "x-frame-options", "connection", "keep-alive")
            loc = _get(rh, "location")
            if loc:
                new_loc = re.sub(rf"^https?://(localhost|127\.0\.0\.1|\[::1\]):{self.target_port}", "", loc) or "/"
                rh = _drop(rh, "location") + [("Location", new_loc)]
            rh.append(("Connection", "close"))

            ctype = (_get(rh, "content-type") or "").lower()
            encoding = (_get(rh, "content-encoding") or "").lower()
            is_html = (
                "text/html" in ctype and method.upper() != "HEAD"
                and status_code not in (204, 304) and encoding in ("", "identity", "gzip", "deflate")
            )
            if is_html:
                try:
                    html = await _read_body(ur, rh, MAX_HTML_BYTES, until_eof=True)
                    if encoding == "gzip":
                        html = gzip.decompress(html)
                    elif encoding == "deflate":
                        html = zlib.decompress(html)
                except (ValueError, OSError, zlib.error, asyncio.IncompleteReadError):
                    await _respond(cw, "502 Bad Gateway", b"Could not read dev server response")
                    return
                html = _inject(html)
                rh = _drop(rh, "content-length", "transfer-encoding", "content-encoding")
                rh.append(("Content-Length", str(len(html))))
                cw.write(_build_head(status_line, rh) + html)
                await cw.drain()
                return

            # Қалғаны (JS, CSS, суреттер, SSE …) — ағынмен
            cw.write(_build_head(status_line, rh))
            await cw.drain()
            await _pipe(ur, cw)
        except (ConnectionError, OSError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            pass
        except Exception:
            logger.exception("dev proxy request failed")
        finally:
            _close(uw)
            _close(cw)


class DevProxyManager:
    def __init__(self) -> None:
        self.proxies: Dict[Tuple[str, int], DevProxy] = {}
        self._lock = asyncio.Lock()
        self._reaper: Optional[asyncio.Task] = None

    async def get_or_create(self, user_id: str, target_port: int) -> DevProxy:
        async with self._lock:
            self._reap()
            key = (user_id, target_port)
            proxy = self.proxies.get(key)
            if proxy and proxy.server:
                proxy.last_used = time.monotonic()
                return proxy
            mine = sorted((p for p in self.proxies.values() if p.user_id == user_id), key=lambda p: p.last_used)
            while len(mine) >= MAX_PROXIES_PER_USER:
                old = mine.pop(0)
                old.close()
                self.proxies.pop((old.user_id, old.target_port), None)
            proxy = DevProxy(user_id, target_port)
            await proxy.start()
            self.proxies[key] = proxy
            if self._reaper is None or self._reaper.done():
                self._reaper = asyncio.create_task(self._reap_loop())
            logger.info("dev proxy :%s -> :%s for user %s", proxy.port, target_port, user_id)
            return proxy

    def _reap(self) -> None:
        now = time.monotonic()
        for key, proxy in list(self.proxies.items()):
            if now - proxy.last_used > IDLE_TIMEOUT or proxy.server is None:
                proxy.close()
                self.proxies.pop(key, None)

    async def _reap_loop(self) -> None:
        while self.proxies:
            await asyncio.sleep(60)
            async with self._lock:
                self._reap()

    def close_all(self) -> None:
        for proxy in self.proxies.values():
            proxy.close()
        self.proxies.clear()


dev_proxy_manager = DevProxyManager()
