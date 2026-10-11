"""API router for mrtk run (real-time processing)."""

import asyncio
import json
import logging
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from mrtklib_web_ui.paths import WORKSPACE_ROOT, is_within
from mrtklib_web_ui.services.mrtk_run_service import (
    MrtkRunService,
    MrtkRunStartRequest,
    StreamsConfigModel,
    expand_path_keywords,
    gpst_now,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Singleton service instance
_service = MrtkRunService()

# Connected WebSocket clients for status streaming
_ws_clients: set[WebSocket] = set()

# Replay state for clients that (re)connect mid-run, e.g. after a page reload
# or a dropped SSH tunnel. Cleared on each start. Log lines arrive here already
# credential-masked by the service.
MAX_LOG_HISTORY = 500
MAX_STATUS_HISTORY = 600
_log_history: deque[str] = deque(maxlen=MAX_LOG_HISTORY)
_status_history: deque[dict[str, Any]] = deque(maxlen=MAX_STATUS_HISTORY)
_last_status: dict[str, Any] = {}
# Debug trace of the current (or last) run: kept after exit like the log.
MAX_TRACE_HISTORY = 1000
_trace_history: deque[str] = deque(maxlen=MAX_TRACE_HISTORY)
_trace_file: dict[str, str] = {}
# Bumped on each accepted start. A previous run's trace tailer may still be
# draining after a natural exit; its callbacks carry the old id and are dropped.
_run_id = 0
_start_lock = asyncio.Lock()
_POSITION_KEYS = ("timestamp", "lat", "lon", "height", "quality", "ns", "ratio", "age")


async def _broadcast(msg: dict[str, Any]) -> None:
    """Broadcast a message to all connected WebSocket clients."""
    global _ws_clients
    text = json.dumps(msg)
    disconnected = set()
    for ws in list(_ws_clients):  # sends yield; handlers may discard meanwhile
        try:
            await ws.send_text(text)
        except Exception:
            disconnected.add(ws)
    _ws_clients -= disconnected


def _clear_history() -> None:
    _log_history.clear()
    _status_history.clear()
    _last_status.clear()
    _trace_history.clear()
    _trace_file.clear()


async def _status_callback(status: dict[str, Any]) -> None:
    """Called by MrtkRunService on each status poll."""
    if status.get("exited"):
        # Positions of a dead run must not replay as live; keep the log so a
        # reconnecting client can still see why it stopped.
        _status_history.clear()
        _last_status.clear()
    else:
        _last_status.clear()
        _last_status.update(status)
        if status.get("lat") is not None:
            _status_history.append(
                {k: status.get(k) for k in _POSITION_KEYS}
            )
    await _broadcast({"type": "status", **status})


async def _log_callback(line: str) -> None:
    """Called by MrtkRunService for each log line."""
    _log_history.append(line)
    await _broadcast({"type": "log", "message": line})


def _trace_callbacks(run_id: int):
    """Trace callbacks for MrtkRunService, bound to one run."""

    async def on_file(path: str) -> None:
        if run_id != _run_id:
            return
        _trace_file["path"] = path
        await _broadcast({"type": "trace_file", "path": path})

    async def on_lines(lines: list[str]) -> None:
        if run_id != _run_id:
            return
        _trace_history.extend(lines)
        await _broadcast({"type": "trace", "lines": lines})

    return on_file, on_lines


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
    The path is checked without its ``::`` file options (``::T``, ``::S=``),
    both as written and with its time keywords expanded for now, so a
    keyword directory that is a symlink out of /workspace is rejected.
    """
    now = gpst_now()
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
        # An empty file path makes mrtk write to stdout (shown as [STDOUT]
        # in the console). Fine for solutions; raw binary logs would flood it.
        if not base:
            if name.endswith("raw log"):
                return f"{name}: file path is required"
            continue
        p = Path(base)
        expanded = Path(expand_path_keywords(base, now))
        try:
            inside = (
                p.is_absolute()
                and is_within(p, WORKSPACE_ROOT)
                and is_within(expanded, WORKSPACE_ROOT)
            )
        except (OSError, RuntimeError) as e:  # e.g. symlink loop (RuntimeError < 3.13)
            return f"{name}: cannot resolve path {base}: {e}"
        if not inside:
            return f"{name} must be within /workspace: {base}"
    return None


@router.post("/start")
async def start_run(request: MrtkRunStartRequest) -> StartResponse:
    """Start mrtk run -s with the given configuration."""
    if err := _validate_write_streams(request.streams):
        return StartResponse(status="error", message=err)
    # One start at a time: two overlapping requests could both pass the
    # is_running check, and the rejected one would still clear the history
    # and advance _run_id, silencing the trace of the run that did start.
    async with _start_lock:
        return await _start_locked(request)


async def _start_locked(request: MrtkRunStartRequest) -> StartResponse:
    global _run_id
    if _service.is_running:
        # Checked here too so a rejected start never wipes the live run's history.
        return StartResponse(status="error", message="mrtk run is already running")
    _run_id += 1
    _clear_history()
    # Other connected tabs still show the previous run's trace.
    await _broadcast({"type": "trace_reset"})
    on_trace_file, on_trace = _trace_callbacks(_run_id)
    try:
        await _service.start(
            request,
            status_callback=_status_callback,
            log_callback=_log_callback,
            trace_callback=on_trace,
            trace_file_callback=on_trace_file,
        )
        # Per-poll statuses carry no `running`; tell other connected clients
        # (e.g. a second tab) explicitly so their button flips to Stop.
        await _broadcast({"type": "status", "running": True})
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
        _status_history.clear()
        _last_status.clear()
        # `exited` so other connected clients (e.g. a second tab still
        # intending to run) also return to idle.
        await _broadcast(
            {"type": "status", "server_state": "stop", "running": False, "exited": True}
        )
        return StopResponse(status="ok", message="mrtk run stopped")
    except Exception as e:
        logger.exception("Failed to stop mrtk run")
        return StopResponse(status="error", message=str(e))


@router.get("/status")
async def get_status() -> StatusResponse:
    """Get current status of mrtk run process."""
    if not _service.is_running:
        return StatusResponse(running=False, status={"server_state": "stop"})

    # Cached poll result: querying the console here would interleave with
    # the poll task on the same telnet stream.
    return StatusResponse(running=True, status=dict(_last_status))


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

    Clients connect on page load and stay connected, so a browser that comes
    back while a run is active reattaches to it.

    Messages sent to clients:
    - {"type": "history", "logs": [...], "positions": [...],
       "traces": [...], "trace_file": "..." | None} (once, on connect)
    - {"type": "status", "lat": ..., "lon": ..., "quality": ..., ...}
    - {"type": "log", "message": "..."}
    - {"type": "trace_reset"} (a new run was accepted)
    - {"type": "trace_file", "path": "..."} (debug trace file found)
    - {"type": "trace", "lines": [...]}
    """
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        # Replay what this client missed. Positions are empty unless running.
        await websocket.send_text(json.dumps({
            "type": "history",
            "logs": list(_log_history),
            "positions": list(_status_history) if _service.is_running else [],
            "traces": list(_trace_history),
            "trace_file": _trace_file.get("path"),
        }))
        # Send initial status. The explicit `running` flag drives the client's
        # Start/Stop lifecycle; the per-poll rtkrcv `server_state` never does.
        # When not running we send running=False WITHOUT `exited`, so a client
        # that is mid-startup (connects the WS before /start returns) ignores it
        # instead of flipping its optimistic "starting" state back to idle.
        # The cached poll result is sent rather than querying the console here,
        # which would interleave with _poll_status on the same telnet stream.
        # Position keys are left out: the last position is already the final
        # `history` entry and would otherwise be appended twice.
        if _service.is_running:
            current = {k: v for k, v in _last_status.items() if k not in _POSITION_KEYS}
            await websocket.send_text(
                json.dumps({"type": "status", **current, "running": True})
            )
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
