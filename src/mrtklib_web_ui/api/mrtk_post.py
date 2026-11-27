"""API endpoints for mrtk_post post-processing."""

import asyncio
import itertools
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from mrtklib_web_ui.paths import (
    WORKSPACE_ROOT,
    resolve_path,
    is_allowed_path,
    is_within,
    has_hidden_component,
)
from mrtklib_web_ui.services import ws_manager
from mrtklib_web_ui.services.input_staging import expand_wildcard
from mrtklib_web_ui.services.mrtk_args import epoch_args
from mrtklib_web_ui.services.mrtk_post_service import (
    STOP_TIMEOUT,
    MrtkPostConfig,
    MrtkPostInputFiles,
    MrtkPostJob,
    MrtkPostService,
    MrtkPostTimeRange,
)

router = APIRouter()

# How long /stop waits for the job to end: SIGTERM, the kill timeout, cleanup.
STOP_WAIT = STOP_TIMEOUT + 5.0

# Store for active mrtk_post jobs
_active_jobs: dict[str, asyncio.Task] = {}
# Finished jobs are kept so /status can return their result, but only the
# most recently *finished* ones; running jobs are never dropped.
MAX_FINISHED_JOBS = 20
# job_id -> finish sequence number. Set by the job itself as its last step,
# so it exists before the task counts as done (a done callback would run a
# loop iteration later and leave a window where the job looks unnumbered).
_finished_seq: dict[str, int] = {}
_finish_counter = itertools.count()
# Jobs the user asked to stop (#234). A stopped job reports "stopped" even
# though its task ends by cancellation; one that finished first keeps its result.
_stop_requested: set[str] = set()
# job_id -> output file, for /active after a page reload.
_job_outputs: dict[str, str] = {}


def _start_job(job_id: str, coro) -> asyncio.Task:
    """Run a job as a task, recording its finish order when it ends."""

    async def run():
        try:
            return await coro
        finally:
            _finished_seq[job_id] = next(_finish_counter)
            # Prune as each job ends, not only when the next one starts, so
            # the limit also holds after the last job of a batch.
            _prune_finished_jobs()

    task = asyncio.create_task(run())
    _active_jobs[job_id] = task
    return task


def _prune_finished_jobs() -> None:
    # Finished = numbered (the job ran its `finally`, possibly the caller
    # itself, which is not done() yet) or done (cancelled before it ran).
    finished = [jid for jid, t in _active_jobs.items() if jid in _finished_seq or t.done()]
    # A task cancelled before it ever ran never reached its `finally`; number
    # such a job now so the sort below has a key for every job.
    for jid in finished:
        _finished_seq.setdefault(jid, next(_finish_counter))
    finished.sort(key=lambda jid: _finished_seq[jid])
    for jid in finished[: max(0, len(finished) - MAX_FINISHED_JOBS)]:
        del _active_jobs[jid]
        _finished_seq.pop(jid, None)
        _stop_requested.discard(jid)
        _job_outputs.pop(jid, None)


def _running_job_id() -> str | None:
    """The job that is still running, if any (at most one, see /execute)."""
    for jid, task in _active_jobs.items():
        if jid not in _finished_seq and not task.done():
            return jid
    return None


class MrtkPostExecuteRequest(BaseModel):
    """Request to execute mrtk_post post-processing."""

    input_files: MrtkPostInputFiles
    config: MrtkPostConfig
    time_range: MrtkPostTimeRange | None = None
    job_id: str | None = Field(
        default=None,
        description="Optional custom job ID",
    )


class MrtkPostJobResponse(BaseModel):
    """Response for mrtk_post job execution."""

    job_id: str
    status: str  # "started", "running", "completed", "failed", "stopped"
    return_code: int | None = None
    error_message: str | None = None
    output_file: str | None = None


