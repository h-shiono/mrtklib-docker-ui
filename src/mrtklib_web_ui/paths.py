"""Shared path resolution and validation for allowed roots.

All file access in the application must go through these helpers
to ensure paths stay within /workspace, /data, or /opt/mrtklib/corrections.
"""

from pathlib import Path

WORKSPACE_ROOT = Path("/workspace")
DATA_ROOT = Path("/data")
CORRECTIONS_ROOT = Path("/opt/mrtklib/corrections")
ALLOWED_ROOTS = [WORKSPACE_ROOT, DATA_ROOT, CORRECTIONS_ROOT]


def resolve_path(path: str) -> Path:
    """Resolve a path to an absolute path within an allowed root.

    Handles paths like "/workspace/foo", "/data/bar",
    "/opt/mrtklib/corrections/clas/file.atx", and relative paths
    (which default to /workspace).
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


def is_allowed_path(p: Path) -> bool:
    """Check if a resolved path is within an allowed root."""
    resolved = p.resolve()
    return any(
        resolved == root or root in resolved.parents
        for root in ALLOWED_ROOTS
    )


def is_within(p: Path, root: Path) -> bool:
    """Check if a resolved path is strictly inside a given root (not equal to it)."""
    resolved = p.resolve()
    return root in resolved.parents
