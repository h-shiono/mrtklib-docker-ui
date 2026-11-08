"""Shared fixtures: local-only test data (see tests/localdata_manifest.toml)."""

from __future__ import annotations

import hashlib
import os
import tomllib
from functools import lru_cache
from pathlib import Path

import pytest

_TESTS = Path(__file__).parent


@lru_cache(maxsize=None)
def _manifest() -> dict:
    with open(_TESTS / "localdata_manifest.toml", "rb") as f:
        return tomllib.load(f)["files"]


@lru_cache(maxsize=None)
def _verified(name: str) -> Path | None:
    entry = _manifest()[name]
    root = Path(os.environ.get("MRTK_UI_TESTDATA", _TESTS / "localdata"))
    path = root / name
    if not path.is_file() or path.stat().st_size != entry["size"]:
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return path if h.hexdigest() == entry["sha256"] else None


@pytest.fixture
def localdata():
    """`localdata("name")` → Path of a manifest file; skips the test without it."""

    def get(name: str) -> Path:
        path = _verified(name)
        if path is None:
            pytest.skip(f"local test data {name} not available (tests/localdata_manifest.toml)")
        return path

    return get
