"""Keys of an imported TOML that the form does not own (#230).

The UI maps an imported TOML onto its form (``tomlToConfig`` in the
frontend) and writes the TOML back from the form (``generate_conf_file``).
Keys the form does not read would be lost on that trip, so the frontend keeps
them in ``extra_toml`` and the backend writes them back here.

What counts as unknown is decided by the frontend when it imports: every key
``tomlToConfig`` does not read. A key the form owns never comes from
``extra_toml``, even in a mode whose TOML does not write it (``signals`` in
frequency mode, an empty ``files.fcb``, the base position in PPP). The merge
below still lets the generated TOML win on any key it writes.
"""

import json
import math
import re
import tomllib
from typing import Any

# Tables the server writes itself, outside generate_conf_file: RT appends
# [streams.*] from the stream settings, and a second [streams.*] table would
# make the TOML invalid. Streams also carry NTRIP credentials.
RESERVED_TABLES = frozenset({"streams"})

_BARE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")


def clean_extras(extra: dict[str, Any] | None) -> dict[str, Any]:
    """Drop reserved tables and empty tables from ``extra``."""

    def _clean(d: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for k, v in d.items():
            if isinstance(v, dict):
                v = _clean(v)
                if not v:
                    continue
            elif v is None:
                continue
            out[k] = v
        return out

    if not extra:
        return {}
    return _clean({k: v for k, v in extra.items() if k not in RESERVED_TABLES})


def merge(generated: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    """``extra`` under ``generated``: generated values win, tables recurse,
    arrays and scalars are replaced whole."""
    out = dict(generated)
    for k, v in extra.items():
        if k not in out:
            out[k] = v
        elif isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = merge(out[k], v)
    return out


def _key(k: str) -> str:
    return k if _BARE_KEY.match(k) else json.dumps(k, ensure_ascii=False)


def _value(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if math.isnan(v):
            return "nan"
        if math.isinf(v):
            return "inf" if v > 0 else "-inf"
        return repr(v)
    if isinstance(v, str):
        # A JSON string is a valid TOML basic string (same escapes).
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ", ".join(_value(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{_key(k)} = {_value(x)}" for k, x in v.items()) + "}"
    raise TypeError(f"cannot write {type(v).__name__} to TOML")


def dumps(doc: dict[str, Any], header: str = "") -> str:
    """Write ``doc`` as TOML: scalars first, then one [table] per dict."""
    lines: list[str] = [header, ""] if header else []

    def _table(d: dict[str, Any], path: tuple[str, ...]) -> None:
        scalars = [(k, v) for k, v in d.items() if not isinstance(v, dict)]
        tables = [(k, v) for k, v in d.items() if isinstance(v, dict)]
        if path and (scalars or not tables):
            lines.append("[" + ".".join(_key(p) for p in path) + "]")
        for k, v in scalars:
            lines.append(f"{_key(k)} = {_value(v)}")
        if path and (scalars or not tables):
            lines.append("")
        for k, v in tables:
            _table(v, path + (k,))

    _table(doc, ())
    return "\n".join(lines)


def apply(text: str, extra: dict[str, Any] | None) -> str:
    """The generated TOML ``text`` with the unknown keys of ``extra`` added.

    Returns ``text`` unchanged when there is nothing to add, so a config
    without imported extras writes exactly what it wrote before.
    """
    extra = clean_extras(extra)
    if not extra:
        return text
    generated = tomllib.loads(text)
    merged = merge(generated, extra)
    if merged == generated:
        return text
    header = text.split("\n", 1)[0] if text.startswith("#") else ""
    return dumps(merged, header)
