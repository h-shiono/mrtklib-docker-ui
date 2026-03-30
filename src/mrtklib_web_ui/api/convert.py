"""API router for mrtk convert (convbin)."""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from mrtklib_web_ui.paths import is_allowed_path

logger = logging.getLogger(__name__)

router = APIRouter()

# Connected WebSocket clients
_ws_clients: set[WebSocket] = set()
_process: Optional[asyncio.subprocess.Process] = None


async def _broadcast(msg: dict[str, Any]) -> None:
    global _ws_clients
    text = json.dumps(msg)
    disconnected = set()
    for ws in _ws_clients:
        try:
            await ws.send_text(text)
        except Exception:
            disconnected.add(ws)
    _ws_clients -= disconnected


class ConvertRequest(BaseModel):
    input_file: str
    format: str | None = None
    receiver_options: str | None = None
    output_obs: str | None = None
    output_nav: str | None = None
    output_dir: str | None = None
    rinex_version: str = "3.04"
    station_id: str | None = None
    time_start: str | None = None
    time_end: str | None = None
    time_ref: str | None = None
    interval: float | None = None
    epoch_tolerance: float | None = None
    time_span: float | None = None
    frequencies: int = 5
    signal_mask: str | None = None
    signal_nomask: str | None = None
    exclude_sats: str | None = None
    exclude_sys: str | None = None
    include_doppler: bool = True
    include_snr: bool = True
    include_iono: bool = False
    include_time_corr: bool = False
    include_leap_sec: bool = False
    half_cycle: bool = False
    header_comment: str | None = None
    header_marker: str | None = None
    header_marker_no: str | None = None
    header_marker_type: str | None = None
    header_observer: str | None = None
    header_receiver: str | None = None
    header_antenna: str | None = None
    header_position: str | None = None
    header_delta: str | None = None
    trace_level: int = 0


def build_convert_cmd(req: ConvertRequest) -> list[str]:
    cmd = ["/usr/local/bin/mrtk", "convert"]
    if req.format:
        cmd += ["-r", req.format]
    if req.receiver_options:
        cmd += ["-ro", req.receiver_options]
    if req.output_obs:
        cmd += ["-o", req.output_obs]
    if req.output_nav:
        cmd += ["-n", req.output_nav]
    if req.output_dir and not req.output_obs:
        cmd += ["-d", req.output_dir]
    if req.station_id:
        cmd += ["-c", req.station_id]
    cmd += ["-v", req.rinex_version]
    if req.time_start:
        cmd += ["-ts", req.time_start]
    if req.time_end:
        cmd += ["-te", req.time_end]
    if req.time_ref:
        cmd += ["-tr", req.time_ref]
    if req.interval and req.interval > 0:
        cmd += ["-ti", str(req.interval)]
    if req.epoch_tolerance is not None and req.epoch_tolerance != 0.005:
        cmd += ["-tt", str(req.epoch_tolerance)]
    if req.time_span and req.time_span > 0:
        cmd += ["-span", str(req.time_span)]
    cmd += ["-f", str(req.frequencies)]
    if not req.include_doppler:
        cmd.append("-od")
    if not req.include_snr:
        cmd.append("-os")
    if req.include_iono:
        cmd.append("-oi")
    if req.include_time_corr:
        cmd.append("-ot")
    if req.include_leap_sec:
        cmd.append("-ol")
    if req.half_cycle:
        cmd.append("-halfc")
    if req.signal_mask:
        cmd += ["-mask", req.signal_mask]
    if req.signal_nomask:
        cmd += ["-nomask", req.signal_nomask]
    if req.exclude_sats:
        for sat in req.exclude_sats.split():
            cmd += ["-x", sat]
    if req.exclude_sys:
        for sys_code in req.exclude_sys.split():
            cmd += ["-y", sys_code]
    for flag, val in [
        ("-hc", req.header_comment), ("-hm", req.header_marker),
        ("-hn", req.header_marker_no), ("-ht", req.header_marker_type),
        ("-ho", req.header_observer), ("-hr", req.header_receiver),
        ("-ha", req.header_antenna), ("-hp", req.header_position),
        ("-hd", req.header_delta),
    ]:
        if val:
            cmd += [flag, val]
    if req.trace_level > 0:
        cmd += ["-trace", str(req.trace_level)]
    cmd.append(req.input_file)
    return cmd


class ConvertResponse(BaseModel):
    status: str
    message: str
    command: str = ""


