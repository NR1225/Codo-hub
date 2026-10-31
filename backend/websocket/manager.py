"""WebSocket connection manager for real-time messaging"""
from fastapi import WebSocket
from typing import Dict, Set
from collections import defaultdict


class ConnectionManager:
    """Manages WebSocket connections for users"""
    
    def __init__(self):
        # userId -> Set[WebSocket]
        self.active_connections: Dict[str, Set[WebSocket]] = defaultdict(set)
    
    async def connect(self, websocket: WebSocket, user_id: str):
        """Connect a user's WebSocket"""
        await websocket.accept()
        self.active_connections[user_id].add(websocket)
        print(f"User {user_id} connected. Total connections: {len(self.active_connections[user_id])}")
    
    def disconnect(self, websocket: WebSocket, user_id: str):
        """Disconnect a user's WebSocket"""
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        print(f"User {user_id} disconnected. Remaining connections: {len(self.active_connections.get(user_id, set()))}")
    
    async def send_personal_message(self, message: dict, user_id: str):
        """Send a message to a specific user via WebSocket"""
        if user_id in self.active_connections:
            # Файл сілтемелері әр алушыға өз қолтаңбасымен (utils/media_access.py)
            from utils.media_access import sign_payload
            message = sign_payload(message, str(user_id))
            disconnected = set()
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    print(f"Error sending message to {user_id}: {e}")
                    disconnected.add(connection)
            
            # Remove disconnected connections
            for conn in disconnected:
                self.active_connections[user_id].discard(conn)

    def is_user_online(self, user_id: str) -> bool:
        """Check if user is online"""
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0


# Global connection manager instance
manager = ConnectionManager()

