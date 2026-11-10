"""API router for the Stream Monitor (#96): decode and show a live stream.

Follows the mrtk run pattern (lessons L17): clients keep one WebSocket open
for the page's lifetime, get a `history` replay on connect, and every
broadcast that ends a session carries `exited: true`.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket
from pydantic import BaseModel, Field

from mrtklib_web_ui.api.message_hub import MessageHub
from mrtklib_web_ui.api.mrtk_relay import _stream_file_path, _validate_relay_args
from mrtklib_web_ui.services.receiver_console import MAX_COMMAND_BYTES, MAX_COMMAND_LINE, encode_command
from mrtklib_web_ui.services.stream_decoders.messages import MessageLog
from mrtklib_web_ui.services.stream_monitor_service import (
    INPUT_SCHEMES,
    STREAM_IDS,
    StreamId,
    StreamMonitorService,
    build_relay_args,
    free_port,
    stream_monitor_services as _services,
)

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_INGEST_FRAME = 65536  # bytes per WebSocket message from a browser input
BROWSER_INPUT = "browser"  # Web Serial in the page (#136); not a relay scheme


def _resolve(stream: str) -> tuple[MessageLog, bool] | None:
    service = _services.get(stream)  # type: ignore[call-overload]
    return (service.messages, service.is_running) if service is not None else None


_hub = MessageHub(
    "Stream Monitor", _resolve, valid_stream=lambda s: s in STREAM_IDS, default_stream="a"
)

for _service in _services.values():
    _service.set_broadcast(_hub.broadcast)
    _service.set_on_tick(_hub.send_all_rows)


class InputStream(BaseModel):
    type: str = Field(examples=[*INPUT_SCHEMES, BROWSER_INPUT])
    path: str = Field(
        max_length=1024,
        examples=["ttyACM0:115200", "localhost:9001", "user:pass@caster:2101/MOUNT"],
    )


class StreamMonitorStartRequest(BaseModel):
    stream: StreamId = "a"
    input: InputStream
    file_speed: float | None = Field(
        default=None,
        gt=0,
        le=1000,
        description="File input only: replay at this many times real time, paced by "
        "the epoch times; null reads the whole file at once",
    )


@router.post("/start")
async def start_monitor(request: StreamMonitorStartRequest) -> dict[str, Any]:
    service = _services[request.stream]
    if request.input.type == BROWSER_INPUT:
        return await _start_browser(service, request)
    others = [s for s in _services.values() if s is not service and s.is_running]
    port = free_port({s.port for s in others if s.port is not None})
    try:
        args = build_relay_args(request.input.type, request.input.path, port)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if err := _validate_relay_args(args):
        raise HTTPException(status_code=403, detail=err)
    if request.input.type == "file":
        return await _start_file(service, args[1], request)
    try:
        await service.start(args, args[1], port)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return service.status_message()


async def _start_file(
    service: StreamMonitorService, stream: str, request: StreamMonitorStartRequest
) -> dict[str, Any]:
    """File input (#161): read here, not through mrtk relay."""
    if "::" in request.input.path:
        raise HTTPException(
            status_code=400,
            detail="File options (::T, ::x...) are not supported here; choose the playback speed",
        )
    path = Path(_stream_file_path(stream) or "")  # the path _validate_relay_args checked
    if not path.is_file():
        raise HTTPException(status_code=400, detail=f"File not found: {path}")
    try:
        await service.start_file(path, request.file_speed)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return service.status_message()


async def _start_browser(
    service: StreamMonitorService, request: StreamMonitorStartRequest
) -> dict[str, Any]:
    """Browser input: the page sends the bytes of a serial port it opened with
    Web Serial to `/ingest`. `path` only names the port for display."""
    label = request.input.path.strip() or "serial port"
    try:
        await service.start_browser(f"browser-serial://{label}")
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return service.status_message()


class SendRequest(BaseModel):
    """One command for the receiver behind a running stream (#136): an ASCII
    `line` (CR LF is added) or binary `hex` (e.g. a UBX frame)."""

    stream: StreamId = "a"
    line: str | None = Field(default=None, max_length=MAX_COMMAND_LINE)
    hex: str | None = Field(default=None, max_length=2 * MAX_COMMAND_BYTES)


@router.post("/send")
async def send_command(request: SendRequest) -> dict[str, Any]:
    try:
        data, shown = encode_command(request.line, request.hex)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        await _services[request.stream].send(data, shown)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=502, detail=f"Write failed: {e}")
    return {"ok": True}


