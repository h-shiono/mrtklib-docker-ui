"""/api/mrtklib/version reports the mrtk binary's version (#39 item 2)."""

import asyncio
import os

import pytest

import importlib

# the package exports a main() function, so import the module explicitly
main = importlib.import_module("mrtklib_web_ui.main")


@pytest.mark.parametrize("out, expected", [
    ("mrtk (MRTKLIB ver.0.7.11 git v0.7.11-1-g8dc1fc6-dirty)\n", ("0.7.11", "v0.7.11-1-g8dc1fc6-dirty")),
    ("mrtk (MRTKLIB ver.0.7.11)\n", ("0.7.11", "")),
    ("garbage\n", ("", "")),
])
def test_read_mrtk_version(tmp_path, monkeypatch, out, expected):
    fake = tmp_path / "mrtk"
    fake.write_text(f"#!/bin/sh\nprintf '{out}'\n")
    fake.chmod(0o755)
    monkeypatch.setattr(main, "_mrtk_version_cache", None)
    assert asyncio.run(main._read_mrtk_version(str(fake))) == expected


def test_missing_binary(monkeypatch):
    monkeypatch.setattr(main, "_mrtk_version_cache", None)
    assert asyncio.run(main._read_mrtk_version("/nonexistent/mrtk")) == ("", "")


def test_timed_out_child_is_killed(tmp_path, monkeypatch):
    pidfile = tmp_path / "pid"
    fake = tmp_path / "mrtk"
    fake.write_text(f"#!/bin/sh\necho $$ > {pidfile}\nexec sleep 30\n")
    fake.chmod(0o755)
    monkeypatch.setattr(main, "_mrtk_version_cache", None)
    monkeypatch.setattr(main, "_MRTK_VERSION_TIMEOUT", 0.5)
    assert asyncio.run(main._read_mrtk_version(str(fake))) == ("", "")
    pid = int(pidfile.read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)
