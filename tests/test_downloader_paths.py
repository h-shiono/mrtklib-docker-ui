"""Downloads only land inside /workspace (#38 item 4)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mrtklib_web_ui.api import downloader


@pytest.fixture
def client(monkeypatch):
    async def fake_download(url, dest, auth=None):
        return {"url": url, "dest": str(dest)}

    monkeypatch.setattr(downloader, "_download_file", fake_download)
    monkeypatch.setattr(downloader, "get_credential", lambda svc: ("u", "p"))
    app = FastAPI()
    app.include_router(downloader.router, prefix="/api/downloader")
    return TestClient(app)


def test_default_destinations_ok(client):
    r = client.post("/api/downloader/qzss/clas", json={"year": 2026, "doy": 284})
    assert r.status_code == 200
    assert r.json()[0]["dest"] == "/workspace/downloads/clas/2026284a.l6"


@pytest.mark.parametrize("dest_dir", ["/workspace/../root", "/opt/mrtklib/corrections", "/workspace/.hidden"])
def test_dest_dir_outside_workspace_rejected(client, dest_dir):
    body = {"year": 2026, "doy": 284, "dest_dir": dest_dir}
    assert client.post("/api/downloader/qzss/clas", json=body).status_code == 403
    assert client.post("/api/downloader/qzss/madoca", json=body).status_code == 403
    assert client.post("/api/downloader/igs/products", json=body).status_code == 403
    assert client.post("/api/downloader/gsi/cors", json={**body, "station": "0001"}).status_code == 403


@pytest.mark.parametrize("path, body", [
    ("/api/downloader/gsi/cors", {"station": "../../etc"}),
    ("/api/downloader/qzss/clas", {"session": "../x"}),
    ("/api/downloader/qzss/madoca", {"prn": "../../x"}),
    ("/api/downloader/igs/products", {"product_type": "sp3", "analysis_center": "../"}),
    ("/api/downloader/qzss/clas", {"doy": 0}),
])
def test_path_bearing_fields_rejected(client, path, body):
    assert client.post(path, json={"year": 2026, "doy": 284, **body}).status_code == 422
