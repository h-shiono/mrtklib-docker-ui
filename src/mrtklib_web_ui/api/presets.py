"""Preset configuration management API."""

import json
import re
import tomllib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

WORKSPACE_ROOT = Path("/workspace")
PRESETS_DIR = WORKSPACE_ROOT / "presets"

# Read-only presets shipped in the image (docker/bundled-presets/ ->
# /opt/mrtklib/presets/<mode>/*.toml). Merged into the list alongside user
# presets. Their ids carry a "@" prefix, which _slugify can never produce
# (it strips everything outside [\w\s-]), so bundled and user ids never clash.
BUNDLED_PRESETS_DIR = Path("/opt/mrtklib/presets")
BUNDLED_PREFIX = "@"


def _slugify(name: str) -> str:
    """Convert a preset name to a filesystem-safe slug."""
    slug = re.sub(r"[^\w\s-]", "", name.strip().lower())
    return re.sub(r"[\s-]+", "-", slug) or "preset"


_ALLOWED_MODES = {"post", "realtime", "clas"}


def _check_mode(mode: str) -> None:
    if mode not in _ALLOWED_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Mode must be one of {sorted(_ALLOWED_MODES)}",
        )


def _presets_dir(mode: str) -> Path:
    """Get the user presets directory for a mode, creating if needed."""
    _check_mode(mode)
    d = PRESETS_DIR / mode
    d.mkdir(parents=True, exist_ok=True)
    return d


def _bundled_dir(mode: str) -> Path:
    """Get the read-only bundled presets directory for a mode (may not exist)."""
    _check_mode(mode)
    return BUNDLED_PRESETS_DIR / mode


def _bundled_path(mode: str, preset_id: str) -> Path | None:
    """Resolve a "@"-prefixed bundled preset id to a file inside the bundled
    dir. Returns None if the id is malformed or escapes the bundled dir."""
    stem = preset_id[len(BUNDLED_PREFIX):]
    # Reject path traversal / nested paths — bundled ids are bare stems.
    if not stem or "/" in stem or "\\" in stem or stem.startswith("."):
        return None
    d = _bundled_dir(mode).resolve()
    path = (d / f"{stem}.toml").resolve()
    if d != path.parent:
        return None
    return path if path.exists() else None


def _user_path(mode: str, preset_id: str) -> Path | None:
    """Resolve a user preset id to a file inside the mode's presets dir.

    Returns None if the id is malformed or would escape the dir (path
    traversal). User ids are bare stems — no separators, no leading dot.
    """
    if not preset_id or "/" in preset_id or "\\" in preset_id or preset_id.startswith("."):
        return None
    d = _presets_dir(mode).resolve()
    path = (d / f"{preset_id}.toml").resolve()
    if d != path.parent:
        return None
    return path


def _preset_name(path: Path, fallback_id: str) -> str:
    """Extract the display name from the leading `# Preset: ` comment."""
    name = fallback_id.replace("-", " ").title()
    first_line = path.read_text().split("\n", 1)[0]
    if first_line.startswith("# Preset: "):
        name = first_line[len("# Preset: "):].strip()
    return name


def _serialize_toml(config: dict[str, Any]) -> str:
    """Serialize a config dict to TOML format."""
    # Reuse the simple TOML serializer pattern
    lines: list[str] = ["# MRTKLIB Preset Configuration (TOML v1.0.0)", ""]

    def _write_table(obj: dict[str, Any], prefix: str = "") -> None:
        scalars: list[tuple[str, Any]] = []
        tables: list[tuple[str, Any]] = []
        for k, v in obj.items():
            if isinstance(v, dict):
                tables.append((k, v))
            else:
                scalars.append((k, v))
        if prefix and scalars:
            lines.append(f"[{prefix}]")
        for k, v in scalars:
            lines.append(f"{k} = {_format_value(v)}")
        if prefix and scalars:
            lines.append("")
        for k, v in tables:
            new_prefix = f"{prefix}.{k}" if prefix else k
            _write_table(v, new_prefix)

    def _format_value(v: Any) -> str:
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, int):
            return str(v)
        if isinstance(v, float):
            if v != 0 and abs(v) < 0.001:
                return f"{v:.2e}"
            return str(v)
        if isinstance(v, str):
            return f'"{v}"'
        if isinstance(v, list):
            items = ", ".join(_format_value(i) for i in v)
            return f"[{items}]"
        return json.dumps(v)

    _write_table(config)
    return "\n".join(lines)


class PresetCreateRequest(BaseModel):
    """A new preset: ``toml`` (the MRTKLIB TOML, as the UI saves it) or
    ``config`` (a parsed TOML dict, as Duplicate sends it)."""

    name: str
    config: dict[str, Any] | None = None
    toml: str | None = None