async def _run_mrtk_post_job(job_id: str, job: MrtkPostJob) -> MrtkPostJobResponse:
    """Execute mrtk_post job with WebSocket log streaming.

    Args:
        job_id: Unique job identifier
        job: Job specification

    Returns:
        Job response with status and results
    """
    service = MrtkPostService()
    started = time.time()
    result = None

    # Create log callback that broadcasts to WebSocket
    async def log_callback(message: str) -> None:
        await ws_manager.broadcast_log(job_id, message)

    # Create progress callback that broadcasts structured progress
    async def progress_callback(progress: dict) -> None:
        await ws_manager.broadcast_progress(job_id, progress)

    try:
        # Brief delay to ensure HTTP response reaches the frontend
        # before we start sending WebSocket messages (avoids race condition
        # where WS messages arrive before the frontend knows the job ID)
        await asyncio.sleep(0.2)

        # Broadcast job start status
        await ws_manager.broadcast_status(
            job_id,
            "running",
            {
                "command": "mrtk_post",
                "output_file": job.input_files.output_file,
            },
        )

        # Run mrtk_post
        result = await service.run_mrtk_post(
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

        return MrtkPostJobResponse(
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
        return MrtkPostJobResponse(
            job_id=job_id,
            status="failed",
            error_message=error_msg,
        )

    except Exception as e:
        error_msg = f"Unexpected error: {e}"
        await ws_manager.broadcast_log(job_id, f"[ERROR] {error_msg}")
        await ws_manager.broadcast_status(job_id, "failed", {"error": error_msg})
        return MrtkPostJobResponse(
            job_id=job_id,
            status="failed",
            error_message=error_msg,
        )

    except asyncio.CancelledError:
        # Only /stop cancels a job; the service has ended mrtk by now. The
        # task finishes normally, so /status can return this result.
        if job_id not in _stop_requested:
            raise
        if result is not None and result.returncode == 0:
            # mrtk had already finished: the stop came too late to matter.
            await ws_manager.broadcast_status(
                job_id, "completed", {"return_code": 0, "output_file": job.input_files.output_file},
            )
            return MrtkPostJobResponse(
                job_id=job_id, status="completed", return_code=0, output_file=job.input_files.output_file,
            )
        return await _report_stopped(job_id, job.input_files.output_file, started)


async def _report_stopped(job_id: str, output_file: str, started: float) -> MrtkPostJobResponse:
    """Tell the page a job was stopped; whatever it wrote is incomplete."""
    out = Path(output_file)
    # A file from an earlier run is not this job's output.
    partial = out.is_file() and out.stat().st_mtime >= started - 1
    await ws_manager.broadcast_log(
        job_id,
        "[WARN] Stopped by user; the output file is incomplete"
        if partial
        else "[INFO] Stopped by user before any output was written",
    )
    await ws_manager.broadcast_status(job_id, "stopped", {"output_file": output_file, "partial": partial})
    return MrtkPostJobResponse(
        job_id=job_id,
        status="stopped",
        output_file=output_file if partial else None,
        error_message="Stopped by user",
    )


@router.post("/execute", response_model=MrtkPostJobResponse)
async def execute_mrtk_post(request: MrtkPostExecuteRequest) -> MrtkPostJobResponse:
    """Execute mrtk_post post-processing.

    This endpoint starts the mrtk_post process asynchronously and streams
    logs via WebSocket. The job runs in the background and the response
    is returned immediately with the job ID.

    Args:
        request: Job configuration

    Returns:
        Job response with job_id and status

    Raises:
        HTTPException: If validation fails or job cannot be started
    """
    # One job at a time, as mrtk run: a second one could write the same
    # output file, and the page follows a single job (#234).
    running = _running_job_id()
    if running:
        raise HTTPException(
            status_code=409,
            detail=f"mrtk post is already running (job {running}); stop it first",
        )

    # Generate job ID
    job_id = request.job_id or f"mrtk_post-{uuid.uuid4().hex[:8]}"
    if job_id in _active_jobs:
        raise HTTPException(status_code=409, detail=f"Job ID already in use: {job_id}")

    def validate_input_path(file_path: str, label: str) -> str:
        """Validate an input file path, supporting ``*`` wildcards in the file name.

        Returns a resolved absolute path string under an allowed root. A
        wildcard is kept as-is: mrtk expands it itself (expath), and one
        pattern must stay one argument so rover/base keep their positions.
        """
        resolved = resolve_path(file_path)
        resolved_str = str(resolved)
        # Paths outside every root are read under /workspace; say so
        shown = file_path if resolved_str == file_path.strip() else f"{file_path} (resolved to {resolved_str})"

        if not is_allowed_path(resolved):
            raise HTTPException(status_code=403, detail=f"{label}: access denied: {file_path}")

        if "*" in str(resolved.parent):
            raise HTTPException(
                status_code=400,
                detail=f"{label}: wildcards are only supported in the file name: {file_path}",
            )
        if "*" in resolved.name:
            if not expand_wildcard(resolved_str):
                raise HTTPException(
                    status_code=400,
                    detail=f"{label} not found (no files match pattern): {shown}",
                )
            return resolved_str
        if not resolved.exists():
            hint = " ('*' is the only wildcard)" if any(c in resolved.name for c in "?[") else ""
            raise HTTPException(status_code=400, detail=f"{label} not found: {shown}{hint}")
        if resolved.is_dir():
            raise HTTPException(
                status_code=400,
                detail=f"{label} is a directory, not a file: {file_path}",
            )
        return resolved_str

    rover_resolved = validate_input_path(request.input_files.rover_obs_file, "Rover observation file")
    nav_resolved = validate_input_path(request.input_files.nav_file, "Navigation file")

    # Validate base obs file if provided
    base_resolved = None
    if request.input_files.base_obs_file:
        base_resolved = validate_input_path(request.input_files.base_obs_file, "Base observation file")

    # Validate correction files if provided
    correction_resolved = []
    for i, cf in enumerate(request.input_files.correction_files or []):
        if cf.strip():
            correction_resolved.append(validate_input_path(cf, f"Correction file #{i + 1}"))

    # A malformed time would otherwise only fail inside the job. A blank one
    # (box ticked, picker cleared) means not set, as in run_mrtk_post.
    if request.time_range:
        for label, flag, value in (
            ("Time Start", "-ts", request.time_range.start_time),
            ("Time End", "-te", request.time_range.end_time),
        ):
            if (value or "").strip():
                try:
                    epoch_args(flag, value)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=f"{label}: {e}") from None

    # Ensure output file path is strictly inside /workspace (not equal to it)
    output_path = resolve_path(request.input_files.output_file)
    if not is_within(output_path, WORKSPACE_ROOT) or has_hidden_component(output_path):
        raise HTTPException(
            status_code=403,
            detail=f"Output must be within /workspace: {request.input_files.output_file}",
        )
    if output_path.is_dir():
        raise HTTPException(
            status_code=400,
            detail=f"Output file must not be a directory: {request.input_files.output_file}",
        )

    # Create job
    job = MrtkPostJob(
        input_files=MrtkPostInputFiles(
            rover_obs_file=rover_resolved,
            base_obs_file=base_resolved,
            nav_file=nav_resolved,
            correction_files=correction_resolved,
            output_file=str(output_path),
        ),
        config=request.config,
        time_range=request.time_range,
    )

    # Start job in background
    _prune_finished_jobs()
    _job_outputs[job_id] = str(output_path)
    _start_job(job_id, _run_mrtk_post_job(job_id, job))

    return MrtkPostJobResponse(
        job_id=job_id,
        status="started",
    )


@router.get("/status/{job_id}", response_model=MrtkPostJobResponse)
async def get_job_status(job_id: str) -> MrtkPostJobResponse:
    """Get status of a mrtk_post job.

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

    if task.cancelled():
        # Stopped before the job ever ran, so it left no result.
        return MrtkPostJobResponse(job_id=job_id, status="stopped", error_message="Stopped by user")

    if task.done():
        try:
            result = task.result()
            return result
        except Exception as e:
            return MrtkPostJobResponse(
                job_id=job_id,
                status="failed",
                error_message=str(e),
            )
    else:
        return MrtkPostJobResponse(
            job_id=job_id,
            status="running",
        )


@router.post("/stop/{job_id}", response_model=MrtkPostJobResponse)
async def stop_job(job_id: str) -> MrtkPostJobResponse:
    """Stop a running mrtk post job and return its final status.

    mrtk post gets SIGTERM, then SIGKILL after a timeout; it has no signal
    handler, so the output file holds what was written so far. Stopping a
    job that already ended returns its result unchanged.
    """
    task = _active_jobs.get(job_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    if not task.done() and job_id not in _finished_seq and job_id not in _stop_requested:
        _stop_requested.add(job_id)
        # Cancel once: a second cancel would interrupt the terminate/kill.
        task.cancel()
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=STOP_WAIT)
    except TimeoutError:
        return MrtkPostJobResponse(job_id=job_id, status="running", error_message="Still stopping")
    except asyncio.CancelledError:
        if not task.done():
            raise  # this request was cancelled, not the job
    except Exception:
        pass  # the job's error is reported by /status below
    return await get_job_status(job_id)


@router.get("/active", response_model=MrtkPostJobResponse | None)
async def active_job() -> MrtkPostJobResponse | None:
    """The running job, so a reloaded page can follow and stop it."""
    jid = _running_job_id()
    if jid is None:
        return None
    return MrtkPostJobResponse(job_id=jid, status="running", output_file=_job_outputs.get(jid))


@router.get("/jobs", response_model=list[str])
async def list_jobs() -> list[str]:
    """List all active mrtk_post job IDs.

    Returns:
        List of active job IDs
    """
    return list(_active_jobs.keys())


class ExportConfRequest(BaseModel):
    """Request to export configuration as TOML file."""

    config: MrtkPostConfig


@router.post("/export-conf")
async def export_conf(request: ExportConfRequest) -> PlainTextResponse:
    """Generate and return MRTKLIB TOML configuration file content.

    Args:
        request: Configuration to export

    Returns:
        TOML file content with download headers
    """
    service = MrtkPostService()
    content = service.generate_conf_file(request.config)
    return PlainTextResponse(
        content=content,
        headers={
            "Content-Disposition": 'attachment; filename="mrtk_post.toml"',
        },
    )
