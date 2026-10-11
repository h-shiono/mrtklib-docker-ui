"""Tests for reattaching a WebSocket client to a run the backend is still doing."""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mrtklib_web_ui.api import mrtk_run


class FakeService:
    def __init__(self) -> None:
        self.is_running = False

    async def get_status(self):  # the WS handler must not query the console
        raise AssertionError("get_status() called from WS handler")

    async def start(self, request, status_callback=None, log_callback=None) -> None:
        self.is_running = True

    async def stop(self) -> None:
        self.is_running = False


@pytest.fixture
def client(monkeypatch):
    fake = FakeService()
    monkeypatch.setattr(mrtk_run, "_service", fake)
    mrtk_run._clear_history()
    app = FastAPI()
    app.include_router(mrtk_run.router, prefix="/api/mrtk-run")
    with TestClient(app) as c:
        yield c, fake
    mrtk_run._clear_history()


def _feed(status=None, log=None):
    if log is not None:
        asyncio.run(mrtk_run._log_callback(log))
    if status is not None:
        asyncio.run(mrtk_run._status_callback(status))


def test_reconnect_mid_run_replays_history_and_status(client):
    c, fake = client
    fake.is_running = True
    _feed(log="[INFO] Console connected")
    _feed(status={"lat": 35.0, "lon": 139.0, "height": 40.0, "quality": 2,
                  "satellites": [{"prn": "G01"}]})
    _feed(status={"lat": 35.1, "lon": 139.1, "height": 41.0, "quality": 1,
                  "satellites": [{"prn": "G02"}]})

    with c.websocket_connect("/api/mrtk-run/ws") as ws:
        hist = ws.receive_json()
        assert hist["type"] == "history"
        assert hist["logs"] == ["[INFO] Console connected"]
        assert [p["lat"] for p in hist["positions"]] == [35.0, 35.1]
        status = ws.receive_json()
        assert status["type"] == "status"
        assert status["running"] is True
        assert "lat" not in status  # already the last history entry
        assert status["satellites"] == [{"prn": "G02"}]

    r = c.get("/api/mrtk-run/status").json()
    assert r["running"] is True and r["status"]["lat"] == 35.1


def test_connect_after_exit_keeps_log_but_not_positions(client):
    c, fake = client
    fake.is_running = True
    _feed(log="[STDERR] boom")
    _feed(status={"lat": 35.0, "lon": 139.0})
    fake.is_running = False
    _feed(status={"server_state": "stop", "running": False, "exited": True})

    with c.websocket_connect("/api/mrtk-run/ws") as ws:
        hist = ws.receive_json()
        assert hist["logs"] == ["[STDERR] boom"]
        assert hist["positions"] == []
        status = ws.receive_json()
        assert status["running"] is False
        assert "exited" not in status


def test_stop_broadcast_marks_exited(client):
    c, fake = client
    fake.is_running = True
    with c.websocket_connect("/api/mrtk-run/ws") as ws:
        ws.receive_json()  # history
        ws.receive_json()  # initial status
        assert c.post("/api/mrtk-run/stop").json()["status"] == "ok"
        msg = ws.receive_json()
        assert msg["running"] is False and msg["exited"] is True


def test_rejected_start_keeps_live_history(client):
    c, fake = client
    fake.is_running = True
    _feed(log="[INFO] live")
    body = {"config": {}, "streams": {}}
    r = c.post("/api/mrtk-run/start", json=body).json()
    assert r["status"] == "error" and "already running" in r["message"]
    assert list(mrtk_run._log_history) == ["[INFO] live"]


def test_start_broadcasts_running_to_idle_clients(client):
    c, fake = client
    with c.websocket_connect("/api/mrtk-run/ws") as ws:
        ws.receive_json()  # history
        assert ws.receive_json()["running"] is False
        body = {"config": {}, "streams": {}}
        assert c.post("/api/mrtk-run/start", json=body).json()["status"] == "ok"
        assert ws.receive_json() == {"type": "status", "running": True}
