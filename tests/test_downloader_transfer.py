"""Downloads stream to a .part file, reject HTML pages, and GSI FTP runs off the loop (#74)."""

import asyncio
import threading

import httpx
import pytest

from mrtklib_web_ui.api import downloader


@pytest.fixture
def serve(monkeypatch):
    """Route downloader's httpx client to a handler: serve(handler)."""
    real_client = httpx.AsyncClient

    def _serve(handler):
        def client(*args, **kwargs):
            return real_client(*args, transport=httpx.MockTransport(handler), **kwargs)

        monkeypatch.setattr(downloader.httpx, "AsyncClient", client)

    return _serve


def _get(url, dest):
    return asyncio.run(downloader._download_file(url, dest))


def test_binary_download_completes(serve, tmp_path):
    body = b"\x1f\x8b" + b"x" * 300_000
    serve(lambda req: httpx.Response(200, content=body, headers={"content-type": "application/octet-stream"}))
    dest = tmp_path / "a.gz"
    entry = _get("https://example.test/a.gz", dest)
    assert entry["status"] == "completed" and entry["size_bytes"] == len(body)
    assert dest.read_bytes() == body
    assert not (tmp_path / "a.gz.part").exists()


@pytest.mark.parametrize("content, ctype", [
    (b"<!DOCTYPE html><html>login</html>", "application/octet-stream"),
    (b"  <html><body>Earthdata Login</body></html>", ""),
    (b"anything", "text/html; charset=utf-8"),
])
def test_html_page_is_rejected(serve, tmp_path, content, ctype):
    serve(lambda req: httpx.Response(200, content=content, headers={"content-type": ctype}))
    dest = tmp_path / "b.gz"
    entry = _get("https://example.test/b.gz", dest)
    assert entry["status"] == "failed" and "HTML" in entry["error"]
    assert not dest.exists() and not (tmp_path / "b.gz.part").exists()


def test_http_error_leaves_nothing(serve, tmp_path):
    serve(lambda req: httpx.Response(404, content=b"not found"))
    dest = tmp_path / "c.gz"
    entry = _get("https://example.test/c.gz", dest)
    assert entry["status"] == "failed"
    assert list(tmp_path.iterdir()) == []


class FakeFTP:
    files = {"0001a.26o": b"obs-a", "0001b.26o": b"obs-bb", "../evil": b"x"}
    fail_on: str | None = None
    threads: list[str] = []

    def __init__(self, host, timeout=None):
        assert timeout
        FakeFTP.threads.append(threading.current_thread().name)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def login(self, user, pw):
        pass

    def cwd(self, path):
        self.path = path

    def nlst(self):
        return list(self.files)

    def retrbinary(self, cmd, cb):
        name = cmd.split(" ", 1)[1]
        cb(self.files[name][:2])
        if name == self.fail_on:
            raise OSError("connection reset")
        cb(self.files[name][2:])


def test_gsi_runs_in_thread_and_counts_only_its_files(monkeypatch, tmp_path):
    monkeypatch.setattr(downloader.ftplib, "FTP", FakeFTP)
    monkeypatch.setattr(downloader, "get_credential", lambda svc: ("u", "p"))
    (tmp_path / "unrelated.bin").write_bytes(b"z" * 1000)
    (tmp_path / "0001b.26o").write_bytes(b"obs-bb")  # already present: skipped, still counted
    FakeFTP.threads = []
    body = downloader.GsiCorsRequest(station="0001", year=2026, doy=284, dest_dir=str(tmp_path))
    monkeypatch.setattr(downloader, "_dest_dir", lambda v: tmp_path)

    entry = asyncio.run(downloader.download_gsi_cors(body))

    assert entry["status"] == "completed"
    assert entry["size_bytes"] == len(b"obs-a") + len(b"obs-bb")
    assert (tmp_path / "0001a.26o").read_bytes() == b"obs-a"
    assert FakeFTP.threads and FakeFTP.threads[0] != threading.main_thread().name
    assert not (tmp_path.parent / "evil").exists()


def test_gsi_failed_transfer_leaves_no_partial(monkeypatch, tmp_path):
    monkeypatch.setattr(downloader.ftplib, "FTP", FakeFTP)
    monkeypatch.setattr(FakeFTP, "fail_on", "0001a.26o")
    with pytest.raises(OSError):
        downloader._gsi_fetch_station_day(("u", "p"), 2026, 284, "0001", tmp_path)
    assert not (tmp_path / "0001a.26o").exists()
    assert not (tmp_path / "0001a.26o.part").exists()


def test_earthdata_redirect_keeps_credentials_for_urs_only(serve, tmp_path):
    seen = []

    def handler(req):
        seen.append((req.url.host, req.headers.get("authorization")))
        if req.url.host == "cddis.example" and "code" not in req.url.params:
            return httpx.Response(302, headers={"location": "https://urs.earthdata.nasa.gov/oauth/authorize?x=1"})
        if req.url.host == "urs.earthdata.nasa.gov":
            if not req.headers.get("authorization"):
                return httpx.Response(200, content=b"<html>login</html>", headers={"content-type": "text/html"})
            return httpx.Response(302, headers={"location": "https://cddis.example/proxyauth?code=abc"})
        return httpx.Response(200, content=b"\x1f\x8bdata")

    serve(handler)
    dest = tmp_path / "p.gz"
    entry = asyncio.run(downloader._download_file("https://cddis.example/f.gz", dest, auth=("user", "pw")))
    assert entry["status"] == "completed", entry
    assert dest.read_bytes() == b"\x1f\x8bdata"
    auth_by_host = {}
    for host, a in seen:
        auth_by_host.setdefault(host, []).append(a)
    assert all(auth_by_host["urs.earthdata.nasa.gov"])
    # Only the original request to the data host carries the user's credentials.
    assert auth_by_host["cddis.example"][1:] == [None]
