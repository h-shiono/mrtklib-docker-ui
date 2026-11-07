"""API router for the Stream Monitor (#96): decode and show a live stream.

Follows the mrtk run pattern (lessons L17): clients keep one WebSocket open
for the page's lifetime, get a `history` replay on connect, and every
broadcast that ends a session carries `exited: true`.
"""

from __future__ import annotations

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

_ws_clients: set[WebSocket] = set()


async def _broadcast(msg: dict[str, Any]) -> None:
    global _ws_clients
    text = json.dumps(msg)
    gone = set()
    for ws in list(_ws_clients):  # sends yield; handlers may discard meanwhile
        try:
            await ws.send_text(text)
        except Exception:
            gone.add(ws)
    _ws_clients -= gone


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
    _ws_clients.add(websocket)
    try:
        await websocket.send_text(json.dumps(_service.history_message()))
        await websocket.send_text(json.dumps(_service.status_message()))
        while True:
            try:
                await websocket.receive_text()
            except WebSocketDisconnect:
                break
    finally:
        _ws_clients.discard(websocket)
