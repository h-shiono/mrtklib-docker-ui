"""Hatanaka compression via rnx2crx / crx2rnx as filters (#81)."""

import asyncio
import gzip
from pathlib import Path

import pytest

from mrtklib_web_ui.api import convert
from mrtklib_web_ui.api.convert import HatanakaRequest, _validate_hatanaka_paths
from mrtklib_web_ui.services import hatanaka


def _req(**kw):
    kw.setdefault("input_file", "/data/site0010.24d.gz")
    kw.setdefault("output_file", "/workspace/site0010.24o")
    kw.setdefault("direction", "decompress")
    return HatanakaRequest(**kw)


def test_valid_request_is_resolved():
    req = _req(input_file="in/a.24o", output_file="out/a.24d")
    assert _validate_hatanaka_paths(req) is None
    assert req.input_file == "/workspace/in/a.24o"
    assert req.output_file == "/workspace/out/a.24d"


@pytest.mark.parametrize("kw", [
    {"input_file": "/workspace/../etc/passwd"},
    {"input_file": "/opt/mrtklib/corrections/clas/isb.tbl"},
    {"input_file": "/workspace/.credentials.toml"},
    {"output_file": "/data/out.24o"},
    {"output_file": "/workspace"},
    {"output_file": "/workspace/../root/x"},
    {"output_file": "/workspace/.ai_settings.toml"},
    {"input_file": "/workspace/a.24o", "output_file": "a.24o"},
])
def test_rejected(kw):
    assert _validate_hatanaka_paths(_req(**kw)) is not None


def test_reset_epochs_must_be_positive():
    with pytest.raises(ValueError):
        _req(reset_epochs=0)


def test_build_args():
    assert [Path(a).name for a in hatanaka.build_args("decompress", False, 100)] == ["crx2rnx"]
    args = hatanaka.build_args("compress", True, 100)
    assert Path(args[0]).name == "rnx2crx"
    assert args[1:] == ["-s", "-e", "100"]


# ── _run_hatanaka with a stand-in tool ──────────────────────────────────────

PAYLOAD = b"     3.04           OBSERVATION DATA    M\n" + b"x" * 3_000_000 + b"\n"


async def _run(tmp_path: Path, script: str, *, src_gz: bool, gzip_out: bool, monkeypatch):
    sent: list[dict] = []

    async def fake_broadcast(msg):
        sent.append(msg)

    monkeypatch.setattr(convert, "_broadcast", fake_broadcast)
    src = tmp_path / ("in.crx.gz" if src_gz else "in.crx")
    if src_gz:
        src.write_bytes(gzip.compress(PAYLOAD))
    else:
        src.write_bytes(PAYLOAD)
    dst = tmp_path / ("out.rnx.gz" if gzip_out else "out.rnx")
    proc = await asyncio.create_subprocess_exec(
        "sh", "-c", script,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    convert._process = proc
    await convert._run_hatanaka(proc, src, dst, gzip_out=gzip_out, decompress=True)
    statuses = [m["status"] for m in sent if m["type"] == "status"]
    return dst, sent, statuses


@pytest.mark.parametrize("src_gz,gzip_out", [(False, False), (True, False), (True, True)])
def test_success_streams_through(tmp_path, monkeypatch, src_gz, gzip_out):
    dst, sent, statuses = asyncio.run(_run(tmp_path, "cat", src_gz=src_gz, gzip_out=gzip_out, monkeypatch=monkeypatch))
    data = gzip.decompress(dst.read_bytes()) if gzip_out else dst.read_bytes()
    assert data == PAYLOAD
    assert statuses == ["completed"]
    # Only plain RINEX output is offered to the preview
    assert any(m["type"] == "output_files" for m in sent) is (not gzip_out)
    assert not list(tmp_path.glob("*.part"))
    assert convert._process is None


def test_warning_exit_is_success(tmp_path, monkeypatch):
    dst, sent, statuses = asyncio.run(_run(tmp_path, "cat; echo 'skipped' >&2; exit 2", src_gz=False, gzip_out=False, monkeypatch=monkeypatch))
    assert statuses == ["completed"]
    assert dst.read_bytes() == PAYLOAD
    assert any("[WARN]" in m.get("message", "") for m in sent)
    assert any(m.get("message") == "[STDERR] skipped" for m in sent)


def test_error_exit_leaves_no_output(tmp_path, monkeypatch):
    dst, sent, statuses = asyncio.run(_run(tmp_path, "head -c 10; exit 1", src_gz=False, gzip_out=False, monkeypatch=monkeypatch))
    assert statuses == ["failed"]
    assert not dst.exists()
    assert not list(tmp_path.glob("*.part"))


def test_corrupt_gzip_input_fails(tmp_path, monkeypatch):
    async def go():
        sent: list[dict] = []

        async def fake_broadcast(msg):
            sent.append(msg)

        monkeypatch.setattr(convert, "_broadcast", fake_broadcast)
        src = tmp_path / "in.crx.gz"
        src.write_bytes(b"not gzip at all")
        dst = tmp_path / "out.rnx"
        proc = await asyncio.create_subprocess_exec(
            "cat", stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        convert._process = proc
        await convert._run_hatanaka(proc, src, dst, gzip_out=False, decompress=True)
        return dst, sent

    dst, sent = asyncio.run(go())
    assert [m["status"] for m in sent if m["type"] == "status"] == ["failed"]
    assert any("BadGzipFile" in m.get("message", "") for m in sent)
    assert not dst.exists()


@pytest.mark.parametrize("break_side", ["input", "output"])
def test_unopenable_file_does_not_hang(tmp_path, monkeypatch, break_side):
    """A tool waiting on stdin, or blocked on a full stdout, must not hang the run."""
    async def go():
        sent: list[dict] = []

        async def fake_broadcast(msg):
            sent.append(msg)

        monkeypatch.setattr(convert, "_broadcast", fake_broadcast)
        src = tmp_path / "in.crx"
        dst = tmp_path / "out.rnx"
        if break_side == "input":
            src.mkdir()  # exists, cannot be opened as a file
            script = "cat"
        else:
            src.write_bytes(PAYLOAD)
            real_open = open

            def failing_open(path, mode="r", *a, **kw):
                if "w" in mode:
                    raise OSError(28, "No space left on device")
                return real_open(path, mode, *a, **kw)

            monkeypatch.setattr(hatanaka, "open", failing_open, raising=False)
            script = "cat"
        proc = await asyncio.create_subprocess_exec(
            "sh", "-c", script,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        convert._process = proc
        await asyncio.wait_for(convert._run_hatanaka(proc, src, dst, gzip_out=False, decompress=True), 10)
        return sent

    sent = asyncio.run(go())
    assert [m["status"] for m in sent if m["type"] == "status"] == ["failed"]
    expected = "[ERROR] IsADirectoryError" if break_side == "input" else "[ERROR] OSError"
    assert any(m.get("message", "").startswith(expected) for m in sent)
    assert not list(tmp_path.glob("*.part"))
