"""FastAPI entry point for MRTKLIB Web UI."""

import asyncio
import importlib.metadata
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

try:
    __version__ = importlib.metadata.version("mrtklib-web-ui")
except importlib.metadata.PackageNotFoundError:
    __version__ = "0.0.0-dev"

from mrtklib_web_ui.api import (
    files, config, mrtk_relay, mrtk_post, mrtk_run, obs_qc,
    presets, downloader, convert, ai, clas_pipeline,
)
from mrtklib_web_ui.services import clas_pipeline_service, process_manager, ws_manager

# Static files directory (set in Docker build)
STATIC_DIR = Path("/app/static")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler."""
    # Startup: Wire up process manager to WebSocket manager
    process_manager.set_log_callback(ws_manager.broadcast_log)

    async def _on_clas_pvt(fix) -> None:
        await ws_manager.broadcast({"type": "clas_pvt", **fix.to_json()})

    async def _on_clas_flow(stats) -> None:
        await ws_manager.broadcast({"type": "clas_flow", **stats.to_json()})

    clas_pipeline_service.set_callbacks(_on_clas_pvt, _on_clas_flow)

    # Setup .netrc from environment variables if not already mounted
    from mrtklib_web_ui.services.credentials import setup_netrc_from_env
    setup_netrc_from_env()
    yield
    # Shutdown: tear down the CLAS pipeline first so its child processes
    # get a clean stop signal before we kill them in the loop below.
    try:
        await clas_pipeline_service.stop()
    except Exception:
        pass
    for proc_info in process_manager.get_all_processes():
        if proc_info.state.value == "running":
            try:
                await process_manager.stop(proc_info.id, timeout=2.0)
            except Exception:
                pass


app = FastAPI(
    title="MRTKLIB Web UI",
    description="Web UI for MRTKLIB command-line tools",
    version=__version__,
    lifespan=lifespan,
)

# CORS middleware for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(config.router, prefix="/api/config", tags=["config"])
app.include_router(mrtk_relay.router, prefix="/api/mrtk-relay", tags=["mrtk-relay"])
app.include_router(mrtk_post.router, prefix="/api/mrtk-post", tags=["mrtk-post"])
app.include_router(mrtk_run.router, prefix="/api/mrtk-run", tags=["mrtk-run"])
app.include_router(obs_qc.router, prefix="/api/obs-qc", tags=["obs-qc"])
app.include_router(presets.router, prefix="/api/presets", tags=["presets"])
app.include_router(downloader.router, prefix="/api/downloader", tags=["downloader"])
app.include_router(convert.router, prefix="/api/convert", tags=["convert"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(clas_pipeline.router, prefix="/api/clas-pipeline", tags=["clas-pipeline"])


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


_MRTK_VERSION_PATTERN = re.compile(r"ver\.(\S+?)\)?(?:\s+git\s+(\S+?))?\)?\s*$")
_mrtk_version_cache: tuple[str, str] | None = None


async def _read_mrtk_version(mrtk_path: str) -> tuple[str, str]:
    """Return (version, git describe) from ``mrtk --version``, cached once found.

    The binary is the source of truth: the image may be built from a
    MRTKLIB_BRANCH other than the one pinned in .mrtklib-version.
    """
    global _mrtk_version_cache
    if _mrtk_version_cache is not None:
        return _mrtk_version_cache
    try:
        proc = await asyncio.create_subprocess_exec(
            mrtk_path, "--version",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
    except (OSError, asyncio.TimeoutError):
        return ("", "")
    m = _MRTK_VERSION_PATTERN.search(out.decode(errors="replace").strip())
    if not m:
        return ("", "")
    _mrtk_version_cache = (m.group(1), m.group(2) or "")
    return _mrtk_version_cache


@app.get("/api/mrtklib/version")
async def mrtklib_version() -> dict[str, str | list[str]]:
    """Get the MRTKLIB version (from ``mrtk --version``) and available subcommands."""
    import shutil

    mrtk_path = shutil.which("mrtk") or "/usr/local/bin/mrtk"
    mrtk_available = Path(mrtk_path).exists()

    # Known mrtk subcommands
    known_subcommands = ["post", "run", "relay", "convert", "ssr2obs", "ssr2osr", "bias", "dump", "cssr2rtcm3"]
    subcommands = known_subcommands if mrtk_available else []
    version, git = await _read_mrtk_version(mrtk_path) if mrtk_available else ("", "")

    return {
        "version": version,
        "git": git,
        "ui_version": __version__,
        "binary": "mrtk" if mrtk_available else "",
        "subcommands": subcommands,
    }


# WebSocket endpoint for real-time logs
@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time log streaming.

    Clients connect here to receive process logs in real-time.
    Messages are JSON formatted with structure:
    {
        "type": "log" | "status" | "connected",
        "process_id": "...",
        "message": "...",
        "timestamp": "..."
    }
    """
    await ws_manager.connect(websocket)
    try:
        # Keep connection alive and handle client messages
        while True:
            try:
                # Wait for client messages (ping/pong or commands)
                data = await websocket.receive_text()
                # Echo back acknowledgment
                await websocket.send_text(f'{{"type":"ack","received":"{data}"}}')
            except WebSocketDisconnect:
                break
    finally:
        await ws_manager.disconnect(websocket)


# Serve static files in production
if STATIC_DIR.exists():
    # Mount static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    # Serve index.html for SPA routing (catch-all)
    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str) -> FileResponse:
        """Serve the SPA for all non-API routes."""
        # Serve a file only if it is really inside the static directory:
        # full_path arrives percent-decoded, so it may contain "..".
        file_path = (STATIC_DIR / full_path).resolve()
        if STATIC_DIR.resolve() in file_path.parents and file_path.is_file():
            return FileResponse(file_path)
        # Fall back to index.html for SPA routing
        return FileResponse(STATIC_DIR / "index.html")
