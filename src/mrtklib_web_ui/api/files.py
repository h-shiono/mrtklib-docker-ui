"""File browser API for /workspace directory."""

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter()

WORKSPACE_ROOT = Path("/workspace")


def _resolve_workspace_path(path: str) -> Path:
    """Resolve a path to an absolute path within /workspace.

    Handles both "/workspace/foo/bar" and "foo/bar" style paths.
    """
    stripped = path
    if stripped.startswith("/workspace/"):
        stripped = stripped[len("/workspace/"):]
    elif stripped.startswith("/workspace"):
        stripped = stripped[len("/workspace"):]
    return (WORKSPACE_ROOT / stripped.lstrip("/")).resolve()


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


@router.get("/browse", response_model=DirectoryListing)
async def browse_directory(path: str = "/") -> DirectoryListing:
    """Browse files and directories in the workspace."""
    target_path = _resolve_workspace_path(path)

    # Security check: ensure path is within workspace
    if not str(target_path).startswith(str(WORKSPACE_ROOT)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    items: list[FileInfo] = []
    for item in sorted(target_path.iterdir(), key=lambda x: (x.is_file(), x.name)):
        item_type: Literal["file", "directory"] = "directory" if item.is_dir() else "file"
        relative_path = str(item.relative_to(WORKSPACE_ROOT))
        items.append(
            FileInfo(
                name=item.name,
                path=f"/{relative_path}",
                type=item_type,
                size=item.stat().st_size if item.is_file() else None,
            )
        )

    return DirectoryListing(
        path=f"/{str(target_path.relative_to(WORKSPACE_ROOT))}",
        items=items,
    )


@router.get("/download")
async def download_file(path: str) -> FileResponse:
    """Download a file from the workspace.

    Args:
        path: File path relative to /workspace (e.g., "/output.pos")

    Returns:
        File response for browser download
    """
    target_path = _resolve_workspace_path(path)

    # Security check: ensure path is within workspace
    if not str(target_path).startswith(str(WORKSPACE_ROOT)):
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


@router.get("/read", response_model=FileReadResponse)
async def read_file(path: str, max_lines: int = 5000) -> FileReadResponse:
    """Read text contents of a file in the workspace.

    Args:
        path: File path relative to /workspace
        max_lines: Maximum number of lines to return (default 5000)

    Returns:
        File contents as text with metadata
    """
    target_path = _resolve_workspace_path(path)

    # Security check: ensure path is within workspace
    if not str(target_path).startswith(str(WORKSPACE_ROOT)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not target_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    file_size = target_path.stat().st_size
    lines = target_path.read_text(errors="replace").splitlines()
    total_lines = len(lines)
    selected = lines[:max_lines]

    return FileReadResponse(
        path=f"/{str(target_path.relative_to(WORKSPACE_ROOT))}",
        content="\n".join(selected),
        total_lines=total_lines,
        returned_lines=len(selected),
        truncated=max_lines < total_lines,
        file_size=file_size,
    )
