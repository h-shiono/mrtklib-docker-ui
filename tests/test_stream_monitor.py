"""Stream Monitor service and API (#96).

The relay is faked: `process_manager.start` opens a local TCP server on the
port the service asked `mrtk relay` to serve, and writes NMEA to it.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from mrtklib_web_ui.services import stream_monitor_service as sms
from mrtklib_web_ui.services.process_manager import ProcessState, process_manager
from mrtklib_web_ui.services.stream_decoders import Epoch, Satellites, SatState
from mrtklib_web_ui.services.stream_monitor_service import MonitorState, build_relay_args
from stream_builders import nmea

T0 = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)


def _epoch(source: str, sec: float, q: int = 1) -> Epoch:
    return Epoch(T0 + timedelta(seconds=sec), "UTC", 35.0, 139.0, 60.0, q, 10, source)


def _sats(source: str) -> Satellites:
    return Satellites(T0, "UTC", source, [SatState("G05", 120.0, 45.0, True, {"L1": 45.0})])


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


# ── MonitorState ────────────────────────────────────────────────────────────


def test_epochs_are_thinned_to_one_per_second():
    st = MonitorState()
    st.add([_epoch("ubx:nav-pvt", k / 10) for k in range(25)])  # 10 Hz, 2.5 s
    epochs, _ = st.take_updates()
    assert [e["time"][17:23] for e in epochs] == ["00.000", "01.000", "02.000"]
    assert st.take_updates() == ([], None)


def test_time_going_back_is_kept():
    st = MonitorState()
    st.add([_epoch("nmea:gga", 100), _epoch("nmea:gga", 5)])  # replayed file / restart
    assert len(st.take_updates()[0]) == 2


def test_native_source_wins_and_nmea_returns_after_the_hold():
    clock = Clock()
    st = MonitorState(clock)
    st.add([_epoch("sbf:pvtgeodetic", 0), _epoch("nmea:gga", 0.5), _epoch("nmea:gga", 1.5)])
    assert st.epoch_source == "sbf:pvtgeodetic"
    assert [e["time"][17:19] for e in st.take_updates()[0]] == ["00"]
    clock.t = sms.SOURCE_HOLD_S + 1  # SBF PVT stopped
    st.add([_epoch("nmea:gga", 9)])
    assert st.epoch_source == "nmea:gga" and len(st.take_updates()[0]) == 1
    assert st.sources() == ["nmea:gga"]


def test_satellites_follow_the_preferred_source():
    st = MonitorState()
    st.add([_sats("nmea:gsv")])
    assert st.take_updates()[1]["satellites"][0]["prn"] == "G05"
    st.add([_sats("sbf"), _sats("nmea:gsv")])
    _, sats = st.take_updates()
    assert st.satellite_source == "sbf" and sats is not None
    assert st.take_updates()[1] is None  # unchanged since


def test_history_is_capped():
    st = MonitorState()
    st.add([_epoch("nmea:gga", k) for k in range(sms.HISTORY_EPOCHS + 10)])
    assert len(st.history) == sms.HISTORY_EPOCHS


# ── relay arguments ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "kind, path, uri",
    [
        ("serial", "ttyACM0:115200", "serial://ttyACM0:115200"),
        ("tcpcli", " host:9001 ", "tcpcli://host:9001"),
        ("ntripcli", "u:p@caster:2101/MNT", "ntrip://u:p@caster:2101/MNT"),
        ("file", "/data/x.sbf", "file:///data/x.sbf"),
    ],
)
def test_build_relay_args(kind, path, uri):
    args, raw = build_relay_args(kind, path, None, 41000)
    assert args == ["-in", uri, "-out", "tcpsvr://:41000"] and raw is None


def test_raw_log_is_numbered_instead_of_overwritten(tmp_path):
    (tmp_path / "mon.raw").write_bytes(b"old")
    args, raw = build_relay_args("tcpcli", "h:1", str(tmp_path / "mon.raw"), 41000)
    assert raw == str(tmp_path / "mon_2.raw")
    assert args[-2:] == ["-out", f"file://{tmp_path / 'mon_2.raw'}"]


@pytest.mark.parametrize("kind, path", [("udpcli", "h:1"), ("tcpcli", "  ")])
def test_build_relay_args_rejects(kind, path):
    with pytest.raises(ValueError):
        build_relay_args(kind, path, None, 41000)


def test_raw_log_with_a_format_tag_is_rejected(tmp_path):
    # mrtk relay strips "#ubx" and would open (and truncate) mon.ubx, which the
    # numbering never checked.
    (tmp_path / "mon.ubx").write_bytes(b"old")
    with pytest.raises(ValueError, match="#"):
        build_relay_args("tcpcli", "h:1", f"{tmp_path / 'mon.ubx'}#ubx", 41000)


# ── API + WebSocket with a fake relay ───────────────────────────────────────


class FakeRelay:
    """Stands in for `mrtk relay`: serves NMEA on the requested tcpsvr port."""

    def __init__(self) -> None:
        self.servers = {}  # process id -> asyncio server (one per stream)
        self.args = None
        self.return_code = None
        self.exit_codes = {}  # process id -> return code, for one relay only
        self.count = None  # epochs to send before going quiet (None = forever)
        self.writers = {}  # process id -> open connections

    async def start(self, command, args, process_id):
        self.args = args
        port = int(args[3].rsplit(":", 1)[1])

        async def handle(reader, writer):
            self.writers.setdefault(process_id, []).append(writer)
            k = 0
            try:
                while self.count is None or k < self.count:
                    t = (T0 + timedelta(seconds=k)).strftime("%H%M%S.00")
                    writer.write(
                        nmea(f"GNRMC,{t},A,3530.0,N,13915.0,E,0.0,,071126,,,A,V")
                        + nmea(f"GNGGA,{t},3530.0,N,13915.0,E,4,12,0.5,20.0,M,40.0,M,1.0,0001")
                        + nmea("GPGSV,1,1,01,05,45,120,44,1")
                    )
                    await writer.drain()
                    k += 1
                    await asyncio.sleep(0.05)
            except (ConnectionError, asyncio.CancelledError):
                pass

        self.servers[process_id] = await asyncio.start_server(handle, "127.0.0.1", port)
        return SimpleNamespace(id=process_id, state=ProcessState.RUNNING)

    async def get_status(self, process_id):
        rc = self.exit_codes.get(process_id, self.return_code)
        state = ProcessState.STOPPED if rc is not None else ProcessState.RUNNING
        return SimpleNamespace(state=state, return_code=rc)

    async def stop(self, process_id, timeout=5.0):
        # Like the real relay exiting: connections close after their data.
        for w in self.writers.pop(process_id, []):
            w.close()
        server = self.servers.pop(process_id, None)
        if server is not None:
            server.close()


@pytest.fixture
def relay(monkeypatch):
    fake = FakeRelay()
    monkeypatch.setattr(process_manager, "start", fake.start)
    monkeypatch.setattr(process_manager, "get_status", fake.get_status)
    monkeypatch.setattr(process_manager, "stop", fake.stop)
    monkeypatch.setattr(process_manager, "get_log", lambda pid: ["[SYSTEM] fake relay"])
    monkeypatch.setattr(sms, "TICK_S", 0.2)
    return fake


@pytest.fixture
def client():
    from mrtklib_web_ui.main import app

    with TestClient(app) as c:
        yield c


def _receive_until(ws, pred, limit=200, stream="a"):
    """The first message of `stream` that matches `pred`."""
    for _ in range(limit):
        m = json.loads(ws.receive_text())
        if m.get("stream") == stream and pred(m):
            return m
    raise AssertionError("message not received")


def test_message_tab_counters_and_selected_rows(relay, client):
    r = client.post(
        "/api/stream-monitor/start",
        json={"input": {"type": "tcpcli", "path": "localhost:9001"}},
    )
    assert r.status_code == 200
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        assert "messages" in json.loads(ws.receive_text())  # history
        types = _receive_until(
            ws, lambda m: m["type"] == "messages" and m["types"]
        )["types"]
        label = types[0]["label"]
        assert types[0]["count"] > 0 and types[0]["kind"] == "nmea"

        # Nothing per frame until the page selects a type.
        ws.send_text(json.dumps({"type": "select_message", "label": label}))
        first = _receive_until(ws, lambda m: m["type"] == "message_rows")
        assert first["reset"] and first["label"] == label
        assert first["rows"][0]["data"].startswith("$")

        # Later ticks only carry what changed.
        seen = first["rows"][-1]["seq"]
        later = _receive_until(ws, lambda m: m["type"] == "message_rows")
        assert not later["reset"] and all(row["seq"] > seen for row in later["rows"])

        # Malformed client messages are ignored, the socket stays open.
        ws.send_text("not json")
        ws.send_text(json.dumps({"type": "select_message", "label": 5}))
        ws.send_text(json.dumps({"type": "select_message", "label": None}))
        _receive_until(ws, lambda m: m["type"] == "status")
    client.post("/api/stream-monitor/stop")


def test_session_streams_epochs_satellites_and_status(relay, client):
    r = client.post(
        "/api/stream-monitor/start",
        json={"input": {"type": "ntripcli", "path": "user:secret@caster:2101/MNT"}},
    )
    assert r.status_code == 200
    assert r.json()["input"] == "ntrip://user:***@caster:2101/MNT"  # masked
    assert relay.args[1] == "ntrip://user:secret@caster:2101/MNT"  # the relay gets the real one
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        assert json.loads(ws.receive_text())["type"] == "history"
        epochs = _receive_until(ws, lambda m: m["type"] == "epochs")["epochs"]
        assert epochs[0]["Q"] == 1 and epochs[0]["height"] == 60.0
        sats = _receive_until(ws, lambda m: m["type"] == "satellites")
        assert sats["satellites"][0]["prn"] == "G05"
        status = _receive_until(ws, lambda m: m["type"] == "status" and m["msg_counts"])
        assert status["running"] and status["epoch_source"] == "nmea:gga"
        # A client that reconnects mid-run gets the history (L17).
        with client.websocket_connect("/api/stream-monitor/ws") as ws2:
            hist = json.loads(ws2.receive_text())
            assert hist["epochs"] and hist["satellites"] and hist["logs"] == ["[SYSTEM] fake relay"]
        assert client.post("/api/stream-monitor/start", json={
            "input": {"type": "tcpcli", "path": "h:1"}}).status_code == 409
        client.post("/api/stream-monitor/stop")
        end = _receive_until(ws, lambda m: m.get("exited"))
        assert end["running"] is False and end["state"] == "stopped"
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        assert json.loads(ws.receive_text())["epochs"] == []  # no replay once stopped


def test_relay_exit_ends_the_session_with_an_error(relay, client):
    assert client.post("/api/stream-monitor/start", json={
        "input": {"type": "tcpcli", "path": "localhost:1"}}).status_code == 200
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        relay.return_code = 1
        end = _receive_until(ws, lambda m: m.get("exited"))
        assert end["state"] == "error" and "code 1" in end["error_message"]
    assert client.get("/api/stream-monitor/status").json()["running"] is False


@pytest.mark.parametrize(
    "body, code",
    [
        ({"input": {"type": "udp", "path": "x"}}, 400),
        ({"input": {"type": "file", "path": "/etc/passwd"}}, 403),
        ({"input": {"type": "file", "path": "/workspace/.credentials.toml"}}, 403),
        ({"input": {"type": "tcpcli", "path": "h:1"}, "raw_log": "/tmp/x.raw"}, 403),
        ({"input": {"type": "tcpcli", "path": "h:1"}, "raw_log": "/workspace/m.ubx#ubx"}, 400),
    ],
)
def test_start_rejects_bad_requests(relay, client, body, code):
    assert client.post("/api/stream-monitor/start", json=body).status_code == code
    assert relay.args is None  # nothing was started



def test_stop_delivers_the_last_epochs(relay, client):
    """The last NMEA epoch is only complete at EOF; stopping must not cut it off."""
    relay.count = 4
    assert client.post("/api/stream-monitor/start", json={
        "input": {"type": "tcpcli", "path": "localhost:1"}}).status_code == 200
    epochs = []

    def collect(m):
        if m["type"] == "epochs":
            epochs.extend(m["epochs"])
        return m

    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        _receive_until(
            ws, lambda m: collect(m)["type"] == "status" and m["msg_counts"].get("GNGGA") == 4
        )
        client.post("/api/stream-monitor/stop")
        _receive_until(ws, lambda m: collect(m).get("exited"))
    assert [e["time"][11:19] for e in epochs] == ["12:00:00", "12:00:01", "12:00:02", "12:00:03"]


def test_other_pages_see_a_new_session_before_its_logs(relay, client):
    """A status with the new started_at precedes the new relay's output, so a
    page that did not click Start can drop the previous session's console."""
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        assert json.loads(ws.receive_text())["type"] == "history"
        assert json.loads(ws.receive_text())["running"] is False
        for _ in range(2):  # the replay of stream b
            assert json.loads(ws.receive_text())["stream"] == "b"
        assert client.post("/api/stream-monitor/start", json={
            "input": {"type": "tcpcli", "path": "localhost:1"}}).status_code == 200
        first = json.loads(ws.receive_text())
        assert first["type"] == "status" and first["state"] == "starting"
        assert first["running"] and first["started_at"]
        client.post("/api/stream-monitor/stop")
        _receive_until(ws, lambda m: m.get("exited"))


