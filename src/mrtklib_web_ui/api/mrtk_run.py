"""API router for mrtk run (real-time processing)."""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from mrtklib_web_ui.paths import WORKSPACE_ROOT, is_within
from mrtklib_web_ui.services.mrtk_run_service import (
    MrtkRunService,
    MrtkRunStartRequest,
    StreamsConfigModel,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Singleton service instance
_service = MrtkRunService()

# Connected WebSocket clients for status streaming
_ws_clients: set[WebSocket] = set()


async def _broadcast(msg: dict[str, Any]) -> None:
    """Broadcast a message to all connected WebSocket clients."""
    global _ws_clients
    text = json.dumps(msg)
    disconnected = set()
    for ws in _ws_clients:
        try:
            await ws.send_text(text)
        except Exception:
            disconnected.add(ws)
    _ws_clients -= disconnected


async def _status_callback(status: dict[str, Any]) -> None:
    """Called by MrtkRunService on each status poll."""
    await _broadcast({"type": "status", **status})


async def _log_callback(line: str) -> None:
    """Called by MrtkRunService for each log line."""
    await _broadcast({"type": "log", "message": line})


class StartResponse(BaseModel):
    status: str
    message: str


class StopResponse(BaseModel):
    status: str
    message: str


class StatusResponse(BaseModel):
    running: bool
    status: dict = Field(default_factory=dict)


def _validate_write_streams(streams: StreamsConfigModel) -> str | None:
    """Ensure file-type output/log streams write only inside /workspace.

    Returns an error message, or None when all write streams are valid.
    The path is checked without its ``::`` file options (``::T``, ``::S=``);
    time keywords (``%Y``, ``%n``, ...) cannot introduce traversal.
    """
    targets = (
        ("Output 1", streams.output_stream1),
        ("Output 2", streams.output_stream2),
        ("Rover raw log", streams.log_stream1),
        ("Base raw log", streams.log_stream2),
        ("Correction raw log", streams.log_stream3),
    )
    for name, s in targets:
        if s.type != "file":
            continue
        base = s.path.split("::", 1)[0].strip()
        # An empty file path makes mrtk write to stdout
        if not base:
            return f"{name}: file path is required"
        p = Path(base)
        if not p.is_absolute() or not is_within(p, WORKSPACE_ROOT):
            return f"{name} must be within /workspace: {base}"
    return None


@router.post("/start")
async def start_run(request: MrtkRunStartRequest) -> StartResponse:
    """Start mrtk run -s with the given configuration."""
    if err := _validate_write_streams(request.streams):
        return StartResponse(status="error", message=err)
    try:
        await _service.start(
            request,
            status_callback=_status_callback,
            log_callback=_log_callback,
        )
        return StartResponse(status="ok", message="mrtk run started")
    except RuntimeError as e:
        return StartResponse(status="error", message=str(e))
    except Exception as e:
        logger.exception("Failed to start mrtk run")
        return StartResponse(status="error", message=str(e))


@router.post("/stop")
async def stop_run() -> StopResponse:
    """Stop the running mrtk run process."""
    try:
        await _service.stop()
        await _broadcast({"type": "status", "server_state": "stop", "running": False})
        return StopResponse(status="ok", message="mrtk run stopped")
    except Exception as e:
        logger.exception("Failed to stop mrtk run")
        return StopResponse(status="error", message=str(e))


@router.get("/status")
async def get_status() -> StatusResponse:
    """Get current status of mrtk run process."""
    if not _service.is_running:
        return StatusResponse(running=False, status={"server_state": "stop"})

    status = await _service.get_status()
    return StatusResponse(running=True, status=status)


@router.post("/export-toml")
async def export_run_toml(request: MrtkRunStartRequest):
    """Generate and download the full rtkrcv TOML config including [streams]."""
    from fastapi.responses import PlainTextResponse
    content = _service.generate_run_toml(request.config, request.streams)
    return PlainTextResponse(
        content=content,
        headers={"Content-Disposition": 'attachment; filename="rtkrcv.toml"'},
    )


@router.websocket("/ws")
async def websocket_run(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time mrtk run status streaming.

    Messages sent to clients:
    - {"type": "status", "lat": ..., "lon": ..., "quality": ..., ...}
    - {"type": "log", "message": "..."}
    """
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        # Send initial status. The explicit `running` flag drives the client's
        # Start/Stop lifecycle; the per-poll rtkrcv `server_state` never does.
        # When not running we send running=False WITHOUT `exited`, so a client
        # that is mid-startup (connects the WS before /start returns) ignores it
        # instead of flipping its optimistic "starting" state back to idle.
        if _service.is_running:
            status = await _service.get_status()
            await websocket.send_text(json.dumps({"type": "status", "running": True, **status}))
        else:
            await websocket.send_text(json.dumps({"type": "status", "server_state": "stop", "running": False}))

        # Keep connection alive
        while True:
            try:
                data = await websocket.receive_text()
                # Handle client commands if needed
                await websocket.send_text(json.dumps({"type": "ack", "received": data}))
            except WebSocketDisconnect:
                break
    finally:
        _ws_clients.discard(websocket)
