"""Tests for following rtkrcv's debug trace file."""

import os
import time

from mrtklib_web_ui.services.trace_tail import TraceTailer


def _append(p, data: bytes) -> None:
    with open(p, "ab") as f:
        f.write(data)


def test_finds_only_trace_files_of_this_run(tmp_path):
    old = tmp_path / "rtkrcv_202601010000.trace"
    old.write_bytes(b"old\n")
    os.utime(old, (time.time() - 3600, time.time() - 3600))
    (tmp_path / "rtkrcv_202601010000.stat").write_bytes(b"stat\n")

    t = TraceTailer(tmp_path, since=time.time() - 1)
    assert t.find() is None and t.read() == []

    new = tmp_path / "rtkrcv_202610110300.trace"
    new.write_bytes(b"")
    assert t.find() == new


def test_reads_complete_lines_and_carries_partial(tmp_path):
    p = tmp_path / "rtkrcv_1.trace"
    p.write_bytes(b"")
    t = TraceTailer(tmp_path, since=0)
    _append(p, b"3 0.001: a\n3 0.002: b")
    assert t.read() == ["3 0.001: a"]
    _append(p, b"cd\r\n")
    assert t.read() == ["3 0.002: bcd"]
    assert t.read() == []
    _append(p, b"tail")
    assert t.read(final=True) == ["tail"]


def test_skips_ahead_when_trace_outruns_reader(tmp_path):
    p = tmp_path / "rtkrcv_1.trace"
    p.write_bytes(b"")
    t = TraceTailer(tmp_path, since=0, max_read=100)
    _append(p, b"".join(b"line %04d xxxxxxxxxx\n" % i for i in range(100)))  # 2100 B
    lines = t.read()
    assert lines[0] == "[... 2000 bytes of trace skipped ...]"
    # Only whole lines after the skip point, ending at the last one written.
    assert all(l.startswith("line ") and len(l) == 20 for l in lines[1:])
    assert lines[-1] == "line 0099 xxxxxxxxxx"
    _append(p, b"next\n")
    assert t.read() == ["next"]


def test_restarts_when_file_is_truncated(tmp_path):
    p = tmp_path / "rtkrcv_1.trace"
    p.write_bytes(b"first run line\n")
    t = TraceTailer(tmp_path, since=0)
    assert t.read() == ["first run line"]
    p.write_bytes(b"new\n")  # reopened with "w"
    assert t.read() == ["new"]
