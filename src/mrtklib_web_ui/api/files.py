"""File browser API for /workspace and /data directories."""

from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter()

WORKSPACE_ROOT = Path("/workspace")
DATA_ROOT = Path("/data")
CORRECTIONS_ROOT = Path("/opt/mrtklib/corrections")
ALLOWED_ROOTS = [WORKSPACE_ROOT, DATA_ROOT, CORRECTIONS_ROOT]


def _is_allowed_path(p: Path) -> bool:
    """Check if a resolved path is within an allowed root."""
    resolved = p.resolve()
    return any(
        resolved == root or root in resolved.parents
        for root in ALLOWED_ROOTS
    )


def _find_root(p: Path) -> Path:
    """Find which allowed root a path belongs to."""
    resolved = p.resolve()
    for root in ALLOWED_ROOTS:
        if resolved == root or root in resolved.parents:
            return root
    raise HTTPException(status_code=403, detail="Access denied")


def _resolve_path(path: str) -> Path:
    """Resolve a path to an absolute path within an allowed root.

    Handles paths like "/workspace/foo", "/data/bar", "foo" (defaults to /workspace).
    """
    stripped = path.strip()
    for root in ALLOWED_ROOTS:
        prefix = str(root) + "/"
        if stripped.startswith(prefix):
            return (root / stripped[len(prefix):].lstrip("/")).resolve()
        if stripped == str(root):
            return root.resolve()
    # Default to workspace for relative paths
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

    if not _is_allowed_path(target_path):
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

    if not _is_allowed_path(target_path):
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
    """Read text contents of a file in workspace or data."""
    target_path = _resolve_path(path)

    if not _is_allowed_path(target_path):
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
        path=str(target_path),
        content="\n".join(selected),
        total_lines=total_lines,
        returned_lines=len(selected),
        truncated=max_lines < total_lines,
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

    content = body.get("content", "")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content)
    return {"status": "ok", "path": str(target_path)}
