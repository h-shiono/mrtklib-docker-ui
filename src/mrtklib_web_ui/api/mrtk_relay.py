"""API endpoints for stream relay control (mrtk relay, formerly str2str)."""

import re
from datetime import datetime
from pathlib import Path

import asyncio
import json
import base64
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from mrtklib_web_ui.api.message_hub import MAX_STREAM_ID, MessageHub

from mrtklib_web_ui.paths import WORKSPACE_ROOT, has_hidden_component, is_allowed_path, is_within
from mrtklib_web_ui.services import process_manager
from mrtklib_web_ui.services.browser_bridge import BrowserBridge, browser_bridges
from mrtklib_web_ui.services.receiver_console import MAX_COMMAND_BYTES, MAX_COMMAND_LINE, encode_command
from mrtklib_web_ui.services.stream_decoders.messages import MessageLog
from mrtklib_web_ui.services.stream_monitor_service import free_port
from mrtklib_web_ui.services.stream_session_service import TapInfo, plan_tap, stream_sessions, strip_tap
from mrtklib_web_ui.services.mrtk_run_service import (
    expand_path_keywords,
    gpst_now,
    number_file_stream_path,
)

router = APIRouter()

# Display names of the relays started from the Stream Relay view, by
# process ID. Also tells them apart from relays the CLAS pipeline runs
# through the same process manager. Entries go when the process info is pruned.
_stream_names: dict[str, str] = {}
# The message tap the server added to each of those relays (#136), by
# process ID: hidden from the page, read by a stream session.
_taps: dict[str, TapInfo | None] = {}
# Browser serial inputs (#136), by process ID: the bridge port the relay
# reads, and the port's name shown as the input.
_browser_inputs: dict[str, tuple[str, str]] = {}


class MrtkRelayStartRequest(BaseModel):
    """Request to start stream relay process (mrtk relay)."""

    args: list[str] = Field(
        default_factory=list,
        description="Command line arguments for mrtk relay",
        examples=[["-in", "serial://ttyUSB0:115200", "-out", "file:///workspace/output.ubx"]],
    )
    process_id: str | None = Field(
        default=None,
        max_length=MAX_STREAM_ID,
        description="Optional custom process ID",
    )
    name: str | None = Field(
        default=None,
        max_length=100,
        description="Stream name shown in the Stream Relay view",
    )
    browser_input: str | None = Field(
        default=None,
        max_length=200,
        description="Browser serial (#136): the input is a serial port the page opened "
        "with Web Serial; this names it. The server provides the input, and the page "
        "sends the bytes to /browser/ingest with the returned browser_token.",
    )


class MrtkRelayStopRequest(BaseModel):
    """Request to stop str2str process."""

    process_id: str = Field(
        description="ID of process to stop",
    )
    timeout: float = Field(
        default=5.0,
        description="Seconds to wait for graceful termination",
        ge=1.0,
        le=30.0,
    )


class ProcessStatusResponse(BaseModel):
    """Process status response."""

    id: str
    command: str
    state: str
    pid: int | None = None
    return_code: int | None = None
    started_at: str | None = None
    stopped_at: str | None = None
    error_message: str | None = None
    args: list[str] = Field(
        default_factory=list,
        description="Command line arguments, with credentials masked",
    )
    browser_token: str | None = Field(
        default=None,
        description="Browser serial input: what the page shows /browser/ingest (start only)",
    )


class RelayStreamResponse(ProcessStatusResponse):
    """A relay from the Stream Relay view, with what a reloaded page needs to adopt it."""

    name: str
    log: list[str] = Field(default_factory=list)


# [user[:passwd]@]addr... after the scheme; the user may be empty (":pw@host")
_STREAM_PASSWORD = re.compile(r"^([^:@/]*):([^@]+)@")


def _mask_stream_arg(arg: str) -> str:
    """Mask the password of a stream argument, keeping scheme and user."""
    scheme, sep, rest = arg.partition("://")
    if not sep:
        scheme, rest = "", arg
    return scheme + sep + _STREAM_PASSWORD.sub(r"\1:***@", rest)


# With no -out, mrtk relay writes the input to its stdout, which would flood
# the console with binary. A relay started with no outputs only receives,
# to check the input: the message tap (#136) is then its output; a relay
# without a tap gets this output, which discards the data.
# Users cannot send it themselves: file outputs must be inside /workspace.
DISCARD_OUTPUT = "file:///dev/null"


