"""RTKLIB process management API."""

from fastapi import APIRouter
from pydantic import BaseModel

from rtklib_web_ui.services.rtklib import RTKProcessManager

router = APIRouter()
process_manager = RTKProcessManager()


class ProcessStartRequest(BaseModel):
    """Request to start an RTKLIB process."""

    command: str
    args: list[str]


class ProcessStatus(BaseModel):
    """Process status response."""

    process_id: str | None
    running: bool
    return_code: int | None = None


@router.post("/start", response_model=ProcessStatus)
async def start_process(request: ProcessStartRequest) -> ProcessStatus:
    """Start an RTKLIB process."""
    process_id = await process_manager.start(request.command, request.args)
    return ProcessStatus(process_id=process_id, running=True)


@router.post("/stop/{process_id}")
async def stop_process(process_id: str) -> ProcessStatus:
    """Stop a running RTKLIB process."""
    return_code = await process_manager.stop(process_id)
    return ProcessStatus(process_id=process_id, running=False, return_code=return_code)


@router.get("/status/{process_id}", response_model=ProcessStatus)
async def get_process_status(process_id: str) -> ProcessStatus:
    """Get the status of an RTKLIB process."""
    status = await process_manager.get_status(process_id)
    return ProcessStatus(
        process_id=process_id,
        running=status["running"],
        return_code=status.get("return_code"),
    )
