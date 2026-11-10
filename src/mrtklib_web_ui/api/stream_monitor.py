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
MAX_INGEST_FRAME = 65536  # bytes per WebSocket message from a browser input
MAX_COMMAND_LINE = 2000  # Septentrio's limit for one ASCII command
MAX_COMMAND_BYTES = 4096
BROWSER_INPUT = "browser"  # Web Serial in the page (#136); not a relay scheme


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
    service = _services[client.selected_stream]
    log = service.messages
    reset = client.log is not log
    if reset:  # just selected, or a new session
        client.log = log
        client.sent_seq = 0
    rows: list[dict[str, Any]] = []
    if service.is_running:  # like `history`: pages clear a finished session
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
    if (request.line is None) == (request.hex is None):
        raise HTTPException(status_code=400, detail="Give either line or hex")
    if request.line is not None:
        line = request.line.strip()
        if not line or any(not (0x20 <= ord(c) < 0x7F) for c in line):
            raise HTTPException(status_code=400, detail="A command line must be printable ASCII")
        data, shown = (line + "\r\n").encode("ascii"), line
    else:
        try:
            data = bytes.fromhex(request.hex or "")
        except ValueError:
            raise HTTPException(status_code=400, detail="hex is not valid hexadecimal")
        if not data:
            raise HTTPException(status_code=400, detail="hex is empty")
        shown = data.hex(" ").upper()
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
