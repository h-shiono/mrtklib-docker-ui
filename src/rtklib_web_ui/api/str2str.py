"""API endpoints for str2str stream server control."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from rtklib_web_ui.services import process_manager, ProcessState

router = APIRouter()


class Str2StrStartRequest(BaseModel):
    """Request to start str2str process."""

    args: list[str] = Field(
        default_factory=list,
        description="Command line arguments for str2str",
        examples=[["-in", "serial://ttyUSB0:115200", "-out", "file:///workspace/output.ubx"]],
    )
    process_id: str | None = Field(
        default=None,
        description="Optional custom process ID",
    )


class Str2StrStopRequest(BaseModel):
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


@router.post("/start", response_model=ProcessStatusResponse)
async def start_str2str(request: Str2StrStartRequest) -> ProcessStatusResponse:
    """Start str2str streaming process.

    If no arguments are provided, str2str will print its help message.
    """
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
async def stop_str2str(request: Str2StrStopRequest) -> ProcessStatusResponse:
    """Stop a running str2str process."""
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
async def get_str2str_status(process_id: str) -> ProcessStatusResponse:
    """Get status of a str2str process."""
    info = await process_manager.get_status(process_id)
    if not info:
        raise HTTPException(status_code=404, detail=f"Process not found: {process_id}")
    return _to_response(info)


@router.get("/processes", response_model=list[ProcessStatusResponse])
async def list_processes() -> list[ProcessStatusResponse]:
    """List all str2str processes."""
    processes = process_manager.get_all_processes()
    return [_to_response(info) for info in processes]


# Convenience endpoint for quick test
@router.post("/test", response_model=ProcessStatusResponse)
async def test_str2str() -> ProcessStatusResponse:
    """Start str2str with no arguments to display help message.

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
