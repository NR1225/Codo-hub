"""Terminal service for managing PTY sessions via WebSocket"""
import asyncio
import os
import sys
import uuid
import logging
from typing import Dict, Optional

logger = logging.getLogger("kazakh_hub.terminal")

# Check platform for PTY support
IS_WINDOWS = sys.platform == "win32"


class TerminalSession:
    """Represents a single terminal session with a PTY process"""

    def __init__(self, session_id: str, user_id: str, cols: int = 80, rows: int = 24):
        self.session_id = session_id
        self.user_id = user_id
        self.cols = cols
        self.rows = rows
        self.process: Optional[asyncio.subprocess.Process] = None
        self.created_at = asyncio.get_event_loop().time()

    async def start(self):
        """Start the shell process"""
        try:
            if IS_WINDOWS:
                # Windows: use cmd.exe with pseudo-terminal simulation
                self.process = await asyncio.create_subprocess_exec(
                    "cmd.exe",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
            else:
                # Unix: use bash with PTY if available
                import pty
                master_fd, slave_fd = pty.openpty()
                self.process = await asyncio.create_subprocess_exec(
                    "/bin/bash",
                    stdin=slave_fd,
                    stdout=slave_fd,
                    stderr=slave_fd,
                )
                os.close(slave_fd)
                self._master_fd = master_fd
            logger.info(f"Terminal session {self.session_id} started for user {self.user_id}")
        except Exception as e:
            logger.error(f"Failed to start terminal session {self.session_id}: {e}")
            raise

    async def write(self, data: str):
        """Write data to the process stdin"""
        if self.process and self.process.stdin:
            try:
                self.process.stdin.write(data.encode("utf-8"))
                await self.process.stdin.drain()
            except Exception as e:
                logger.error(f"Error writing to terminal {self.session_id}: {e}")

    async def resize(self, cols: int, rows: int):
        """Resize the terminal"""
        self.cols = cols
        self.rows = rows
        # On Unix, we could resize the PTY here
        # For now, just update the stored dimensions

    async def kill(self):
        """Kill the process"""
        if self.process:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.process.kill()
            except Exception as e:
                logger.error(f"Error killing terminal {self.session_id}: {e}")
            finally:
                self.process = None

    @property
    def is_alive(self) -> bool:
        """Check if the process is still running"""
        return self.process is not None and self.process.returncode is None


class TerminalManager:
    """Manages all terminal sessions"""

    def __init__(self):
        self.sessions: Dict[str, TerminalSession] = {}
        self._cleanup_task: Optional[asyncio.Task] = None

    async def create_session(self, user_id: str, cols: int = 80, rows: int = 24) -> TerminalSession:
        """Create a new terminal session"""
        session_id = str(uuid.uuid4())
        session = TerminalSession(session_id, user_id, cols, rows)
        await session.start()
        self.sessions[session_id] = session

        # Start reading output
        asyncio.create_task(self._read_output(session))

        return session

    async def _read_output(self, session: TerminalSession):
        """Read output from a terminal session and store it"""
        if not session.process or not session.process.stdout:
            return

        try:
            while session.is_alive:
                data = await session.process.stdout.read(4096)
                if not data:
                    break
                # Store output for the WebSocket handler to pick up
                if not hasattr(session, '_output_queue'):
                    session._output_queue = asyncio.Queue()
                await session._output_queue.put(data.decode("utf-8", errors="replace"))
        except Exception as e:
            logger.error(f"Error reading from terminal {session.session_id}: {e}")
        finally:
            if not hasattr(session, '_output_queue'):
                session._output_queue = asyncio.Queue()
            await session._output_queue.put(None)  # Signal end of output

    async def close_session(self, session_id: str):
        """Close and cleanup a terminal session"""
        session = self.sessions.pop(session_id, None)
        if session:
            await session.kill()
            logger.info(f"Terminal session {session_id} closed")


# Global terminal manager instance
terminal_manager = TerminalManager()