def test_a_relay_that_fails_to_start_ends_the_session(relay, client, monkeypatch):
    async def fail(command, args, process_id):
        raise OSError("no such binary")

    monkeypatch.setattr(process_manager, "start", fail)
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        _receive_until(ws, lambda m: m["type"] == "status")
        assert client.post("/api/stream-monitor/start", json={
            "input": {"type": "tcpcli", "path": "localhost:1"}}).status_code == 409
        end = _receive_until(ws, lambda m: m.get("exited"))
        assert end["state"] == "error" and "no such binary" in end["error_message"]
    assert client.get("/api/stream-monitor/status").json()["running"] is False


def test_relay_start_line_is_masked():
    """process_manager masks every log line before it reaches the WebSocket."""
    from mrtklib_web_ui.services.mask_credentials import mask_log_line

    line = "[SYSTEM] Starting: mrtk relay -in ntrip://user:secret@caster:2101/MNT -out tcpsvr://:1"
    assert "secret" not in mask_log_line(line)
    assert "ntrip://user:***@caster:2101/MNT" in mask_log_line(line)


def test_a_stalled_client_cannot_block_the_broadcast():
    from mrtklib_web_ui.api import stream_monitor as api

    class StalledWs:
        closed = False

        async def send_text(self, text):
            await asyncio.Event().wait()  # network stalled: never returns

        async def close(self, code=1000):
            self.closed = True

    class GoodWs:
        def __init__(self):
            self.got = []

        async def send_text(self, text):
            self.got.append(text)

    async def run():
        stalled, good = api._Client(StalledWs()), api._Client(GoodWs())
        for c in (stalled, good):
            api._clients.add(c)
            c.task = asyncio.create_task(c.run())
        try:
            n = api.CLIENT_QUEUE_MAX + 5
            for k in range(n):  # each broadcast must return without waiting
                await asyncio.wait_for(api._broadcast({"k": k}), timeout=0.1)
                await asyncio.sleep(0)
            await asyncio.sleep(0.01)
            assert stalled not in api._clients and stalled.ws.closed
            assert good in api._clients and len(good.ws.got) == n
        finally:
            for c in (stalled, good):
                api._drop(c)

    asyncio.run(run())


# ── File input (#161): read here, not through mrtk relay ───────────────────


def _nmea_file(path, n: int) -> None:
    out = b""
    for k in range(n):
        t = (T0 + timedelta(seconds=k)).strftime("%H%M%S.00")
        out += nmea(f"GNRMC,{t},A,3530.0,N,13915.0,E,0.0,,071126,,,A,V")
        out += nmea(f"GNGGA,{t},3530.0,N,13915.0,E,4,12,0.5,20.0,M,40.0,M,1.0,0001")
        out += nmea("GPGSV,1,1,01,05,45,120,44,1")
    path.write_bytes(out)


@pytest.fixture
def data_root(tmp_path, monkeypatch):
    from mrtklib_web_ui import paths

    root = tmp_path.resolve()
    monkeypatch.setattr(paths, "ALLOWED_ROOTS", [root])
    return root


def test_file_is_read_at_once_without_the_relay(relay, client, data_root):
    f = data_root / "rcv.nmea"
    _nmea_file(f, 30)
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        r = client.post("/api/stream-monitor/start", json={"input": {"type": "file", "path": str(f)}})
        assert r.status_code == 200, r.text
        assert relay.args is None  # no mrtk relay for a file
        epochs = []
        status = _receive_until(
            ws,
            lambda m: (m["type"] == "epochs" and epochs.extend(m["epochs"])) or (
                m["type"] == "status" and m["file"] and m["file"]["eof"]
            ),
        )
        # The whole file arrived and the session stays open with the data.
        assert status["running"] and status["file"]["read"] == f.stat().st_size
        _receive_until(ws, lambda m: m["type"] == "epochs" and epochs.extend(m["epochs"]) or len(epochs) == 30)
        assert len(epochs) == 30
        with client.websocket_connect("/api/stream-monitor/ws") as ws2:  # reload keeps it
            hist = json.loads(ws2.receive_text())
            assert len(hist["epochs"]) == 30 and hist["satellites"]
            assert any("End of file" in line for line in hist["logs"])
        client.post("/api/stream-monitor/stop")
        end = _receive_until(ws, lambda m: m.get("exited"))
        assert end["state"] == "stopped"


def test_file_is_paced_by_epoch_time(relay, client, data_root):
    f = data_root / "rcv.nmea"
    _nmea_file(f, 11)  # 10 s of data
    r = client.post("/api/stream-monitor/start", json={
        "input": {"type": "file", "path": str(f)}, "file_speed": 20})
    assert r.status_code == 200, r.text
    assert r.json()["file"]["speed"] == 20
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        first = _receive_until(ws, lambda m: m["type"] == "status")
        assert not first["file"]["eof"]  # 10 s at 20x: about 0.5 s
        last = _receive_until(ws, lambda m: m["type"] == "status" and m["file"]["eof"])
        assert last["file"]["read"] == f.stat().st_size
        client.post("/api/stream-monitor/stop")
        _receive_until(ws, lambda m: m.get("exited"))


def test_paced_file_without_epochs_still_yields(tmp_path):
    """A paced file with no position (a measurement-only log) must not read
    through in one go: Stop, the ticker and clients run between chunks."""
    f = tmp_path / "sats.nmea"
    f.write_bytes(nmea("GPGSV,1,1,01,05,45,120,44,1") * 2000)  # ~60 KiB, no Epoch
    size = f.stat().st_size

    async def run():
        svc = sms.StreamMonitorService()
        await svc.start_file(f, 1.0)
        for _ in range(5):
            await asyncio.sleep(0)
        read, eof = svc.file["read"], svc.file["eof"]
        await asyncio.wait_for(svc.stop(), timeout=2)
        return read, eof, svc.state

    read, eof, state = asyncio.run(run())
    assert not eof and 0 < read < size
    assert state == "stopped"


@pytest.mark.parametrize(
    "body, code",
    [
        ({"input": {"type": "file", "path": "{root}/missing.ubx"}}, 400),
        ({"input": {"type": "file", "path": "{root}/rcv.nmea::T::x2"}}, 400),
        ({"input": {"type": "file", "path": "{root}/rcv.nmea"}, "raw_log": "/workspace/x.raw"}, 400),
        ({"input": {"type": "file", "path": "{root}/rcv.nmea"}, "file_speed": 0}, 422),
        ({"input": {"type": "file", "path": "/etc/hosts"}}, 403),
    ],
)
def test_file_input_rejects(relay, client, data_root, body, code):
    _nmea_file(data_root / "rcv.nmea", 2)
    body = json.loads(json.dumps(body).replace("{root}", str(data_root)))
    assert client.post("/api/stream-monitor/start", json=body).status_code == code
    assert client.get("/api/stream-monitor/status").json()["running"] is False


# ── two streams (#171) ──────────────────────────────────────────────────────


def _start(client, stream, path="localhost:9001", **body):
    return client.post(
        "/api/stream-monitor/start",
        json={"stream": stream, "input": {"type": "tcpcli", "path": path}, **body},
    )


def _stop_both(client):
    return [client.post("/api/stream-monitor/stop", params={"stream": s}).json() for s in "ab"]


def test_two_streams_run_side_by_side(relay, client):
    assert _start(client, "a").status_code == 200
    assert _start(client, "b", "localhost:9002").status_code == 200
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        first = [json.loads(ws.receive_text()) for _ in range(4)]
        assert [(m["type"], m["stream"]) for m in first] == [
            ("history", "a"), ("status", "a"), ("history", "b"), ("status", "b"),
        ]
        for stream, port in (("a", "9001"), ("b", "9002")):
            status = _receive_until(ws, lambda m: m["type"] == "status", stream=stream)
            assert status["running"] and status["input"].endswith(port)
            assert _receive_until(ws, lambda m: m["type"] == "epochs", stream=stream)["epochs"]
    a = client.get("/api/stream-monitor/status", params={"stream": "a"}).json()
    b = client.get("/api/stream-monitor/status", params={"stream": "b"}).json()
    assert a["stream"] == "a" and b["stream"] == "b"
    assert sorted(relay.servers) == ["stream-monitor-relay-a", "stream-monitor-relay-b"]
    _stop_both(client)


def test_stopping_or_losing_one_stream_leaves_the_other(relay, client):
    _start(client, "a")
    _start(client, "b", "localhost:9002")
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        relay.exit_codes["stream-monitor-relay-b"] = 3
        ended = _receive_until(ws, lambda m: m["type"] == "status" and m.get("exited"), stream="b")
        assert ended["state"] == "error" and "code 3" in ended["error_message"]
        assert _receive_until(ws, lambda m: m["type"] == "status", stream="a")["running"]

    # Stream b can start again; stopping it does not touch a.
    relay.exit_codes.clear()
    assert _start(client, "b", "localhost:9003").status_code == 200
    assert client.post("/api/stream-monitor/stop", params={"stream": "b"}).json()["state"] == "stopped"
    assert client.get("/api/stream-monitor/status", params={"stream": "a"}).json()["running"]

    assert [s["running"] for s in _stop_both(client)] == [False, False]


def test_a_running_stream_refuses_a_second_start(relay, client):
    assert _start(client, "b").status_code == 200
    r = _start(client, "b", "localhost:9002")
    assert r.status_code == 409 and "Stream B" in r.json()["detail"]
    assert _start(client, "a", "localhost:9003").status_code == 200
    _stop_both(client)


def test_unknown_stream_id_is_rejected(relay, client):
    assert _start(client, "c").status_code == 422
    assert client.post("/api/stream-monitor/stop", params={"stream": "c"}).status_code == 422


def test_message_rows_come_from_the_selected_stream(relay, client):
    _start(client, "a")
    _start(client, "b", "localhost:9002")
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        label = _receive_until(ws, lambda m: m["type"] == "messages" and m["types"], stream="b")["types"][0]["label"]
        ws.send_text(json.dumps({"type": "select_message", "stream": "b", "label": label}))
        rows = _receive_until(ws, lambda m: m["type"] == "message_rows", stream="b")
        assert rows["reset"] and rows["label"] == label and rows["rows"]
        # A bad stream id is ignored; the selection stays.
        ws.send_text(json.dumps({"type": "select_message", "stream": "x", "label": None}))
        assert _receive_until(ws, lambda m: m["type"] == "message_rows", stream="b")["label"] == label
    _stop_both(client)


def test_a_stopped_session_replays_no_message_rows(relay, client):
    _start(client, "a")
    with client.websocket_connect("/api/stream-monitor/ws") as ws:
        label = _receive_until(ws, lambda m: m["type"] == "messages" and m["types"])["types"][0]["label"]
        client.post("/api/stream-monitor/stop")
        _receive_until(ws, lambda m: m["type"] == "status" and m.get("exited"))
        ws.send_text(json.dumps({"type": "select_message", "label": label}))
        rows = _receive_until(ws, lambda m: m["type"] == "message_rows")
        assert rows["reset"] and rows["rows"] == []


def test_two_streams_get_different_raw_logs(tmp_path):
    raw = str(tmp_path / "mon_%Y.raw")
    now = datetime(2026, 11, 9, 4, 0, 0, tzinfo=timezone.utc)
    _, first = build_relay_args("tcpcli", "h:1", raw, 41000, now=now)
    _, second = build_relay_args("tcpcli", "h:2", raw, 41001, now=now, other_raw_logs=[first])
    assert first != second and "_2" in second


def test_free_port_skips_excluded_ports():
    taken = sms.free_port()
    assert sms.free_port({taken}) != taken
