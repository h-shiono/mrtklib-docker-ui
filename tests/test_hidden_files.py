"""The file API never exposes dotfiles such as stored secrets (#38 item 1)."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mrtklib_web_ui import paths
from mrtklib_web_ui.api import convert, files


def test_has_hidden_component():
    assert paths.has_hidden_component(Path("/workspace/.ai_settings.toml"))
    assert paths.has_hidden_component(Path("/workspace/.mrtk_stage_x/rover.obs"))
    assert paths.has_hidden_component(Path("/workspace/sub/../.credentials.toml"))
    assert not paths.has_hidden_component(Path("/workspace/out/rover.pos"))
    assert not paths.has_hidden_component(Path("/workspace/rtlog/rovr.ubx.tag"))
    assert not paths.has_hidden_component(Path("/workspace"))


@pytest.fixture
def client(tmp_path, monkeypatch):
    ws = tmp_path.resolve() / "workspace"
    ws.mkdir()
    (ws / ".ai_settings.toml").write_text('[anthropic]\napi_key = "sk-secret"\n')
    (ws / "link.toml").symlink_to(ws / ".ai_settings.toml")
    (ws / "result.pos").write_text("ok\n")
    roots = [ws]
    monkeypatch.setattr(paths, "ALLOWED_ROOTS", roots)
    monkeypatch.setattr(paths, "WORKSPACE_ROOT", ws)
    monkeypatch.setattr(files, "ALLOWED_ROOTS", roots)
    monkeypatch.setattr(files, "WORKSPACE_ROOT", ws)
    app = FastAPI()
    app.include_router(files.router, prefix="/api/files")
    app.include_router(convert.router, prefix="/api/convert")
    return TestClient(app), ws


def test_browse_hides_dotfiles(client):
    c, ws = client
    names = [i["name"] for i in c.get("/api/files/browse", params={"path": str(ws)}).json()["items"]]
    assert ".ai_settings.toml" not in names
    assert "result.pos" in names


@pytest.mark.parametrize("name", [".ai_settings.toml", "link.toml"])
def test_secret_not_readable(client, name):
    c, ws = client
    target = str(ws / name)
    assert c.get("/api/files/read", params={"path": target}).status_code == 403
    assert c.get("/api/files/download", params={"path": target}).status_code == 403
    assert c.get("/api/convert/preview", params={"path": target}).status_code == 403


def test_secret_not_writable(client):
    c, ws = client
    r = c.post("/api/files/write", params={"path": str(ws / ".ai_settings.toml")}, json={"content": "x"})
    assert r.status_code == 403
    assert "sk-secret" in (ws / ".ai_settings.toml").read_text()


def test_regular_file_still_readable(client):
    c, ws = client
    r = c.get("/api/files/read", params={"path": str(ws / "result.pos")})
    assert r.status_code == 200 and r.json()["content"] == "ok"
