"""/api/files/read reads a bounded head (or tail) and counts lines without loading the file."""

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
@pytest.mark.parametrize("from_end", [False, True])
def test_line_count_matches_splitlines(read, data, total, from_end):
    tmp, r = read
    (tmp / "f.txt").write_bytes(data)
    res = r("f.txt", from_end=from_end)
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


LINES = [f"line {i}" for i in range(10_000)]


@pytest.mark.parametrize("trailer, sep", [("\n", "\n"), ("", "\n"), ("\r\n", "\r\n")])
@pytest.mark.parametrize("n", [0, 1, 3, 9_999, 10_000, 20_000])
def test_tail_returns_last_lines(read, monkeypatch, trailer, sep, n):
    tmp, r = read
    monkeypatch.setattr(files, "_COUNT_CHUNK", 7)  # many backward chunks, odd boundaries
    (tmp / "f.txt").write_bytes((sep.join(LINES) + trailer).encode())
    res = r("f.txt", max_lines=n, from_end=True)
    want = LINES[-n:] if n else []
    assert res.content == "\n".join(want)
    assert res.returned_lines == len(want) and res.total_lines == len(LINES)
    assert res.truncated is (len(want) < len(LINES))


def test_tail_byte_cap_drops_partial_first_line(read, monkeypatch):
    tmp, r = read
    monkeypatch.setattr(files, "READ_MAX_BYTES", 12)
    (tmp / "f.txt").write_bytes(b"aaaa\nbbbb\ncccc\ndddd\n")
    res = r("f.txt", from_end=True)
    # The last 12 bytes are "bbb\ncccc\ndddd\n" minus the partial "bbb".
    assert res.content == "cccc\ndddd"
    assert res.total_lines == 4 and res.truncated

    monkeypatch.setattr(files, "READ_MAX_BYTES", 10)
    res = r("f.txt", from_end=True)
    # Exactly "cccc\ndddd\n": cut on a line boundary, so "cccc" is whole.
    assert res.content == "cccc\ndddd"

    (tmp / "bin").write_bytes(b"y" * 1000)  # one huge line
    res = r("bin", from_end=True)
    assert res.content == "" and res.returned_lines == 0
    assert res.total_lines == 1 and res.truncated
