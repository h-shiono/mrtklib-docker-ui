"""File browser API for /workspace and /data directories."""

import asyncio
import os
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from mrtklib_web_ui.paths import (
    ALLOWED_ROOTS,
    WORKSPACE_ROOT,
    DATA_ROOT,
    CORRECTIONS_ROOT,
    resolve_path as _resolve_path,
    is_allowed_path as _is_allowed_path,
    has_hidden_component,
)

router = APIRouter()


def _find_root(p: Path) -> Path:
    """Find which allowed root a path belongs to."""
    resolved = p.resolve()
    for root in ALLOWED_ROOTS:
        if resolved == root or root in resolved.parents:
            return root
    raise HTTPException(status_code=403, detail="Access denied")


class FileInfo(BaseModel):
    """File or directory information."""

    name: str
    path: str
    type: Literal["file", "directory"]
    size: int | None = None


class DirectoryListing(BaseModel):
    """Directory listing response."""

    path: str
    items: list[FileInfo]


class RootInfo(BaseModel):
    """Volume root information."""

    path: str
    label: str
    writable: bool
    mounted: bool


@router.get("/roots")
async def list_roots() -> list[RootInfo]:
    """List available volume roots."""
    roots = [
        RootInfo(
            path="/workspace",
            label="Workspace (output)",
            writable=True,
            mounted=WORKSPACE_ROOT.exists(),
        ),
        RootInfo(
            path="/data",
            label="Data (read-only)",
            writable=False,
            mounted=DATA_ROOT.exists() and any(DATA_ROOT.iterdir()) if DATA_ROOT.exists() else False,
        ),
    ]
    # Only show System root if correction files are present
    try:
        if CORRECTIONS_ROOT.exists() and any(CORRECTIONS_ROOT.iterdir()):
            roots.append(
                RootInfo(
                    path="/opt/mrtklib/corrections",
                    label="System (read-only)",
                    writable=False,
                    mounted=True,
                )
            )
    except OSError:
        pass  # Treat as not mounted
    return roots


@router.get("/corrections")
async def list_corrections() -> dict[str, list[dict[str, Any]]]:
    """List bundled MRTKLIB correction files."""
    result: dict[str, list[dict[str, Any]]] = {}
    for profile in ["clas", "madoca"]:
        profile_path = CORRECTIONS_ROOT / profile
        files: list[dict[str, Any]] = []
        try:
            if profile_path.exists():
                for f in sorted(profile_path.iterdir()):
                    try:
                        if not f.is_file():
                            continue
                        files.append({
                            "filename": f.name,
                            "path": str(f),
                            "size_bytes": f.stat().st_size,
                        })
                    except OSError:
                        continue
        except OSError:
            files = []
        result[profile] = files
    return result


@router.get("/browse", response_model=DirectoryListing)
async def browse_directory(path: str = "/workspace") -> DirectoryListing:
    """Browse files and directories in workspace or data."""
    target_path = _resolve_path(path)

    if not _is_allowed_path(target_path) or has_hidden_component(target_path):
        raise HTTPException(status_code=403, detail="Access denied")

    if not target_path.exists():
        # Graceful degradation for unmounted /data
        root = _find_root(target_path)
        if root == DATA_ROOT:
            return DirectoryListing(path="/data", items=[])
        raise HTTPException(status_code=404, detail="Path not found")

    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    root = _find_root(target_path)
    items: list[FileInfo] = []
    try:
        for item in sorted(target_path.iterdir(), key=lambda x: (x.is_file(), x.name)):
            # Also skip normal-named symlinks into a hidden path; read/download refuse them
            try:
                if item.name.startswith(".") or has_hidden_component(item):
                    continue
            except (OSError, RuntimeError):  # e.g. symlink loop
                continue
            item_type: Literal["file", "directory"] = "directory" if item.is_dir() else "file"
            relative_path = str(item.relative_to(root))
            items.append(
                FileInfo(
                    name=item.name,
                    path=f"{root}/{relative_path}",
                    type=item_type,
                    size=item.stat().st_size if item.is_file() else None,
                )
            )
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return DirectoryListing(
        path=str(target_path),
        items=items,
    )


@router.get("/download")
async def download_file(path: str) -> FileResponse:
    """Download a file from workspace or data."""
    target_path = _resolve_path(path)

    if not _is_allowed_path(target_path) or has_hidden_component(target_path):
        raise HTTPException(status_code=403, detail="Access denied")

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not target_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    return FileResponse(
        path=target_path,
        filename=target_path.name,
        media_type="application/octet-stream",
    )


class FileReadResponse(BaseModel):
    """Response for reading file text contents."""

    path: str
    content: str
    total_lines: int
    returned_lines: int
    truncated: bool
    file_size: int


