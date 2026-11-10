"""Browser serial as a Streams input (#136): the bridge between the page's
serial port and the relay."""

import asyncio
import base64
import json
import time

import pytest
from starlette.websockets import WebSocketDisconnect

from fastapi.testclient import TestClient

from mrtklib_web_ui.services import browser_bridge as bb
from mrtklib_web_ui.services import stream_session_service as sss
from mrtklib_web_ui.services.process_manager import process_manager
from test_stream_sessions import FakeRelay


@pytest.fixture
def relay(monkeypatch):
    fake = FakeRelay()
    monkeypatch.setattr(process_manager, "start", fake.start)
    monkeypatch.setattr(process_manager, "get_status", fake.get_status)
    monkeypatch.setattr(process_manager, "stop", fake.stop)
    monkeypatch.setattr(process_manager, "get_log", lambda pid: [])
    monkeypatch.setattr(sss, "TICK_S", 0.2)
    return fake


@pytest.fixture
def client():
    from mrtklib_web_ui.main import app

    with TestClient(app) as c:
        yield c


def _start(client, label="u-blox 1546:01A9, 115200 baud", outputs=()):
    args = [x for o in outputs for x in ("-out", o)]
    r = client.post("/api/mrtk-relay/start", json={"args": args, "name": "USB", "browser_input": label})
    assert r.status_code == 200, r.text
    return r.json()


def _bridge_port(relay, pid):
    run = relay.args[pid]
    return int(run[run.index("-in") + 1].rsplit(":", 1)[1])


def test_start_serves_the_port_on_localhost_and_hides_it(relay, client):
    st = _start(client)
    pid = st["id"]
    run = relay.args[pid]
    assert run[run.index("-in") + 1].startswith("tcpcli://127.0.0.1:")
    assert st["args"] == ["-in", "browser://u-blox 1546:01A9, 115200 baud"]
    assert st["browser_token"]
    listed = client.get("/api/mrtk-relay/streams").json()[0]
    assert listed["args"] == ["-in", "browser://u-blox 1546:01A9, 115200 baud"] and listed["browser_token"] is None
    client.post("/api/mrtk-relay/stop", json={"process_id": pid})


@pytest.mark.parametrize("which", ["token", "id"])
def test_ingest_refuses_a_wrong_page(relay, client, which):
    st = _start(client)
    pid, token = st["id"], st["browser_token"]
    url = (f"/api/mrtk-relay/browser/ingest?process_id={pid}&token=nope" if which == "token"
           else f"/api/mrtk-relay/browser/ingest?process_id=nope&token={token}")
    with client.websocket_connect(url) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_bytes()
        assert closed.value.code == 1008
    client.post("/api/mrtk-relay/stop", json={"process_id": pid})


def test_bytes_flow_both_ways_and_leaving_stops_the_relay(relay, client):
    st = _start(client)
    pid, token = st["id"], st["browser_token"]
    port = _bridge_port(relay, pid)
    got = {}

    async def as_relay(page_bytes):
        # The relay's side: read what the page sent, answer with a command echo.
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        got["relay"] = await asyncio.wait_for(reader.readexactly(len(page_bytes)), 5)
        writer.write(b"getReceiverInterface\r\n")
        await writer.drain()
        await asyncio.sleep(0.2)
        writer.close()

    with client.websocket_connect(f"/api/mrtk-relay/browser/ingest?process_id={pid}&token={token}") as ws:
        data = b"$GNGGA,1*00\r\n" * 10
        ws.send_bytes(data)  # before the relay connects: kept for it
        client.portal.call(as_relay, data)
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "write" and base64.b64decode(msg["data"]) == b"getReceiverInterface\r\n"
    assert got["relay"] == data
    # The page left: its relay is stopped.
    assert pid in relay.stopped


def test_a_page_that_never_connects_stops_the_relay(relay, client, monkeypatch):
    monkeypatch.setattr(bb, "ATTACH_TIMEOUT_S", 0.2)
    pid = _start(client)["id"]
    for _ in range(50):
        if pid in relay.stopped:
            break
        time.sleep(0.05)
    assert pid in relay.stopped


def test_stop_closes_the_page_socket(relay, client):
    st = _start(client)
    pid, token = st["id"], st["browser_token"]
    with client.websocket_connect(f"/api/mrtk-relay/browser/ingest?process_id={pid}&token={token}") as ws:
        ws.send_bytes(b"x")
        assert client.post("/api/mrtk-relay/stop", json={"process_id": pid}).status_code == 200
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 1000


def test_a_second_page_is_refused(relay, client):
    st = _start(client)
    url = f"/api/mrtk-relay/browser/ingest?process_id={st['id']}&token={st['browser_token']}"
    with client.websocket_connect(url):
        with client.websocket_connect(url) as second:
            with pytest.raises(WebSocketDisconnect) as closed:
                second.receive_text()
            assert closed.value.code == 1008
    client.post("/api/mrtk-relay/stop", json={"process_id": st["id"]})


def test_the_stream_takes_commands_through_its_tap(relay, client):
    """The relay's input is a local TCP client to no relay: commands go."""
    pid = _start(client)["id"]
    run = relay.args[pid]
    assert run[-2] == "-b"
    status = [s for s in client.get("/api/mrtk-relay/sessions").json() if s["stream"] == pid][0]
    assert status["commands"] or status["blocked"] == "The relay is not connected yet" or status["blocked"] is None
    client.post("/api/mrtk-relay/stop", json={"process_id": pid})
