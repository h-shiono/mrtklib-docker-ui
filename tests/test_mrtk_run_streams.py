"""Tests for RT input stream status (rover / base / correction)."""

from mrtklib_web_ui.services.mrtk_run_service import (
    STREAM_STALL_S,
    InputStreamTracker,
    parse_input_counts,
    parse_stream_output,
)

# Captured from `mrtk run` v0.7.11 against a dummy caster: input1 on a valid
# mountpoint, input2 on a missing one (raw multi-line SOURCETABLE response in
# the message), input3 a refused TCP port.
STREAM_TEXT = (
    "s \x08t \x08r \x08e \x08a \x08m \x08\r\n\r\n"
    "\x1b[1mStream       Type     Fmt   S    In-byte  In-bps   Out-byte Out-bps "
    "Path                     Message\x1b[0m\r\n"
    "input1       ntripcli rtcm3 C       2202    3196          0       0 "
    "u:p@127.0.0.1:19001/GOOD 127.0.0.1/GOOD\r\n"
    "input2       ntripcli rtcm3 C          0       0          0       0 "
    "u:p@127.0.0.1:19001/MISS SOURCETABLE 200 OK\r\r\nContent-Typ\r\n"
    "input3       tcpcli   rtcm3 C          0       0          0       0 "
    "127.0.0.1:19009          recv error (61)\r\n"
    "output1      -        llh   -          0       0          0       0 "
    "                         \r\n"
    "rtkrcv> "
)

STATUS_TEXT = (
    "# of input1 data            : obs(0),nav(0),gnav(0),ion(0),sbs(0),pos(0),"
    "dgps(0),ssr(0),err(0)\r\n"
    "# of input2 data            : obs(12),nav(3),gnav(0),ion(1),sbs(0),pos(0),"
    "dgps(0),ssr(0),err(2)\r\n"
)


def _row(n, typ, inb, bps, msg, path="host:2101/MNT", fmt="rtcm3"):
    return (
        f"input{n}       {typ:<8} {fmt:<5} C {inb:>10} {bps:>7} {0:>10} {0:>7} "
        f"{path:<24.24} {msg}\r\n"
    )


def test_parse_stream_output():
    s = parse_stream_output(STREAM_TEXT)
    assert set(s) == {"rover", "base", "correction"}
    assert s["rover"] == {
        "type": "ntripcli", "format": "rtcm3", "in_bytes": 2202,
        "in_bps": 3196, "message": "127.0.0.1/GOOD",
    }
    # Only the first line of a multi-line message is kept
    assert s["base"]["message"] == "SOURCETABLE 200 OK"
    assert s["correction"]["type"] == "tcpcli"
    assert s["correction"]["message"] == "recv error (61)"


def test_parse_stream_output_unused_input():
    s = parse_stream_output(_row(2, "-", 0, 0, "", path=""))
    assert s["base"]["type"] == "-"
    assert s["base"]["message"] == ""


def test_parse_stream_output_unlabelled_format():
    # rtkrcv prints an empty Fmt for rinex / nmea inputs
    s = parse_stream_output(_row(1, "serial", 1200, 9600, "ttyUSB0", fmt=""))
    assert s["rover"]["format"] == ""
    assert s["rover"]["in_bytes"] == 1200
    assert s["rover"]["message"] == "ttyUSB0"


def test_parse_input_counts():
    c = parse_input_counts(STATUS_TEXT)
    assert c["rover"] == {"decoded": 0, "errors": 0}
    assert c["base"] == {"decoded": 16, "errors": 2}


def test_tracker_states_from_capture():
    t = InputStreamTracker()
    entries, events = t.update(parse_stream_output(STREAM_TEXT), {}, now=0.0)
    by = {e["name"]: e for e in entries}
    assert by["rover"]["state"] == "receiving"
    assert by["base"]["state"] == "error"
    assert by["base"]["hint"] == "Mountpoint not found on caster"
    assert by["correction"]["state"] == "error"
    assert by["correction"]["hint"] == "Cannot connect to host"
    assert any("Base stream: Mountpoint not found" in e for e in events)
    assert not any("Rover" in e for e in events)


