"""API endpoints for rnx2rtkp post-processing."""

import asyncio
import glob as glob_mod
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from rtklib_web_ui.services import ws_manager
from rtklib_web_ui.services.rnx2rtkp_service import (
    Rnx2RtkpConfig,
    Rnx2RtkpInputFiles,
    Rnx2RtkpJob,
    Rnx2RtkpService,
    Rnx2RtkpTimeRange,
)

router = APIRouter()

# Store for active rnx2rtkp jobs
_active_jobs: dict[str, asyncio.Task] = {}


class Rnx2RtkpExecuteRequest(BaseModel):
    """Request to execute rnx2rtkp post-processing."""

    input_files: Rnx2RtkpInputFiles
    config: Rnx2RtkpConfig
    time_range: Rnx2RtkpTimeRange | None = None
    job_id: str | None = Field(
        default=None,
        description="Optional custom job ID",
    )


class Rnx2RtkpJobResponse(BaseModel):
    """Response for rnx2rtkp job execution."""

    job_id: str
    status: str  # "started", "completed", "failed"
    return_code: int | None = None
    error_message: str | None = None
    output_file: str | None = None


async def _run_rnx2rtkp_job(job_id: str, job: Rnx2RtkpJob) -> Rnx2RtkpJobResponse:
    """Execute rnx2rtkp job with WebSocket log streaming.

    Args:
        job_id: Unique job identifier
        job: Job specification

    Returns:
        Job response with status and results
    """
    # Brief delay to ensure HTTP response reaches the frontend
    # before we start sending WebSocket messages (avoids race condition
    # where WS messages arrive before the frontend knows the job ID)
    await asyncio.sleep(0.2)

    service = Rnx2RtkpService()

    # Create log callback that broadcasts to WebSocket
    async def log_callback(message: str) -> None:
        await ws_manager.broadcast_log(job_id, message)

    # Create progress callback that broadcasts structured progress
    async def progress_callback(progress: dict) -> None:
        await ws_manager.broadcast_progress(job_id, progress)

    try:
        # Broadcast job start status
        await ws_manager.broadcast_status(
            job_id,
            "running",
            {
                "command": "rnx2rtkp",
                "output_file": job.input_files.output_file,
            },
        )

        # Run rnx2rtkp
        result = await service.run_rnx2rtkp(
            job, log_callback=log_callback, progress_callback=progress_callback
        )

        # Broadcast completion status
        await ws_manager.broadcast_status(
            job_id,
            "completed" if result.returncode == 0 else "failed",
            {
                "return_code": result.returncode,
                "output_file": job.input_files.output_file,
            },
        )

        return Rnx2RtkpJobResponse(
            job_id=job_id,
            status="completed" if result.returncode == 0 else "failed",
            return_code=result.returncode,
            output_file=job.input_files.output_file if result.returncode == 0 else None,
            error_message=None if result.returncode == 0 else "Processing failed (see logs)",
        )

    except FileNotFoundError as e:
        error_msg = f"Input file not found: {e}"
        await ws_manager.broadcast_log(job_id, f"[ERROR] {error_msg}")
        await ws_manager.broadcast_status(job_id, "failed", {"error": error_msg})
        return Rnx2RtkpJobResponse(
            job_id=job_id,
            status="failed",
            error_message=error_msg,
        )

    except Exception as e:
        error_msg = f"Unexpected error: {e}"
        await ws_manager.broadcast_log(job_id, f"[ERROR] {error_msg}")
        await ws_manager.broadcast_status(job_id, "failed", {"error": error_msg})
        return Rnx2RtkpJobResponse(
            job_id=job_id,
            status="failed",
            error_message=error_msg,
        )

    finally:
        # Keep job in _active_jobs so status endpoint can return final result.
        # The task.done() check in get_job_status will return the result.
        pass