def _with_discard_output(args: list[str]) -> list[str]:
    """Add the discard output to a relay with an input and no output."""
    flags = [_ALIASES.get(a, a) for a in args]
    if "-in" in flags and "-out" not in flags:
        return [*args, "-out", DISCARD_OUTPUT]
    return args


def _without_discard_output(args: list[str]) -> list[str]:
    """The arguments as the user gave them, without the discard output."""
    out: list[str] = []
    i = 0
    while i < len(args):
        if args[i] == "-out" and i + 1 < len(args) and args[i + 1] == DISCARD_OUTPUT:
            i += 2
            continue
        out.append(args[i])
        i += 1
    return out


def _to_response(info) -> ProcessStatusResponse:
    """Convert ProcessInfo to response model."""
    return ProcessStatusResponse(
        id=info.id,
        command=info.command,
        state=info.state.value,
        pid=info.pid,
        return_code=info.return_code,
        started_at=info.started_at.isoformat() if info.started_at else None,
        stopped_at=info.stopped_at.isoformat() if info.stopped_at else None,
        error_message=info.error_message,
        args=[
            _mask_stream_arg(a)
            for a in _show_browser_input(
                strip_tap(_without_discard_output(info.args), _taps.get(info.id)), info.id
            )
        ],
    )


def _show_browser_input(args: list[str], process_id: str) -> list[str]:
    """A Browser serial input as the page knows it, not the bridge port."""
    browser = _browser_inputs.get(process_id)
    if browser is None:
        return args
    bridge_in, label = browser
    return [f"browser://{label}" if a == bridge_in else a for a in args]


