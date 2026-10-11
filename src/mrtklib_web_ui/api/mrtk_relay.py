"""API endpoints for stream relay control (mrtk relay, formerly str2str)."""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mrtklib_web_ui.paths import WORKSPACE_ROOT, has_hidden_component, is_allowed_path, is_within
from mrtklib_web_ui.services import process_manager, ProcessState
from mrtklib_web_ui.services.mrtk_run_service import expand_path_keywords, gpst_now

router = APIRouter()


class MrtkRelayStartRequest(BaseModel):
    """Request to start stream relay process (mrtk relay)."""

    args: list[str] = Field(
        default_factory=list,
        description="Command line arguments for mrtk relay",
        examples=[["-in", "serial://ttyUSB0:115200", "-out", "file:///workspace/output.ubx"]],
    )
    process_id: str | None = Field(
        default=None,
        description="Optional custom process ID",
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
    )


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
    """
    if err := _validate_relay_args(request.args):
        raise HTTPException(status_code=403, detail=err)
    try:
        info = await process_manager.start(
            command="str2str",
            args=request.args,
            process_id=request.process_id,
        )
        return _to_response(info)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start process: {e}")


@router.post("/stop", response_model=ProcessStatusResponse)
async def stop_relay(request: MrtkRelayStopRequest) -> ProcessStatusResponse:
    """Stop a running relay process."""
    try:
        info = await process_manager.stop(
            process_id=request.process_id,
            timeout=request.timeout,
        )
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