def test_tracker_latches_error_across_reconnect():
    t = InputStreamTracker()
    t.update(parse_stream_output(_row(2, "ntripcli", 0, 0, "no mountp. reconnect...")), {}, 0.0)
    # The retry overwrites the message; the error must stay visible
    entries, events = t.update(
        parse_stream_output(_row(2, "ntripcli", 0, 0, "connecting...")), {}, 1.0
    )
    assert entries[0]["state"] == "error"
    assert entries[0]["last_error"] == "no mountp. reconnect..."
    assert events == []  # unchanged error kind is not re-logged


def test_tracker_error_right_after_data_is_kept():
    t = InputStreamTracker()
    t.update(parse_stream_output(_row(2, "tcpcli", 500, 4000, "host")), {}, 0.0)
    # Error within the stall window, bytes unchanged: must not be dropped
    e, ev = t.update(parse_stream_output(_row(2, "tcpcli", 500, 0, "recv error (111)")), {}, 1.0)
    assert e[0]["state"] == "error"
    assert ev == ["[WARN] Base stream: Cannot connect to host (recv error (111))"]
    e, _ = t.update(parse_stream_output(_row(2, "tcpcli", 500, 0, "connecting...")), {}, 2.0)
    assert e[0]["state"] == "error"
    assert e[0]["last_error"] == "recv error (111)"


def test_tracker_auth_error():
    t = InputStreamTracker()
    entries, _ = t.update(
        parse_stream_output(_row(1, "ntripcli", 0, 0, "HTTP/1.0 401 Unauthorized")), {}, 0.0
    )
    assert entries[0]["state"] == "error"
    assert entries[0]["hint"].startswith("Authentication failed")


def test_tracker_connecting_then_receiving_then_stalled():
    t = InputStreamTracker()
    e, _ = t.update(parse_stream_output(_row(1, "tcpcli", 0, 0, "connecting...")), {}, 0.0)
    assert e[0]["state"] == "connecting"
    e, ev = t.update(parse_stream_output(_row(1, "tcpcli", 500, 4000, "host")), {}, 1.0)
    assert e[0]["state"] == "receiving"
    assert ev == ["[INFO] Rover stream: receiving data"]
    e, ev = t.update(
        parse_stream_output(_row(1, "tcpcli", 500, 0, "host")), {}, 1.0 + STREAM_STALL_S + 1
    )
    assert e[0]["state"] == "stalled"
    assert ev == ["[WARN] Rover stream: no data received"]
    # rtkrcv later reports the stall as a timeout
    e, _ = t.update(parse_stream_output(_row(1, "tcpcli", 500, 0, "timeout")), {}, 20.0)
    assert e[0]["state"] == "error"
    # Data comes back: the latched error clears
    e, _ = t.update(parse_stream_output(_row(1, "tcpcli", 900, 3000, "host")), {}, 21.0)
    assert e[0]["state"] == "receiving"
    assert e[0]["last_error"] is None


def test_tracker_nodecode_rover_only():
    t = InputStreamTracker()
    text = _row(1, "ntripcli", 9000, 3000, "h/M") + _row(3, "ntripcli", 9000, 3000, "h/M")
    counts = {"rover": {"decoded": 0, "errors": 0}, "correction": {"decoded": 0, "errors": 0}}
    entries, events = t.update(parse_stream_output(text), counts, 0.0)
    by = {e["name"]: e for e in entries}
    assert by["rover"]["state"] == "nodecode"
    # CLAS L6 SSR is not counted by rtksvr, so correction is never flagged
    assert by["correction"]["state"] == "receiving"
    assert any("Rover stream: Data received but nothing decoded" in e for e in events)


def test_tracker_off_input():
    t = InputStreamTracker()
    entries, events = t.update(parse_stream_output(_row(3, "-", 0, 0, "", path="")), {}, 0.0)
    assert entries[0]["state"] == "off"
    assert events == []


def test_tracker_masks_credentials_in_message():
    t = InputStreamTracker()
    entries, _ = t.update(
        parse_stream_output(_row(1, "ntripcli", 0, 0, "user:secret@host error")), {}, 0.0
    )
    assert "secret" not in entries[0]["message"]
