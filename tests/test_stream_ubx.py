"""UBX decoder: NAV-PVT, NAV-SAT (#96). Synthesized frames only."""

import struct

import pytest

from mrtklib_web_ui.services.stream_decoders import Epoch, Satellites, StreamDecoder
from stream_builders import ubx

ITOW = 389969000


def nav_pvt(fix_type=3, flags=0x01, valid=0x07, invalid_llh=False, itow=ITOW, nano=-500000) -> bytes:
    p = bytearray(92)
    struct.pack_into("<IHBBBBBB", p, 0, itow, 2026, 11, 7, 12, 19, 12, valid)
    struct.pack_into("<i", p, 16, nano)
    struct.pack_into("<BBBB", p, 20, fix_type, flags, 0, 20)
    struct.pack_into("<iii", p, 24, 1392500000, 355000000, 60300)  # lon, lat 1e-7 deg; h mm
    p[78] = 0x01 if invalid_llh else 0
    return ubx(0x01, 0x07, bytes(p))


def nav_sat(svs, itow=ITOW) -> bytes:
    body = struct.pack("<IBBH", itow, 1, len(svs), 0)
    for gnss, sv, cno, elev, azim, flags in svs:
        body += struct.pack("<BBBbhhI", gnss, sv, cno, elev, azim, 0, flags)
    return ubx(0x01, 0x35, body)


def _run(data: bytes):
    dec = StreamDecoder()
    events = dec.feed(data) + dec.flush()
    return [e for e in events if isinstance(e, Epoch)], [e for e in events if isinstance(e, Satellites)]


def test_nav_pvt_epoch():
    (e,), _ = _run(nav_pvt(flags=0x01 | (2 << 6)))
    j = e.to_json()
    assert j["time"] == "2026-11-07T12:19:11.999Z" and j["time_sys"] == "UTC"  # nano < 0
    assert j["lat"] == pytest.approx(35.5) and j["lon"] == pytest.approx(139.25)
    assert j["height"] == pytest.approx(60.3) and j["ns"] == 20 and j["Q"] == 1


@pytest.mark.parametrize(
    "kw, q",
    [
        ({"flags": 0x01 | (1 << 6)}, 2),  # carrier float
        ({"flags": 0x03}, 4),  # differential
        ({"flags": 0x01}, 5),  # single
        ({"fix_type": 1, "flags": 0}, 7),  # dead reckoning only
    ],
)
def test_nav_pvt_quality(kw, q):
    (e,), _ = _run(nav_pvt(**kw))
    assert e.q == q


@pytest.mark.parametrize(
    "kw",
    [{"fix_type": 0}, {"fix_type": 5}, {"flags": 0}, {"invalid_llh": True}, {"valid": 0}],
)
def test_nav_pvt_without_a_position_is_dropped(kw):
    epochs, _ = _run(nav_pvt(**kw))
    assert epochs == []


def test_nav_sat_snapshot_takes_the_pvt_time():
    svs = [
        (0, 5, 45, 30, 120, 0x08 | 0x04),  # GPS 5, used
        (1, 129, 40, -100, 0, 0x04),  # SBAS 129 → S29, elevation unknown
        (6, 255, 30, 10, 10, 0),  # GLONASS unknown slot → dropped
        (3, 19, 0, 20, 200, 0),  # BeiDou 19, not tracked
    ]
    _, (snap,) = _run(nav_pvt(flags=0x01) + nav_sat(svs))
    j = snap.to_json()
    assert j["time"] == "2026-11-07T12:19:11.999Z"
    sats = {s["prn"]: s for s in j["satellites"]}
    assert set(sats) == {"G05", "S29", "C19"}
    assert sats["G05"] == {
        "prn": "G05", "system": "GPS", "azimuth": 120.0, "elevation": 30.0,
        "used": True, "snr": 45.0, "snr_by_band": {"L1": 45.0},
    }
    assert sats["S29"]["elevation"] is None and sats["S29"]["azimuth"] is None
    assert sats["C19"]["snr"] is None and sats["C19"]["used"] is False


def test_nav_sat_without_matching_pvt_has_no_time():
    _, (snap,) = _run(nav_sat([(0, 5, 45, 30, 120, 0x08)], itow=ITOW + 1000))
    assert snap.time is None


@pytest.mark.parametrize("valid", [0x01, 0x02])
def test_nav_pvt_needs_both_valid_date_and_time(valid):
    epochs, snaps = _run(nav_pvt(valid=valid) + nav_sat([(0, 5, 45, 30, 120, 0x08)]))
    assert epochs == [] and snaps[0].time is None  # NAV-SAT does not inherit it