def _without_input(args: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(args):
        if _ALIASES.get(args[i], args[i]) == "-in":
            i += 2
            continue
        out.append(args[i])
        i += 1
    return out


# str2str decodefmt(): a trailing "#fmt" is stripped only for these formats
_STREAM_FORMATS = {
    "#rtcm2", "#rtcm3", "#nov", "#oem3", "#ubx", "#ss2", "#hemis",
    "#stq", "#javad", "#nvs", "#binex", "#rt17", "#sbf",
}
# Options whose value is a local file or directory: flag -> (label, write)
_PATH_OPTIONS = {
    "-c": ("Input commands file", False),
    "-c1": ("Output 1 commands file", False),
    "-c2": ("Output 2 commands file", False),
    "-c3": ("Output 3 commands file", False),
    "-c4": ("Output 4 commands file", False),
    "-fl": ("Log file", True),
    "-l": ("Local directory", True),
}
_ALIASES = {"--input": "-in", "--output": "-out"}


def _stream_file_path(stream: str) -> str | None:
    """Return the local file path of a stream argument, or None if not a file stream.

    Mirrors str2str decodepath(): no "://" means a file, and so does any
    scheme starting with "file". File options after "::" are dropped.
    """
    head, sep, tail = stream.rpartition("#")
    if sep and sep + tail in _STREAM_FORMATS:
        stream = head
    if "://" in stream:
        if not stream.startswith("file"):
            return None
        stream = stream.split("://", 1)[1]
    return stream.split("::", 1)[0].strip()


def _split_file_stream(stream: str) -> tuple[str, str, str]:
    """Split a file stream argument into (scheme prefix, path with ::options, #format).

    The inverse of the parsing in `_stream_file_path`: the parts joined give
    the argument back.
    """
    fmt = ""
    head, sep, tail = stream.rpartition("#")
    if sep and sep + tail in _STREAM_FORMATS:
        stream, fmt = head, sep + tail
    prefix = ""
    if "://" in stream:
        scheme, _, stream = stream.partition("://")
        prefix = scheme + "://"
    return prefix, stream, fmt


def _file_outputs(args: list[str]) -> list[int]:
    """Indexes of the file output values in `args`, not the discard output."""
    return [
        i + 1 for i, a in enumerate(args[:-1])
        if _ALIASES.get(a, a) == "-out"
        and args[i + 1] != DISCARD_OUTPUT
        and _stream_file_path(args[i + 1])
    ]


def _number_file_outputs(args: list[str], reserved: set[str], now: datetime) -> list[str]:
    """Number file outputs that would overwrite an existing file.

    mrtk relay opens file outputs with "wb", so a restart within the same
    keyword period (or with a fixed name) would truncate the earlier file.
    As for Real-time logs and Stream Monitor raw logs, _2, _3, ... is
    inserted instead (`number_file_stream_path`). `reserved` holds the
    files other relays write; this relay's outputs are added to it.
    """
    out = list(args)
    for i in _file_outputs(args):
        prefix, path, fmt = _split_file_stream(args[i])
        out[i] = prefix + number_file_stream_path(path, now, reserved) + fmt
    return out


def _running_relay_files(now: datetime) -> set[str]:
    """Files the running relays write (Stream Relay, CLAS to RTCM3), as resolved
    paths, each with its .tag companion (as `number_file_stream_path` reserves):
    a relay that has not created them yet still owns both."""
    files: set[str] = set()
    for info in process_manager.get_all_processes():
        if info.command != "str2str" or info.state.value not in ("starting", "running"):
            continue
        for i in _file_outputs(info.args):
            path = str(Path(expand_path_keywords(_stream_file_path(info.args[i]), now)).resolve())
            files.update((path, f"{path}.tag"))
    return files


def _check_local_path(label: str, value: str, write: bool) -> str | None:
    if not value:
        return None  # empty path = stdin/stdout
    p = Path(value)
    expanded = Path(expand_path_keywords(value, gpst_now()))
    try:
        if write:
            ok = all(
                is_within(x, WORKSPACE_ROOT) or x.resolve() == WORKSPACE_ROOT.resolve()
                for x in (p, expanded)
            )
        else:
            ok = all(is_allowed_path(x) for x in (p, expanded))
        ok = ok and p.is_absolute() and not any(has_hidden_component(x) for x in (p, expanded))
    except (OSError, RuntimeError) as e:  # e.g. symlink loop (RuntimeError < 3.13)
        return f"{label}: cannot resolve path {value}: {e}"
    if not ok:
        where = "/workspace" if write else "/workspace, /data or /opt/mrtklib/corrections"
        return f"{label} must be an absolute path within {where}: {value}"
    return None


def _validate_relay_args(args: list[str]) -> str | None:
    """Ensure every local file mrtk relay would read or write is inside an allowed root.

    Inputs and command files may be read from any allowed root; file
    outputs, the log file and the ftp/http local directory must be
    inside /workspace. Returns an error message, or None if valid.
    """
    for i, raw in enumerate(args):
        flag = _ALIASES.get(raw, raw)
        if i + 1 >= len(args):
            break
        value = args[i + 1]
        if flag in ("-in", "-out"):
            path = _stream_file_path(value)
            if path is None:
                continue
            label = "Input stream file" if flag == "-in" else "Output stream file"
            err = _check_local_path(label, path, write=flag == "-out")
        elif flag in _PATH_OPTIONS:
            label, write = _PATH_OPTIONS[flag]
            err = _check_local_path(label, value, write)
        else:
            continue
        if err:
            return err
    return None


@router.post("/start", response_model=ProcessStatusResponse)
async def start_relay(request: MrtkRelayStartRequest) -> ProcessStatusResponse:
    """Start stream relay process (mrtk relay).

    If no arguments are provided, mrtk relay will print its help message.
    An input with no output only receives: the data is discarded. A file
    output that would overwrite an existing file gets _2, _3, ...; the
    returned args name the files written.
    """
    user_args = request.args
    bridge: BrowserBridge | None = None
    if request.browser_input is not None:
        # The input is the page's serial port, served on 127.0.0.1 (#136).
        bridge = BrowserBridge(request.browser_input.strip() or "serial port")
        bridge_port = await bridge.open()
        user_args = ["-in", f"tcpcli://127.0.0.1:{bridge_port}", *_without_input(request.args)]
    if err := _validate_relay_args(user_args):
        if bridge is not None:
            await bridge.close()
        raise HTTPException(status_code=403, detail=err)
    now = gpst_now()
    try:
        args = _number_file_outputs(user_args, _running_relay_files(now), now)
    except (RuntimeError, OSError) as e:  # no free _N name; unresolvable path
        if bridge is not None:
            await bridge.close()
        raise HTTPException(status_code=409, detail=str(e))
    taken = {s.tap.port for s in stream_sessions.sessions.values()}
    args, tap, blocked = plan_tap(args, free_port(taken))
    try:
        info = await process_manager.start(
            command="str2str",
            args=_with_discard_output(args),
            process_id=request.process_id,
        )
        _stream_names[info.id] = request.name or info.id
        _taps[info.id] = tap
        if bridge is not None:
            _browser_inputs[info.id] = (user_args[1], bridge.label)
            browser_bridges.add(info.id, bridge)
        if tap is not None:
            await stream_sessions.attach(info.id, tap, blocked, _input_of(args))
        response = _to_response(info)
        if bridge is not None:
            response.browser_token = bridge.token
        return response
    except ValueError as e:
        if bridge is not None:
            await bridge.close()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        if bridge is not None:
            await bridge.close()
        raise HTTPException(status_code=500, detail=f"Failed to start process: {e}")


@router.post("/stop", response_model=ProcessStatusResponse)
async def stop_relay(request: MrtkRelayStopRequest) -> ProcessStatusResponse:
    """Stop a running relay process."""
    try:
        info = await process_manager.stop(
            process_id=request.process_id,
            timeout=request.timeout,
        )
        await stream_sessions.end(request.process_id)
        await browser_bridges.relay_stopped(request.process_id)
        return _to_response(info)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop process: {e}")


@router.get("/status/{process_id}", response_model=ProcessStatusResponse)
async def get_relay_status(process_id: str) -> ProcessStatusResponse:
    """Get status of a relay process."""
    info = await process_manager.get_status(process_id)
    if not info:
        raise HTTPException(status_code=404, detail=f"Process not found: {process_id}")
    return _to_response(info)


@router.get("/processes", response_model=list[ProcessStatusResponse])
async def list_processes() -> list[ProcessStatusResponse]:
    """List all relay processes."""
    processes = process_manager.get_all_processes()
    return [_to_response(info) for info in processes]


@router.get("/streams", response_model=list[RelayStreamResponse])
async def list_streams() -> list[RelayStreamResponse]:
    """List the relays started from the Stream Relay view, with their recent log.

    Lets a page that was reloaded or reconnected pick up relays that are
    still running, and catch up on ones that ended meanwhile (#52).
    """
    streams = []
    for proc_id, name in list(_stream_names.items()):
        info = await process_manager.get_status(proc_id)
        if info is None:  # pruned by the process manager
            del _stream_names[proc_id]
            _taps.pop(proc_id, None)
            _browser_inputs.pop(proc_id, None)
            continue
        streams.append(RelayStreamResponse(
            **_to_response(info).model_dump(),
            name=name,
            log=process_manager.get_log(proc_id),
        ))
    return streams


# Convenience endpoint for quick test
@router.post("/test", response_model=ProcessStatusResponse)
async def test_relay() -> ProcessStatusResponse:
    """Start mrtk relay with no arguments to display help message.

    This is useful for testing that the binary works.
    """
    try:
        info = await process_manager.start(
            command="str2str",
            args=[],  # No args = prints help and exits
            process_id="test",
        )
        return _to_response(info)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Stream sessions (#136): messages and receiver commands of a relay ───────


def _input_of(args: list[str]) -> str:
    flags = [_ALIASES.get(a, a) for a in args]
    i = flags.index("-in") if "-in" in flags else -1
    return args[i + 1] if 0 <= i < len(args) - 1 else ""


def _resolve_session(process_id: str) -> tuple[MessageLog, bool] | None:
    session = stream_sessions.get(process_id)
    return (session.frames.messages, not session.ended) if session is not None else None


_hub = MessageHub("Stream sessions", _resolve_session, valid_stream=lambda s: bool(s))
stream_sessions.set_broadcast(_hub.broadcast)
stream_sessions.set_on_tick(_hub.send_all_rows)


class SessionSendRequest(BaseModel):
    """One command for the receiver behind a relay: an ASCII `line` (CR LF is
    added) or a binary frame in `hex` (e.g. UBX)."""

    process_id: str = Field(max_length=MAX_STREAM_ID)
    line: str | None = Field(default=None, max_length=MAX_COMMAND_LINE)
    hex: str | None = Field(default=None, max_length=2 * MAX_COMMAND_BYTES)


@router.get("/sessions")
async def list_sessions() -> list[dict[str, Any]]:
    """Status of every relay's session (decoder, console, commands)."""
    return [s.status_message() for s in stream_sessions.sessions.values()]


@router.post("/sessions/send")
async def send_to_session(request: SessionSendRequest) -> dict[str, Any]:
    try:
        data, shown = encode_command(request.line, request.hex)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    session = stream_sessions.get(request.process_id)
    if session is None:
        raise HTTPException(status_code=409, detail="This relay is not running")
    try:
        await session.send(data, shown)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=502, detail=f"Write failed: {e}")
    return {"ok": True}


@router.websocket("/sessions/ws")
async def websocket_sessions(websocket: WebSocket) -> None:
    """Messages are per relay and carry `stream` (its process ID):

    - {"type": "history", "messages": {...}, "console": [...]} on connect, and
      when a session starts
    - {"type": "status", "running", "connected", "bytes_per_sec", "commands":
      bool, "blocked": reason | null, stats ...} each second; `exited: true`
      when the relay stops
    - {"type": "messages", "now", "types": [...]} per-type counters, each second
    - {"type": "message_rows", ...} rows of the type the page selected
    - {"type": "console", "entry": {...}} a command sent or a reply

    Sent by clients: {"type": "select_message", "stream": process_id, "label": str | null}
    """
    def replay() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for session in stream_sessions.sessions.values():
            out += [session.history_message(), session.status_message()]
        return out

    await _hub.serve(websocket, replay)


# ── Browser serial input (#136) ─────────────────────────────────────────────

MAX_INGEST_FRAME = 65536  # bytes per WebSocket message from the page
_PROCESS_CHECK_S = 1.0


async def _stop_browser_relay(process_id: str) -> None:
    """The page went away: stop its relay (and the stream's session)."""
    try:
        await process_manager.stop(process_id=process_id, timeout=3.0)
    except ValueError:
        pass  # already gone
    await stream_sessions.end(process_id)


browser_bridges.set_stop_relay(_stop_browser_relay)


@router.websocket("/browser/ingest")
async def websocket_browser_ingest(websocket: WebSocket, process_id: str = "", token: str = "") -> None:
    """The bytes of a Browser serial stream's port, binary messages from the
    page that started it (`token` from /start). The server sends
    {"type": "write", "data": base64} for the page to write to its port.
    Closing the socket stops the stream; the server closes it when the
    stream stops (Stop on any page, or the relay exits)."""
    await websocket.accept()
    bridge = browser_bridges.get(process_id)
    if bridge is None:
        await websocket.close(code=1008, reason="No browser serial stream with this ID")
        return

    async def to_page(data: bytes) -> None:
        await websocket.send_text(
            json.dumps({"type": "write", "data": base64.b64encode(data).decode("ascii")})
        )

    try:
        bridge.attach(token, to_page)
    except ValueError as e:
        await websocket.close(code=1008, reason=str(e))
        return
    ended = asyncio.create_task(bridge.ended.wait())
    received: asyncio.Task | None = None
    try:
        while True:
            if received is None:
                received = asyncio.create_task(websocket.receive())
            done, _ = await asyncio.wait(
                {received, ended}, timeout=_PROCESS_CHECK_S, return_when=asyncio.FIRST_COMPLETED
            )
            if ended in done:
                await _close_quietly(websocket, 1000, "Stream stopped")
                return
            if not done:  # quiet second: is the relay still there?
                info = await process_manager.get_status(process_id)
                if info is None or info.state.value not in ("starting", "running"):
                    await _close_quietly(websocket, 1000, "The relay exited")
                    return
                continue
            message = received.result()
            received = None
            if message["type"] == "websocket.disconnect":
                return
            data = message.get("bytes")
            if data is None:
                continue
            if len(data) > MAX_INGEST_FRAME:
                await _close_quietly(websocket, 1009, "Message too large")
                return
            await bridge.from_page(data)
    except WebSocketDisconnect:
        pass
    finally:
        ended.cancel()
        if received is not None:
            received.cancel()
        await browser_bridges.page_left(process_id)


async def _close_quietly(ws: WebSocket, code: int, reason: str) -> None:
    try:
        await asyncio.wait_for(ws.close(code=code, reason=reason), timeout=5.0)
    except Exception:
        pass