@router.post("/stop")
async def stop_monitor(stream: StreamId = "a") -> dict[str, Any]:
    await _services[stream].stop()
    return _services[stream].status_message()


@router.get("/status")
async def get_status(stream: StreamId = "a") -> dict[str, Any]:
    return _services[stream].status_message()


@router.websocket("/ingest")
async def websocket_ingest(
    websocket: WebSocket, stream: str = "a", session: str | None = None
) -> None:
    """Bytes of a browser input (#136), binary messages from the page that
    started the session (`session` = its `started_at`). Closing the socket ends
    the session; the server closes it when the session ends (Stop elsewhere).
    The server sends {"type": "write", "data": base64} for the page to write
    to its port (receiver commands)."""
    await websocket.accept()
    if stream not in STREAM_IDS:
        await websocket.close(code=1008, reason="Unknown stream")
        return
    service = _services[stream]

    async def write(data: bytes) -> None:
        """Bytes for the page's serial port (receiver commands)."""
        await websocket.send_text(
            json.dumps({"type": "write", "data": base64.b64encode(data).decode("ascii")})
        )

    try:
        run = service.attach_ingest(session, write)
    except ValueError as e:
        await websocket.close(code=1008, reason=str(e))
        return
    ended = asyncio.create_task(service.wait_ended())
    try:
        while True:
            received = asyncio.create_task(websocket.receive())
            done, _ = await asyncio.wait({received, ended}, return_when=asyncio.FIRST_COMPLETED)
            if received not in done:  # session ended (Stop from any page)
                received.cancel()
                await _close_quietly_code(websocket, 1000, "Session ended")
                return
            message = received.result()
            if message["type"] == "websocket.disconnect":
                return
            data = message.get("bytes")
            if data is None:
                continue  # text: reserved for messages from the page
            if len(data) > MAX_INGEST_FRAME:
                await _close_quietly_code(websocket, 1009, "Message too large")
                return
            await service.feed_ingest(run, data)
    finally:
        ended.cancel()
        await service.detach_ingest(run)


async def _close_quietly_code(ws: WebSocket, code: int, reason: str) -> None:
    try:
        await asyncio.wait_for(ws.close(code=code, reason=reason), timeout=5.0)
    except Exception:
        pass


@router.websocket("/ws")
async def websocket_monitor(websocket: WebSocket) -> None:
    """Every message but `message_rows` is per stream and carries `stream`
    ("a" / "b"). Messages sent to clients:

    - {"type": "history", "epochs": [...], "satellites": {...} | null, "logs": [...]}
      once on connect, per stream (epochs / satellites only while running)
    - {"type": "status", "running": bool, "state": ..., stats ...} each second;
      `exited: true` when a session ends
    - {"type": "epochs", "epochs": [Epoch, ...]} thinned to 1 Hz
    - {"type": "satellites", "time": ..., "time_sys": ..., "satellites": [...]}
    - {"type": "log", "message": "..."} mrtk relay output (credentials masked)
    - {"type": "messages", "now": ..., "types": [...]} per-type counters, each second
    - {"type": "message_rows", "label": ..., "reset": bool, "rows": [...]} to the
      page that selected this type; `reset` replaces what it had
    - {"type": "console", "entry": {"t", "dir": "tx" | "rx", "label", "text" |
      "summary" + "data"}} a command sent or the receiver's reply (#136);
      `history` carries the session's entries as `console`

    Sent by clients: {"type": "select_message", "stream": "a", "label": str | null}
    """
    def replay() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for service in _services.values():
            out += [service.history_message(), service.status_message()]
        return out

    await _hub.serve(websocket, replay)