# Upper bound on the text returned by /read, whatever max_lines asks for, so a
# huge file (or one with no newlines) cannot be pulled into memory whole.
READ_MAX_BYTES = 16 * 1024 * 1024
_COUNT_CHUNK = 1024 * 1024


def _count_lines(f: Any) -> int:
    """Count the lines of an open binary file, scanning it in chunks."""
    f.seek(0)
    total = 0
    last = b"\n"
    while chunk := f.read(_COUNT_CHUNK):
        total += chunk.count(b"\n")
        last = chunk[-1:]
    if last != b"\n":
        total += 1  # final line without a trailing newline
    return total


def _read_head(path: Path, max_lines: int, max_bytes: int) -> tuple[list[str], int, bool]:
    """Read up to max_lines lines / max_bytes bytes, then count all lines.

    Returns (lines, total_lines, hit_byte_limit). Memory stays bounded by
    max_bytes; the line count scans the file in chunks without keeping it.
    """
    lines: list[str] = []
    used = 0
    hit_limit = False
    with path.open("rb") as f:
        while len(lines) < max_lines:
            raw = f.readline(max_bytes - used + 1)
            if not raw:
                break
            if used + len(raw) > max_bytes:
                hit_limit = True
                break
            used += len(raw)
            lines.append(raw.decode("utf-8", errors="replace").rstrip("\r\n"))

        total = _count_lines(f)
    return lines, total, hit_limit


def _byte_at(f: Any, offset: int) -> bytes:
    f.seek(offset)
    return f.read(1)


def _read_tail(path: Path, max_lines: int, max_bytes: int) -> tuple[list[str], int, bool]:
    """Read the last max_lines lines (at most max_bytes bytes), then count all lines.

    Same return shape as _read_head. The file is read backwards in chunks
    until enough lines are buffered, so the cost is bounded by what is
    returned, not by the file size (apart from the line count).
    """
    with path.open("rb") as f:
        end = f.seek(0, os.SEEK_END)
        pos = end
        buf = b""
        # One extra newline: the line before the first returned one must be
        # terminated, or that first line could be partial.
        while pos > 0 and buf.count(b"\n") <= max_lines and len(buf) <= max_bytes:
            step = min(_COUNT_CHUNK, pos)
            pos -= step
            f.seek(pos)
            buf = f.read(step) + buf

        hit_limit = len(buf) > max_bytes
        if hit_limit:
            buf = buf[-max_bytes:]
        start = end - len(buf)  # file offset of buf[0]
        # buf[0] starts a line only at the file start or right after a newline.
        first_partial = start > 0 and _byte_at(f, start - 1) != b"\n"
        if buf.endswith(b"\n"):
            buf = buf[:-1]  # the file's trailing newline ends the last line
        parts = buf.split(b"\n") if end else []
        if first_partial:
            parts = parts[1:]
        selected = parts[-max_lines:] if max_lines > 0 else []
        lines = [p.decode("utf-8", errors="replace").rstrip("\r") for p in selected]

        total = _count_lines(f)
    return lines, total, hit_limit


@router.get("/read", response_model=FileReadResponse)
async def read_file(path: str, max_lines: int = 5000, from_end: bool = False) -> FileReadResponse:
    """Read text contents of a file in workspace or data.

    With from_end, return the last max_lines lines instead of the first.
    """
    target_path = _resolve_path(path)

    if not _is_allowed_path(target_path) or has_hidden_component(target_path):
        raise HTTPException(status_code=403, detail="Access denied")

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not target_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    file_size = target_path.stat().st_size
    # Off the event loop: a multi-GB file must not stall every other request
    # (RT/relay WebSockets included) while it is scanned.
    selected, total_lines, hit_limit = await asyncio.to_thread(
        _read_tail if from_end else _read_head, target_path, max(max_lines, 0), READ_MAX_BYTES
    )

    return FileReadResponse(
        path=str(target_path),
        content="\n".join(selected),
        total_lines=total_lines,
        returned_lines=len(selected),
        truncated=hit_limit or len(selected) < total_lines,
        file_size=file_size,
    )


@router.post("/write")
async def write_file(path: str, body: dict[str, Any]) -> dict[str, str]:
    """Write text content to a file (workspace only)."""
    target_path = _resolve_path(path)

    # Only allow writes to workspace
    resolved = target_path.resolve()
    if not (resolved == WORKSPACE_ROOT or WORKSPACE_ROOT in resolved.parents):
        raise HTTPException(status_code=403, detail="Write access denied — only /workspace is writable")
    if has_hidden_component(resolved):
        raise HTTPException(status_code=403, detail="Access denied")

    content = body.get("content", "")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content)
    return {"status": "ok", "path": str(target_path)}
