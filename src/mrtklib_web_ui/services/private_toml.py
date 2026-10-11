"""Write small secret-bearing TOML files (API keys, passwords) safely.

Values are emitted as fully escaped TOML basic strings, the result is
validated with tomllib, and the file is replaced atomically with 0600
permissions so a failed write never leaves a truncated secrets file.
"""

import os
import re
import tempfile
import tomllib
from pathlib import Path

_BARE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")
_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r"}


def toml_string(value: str) -> str:
    """Return value as a quoted TOML basic string."""
    out = []
    for ch in value:
        if ch in _ESCAPES:
            out.append(_ESCAPES[ch])
        elif ord(ch) < 0x20 or ord(ch) == 0x7F:
            out.append(f"\\u{ord(ch):04X}")
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def toml_key(key: str) -> str:
    """Return key bare if TOML allows it, quoted otherwise."""
    return key if _BARE_KEY.match(key) else toml_string(key)


def dumps_tables(tables: dict[str, dict[str, str]]) -> str:
    """Serialize {table: {key: str}} into TOML text."""
    lines: list[str] = []
    for name, entries in tables.items():
        lines.append(f"[{toml_key(name)}]")
        for k, v in entries.items():
            lines.append(f"{toml_key(k)} = {toml_string(v)}")
        lines.append("")
    return "\n".join(lines)


def write_private_toml(path: Path, content: str) -> None:
    """Validate content as TOML, then atomically replace path (mode 0600).

    The temp file is created exclusively under a fresh name (mkstemp), so
    a planted file or symlink is never written through, and the target is
    only replaced once every byte is on disk.
    """
    tomllib.loads(content)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(content.encode())
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise
