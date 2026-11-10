"""Stream sessions (#136): the message tap of a relay, its console and commands."""

import asyncio
import json
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from mrtklib_web_ui.services import stream_session_service as sss
from mrtklib_web_ui.services.process_manager import ProcessState, process_manager
from mrtklib_web_ui.services.stream_session_service import TapInfo, plan_tap, relay_back_owner, strip_tap
from stream_builders import nmea

P = 41000  # the tap port the server picked


# ── plan_tap / strip_tap ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "args, run_tail, tap, blocked",
    [
        # serial input, one output: tap is output 2, with -b 2
        (["-in", "serial://ttyACM0", "-out", "file:///w/x.sbf"],
         ["-out", f"tcpsvr://:{P}", "-b", "2"], TapInfo(P, True, True), None),
        # receive only: the tap is output 1
        (["-in", "tcpcli://h:9000"], ["-out", f"tcpsvr://:{P}", "-b", "1"], TapInfo(P, True, True), None),
        # NTRIP: read-only tap
        (["-in", "ntrip://u:p@c:2101/M", "-out", "tcpsvr://:9001"],
         ["-out", f"tcpsvr://:{P}"], TapInfo(P, True, False), "An NTRIP input cannot take receiver commands"),
        (["-in", "file:///data/x.sbf::T"], ["-out", f"tcpsvr://:{P}"], TapInfo(P, True, False),
         "A file input cannot take commands"),
    ],
)
def test_plan_tap_adds_the_tap(args, run_tail, tap, blocked):
    run, got_tap, got_blocked = plan_tap(args, P)
    assert run == [*args, *run_tail] and got_tap == tap and got_blocked == blocked


def test_user_relay_back_to_a_tcp_server_is_shared():
    args = ["-in", "serial://ttyACM0", "-b", "1", "-out", "tcpsvr://:9100", "-out", "file:///w/x"]
    run, tap, blocked = plan_tap(args, P)
    assert run == args and tap == TapInfo(9100, False, False) and blocked is None


def test_user_relay_back_to_a_file_leaves_a_read_only_tap():
    args = ["-in", "serial://ttyACM0", "-b", "1", "-out", "file:///w/x"]
    run, tap, blocked = plan_tap(args, P)
    assert run == [*args, "-out", f"tcpsvr://:{P}"] and tap == TapInfo(P, True, False)
    assert "-b 1" in blocked


def test_four_outputs_share_a_user_tcp_server():
    outs = ["file:///w/a", "tcpsvr://:9002", "file:///w/b", "ntrips://:p@c:2101/M"]
    args = ["-in", "serial://ttyACM0"] + [x for o in outs for x in ("-out", o)]
    run, tap, blocked = plan_tap(args, P)
    assert run == [*args, "-b", "2"] and tap == TapInfo(9002, False, True) and blocked is None


def test_four_outputs_without_a_tcp_server_get_no_tap():
    args = ["-in", "serial://ttyACM0"] + [x for i in range(4) for x in ("-out", f"file:///w/{i}")]
    run, tap, blocked = plan_tap(args, P)
    assert run == args and tap is None and "four outputs" in blocked


def test_no_input_no_tap():
    assert plan_tap([], P) == ([], None, "No input")


def test_strip_tap_hides_what_the_server_added():
    args = ["-in", "serial://x", "-out", "tcpsvr://:9001"]
    run, tap, _ = plan_tap(args, P)
    assert strip_tap(run, tap) == args
    shared = ["-in", "serial://x"] + [x for o in ("file:///a", "tcpsvr://:9", "file:///b", "file:///c") for x in ("-out", o)]
    run, tap, _ = plan_tap(shared, P)
    assert strip_tap(run, tap) == shared  # only the added -b goes


def test_monitor_still_refuses_a_user_output_of_a_stream_with_a_tap():
    """The tap holds the relay-back index, so a user tcpsvr output drops commands."""
    run, _, _ = plan_tap(["-in", "serial://x", "-out", "tcpsvr://:9001"], P)
    infos = [SimpleNamespace(id="r1", command="str2str", args=run, state=ProcessState.RUNNING)]
    orig = process_manager.get_all_processes
    process_manager.get_all_processes = lambda: infos
    try:
        assert relay_back_owner(9001, exclude="m") == ("r1", False)
        assert relay_back_owner(P, exclude="m") == ("r1", True)
    finally:
        process_manager.get_all_processes = orig


# ── API + WebSocket with a fake relay ───────────────────────────────────────

ACK = b"$R: getReceiverInterface\r\n  ReceiverInterface, RxName, mosaic-G5\r\nUSB1>"


class FakeRelay:
    """Serves the tap port from the args: NMEA out, a Septentrio reply to
    every command line written to it."""

    def __init__(self) -> None:
        self.servers = {}
        self.writers = {}
        self.received = bytearray()
        self.args = {}
        self.stopped = set()

    async def start(self, command, args, process_id=None):
        pid = process_id or f"relay-{len(self.args) + 1}"
        self.args[pid] = args
        taps = [a for i, a in enumerate(args) if i and args[i - 1] == "-out" and a.startswith("tcpsvr://")]
        port = int(taps[-1].rsplit(":", 1)[1])

        async def handle(reader, writer):
            self.writers.setdefault(pid, []).append(writer)

            async def commands():
                while chunk := await reader.read(4096):
                    self.received.extend(chunk)
                    writer.write(ACK)

            asyncio.create_task(commands())
            try:
                while True:
                    writer.write(nmea("GNGGA,120000.00,3530.0,N,13915.0,E,1,12,0.5,20.0,M,40.0,M,,"))
                    await writer.drain()
                    await asyncio.sleep(0.05)
            except (ConnectionError, asyncio.CancelledError):
                pass

        self.servers[pid] = await asyncio.start_server(handle, "127.0.0.1", port)
        return SimpleNamespace(
            id=pid, command=command, args=args, state=ProcessState.RUNNING, pid=1,
            return_code=None, started_at=None, stopped_at=None, error_message=None,
        )

    async def get_status(self, process_id):
        if process_id not in self.args:
            return None
        state = ProcessState.STOPPED if process_id in self.stopped else ProcessState.RUNNING
        return SimpleNamespace(
            id=process_id, command="str2str", args=self.args[process_id], state=state, pid=1,
            return_code=None, started_at=None, stopped_at=None, error_message=None,
        )

    async def stop(self, process_id, timeout=5.0):
        self.stopped.add(process_id)
        for w in self.writers.pop(process_id, []):
            w.close()
        server = self.servers.pop(process_id, None)
        if server is not None:
            server.close()
        return await self.get_status(process_id)


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


def _until(ws, pred, stream, limit=300):
    for _ in range(limit):
        m = json.loads(ws.receive_text())
        if m.get("stream") == stream and pred(m):
            return m
    raise AssertionError("message not received")


def test_stream_session_messages_console_and_commands(relay, client):
    args = ["-in", "serial://ttyACM0:115200", "-out", "file:///workspace/x.sbf"]
    r = client.post("/api/mrtk-relay/start", json={"args": args, "name": "Rover"})
    assert r.status_code == 200
    pid = r.json()["id"]
    assert r.json()["args"] == args  # the tap and its -b stay hidden
    run = relay.args[pid]
    assert run[-2:] == ["-b", "2"] and run[-4] == "-out"
    assert client.get("/api/mrtk-relay/streams").json()[0]["args"] == args
    with client.websocket_connect("/api/mrtk-relay/sessions/ws") as ws:
        status = _until(ws, lambda m: m["type"] == "status" and m["connected"], pid)
        assert status["commands"] and status["blocked"] is None
        types = _until(ws, lambda m: m["type"] == "messages" and m["types"], pid)["types"]
        assert types[0]["label"] == "GNGGA"
        ws.send_text(json.dumps({"type": "select_message", "stream": pid, "label": "GNGGA"}))
        rows = _until(ws, lambda m: m["type"] == "message_rows", pid)
        assert rows["reset"] and rows["rows"][0]["data"].startswith("$GNGGA")

        r = client.post("/api/mrtk-relay/sessions/send", json={"process_id": pid, "line": "getReceiverInterface"})
        assert r.status_code == 200
        sent = _until(ws, lambda m: m["type"] == "console", pid)["entry"]
        reply = _until(ws, lambda m: m["type"] == "console", pid)["entry"]
        assert sent["dir"] == "tx" and reply["label"] == "Septentrio reply"
        assert bytes(relay.received) == b"getReceiverInterface\r\n"

        assert client.post("/api/mrtk-relay/stop", json={"process_id": pid}).status_code == 200
        ended = _until(ws, lambda m: m["type"] == "status" and m.get("exited"), pid)
        assert not ended["running"]
    assert client.get("/api/mrtk-relay/sessions").json() == []


