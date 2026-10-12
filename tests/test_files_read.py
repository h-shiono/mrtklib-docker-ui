"""/api/files/read reads a bounded head and counts lines without loading the file."""

import asyncio

import pytest
from fastapi import HTTPException

from mrtklib_web_ui.api import files


@pytest.fixture
def read(monkeypatch, tmp_path):
    monkeypatch.setattr(files, "_resolve_path", lambda p: tmp_path / p)
    monkeypatch.setattr(files, "_is_allowed_path", lambda p: True)

    def _read(name: str, **kw):
        return asyncio.run(files.read_file(name, **kw))

    return tmp_path, _read


@pytest.mark.parametrize(
    "data, total",
    [
        (b"", 0),
        (b"a\n", 1),
        (b"a\nb", 2),
        (b"a\r\nb\r\n", 2),
        (b"\n\n", 2),
    ],
)
def test_line_count_matches_splitlines(read, data, total):
    tmp, r = read
    (tmp / "f.txt").write_bytes(data)
    res = r("f.txt")
    assert res.total_lines == total == len(data.decode().splitlines())
    assert res.content == "\n".join(data.decode().splitlines())
    assert res.truncated is False


def test_max_lines_truncates_and_counts_rest(read):
    tmp, r = read
    (tmp / "f.txt").write_bytes(b"".join(f"line {i}\n".encode() for i in range(10_000)))
    res = r("f.txt", max_lines=3)
    assert res.content == "line 0\nline 1\nline 2"
    assert res.returned_lines == 3 and res.total_lines == 10_000 and res.truncated


def test_byte_cap_stops_reading(read, monkeypatch):
    tmp, r = read
    monkeypatch.setattr(files, "READ_MAX_BYTES", 10)
    (tmp / "f.txt").write_bytes(b"abcd\nefgh\n" + b"x" * 1000)  # last line has no newline
    res = r("f.txt")
    assert res.content == "abcd\nefgh"
    assert res.total_lines == 3 and res.truncated

    (tmp / "bin").write_bytes(b"y" * 1000)  # no newline at all
    res = r("bin")
    assert res.content == "" and res.returned_lines == 0
    assert res.total_lines == 1 and res.truncated


def test_missing_file_404(read):
    _, r = read
    with pytest.raises(HTTPException) as e:
        r("nope.txt")
    assert e.value.status_code == 404
