"""API router for the Stream Monitor (#96): decode and show a live stream.

Follows the mrtk run pattern (lessons L17): clients keep one WebSocket open
for the page's lifetime, get a `history` replay on connect, and every
broadcast that ends a session carries `exited: true`.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from mrtklib_web_ui.api.mrtk_relay import _validate_relay_args
from mrtklib_web_ui.services.stream_monitor_service import (
    INPUT_SCHEMES,
    build_relay_args,
    free_port,
    stream_monitor_service as _service,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Messages queued per client. A client whose send blocks (stalled network)
# fills its queue and is dropped, so it cannot hold up the other clients, the
# session ticker or the relay log callback (process_manager awaits it).
CLIENT_QUEUE_MAX = 256


class _Client:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=CLIENT_QUEUE_MAX)
        self.task: asyncio.Task | None = None

    async def run(self) -> None:
        while True:
            await self.ws.send_text(await self.queue.get())


_clients: set[_Client] = set()


def _drop(client: _Client, close: bool = False) -> None:
    _clients.discard(client)
    if client.task is not None:
        client.task.cancel()
    if close:
        # Closing makes the page reconnect and get a fresh `history`.
        asyncio.create_task(_close_quietly(client.ws))


async def _close_quietly(ws: WebSocket) -> None:
    try:
        await asyncio.wait_for(ws.close(code=1013), timeout=5.0)  # 1013: try again later
    except Exception:
        pass


async def _broadcast(msg: dict[str, Any]) -> None:
    """Queue a message for every client; never waits on a socket."""
    text = json.dumps(msg)
    for client in list(_clients):
        try:
            client.queue.put_nowait(text)
        except asyncio.QueueFull:
            logger.warning("Stream Monitor: dropping a WebSocket client that stopped reading")
            _drop(client, close=True)


_service.set_broadcast(_broadcast)


class InputStream(BaseModel):
    type: str = Field(examples=list(INPUT_SCHEMES))
    path: str = Field(
        max_length=1024,
        examples=["ttyACM0:115200", "localhost:9001", "user:pass@caster:2101/MOUNT"],
    )


class StreamMonitorStartRequest(BaseModel):
    input: InputStream
    raw_log: str | None = Field(
        default=None,
        max_length=1024,
        description="Optional raw log file under /workspace (mrtk time keywords allowed)",
        examples=["/workspace/rtlog/monitor_%Y%m%d_%h%M.raw"],
    )


@router.post("/start")
async def start_monitor(request: StreamMonitorStartRequest) -> dict[str, Any]:
    port = free_port()
    try:
        args, raw_log = build_relay_args(
            request.input.type, request.input.path, request.raw_log, port
        )
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    if err := _validate_relay_args(args):
        raise HTTPException(status_code=403, detail=err)
    try:
        await _service.start(args, args[1], raw_log, port)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _service.status_message()


@router.post("/stop")
async def stop_monitor() -> dict[str, Any]:
    await _service.stop()
    return _service.status_message()


@router.get("/status")
async def get_status() -> dict[str, Any]:
    return _service.status_message()


@router.websocket("/ws")
async def websocket_monitor(websocket: WebSocket) -> None:
    """Messages sent to clients:

    - {"type": "history", "epochs": [...], "satellites": {...} | null, "logs": [...]}
      once on connect (epochs / satellites only while running)
    - {"type": "status", "running": bool, "state": ..., stats ...} each second;
      `exited: true` when a session ends
    - {"type": "epochs", "epochs": [Epoch, ...]} thinned to 1 Hz
    - {"type": "satellites", "time": ..., "time_sys": ..., "satellites": [...]}
    - {"type": "log", "message": "..."} mrtk relay output (credentials masked)
    """
    await websocket.accept()
    client = _Client(websocket)
    # Replay first, through the same queue so it stays ahead of live messages.
    client.queue.put_nowait(json.dumps(_service.history_message()))
    client.queue.put_nowait(json.dumps(_service.status_message()))
    _clients.add(client)
    client.task = asyncio.create_task(client.run())
    try:
        while True:
            try:
                await websocket.receive_text()
            except (WebSocketDisconnect, RuntimeError):  # RuntimeError: closed by _drop
                break
    finally:
        _drop(client)