def _preset_body(body: PresetCreateRequest) -> str:
    """The preset file content after the ``# Preset:`` line."""
    if body.toml is not None:
        try:
            tomllib.loads(body.toml)
        except tomllib.TOMLDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid TOML: {e}")
        return body.toml
    if body.config is None:
        raise HTTPException(status_code=400, detail="toml or config is required")
    return _serialize_toml(body.config)


class PresetUpdateRequest(BaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None


@router.get("/{mode}")
async def list_presets(mode: str) -> list[dict[str, Any]]:
    """List all presets for a mode: bundled (read-only) first, then user."""
    presets: list[dict[str, Any]] = []

    bundled = _bundled_dir(mode)
    if bundled.is_dir():
        for f in sorted(bundled.glob("*.toml")):
            stat = f.stat()
            preset_id = f"{BUNDLED_PREFIX}{f.stem}"
            presets.append({
                "id": preset_id,
                "name": _preset_name(f, f.stem),
                "created_at": datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat(),
                "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "source": "bundled",
                "read_only": True,
            })

    d = _presets_dir(mode)
    for f in sorted(d.glob("*.toml")):
        stat = f.stat()
        presets.append({
            "id": f.stem,
            "name": _preset_name(f, f.stem),
            "created_at": datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat(),
            "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "source": "user",
            "read_only": False,
        })
    return presets


@router.post("/{mode}")
async def create_preset(mode: str, body: PresetCreateRequest) -> dict[str, str]:
    """Create a new preset."""
    d = _presets_dir(mode)
    slug = _slugify(body.name)
    path = d / f"{slug}.toml"

    preset_body = _preset_body(body)

    # Avoid overwriting
    if path.exists():
        i = 2
        while (d / f"{slug}-{i}.toml").exists():
            i += 1
        slug = f"{slug}-{i}"
        path = d / f"{slug}.toml"

    # Write config and name as comment
    content = f"# Preset: {body.name}\n" + preset_body
    path.write_text(content)

    return {
        "id": slug,
        "name": body.name,
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
    }


@router.get("/{mode}/{preset_id}")
async def get_preset(mode: str, preset_id: str) -> dict[str, Any]:
    """Get a single preset with its config (bundled or user)."""
    read_only = preset_id.startswith(BUNDLED_PREFIX)
    if read_only:
        path = _bundled_path(mode, preset_id)
        if path is None:
            raise HTTPException(status_code=404, detail="Preset not found")
    else:
        path = _user_path(mode, preset_id)
        if path is None or not path.exists():
            raise HTTPException(status_code=404, detail="Preset not found")

    try:
        config = tomllib.loads(path.read_text())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse preset: {e}")

    return {
        "id": preset_id,
        "name": _preset_name(path, preset_id.lstrip(BUNDLED_PREFIX)),
        "config": config,
        "read_only": read_only,
    }


@router.put("/{mode}/{preset_id}")
async def update_preset(mode: str, preset_id: str, body: PresetUpdateRequest) -> dict[str, str]:
    """Update a preset (rename or update config)."""
    if preset_id.startswith(BUNDLED_PREFIX):
        raise HTTPException(
            status_code=409,
            detail="Built-in presets are read-only; duplicate to edit.",
        )
    d = _presets_dir(mode)
    path = _user_path(mode, preset_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Preset not found")

    if body.name and body.config:
        # Full update with rename
        new_slug = _slugify(body.name)
        new_path = d / f"{new_slug}.toml"
        content = f"# Preset: {body.name}\n" + _serialize_toml(body.config)
        new_path.write_text(content)
        if new_path != path:
            path.unlink()
        return {"id": new_slug, "name": body.name}
    elif body.name:
        # Rename only
        new_slug = _slugify(body.name)
        new_path = d / f"{new_slug}.toml"
        old_content = path.read_text()
        # Replace first line comment
        lines = old_content.split("\n")
        if lines[0].startswith("# Preset: "):
            lines[0] = f"# Preset: {body.name}"
        new_path.write_text("\n".join(lines))
        if new_path != path:
            path.unlink()
        return {"id": new_slug, "name": body.name}
    elif body.config:
        # Update config only
        first_line = path.read_text().split("\n")[0]
        name = preset_id.replace("-", " ").title()
        if first_line.startswith("# Preset: "):
            name = first_line[len("# Preset: "):]
        content = f"# Preset: {name}\n" + _serialize_toml(body.config)
        path.write_text(content)
        return {"id": preset_id, "name": name}

    return {"id": preset_id, "name": preset_id}


@router.delete("/{mode}/{preset_id}")
async def delete_preset(mode: str, preset_id: str) -> dict[str, str]:
    """Delete a preset."""
    if preset_id.startswith(BUNDLED_PREFIX):
        raise HTTPException(
            status_code=409,
            detail="Built-in presets are read-only; cannot delete.",
        )
    path = _user_path(mode, preset_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Preset not found")
    path.unlink()
    return {"status": "deleted"}