@router.post("/start")
async def start_convert(request: ConvertRequest) -> ConvertResponse:
    """Start mrtk convert process."""
    global _process
    if _process and _process.returncode is None:
        return ConvertResponse(status="error", message="Conversion already running")

    cmd = build_convert_cmd(request)
    cmd_str = " ".join(cmd)
    await _broadcast({"type": "log", "message": f"[CMD] {cmd_str}"})

    try:
        _process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        async def read_stream(stream, prefix=""):
            import time as _time
            buf = b""
            last_progress = ""
            last_progress_time = 0.0
            while True:
                chunk = await stream.read(4096)
                if not chunk:
                    break
                buf += chunk
                # Split on \r or \n
                while b"\r" in buf or b"\n" in buf:
                    r_pos = buf.find(b"\r")
                    n_pos = buf.find(b"\n")
                    if r_pos == -1:
                        pos = n_pos
                    elif n_pos == -1:
                        pos = r_pos
                    else:
                        pos = min(r_pos, n_pos)
                    line = buf[:pos].decode("utf-8", errors="replace").strip()
                    # Skip \r\n combo
                    if pos + 1 < len(buf) and buf[pos:pos + 2] == b"\r\n":
                        buf = buf[pos + 2:]
                    else:
                        buf = buf[pos + 1:]
                    if not line:
                        continue
                    # Throttle CR-delimited progress lines (max 1/sec)
                    is_progress = line.startswith("scanning:") or (": O=" in line) or (": E=" in line) or (": S=" in line)
                    if is_progress:
                        now = _time.monotonic()
                        if now - last_progress_time >= 1.0:
                            last_progress_time = now
                            last_progress = line
                            await _broadcast({"type": "progress", "message": f"{prefix}{line}"})
                    else:
                        await _broadcast({"type": "log", "message": f"{prefix}{line}"})
            # Flush remaining
            if buf.strip():
                text = buf.decode("utf-8", errors="replace").strip()
                if text:
                    await _broadcast({"type": "log", "message": f"{prefix}{text}"})

        # Run stream readers and wait for process in background
        async def run_and_wait():
            global _process
            proc = _process
            if not proc:
                return
            # Read stdout/stderr concurrently, then wait for exit
            await asyncio.gather(
                read_stream(proc.stdout, ""),
                read_stream(proc.stderr, "[STDERR] "),
            )
            await proc.wait()
            rc = proc.returncode
            if rc == 0:
                await _broadcast({"type": "status", "status": "completed"})
                await _broadcast({"type": "log", "message": "[INFO] Conversion completed successfully"})
            else:
                await _broadcast({"type": "status", "status": "failed"})
                await _broadcast({"type": "log", "message": f"[ERROR] Conversion failed with exit code {rc}"})
            _process = None

        asyncio.create_task(run_and_wait())

        return ConvertResponse(status="ok", message="Conversion started", command=cmd_str)

    except Exception as e:
        logger.exception("Failed to start conversion")
        return ConvertResponse(status="error", message=str(e))


@router.post("/stop")
async def stop_convert() -> ConvertResponse:
    """Stop running conversion."""
    global _process
    if not _process or _process.returncode is not None:
        return ConvertResponse(status="error", message="No conversion running")
    try:
        _process.terminate()
        await asyncio.wait_for(_process.wait(), timeout=5.0)
    except asyncio.TimeoutError:
        _process.kill()
    _process = None
    await _broadcast({"type": "status", "status": "stopped"})
    return ConvertResponse(status="ok", message="Conversion stopped")


@router.get("/status")
async def convert_status() -> dict[str, Any]:
    """Get conversion status."""
    running = _process is not None and _process.returncode is None
    return {"running": running}


@router.websocket("/ws")
async def websocket_convert(websocket: WebSocket) -> None:
    """WebSocket for conversion log streaming."""
    global _ws_clients
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)


# ── Preview endpoint ────────────────────────────────────────────────────────



def _parse_rinex_preview(path: Path, max_epochs: int = 5) -> dict[str, Any]:
    with open(path, "r", errors="replace") as f:
        # Read only enough lines (header + data for max_epochs).
        # For safety, cap at 50_000 lines to avoid loading huge files.
        lines: list[str] = []
        for i, line in enumerate(f):
            lines.append(line)
            if i >= 50_000:
                break

    total_lines = len(lines)

    # Check first line is printable ASCII (strip whitespace since readlines keeps \n)
    if lines and not lines[0].strip().isprintable() and lines[0].strip():
        raise HTTPException(status_code=400, detail="File does not appear to be a text/RINEX file")

    # Find END OF HEADER
    header_end = 0
    for i, line in enumerate(lines):
        if "END OF HEADER" in line:
            header_end = i + 1
            break

    header = "".join(lines[:header_end])

    # Detect RINEX type from header
    rinex_type = "UNKNOWN"
    for line in lines[:header_end]:
        if "RINEX VERSION / TYPE" in line:
            type_char = line[20].strip() if len(line) > 20 else ""
            rinex_type = {"O": "OBS", "N": "NAV", "G": "GNAV"}.get(type_char, "UNKNOWN")
            break

    # Extract first N epochs from data section
    data_lines = lines[header_end:]
    epoch_count = 0
    preview_lines: list[str] = []

    for line in data_lines:
        is_epoch_marker = line.startswith(">") or (
            len(line) > 25 and line[0] == " " and line[1:3].strip().isdigit()
        )
        if is_epoch_marker:
            epoch_count += 1
            if epoch_count > max_epochs:
                break
        preview_lines.append(line)

    data_preview = "".join(preview_lines)

    # Count total epochs for truncation check
    total_epochs = sum(
        1
        for l in data_lines
        if l.startswith(">") or (len(l) > 25 and l[0] == " " and l[1:3].strip().isdigit())
    )
    truncated = epoch_count <= total_epochs and epoch_count > max_epochs or total_epochs > max_epochs

    return {
        "filename": path.name,
        "rinex_type": rinex_type,
        "header": header,
        "data_preview": data_preview,
        "total_lines": total_lines,
        "header_lines": header_end,
        "truncated": truncated,
    }


@router.get("/preview")
async def preview_rinex(
    path: str = Query(..., description="Absolute path to RINEX file"),
    max_epochs: int = Query(default=5, ge=1, le=10, description="Number of epochs to preview"),
) -> dict[str, Any]:
    """Preview a RINEX file (header + first N epochs)."""
    target = Path(path).resolve()

    if not is_allowed_path(target):
        raise HTTPException(status_code=403, detail="Access denied: path outside allowed directories")

    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    try:
        return _parse_rinex_preview(target, max_epochs)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to preview RINEX file")
        raise HTTPException(status_code=500, detail=str(e))
