"""CLAS to RTCM3: further relay outputs after the bridge (#197)."""

import asyncio
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mrtklib_web_ui.api import clas_pipeline as api
from mrtklib_web_ui.services.clas_pipeline_service import (
    ClasPipelineService,
    PipelineConfig,
    PipelineStatus,
)

# The module: `services.clas_pipeline_service` is also the name of its instance.
svc_mod = importlib.import_module("mrtklib_web_ui.services.clas_pipeline_service")


@pytest.fixture
def client(monkeypatch):
    started = []

    async def fake_start(config):
        started.append(config)
        return PipelineStatus(bridge_port=config.bridge_port, outputs=config.outputs)

    monkeypatch.setattr(api.clas_pipeline_service, "start", fake_start)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/clas-pipeline")
    with TestClient(app) as c:
        c.started = started
        yield c


def _body(**kw):
    return {"receiver_id": "septentrio-mosaic-g5", "input_device": "tcpcli://h:1", **kw}


@pytest.mark.parametrize("outputs, code", [
    (["file:///etc/x.sbf"], 403),             # files only under /workspace
    (["/workspace/.credentials.toml"], 403),
    (["tcpsvr://:9870"], 400),                # the bridge port
    (["tcpsvr://:9870#sbf"], 400),
])
def test_bad_outputs_are_rejected(client, outputs, code):
    assert client.post("/api/clas-pipeline/start", json=_body(outputs=outputs)).status_code == code
    assert client.started == []


def test_outputs_are_numbered_and_returned(client, monkeypatch, tmp_path):
    monkeypatch.setattr(api, "_validate_relay_args", lambda args: None)  # tmp_path is not /workspace
    (tmp_path / "sbf.sbf").write_bytes(b"old")
    outputs = [f"file://{tmp_path / 'sbf.sbf'}::S=1", "tcpsvr://:9871"]
    r = client.post("/api/clas-pipeline/start", json=_body(outputs=outputs))
    assert r.status_code == 200
    written = [f"file://{tmp_path / 'sbf_2.sbf'}::S=1", "tcpsvr://:9871"]
    assert client.started[0].outputs == written
    assert r.json()["outputs"] == written


def test_relay_gets_the_bridge_first_then_the_outputs(monkeypatch):
    calls = []

    async def fake_pm_start(command, args, process_id):
        calls.append((process_id, args))

    async def fake_stop(pid, timeout=3.0):
        return None

    monkeypatch.setattr(svc_mod.process_manager, "start", fake_pm_start)
    monkeypatch.setattr(svc_mod.process_manager, "stop", fake_stop)
    monkeypatch.setattr(svc_mod, "_BIND_GRACE_S", 0)
    svc = ClasPipelineService()

    async def run():
        await svc.start(PipelineConfig(
            receiver_id="septentrio-mosaic-g5", input_device="tcpcli://h:1", input_baud=115200,
            outputs=["file:///workspace/clas/a.sbf", "tcpsvr://:9871"],
        ))
        await svc.stop()

    asyncio.run(run())
    relay = dict(calls)["clas-relay"]
    # -b 1 relays back from the first output only: the bridge must stay first
    assert relay[relay.index("-b"):] == [
        "-b", "1",
        "-out", "tcpsvr://:9870",
        "-out", "file:///workspace/clas/a.sbf",
        "-out", "tcpsvr://:9871",
    ]


def test_the_bridge_gets_a_read_only_stream_session(monkeypatch):
    """The page shows the bridge's messages (#136); commands are refused while
    the pipeline runs, since the receiver port takes RTCM3."""
    from mrtklib_web_ui.services import stream_session_service as sss

    async def fake_pm_start(command, args, process_id):
        return None

    async def fake_stop(pid, timeout=3.0):
        return None

    monkeypatch.setattr(svc_mod.process_manager, "start", fake_pm_start)
    monkeypatch.setattr(svc_mod.process_manager, "stop", fake_stop)
    monkeypatch.setattr(svc_mod, "_BIND_GRACE_S", 0)
    svc = ClasPipelineService()
    seen = {}

    async def run():
        await svc.start(PipelineConfig(
            receiver_id="septentrio-mosaic-g5", input_device="tcpcli://h:1", input_baud=115200,
        ))
        session = sss.stream_sessions.get("clas-relay")
        seen["port"] = session.tap.port
        seen["owned"] = session.tap.owned
        seen["blocked"] = session.blocked
        try:
            await session.send(b"grc\r\n", "grc")
        except RuntimeError as e:
            seen["send"] = str(e)
        await svc.stop()
        seen["after"] = sss.stream_sessions.get("clas-relay")

    asyncio.run(run())
    assert seen["port"] == 9870 and seen["owned"] is False
    assert "RTCM3" in seen["blocked"] and "RTCM3" in seen["send"]
    assert seen["after"] is None
