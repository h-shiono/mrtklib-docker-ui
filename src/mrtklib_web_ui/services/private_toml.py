"""Write small secret-bearing TOML files (API keys, passwords) safely.

Values are emitted as fully escaped TOML basic strings, the result is
validated with tomllib, and the file is replaced atomically with 0600
permissions so a failed write never leaves a truncated secrets file.
"""

import os
import re
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
    """Validate content as TOML, then atomically replace path (mode 0600)."""
    tomllib.loads(content)
    tmp_path = path.with_name(path.name + ".tmp")
    fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.fchmod(fd, 0o600)
        os.write(fd, content.encode())
    finally:
        os.close(fd)
    os.replace(tmp_path, path)