@router.post("/execute", response_model=Rnx2RtkpJobResponse)
async def execute_rnx2rtkp(request: Rnx2RtkpExecuteRequest) -> Rnx2RtkpJobResponse:
    """Execute rnx2rtkp post-processing.

    This endpoint starts the rnx2rtkp process asynchronously and streams
    logs via WebSocket. The job runs in the background and the response
    is returned immediately with the job ID.

    Args:
        request: Job configuration

    Returns:
        Job response with job_id and status

    Raises:
        HTTPException: If validation fails or job cannot be started
    """
    # Generate job ID
    job_id = request.job_id or f"rnx2rtkp-{uuid.uuid4().hex[:8]}"

    # Normalize path: handle both "/workspace/obs/file.obs" and "obs/file.obs"
    workspace = Path("/workspace")

    def resolve_workspace_path(file_path: str) -> Path:
        """Resolve a file path relative to /workspace, handling /workspace prefix."""
        stripped = file_path
        if stripped.startswith("/workspace/"):
            stripped = stripped[len("/workspace/"):]
        elif stripped.startswith("/workspace"):
            stripped = stripped[len("/workspace"):]
        return workspace / stripped.lstrip("/")

    def validate_input_path(file_path: str, label: str) -> str:
        """Validate an input file path, supporting wildcards.

        Returns the original path string (wildcards are passed through to rnx2rtkp).
        """
        resolved = resolve_workspace_path(file_path)
        resolved_str = str(resolved)
        # Check if path contains glob wildcards
        if any(c in resolved_str for c in ("*", "?", "[")):
            matches = glob_mod.glob(resolved_str)
            if not matches:
                raise HTTPException(
                    status_code=400,
                    detail=f"{label} not found (no files match pattern): {file_path}",
                )
            return resolved_str
        else:
            if not resolved.exists():
                raise HTTPException(
                    status_code=400,
                    detail=f"{label} not found: {file_path}",
                )
            return resolved_str

    rover_resolved = validate_input_path(request.input_files.rover_obs_file, "Rover observation file")
    nav_resolved = validate_input_path(request.input_files.nav_file, "Navigation file")

    # Validate base obs file if provided
    base_resolved = None
    if request.input_files.base_obs_file:
        base_resolved = validate_input_path(request.input_files.base_obs_file, "Base observation file")

    # Ensure output file path is absolute and within workspace
    output_path = resolve_workspace_path(request.input_files.output_file)

    # Create job
    job = Rnx2RtkpJob(
        input_files=Rnx2RtkpInputFiles(
            rover_obs_file=rover_resolved,
            base_obs_file=base_resolved,
            nav_file=nav_resolved,
            output_file=str(output_path),
        ),
        config=request.config,
        time_range=request.time_range,
    )

    # Start job in background
    task = asyncio.create_task(_run_rnx2rtkp_job(job_id, job))
    _active_jobs[job_id] = task

    return Rnx2RtkpJobResponse(
        job_id=job_id,
        status="started",
    )


@router.get("/status/{job_id}", response_model=Rnx2RtkpJobResponse)
async def get_job_status(job_id: str) -> Rnx2RtkpJobResponse:
    """Get status of a rnx2rtkp job.

    Args:
        job_id: Job identifier

    Returns:
        Job status response

    Raises:
        HTTPException: If job not found
    """
    if job_id not in _active_jobs:
        raise HTTPException(
            status_code=404,
            detail=f"Job not found: {job_id}",
        )

    task = _active_jobs[job_id]

    if task.done():
        try:
            result = task.result()
            return result
        except Exception as e:
            return Rnx2RtkpJobResponse(
                job_id=job_id,
                status="failed",
                error_message=str(e),
            )
    else:
        return Rnx2RtkpJobResponse(
            job_id=job_id,
            status="running",
        )


@router.get("/jobs", response_model=list[str])
async def list_jobs() -> list[str]:
    """List all active rnx2rtkp job IDs.

    Returns:
        List of active job IDs
    """
    return list(_active_jobs.keys())


class ExportConfRequest(BaseModel):
    """Request to export configuration as .conf file."""

    config: Rnx2RtkpConfig


@router.post("/export-conf")
async def export_conf(request: ExportConfRequest) -> PlainTextResponse:
    """Generate and return RTKLIB .conf file content from configuration.

    Args:
        request: Configuration to export

    Returns:
        Plain text .conf file content with download headers
    """
    service = Rnx2RtkpService()
    content = service.generate_conf_file(request.config)
    return PlainTextResponse(
        content=content,
        headers={
            "Content-Disposition": 'attachment; filename="rtklib.conf"',
        },
    )