def test_history_replays_the_console(relay, client):
    r = client.post("/api/mrtk-relay/start", json={"args": ["-in", "tcpcli://h:9000"]})
    pid = r.json()["id"]
    with client.websocket_connect("/api/mrtk-relay/sessions/ws") as ws:
        _until(ws, lambda m: m["type"] == "status" and m["connected"], pid)
        client.post("/api/mrtk-relay/sessions/send", json={"process_id": pid, "line": "grc"})
        _until(ws, lambda m: m["type"] == "console" and m["entry"]["dir"] == "rx", pid)
    with client.websocket_connect("/api/mrtk-relay/sessions/ws") as ws:
        history = _until(ws, lambda m: m["type"] == "history", pid)
        assert [e["dir"] for e in history["console"]] == ["tx", "rx"]
    client.post("/api/mrtk-relay/stop", json={"process_id": pid})


def test_an_ntrip_stream_reads_but_takes_no_commands(relay, client):
    r = client.post("/api/mrtk-relay/start", json={"args": ["-in", "ntrip://u:p@c:2101/MNT"]})
    pid = r.json()["id"]
    assert "-b" not in relay.args[pid]
    with client.websocket_connect("/api/mrtk-relay/sessions/ws") as ws:
        status = _until(ws, lambda m: m["type"] == "status" and m["connected"], pid)
        assert not status["commands"] and "NTRIP" in status["blocked"]
    r = client.post("/api/mrtk-relay/sessions/send", json={"process_id": pid, "line": "grc"})
    assert r.status_code == 409 and "NTRIP" in r.json()["detail"]
    assert bytes(relay.received) == b""
    client.post("/api/mrtk-relay/stop", json={"process_id": pid})


@pytest.mark.parametrize(
    "body, code",
    [
        ({"process_id": "nope", "line": "grc"}, 409),
        ({"process_id": "x"}, 400),
        ({"process_id": "x", "line": "badé"}, 400),
        ({"process_id": "x", "hex": "zz"}, 400),
    ],
)
def test_session_send_rejects(relay, client, body, code):
    assert client.post("/api/mrtk-relay/sessions/send", json=body).status_code == code


def test_a_relay_that_exits_ends_its_session(relay, client):
    r = client.post("/api/mrtk-relay/start", json={"args": ["-in", "tcpcli://h:9000"]})
    pid = r.json()["id"]
    with client.websocket_connect("/api/mrtk-relay/sessions/ws") as ws:
        _until(ws, lambda m: m["type"] == "status" and m["connected"], pid)
        relay.stopped.add(pid)  # the process exits on its own
        _until(ws, lambda m: m["type"] == "status" and m.get("exited"), pid)


def test_commands_from_two_pages_do_not_interleave(relay, client):
    """Each send holds the session's lock, so lines arrive whole."""
    r = client.post("/api/mrtk-relay/start", json={"args": ["-in", "tcpcli://h:9000"]})
    pid = r.json()["id"]
    session = sss.stream_sessions.get(pid)

    async def both():
        for _ in range(100):
            if session.connected:
                break
            await asyncio.sleep(0.02)
        await asyncio.gather(*(session.send(f"cmd{i:02d}".encode() * 20 + b"\r\n", f"cmd{i}") for i in range(10)))

    with client.websocket_connect("/api/mrtk-relay/sessions/ws"):
        client.portal.call(both)
    for _ in range(50):
        if bytes(relay.received).count(b"\r\n") == 10:
            break
        time.sleep(0.02)
    lines = bytes(relay.received).split(b"\r\n")[:-1]
    assert sorted(lines) == sorted(f"cmd{i:02d}".encode() * 20 for i in range(10))
    client.post("/api/mrtk-relay/stop", json={"process_id": pid})


