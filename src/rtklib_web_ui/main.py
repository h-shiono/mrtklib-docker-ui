"""FastAPI entry point for RTKLIB Web UI."""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from rtklib_web_ui.api import files, process, config, str2str, rnx2rtkp, obs_qc
from rtklib_web_ui.services import process_manager, ws_manager

# Static files directory (set in Docker build)
STATIC_DIR = Path("/app/static")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler."""
    # Startup: Wire up process manager to WebSocket manager
    process_manager.set_log_callback(ws_manager.broadcast_log)
    yield
    # Shutdown: Stop all running processes
    for proc_info in process_manager.get_all_processes():
        if proc_info.state.value == "running":
            try:
                await process_manager.stop(proc_info.id, timeout=2.0)
            except Exception:
                pass


app = FastAPI(
    title="RTKLIB Web UI",
    description="Web UI for RTKLIB command-line tools",
    version="0.1.0",
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
app.include_router(process.router, prefix="/api/process", tags=["process"])
app.include_router(config.router, prefix="/api/config", tags=["config"])
app.include_router(str2str.router, prefix="/api/str2str", tags=["str2str"])
app.include_router(rnx2rtkp.router, prefix="/api/rnx2rtkp", tags=["rnx2rtkp"])
app.include_router(obs_qc.router, prefix="/api/obs-qc", tags=["obs-qc"])


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api/rtklib/version")
async def rtklib_version() -> dict[str, str | list[str]]:
    """Get RTKLIB version and available binaries."""
    import asyncio
    import shutil

    binaries = []
    for cmd in ["str2str", "convbin", "rnx2rtkp", "rtkrcv"]:
        if shutil.which(cmd) or Path(f"/usr/local/bin/{cmd}").exists():
            binaries.append(cmd)

    # Try to get version from str2str
    version = "RTKLIB ver.2.4.3 b34"
    try:
        proc = await asyncio.create_subprocess_exec(
            "/usr/local/bin/str2str",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        # Parse version from help output
        output = stderr.decode("utf-8", errors="replace")
        for line in output.split("\n"):
            if "ver." in line.lower() or "version" in line.lower():
                # Extract version string from output
                version = line.strip()
                break
    except Exception:
        # Fall back to default version if binary execution fails
        pass

    return {
        "version": version,
        "binaries": binaries,
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
        # Check if the file exists in static directory
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        # Fall back to index.html for SPA routing
        return FileResponse(STATIC_DIR / "index.html")
