"""WebSocket connection manager for real-time log streaming."""

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from fastapi import WebSocket


@dataclass
class WebSocketManager:
    """Manages WebSocket connections and message broadcasting.

    Handles multiple client connections and broadcasts log messages
    from RTKLIB processes to all connected clients.
    """

    # Active WebSocket connections
    _connections: set[WebSocket] = field(default_factory=set)

    # Lock for thread-safe connection management
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def connect(self, websocket: WebSocket) -> None:
        """Accept and register a new WebSocket connection.

        Args:
            websocket: The WebSocket connection to register
        """
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

        # Send welcome message
        await self._send_to_client(
            websocket,
            {
                "type": "connected",
                "message": "Connected to RTKLIB Web UI log stream",
                "timestamp": datetime.now().isoformat(),
            },
        )

    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection.

        Args:
            websocket: The WebSocket connection to remove
        """
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Broadcast a message to all connected clients.

        Args:
            message: Dictionary to serialize and send as JSON
        """
        if not self._connections:
            return

        # Add timestamp if not present
        if "timestamp" not in message:
            message["timestamp"] = datetime.now().isoformat()

        # Copy connections to avoid modification during iteration
        async with self._lock:
            connections = list(self._connections)

        # Send to all connections
        disconnected = []
        for websocket in connections:
            try:
                await self._send_to_client(websocket, message)
            except Exception:
                disconnected.append(websocket)

        # Remove failed connections
        if disconnected:
            async with self._lock:
                for ws in disconnected:
                    self._connections.discard(ws)

    async def broadcast_log(self, process_id: str, log_line: str) -> None:
        """Broadcast a log line from a process.

        Args:
            process_id: ID of the process that generated the log
            log_line: The log message
        """
        await self.broadcast(
            {
                "type": "log",
                "process_id": process_id,
                "message": log_line,
            }
        )

    async def broadcast_status(
        self, process_id: str, status: str, details: dict[str, Any] | None = None
    ) -> None:
        """Broadcast a process status update.

        Args:
            process_id: ID of the process
            status: Current status (running, stopped, error)
            details: Optional additional details
        """
        message = {
            "type": "status",
            "process_id": process_id,
            "status": status,
        }
        if details:
            message["details"] = details

        await self.broadcast(message)

    async def broadcast_progress(
        self, process_id: str, progress: dict[str, Any]
    ) -> None:
        """Broadcast processing progress update.

        Args:
            process_id: ID of the process
            progress: Progress data (epoch, quality, ns, ratio)
        """
        await self.broadcast(
            {
                "type": "progress",
                "process_id": process_id,
                **progress,
            }
        )

    async def _send_to_client(
        self, websocket: WebSocket, message: dict[str, Any]
    ) -> None:
        """Send a message to a single client.

        Args:
            websocket: Target WebSocket connection
            message: Message to send
        """
        await websocket.send_text(json.dumps(message))

    @property
    def connection_count(self) -> int:
        """Get the number of active connections."""
        return len(self._connections)


# Global WebSocket manager instance
ws_manager = WebSocketManager()
