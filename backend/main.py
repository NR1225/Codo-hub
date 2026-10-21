"""Kazakh Hub Backend API - Main application file"""
from dotenv import load_dotenv
load_dotenv()

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from datetime import datetime
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import uvicorn
import os
import asyncio
import logging

# Import database and config
from database import load_data, save_codes, save_users, save_friends, save_messages, save_friend_requests, codes
from config import FIRESTORE_SYNC_AVAILABLE, FIRESTORE_INIT
from db import init_db

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger("kazakh_hub")

# Import routes
from routes import api_router

# Rate limiter setup
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for startup and shutdown"""

    # Startup
    # Initialize SQL database
    init_db()

    # Migrate JSON users to SQL
    from migrate_json_users import migrate_json_users
    migrate_json_users()

    load_data()
    logger.info(f"Loaded {len(codes)} codes from file")
    
    # Initialize Firestore if available
    if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_INIT:
        try:
            FIRESTORE_INIT()
        except Exception as e:
            logger.warning(f"Firestore initialization failed: {e}")
    
    # Auto-save task
    async def auto_save():
        while True:
            await asyncio.sleep(30)  # Save every 30 seconds
            try:
                save_codes()
                save_users()
                save_friends()
                save_messages()
                save_friend_requests()
                logger.info("Auto-saved all data")
            except Exception as e:
                logger.error(f"Error in auto-save: {e}")
    
    # Start auto-save task
    auto_save_task = asyncio.create_task(auto_save())
    
    yield
    
    # Shutdown - save all data before closing
    try:
        save_codes()
        save_users()
        save_friends()
        save_messages()
        save_friend_requests()
        logger.info("All data saved on shutdown")
    except Exception as e:
        logger.error(f"Error saving data on shutdown: {e}")
    
    # Cancel auto-save task
    auto_save_task.cancel()
    try:
        await auto_save_task
    except asyncio.CancelledError:
        pass


# Initialize FastAPI app with lifespan
app = FastAPI(
    title="Kazakh Hub API",
    version="1.0.0",
    lifespan=lifespan
)

# Add rate limit exceeded handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware - MUST be the outermost layer so OPTIONS preflight
# requests are handled before any rate-limiting or other middleware.
_cors_origins_str = os.getenv("CORS_ORIGINS",
    "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:5177,http://localhost:5178,http://localhost:5179,"
    "http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,http://127.0.0.1:5176,http://127.0.0.1:5177,http://127.0.0.1:5178,http://127.0.0.1:5179")
_cors_origins = [origin.strip() for origin in _cors_origins_str.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# NOTE: SlowAPIMiddleware is NOT added as global middleware because it
# intercepts CORS OPTIONS preflight requests and returns 400 without
# Access-Control-Allow-Origin headers. Rate limiting is applied per-route
# via the @limiter.limit() decorator instead.


# Security headers and logging middleware.
# These are added via add_middleware() so they sit INSIDE (after) the CORS
# middleware in the request path — CORS handles OPTIONS preflight first,
# then these run only for actual requests.
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["X-Request-ID"] = os.urandom(16).hex()
        try:
            del response.headers["server"]
        except KeyError:
            pass
        return response

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        print(f"{datetime.now().isoformat()} - {request.method} {request.url.path}")
        response = await call_next(request)
        if request.method == "GET" and request.url.path.startswith("/api/codes"):
            response.headers["Cache-Control"] = "public, max-age=30"
        return response

# Add inner middleware BEFORE CORS (LIFO: last added = runs first on request)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

# Root endpoints
@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Kazakh Hub Backend API",
        "note": "This is the backend server. Please use the frontend at http://localhost:5174",
        "api": "http://localhost:3000/api",
        "frontend": "http://localhost:5174"
    }

@app.get("/api")
async def api_root():
    """API root endpoint with documentation"""
    return {
        "message": "Kazakh Hub API",
        "version": "1.0.0",
        "endpoints": {
            "health": "GET /api/health",
            "codes": {
                "getAll": "GET /api/codes",
                "getOne": "GET /api/codes/{id}",
                "create": "POST /api/codes",
                "update": "PUT /api/codes/{id}",
                "delete": "DELETE /api/codes/{id}"
            },
            "users": {
                "current": "GET /api/user",
                "profile": "GET /api/users/{id}"
            },
            "messages": {
                "getAll": "GET /api/messages/{user_id}",
                "getConversation": "GET /api/messages/{user_id}/{friend_id}",
                "create": "POST /api/messages",
                "markRead": "PUT /api/messages/{message_id}/read"
            },
            "friends": {
                "getAll": "GET /api/friends/{user_id}",
                "add": "POST /api/friends/{user_id}/add",
                "remove": "DELETE /api/friends/{user_id}/remove/{friend_id}"
            },
            "chats": {
                "getAll": "GET /api/chats/{user_id}"
            },
            "websocket": {
                "connect": "WS /api/ws/{user_id}"
            }
        }
    }

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "Kazakh Hub API is running"}

# Include API routes
app.include_router(api_router)

# Handle OPTIONS for uploads endpoint - let CORSMiddleware handle CORS headers
@app.options("/api/uploads/{file_path:path}")
async def serve_upload_options(file_path: str):
    """Handle CORS preflight for uploads"""
    return Response(content="")

# Custom endpoint for serving uploads with CORS headers
@app.get("/api/uploads/{file_path:path}")
async def serve_upload(file_path: str):
    """Serve uploaded files with CORS headers"""
    import urllib.parse
    
    # URL decode the file path to handle special characters and spaces
    try:
        decoded_path = urllib.parse.unquote(file_path)
    except Exception:
        decoded_path = file_path
    
    upload_dir = "uploads"
    file_full_path = os.path.join(upload_dir, decoded_path)
    
    # Normalize the path to handle any path separators
    file_full_path = os.path.normpath(file_full_path)
    
    # Security check: prevent directory traversal
    # Ensure the resolved path is still within upload_dir
    upload_dir_abs = os.path.abspath(upload_dir)
    file_full_path_abs = os.path.abspath(file_full_path)
    
    if not file_full_path_abs.startswith(upload_dir_abs) or ".." in decoded_path:
        response = JSONResponse(
            content={"error": "File not found"},
            status_code=404
        )
        return response
    
    # Check if file exists
    if not os.path.exists(file_full_path) or not os.path.isfile(file_full_path):
        response = JSONResponse(
            content={"error": "File not found"},
            status_code=404
        )
        return response
    
    # Determine content type based on decoded path
    content_type = "application/octet-stream"
    MIME_MAP = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    }
    ext = os.path.splitext(decoded_path)[1].lower()
    if ext in MIME_MAP:
        content_type = MIME_MAP[ext]
    
    # Get filename for Content-Disposition header
    filename = os.path.basename(decoded_path)

    return FileResponse(
        file_full_path,
        media_type=content_type,
        filename=filename,
        headers={
            "Cache-Control": "public, max-age=31536000",
        }
    )

# Include WebSocket endpoint directly (WebSocket doesn't work well with APIRouter)
from fastapi import WebSocket, WebSocketDisconnect, Query
from database import messages, save_messages
from websocket import manager
from utils.auth import resolve_access_user
from db import SessionLocal

@app.websocket("/api/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, token: str = Query(None)):
    """WebSocket endpoint for real-time messaging (requires JWT token)"""
    # Validate Origin header to prevent cross-site WebSocket hijacking
    origin = websocket.headers.get("origin", "")
    allowed_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174")
    allowed_origins = [o.strip() for o in allowed_origins_str.split(",") if o.strip()]
    if not origin or origin not in allowed_origins:
        await websocket.close(code=4003, reason="Origin not allowed")
        return

    # Validate JWT access token (required). Uses the same strict validation as
    # get_current_user: type=="access" + session_id must match the live session,
    # so a logged-out / session-revoked token is rejected here too.
    if not token:
        await websocket.close(code=4001, reason="Authentication required")
        return
    db = SessionLocal()
    try:
        try:
            user = resolve_access_user(token, db)
        except Exception:
            await websocket.close(code=4001, reason="Invalid token")
            return
        if user.id != user_id:
            await websocket.close(code=4001, reason="User ID mismatch")
            return
    finally:
        db.close()

    from services import presence_service
    was_online = manager.is_user_online(user_id)
    await manager.connect(websocket, user_id)
    await presence_service.on_connected(user_id, was_online)
    try:
        while True:
            data = await websocket.receive_json()
            message_type = data.get('type')
            
            if message_type == 'ping':
                await websocket.send_json({'type': 'pong'})
            elif message_type == 'mark_delivered':
                # Mark message as delivered
                message_id = data.get('messageId')
                if message_id:
                    message = next((msg for msg in messages if msg['id'] == message_id), None)
                    if message and message.get('status') == 'sent':
                        message['status'] = 'delivered'
                        save_messages()
            elif message_type == 'typing':
                # Forward typing indicator to recipient
                recipient_id = data.get('recipientId')
                if recipient_id:
                    await manager.send_personal_message({
                        'type': 'typing',
                        'userId': user_id,
                        'isTyping': data.get('isTyping', False)
                    }, recipient_id)
            elif message_type == 'group_typing':
                # Топта жазып жатқанын басқа мүшелерге жеткізу (тек мүше болса)
                group_id = data.get('groupId')
                if isinstance(group_id, str) and group_id:
                    from services.group_service import GroupService
                    tdb = SessionLocal()
                    try:
                        if GroupService.get_membership(tdb, group_id, user_id):
                            await GroupService.broadcast(tdb, group_id, {
                                'type': 'group_typing',
                                'groupId': group_id,
                                'userId': user_id,
                                'isTyping': bool(data.get('isTyping', False)),
                            }, exclude=user_id)
                    finally:
                        tdb.close()
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)
        await presence_service.on_disconnected(user_id)
    except Exception as e:
        print(f"WebSocket error for user {user_id}: {e}")
        manager.disconnect(websocket, user_id)
        await presence_service.on_disconnected(user_id)


# Terminal WebSocket endpoint for Vibecoding
from services.terminal_service import terminal_manager, TerminalLimitError
from config import (
    TERMINAL_ENABLED, TERMINAL_MAX_INPUT_BYTES,
    TERMINAL_INPUT_RATE_MAX, TERMINAL_INPUT_RATE_WINDOW,
)

@app.websocket("/api/ws/terminal")
async def terminal_websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    """WebSocket endpoint for terminal sessions in Vibecoding (requires JWT token)"""
    # Feature kill-switch.
    if not TERMINAL_ENABLED:
        await websocket.close(code=4004, reason="Terminal is disabled")
        return

    # Validate Origin header
    origin = websocket.headers.get("origin", "")
    allowed_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174")
    allowed_origins = [o.strip() for o in allowed_origins_str.split(",") if o.strip()]
    if not origin or origin not in allowed_origins:
        await websocket.close(code=4003, reason="Origin not allowed")
        return

    # Validate JWT access token. Same strict validation as get_current_user
    # (type=="access" + live session_id match) so a revoked session can't open
    # a terminal WebSocket either.
    if not token:
        await websocket.close(code=4001, reason="Authentication required")
        return

    user_id = None
    db = SessionLocal()
    try:
        try:
            user = resolve_access_user(token, db)
        except Exception:
            await websocket.close(code=4001, reason="Invalid token")
            return
        user_id = user.id
    finally:
        db.close()

    # Accept the WebSocket connection
    await websocket.accept()

    # Create a new terminal session (enforces per-user / global caps)
    session = None
    output_task = None
    try:
        try:
            session = await terminal_manager.create_session(user_id)
        except TerminalLimitError as e:
            await websocket.send_json({"type": "error", "message": str(e)})
            await websocket.close(code=4008, reason="Session limit")
            return

        # Send connected message
        await websocket.send_json({
            "type": "connected",
            "sessionId": session.session_id
        })

        # Start reading output from the terminal
        async def read_terminal_output():
            """Read output from the terminal and send it to the WebSocket"""
            try:
                while True:
                    data = await session.output_queue.get()
                    if data is None:
                        # Process exited
                        await websocket.send_json({
                            "type": "exit",
                            "code": session.process.returncode if session.process else 0
                        })
                        break
                    await websocket.send_json({
                        "type": "output",
                        "data": data
                    })
            except Exception as e:
                logger.error(f"Error reading terminal output: {e}")

        # Start output reader task
        output_task = asyncio.create_task(read_terminal_output())

        # Simple per-connection input rate limiter (sliding window).
        rate_window_start = asyncio.get_event_loop().time()
        rate_count = 0

        # Handle incoming messages
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")

            if message_type == "input":
                # Rate limit: cap input messages per window.
                now = asyncio.get_event_loop().time()
                if now - rate_window_start > TERMINAL_INPUT_RATE_WINDOW:
                    rate_window_start = now
                    rate_count = 0
                rate_count += 1
                if rate_count > TERMINAL_INPUT_RATE_MAX:
                    await websocket.send_json({"type": "error", "message": "Input rate limit exceeded"})
                    await websocket.close(code=4008, reason="Rate limit")
                    break

                input_data = data.get("data", "")
                if not isinstance(input_data, str):
                    continue
                # Size cap (defence in depth; the session also truncates).
                if len(input_data.encode("utf-8")) > TERMINAL_MAX_INPUT_BYTES:
                    input_data = input_data.encode("utf-8")[:TERMINAL_MAX_INPUT_BYTES].decode("utf-8", "ignore")
                # Audit log (truncated so secrets typed at the prompt aren't fully stored).
                logger.info("term-input user=%s session=%s bytes=%d", user_id, session.session_id, len(input_data))
                await session.write(input_data)

            elif message_type == "resize":
                cols = data.get("cols", 80)
                rows = data.get("rows", 24)
                await session.resize(cols, rows)
                session.touch()

            elif message_type == "ping":
                session.touch()
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info(f"Terminal WebSocket disconnected for user {user_id}")
    except Exception as e:
        logger.error(f"Terminal WebSocket error for user {user_id}: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        # Cleanup
        if output_task and not output_task.done():
            output_task.cancel()
            try:
                await output_task
            except asyncio.CancelledError:
                pass
        if session:
            await terminal_manager.close_session(session.session_id)


# Route-order fix: the literal "/api/ws/terminal" must be matched before the
# parametric "/api/ws/{user_id}" (defined earlier), which would otherwise
# capture "terminal" as a user_id and reject the handshake with "User ID
# mismatch". Starlette matches routes in registration order, so move the
# literal terminal route ahead of the parametric one.
def _prioritize_terminal_route():
    routes = app.router.routes
    term_idx = user_idx = None
    for i, r in enumerate(routes):
        path = getattr(r, "path", None)
        if path == "/api/ws/terminal" and term_idx is None:
            term_idx = i
        elif path == "/api/ws/{user_id}" and user_idx is None:
            user_idx = i
    if term_idx is not None and user_idx is not None and term_idx > user_idx:
        routes.insert(user_idx, routes.pop(term_idx))

_prioritize_terminal_route()


if __name__ == "__main__":
    # Default to 3000 for local development, 8080 for Cloud Run
    port = int(os.getenv("PORT", 3000))
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=port,
        timeout_keep_alive=75,  # Keep connections alive for 75 seconds
        timeout_graceful_shutdown=10,  # Graceful shutdown timeout
        access_log=True,  # Enable access logging for debugging
        server_header=False,  # Don't advertise the server software (info disclosure)
    )
