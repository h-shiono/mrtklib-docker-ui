"""API router for the Stream Monitor (#96): decode and show a live stream.

Follows the mrtk run pattern (lessons L17): clients keep one WebSocket open
for the page's lifetime, get a `history` replay on connect, and every
broadcast that ends a session carries `exited: true`.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from mrtklib_web_ui.api.mrtk_relay import _stream_file_path, _validate_relay_args
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

# Messages queued per client. A client whose send blocks (stalled network)
# fills its queue and is dropped, so it cannot hold up the other clients, the
# session ticker or the relay log callback (process_manager awaits it).
CLIENT_QUEUE_MAX = 256
MAX_SELECT_LABEL = 64


class _Client:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=CLIENT_QUEUE_MAX)
        self.task: asyncio.Task | None = None
        # The message type this page shows in its Message tab (#136), and
        # how far it has been sent. `log` tells when a new session began.
        self.selected_stream: StreamId = "a"
        self.selected: str | None = None
        self.sent_seq = 0
        self.log: MessageLog | None = None

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


def _send_rows(client: _Client) -> None:
    """Queue the new rows of the client's selected message type."""
    if client.selected is None:
        return
    log = _services[client.selected_stream].messages
    reset = client.log is not log
    if reset:  # just selected, or a new session
        client.log = log
        client.sent_seq = 0
    rows, client.sent_seq = log.rows(client.selected, client.sent_seq)
    if not rows and not reset:
        return
    msg = {
        "type": "message_rows",
        "stream": client.selected_stream,
        "label": client.selected,
        "reset": reset,
        "rows": rows,
    }
    try:
        client.queue.put_nowait(json.dumps(msg))
    except asyncio.QueueFull:
        logger.warning("Stream Monitor: dropping a WebSocket client that stopped reading")
        _drop(client, close=True)


def _send_all_rows() -> None:
    for client in list(_clients):
        _send_rows(client)


def _handle_client_message(client: _Client, text: str) -> None:
    """`{"type": "select_message", "stream": "a", "label": str | null}` from a page."""
    try:
        msg = json.loads(text)
    except ValueError:
        return
    if not isinstance(msg, dict) or msg.get("type") != "select_message":
        return
    label = msg.get("label")
    if label is not None and (not isinstance(label, str) or len(label) > MAX_SELECT_LABEL):
        return
    stream = msg.get("stream", "a")
    if stream not in STREAM_IDS:
        return
    client.selected_stream = stream
    client.selected = label
    client.log = None  # the next rows are a full replay
    _send_rows(client)


for _service in _services.values():
    _service.set_broadcast(_broadcast)
    _service.set_on_tick(_send_all_rows)


class InputStream(BaseModel):
    type: str = Field(examples=list(INPUT_SCHEMES))
    path: str = Field(
        max_length=1024,
        examples=["ttyACM0:115200", "localhost:9001", "user:pass@caster:2101/MOUNT"],
    )


class StreamMonitorStartRequest(BaseModel):
    stream: StreamId = "a"
    input: InputStream
    raw_log: str | None = Field(
        default=None,
        max_length=1024,
        description="Optional raw log file under /workspace (mrtk time keywords allowed)",
        examples=["/workspace/rtlog/monitor_%Y%m%d_%h%M.raw"],
    )
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
    others = [s for s in _services.values() if s is not service and s.is_running]
    port = free_port({s.port for s in others if s.port is not None})
    try:
        args, raw_log = build_relay_args(
            request.input.type,
            request.input.path,
            request.raw_log,
            port,
            other_raw_logs=[s.raw_log for s in others if s.raw_log],
        )
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    if err := _validate_relay_args(args):
        raise HTTPException(status_code=403, detail=err)
    if request.input.type == "file":
        return await _start_file(service, args[1], request)
    try:
        await service.start(args, args[1], raw_log, port)
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
    if request.raw_log:
        raise HTTPException(status_code=400, detail="A file input is not saved again as a raw log")
    path = Path(_stream_file_path(stream) or "")  # the path _validate_relay_args checked
    if not path.is_file():
        raise HTTPException(status_code=400, detail=f"File not found: {path}")
    try:
        await service.start_file(path, request.file_speed)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return service.status_message()


@router.post("/stop")
async def stop_monitor(stream: StreamId = "a") -> dict[str, Any]:
    await _services[stream].stop()
    return _services[stream].status_message()


@router.get("/status")
async def get_status(stream: StreamId = "a") -> dict[str, Any]:
    return _services[stream].status_message()


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

    Sent by clients: {"type": "select_message", "stream": "a", "label": str | null}
    """
    await websocket.accept()
    client = _Client(websocket)
    # Replay first, through the same queue so it stays ahead of live messages.
    for service in _services.values():
        client.queue.put_nowait(json.dumps(service.history_message()))
        client.queue.put_nowait(json.dumps(service.status_message()))
    _clients.add(client)
    client.task = asyncio.create_task(client.run())
    try:
        while True:
            try:
                text = await websocket.receive_text()
            except (WebSocketDisconnect, RuntimeError):  # RuntimeError: closed by _drop
                break
            _handle_client_message(client, text)
    finally:
        _drop(client)