# ── review follow-ups ───────────────────────────────────────────────────────


def test_a_file_read_at_full_speed_gets_no_tap():
    args = ["-in", "file:///data/x.sbf", "-out", "tcpsvr://:9001"]
    run, tap, blocked = plan_tap(args, P)
    assert run == args and tap is None and "::T" in blocked


def test_a_stream_reading_another_relays_user_output_takes_no_commands(monkeypatch):
    """Relay B reads relay A's user output: A's tap holds -b, so A drops what B sends."""
    a_run, _, _ = plan_tap(["-in", "serial://x", "-out", "tcpsvr://:9001"], P)
    infos = [SimpleNamespace(id="A", command="str2str", args=a_run, state=ProcessState.RUNNING)]
    monkeypatch.setattr(process_manager, "get_all_processes", lambda: infos)
    b = sss.StreamSession("B", TapInfo(P + 1, True, True), None, "tcpcli://127.0.0.1:9001")
    assert "'A'" in b.blocked
    assert b.status_message()["commands"] is False
    with pytest.raises(RuntimeError):
        asyncio.run(b.send(b"grc\r\n", "grc"))
    # reading A's tap itself (its relay-back output) would pass
    assert sss.StreamSession("C", TapInfo(P + 2, True, True), None, f"tcpcli://127.0.0.1:{P}").blocked is None


def test_process_ids_have_one_length_limit(relay, client):
    r = client.post("/api/mrtk-relay/start", json={"args": ["-in", "tcpcli://h:1"], "process_id": "x" * 101})
    assert r.status_code == 422
    r = client.post("/api/mrtk-relay/start", json={"args": ["-in", "tcpcli://h:1"], "process_id": "y" * 100})
    assert r.status_code == 200
    with client.websocket_connect("/api/mrtk-relay/sessions/ws") as ws:
        ws.send_text(json.dumps({"type": "select_message", "stream": "y" * 100, "label": "GNGGA"}))
        rows = _until(ws, lambda m: m["type"] == "message_rows", "y" * 100)
        assert rows["reset"]
    client.post("/api/mrtk-relay/stop", json={"process_id": "y" * 100})


def test_the_decoder_is_flushed_when_the_tap_connection_ends():
    """A last line ending in a lone CR is decoded, not left in the framer."""

    async def run():
        async def handle(reader, writer):
            writer.write(nmea("GNGGA,1", eol=b"\r"))
            await writer.drain()
            writer.close()

        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        session = sss.StreamSession("F", TapInfo(port, True, True), None)
        session.start(lambda msg: asyncio.sleep(0))
        for _ in range(100):
            if session.frames.decoder.msg_counts:
                break
            await asyncio.sleep(0.02)
        await session.stop()
        server.close()
        return dict(session.frames.decoder.msg_counts)

    assert asyncio.run(run()) == {"GNGGA": 1}


def test_a_large_replay_fits_the_client_queue_and_is_taken_after_accept():
    from mrtklib_web_ui.api.message_hub import CLIENT_QUEUE_MAX, MessageHub

    order = []

    class Ws:
        def __init__(self):
            self.sent = []

        async def accept(self):
            order.append("accept")

        async def send_text(self, text):
            self.sent.append(text)

        async def receive_text(self):
            await asyncio.sleep(0.05)
            from fastapi import WebSocketDisconnect

            raise WebSocketDisconnect()

    def replay():
        order.append("replay")
        return [{"k": i} for i in range(CLIENT_QUEUE_MAX * 2)]

    async def run():
        ws = Ws()
        hub = MessageHub("test", lambda s: None, valid_stream=lambda s: True)
        await hub.serve(ws, replay)
        return ws

    ws = asyncio.run(run())
    assert order == ["accept", "replay"]
    assert len(ws.sent) == CLIENT_QUEUE_MAX * 2

