"""SBF decoder: PVTGeodetic, MeasEpoch, ChannelStatus, SatVisibility (#96)."""

import math
import struct

import pytest

from mrtklib_web_ui.services.stream_decoders import Epoch, Satellites, StreamDecoder
from mrtklib_web_ui.services.stream_decoders.sbf import cn0_dbhz, svid_to_prn
from stream_builders import sbf, sbf_tow

WN, TOW = 2410, 389951000  # GPST 2026-03-19 12:19:11


def pvt_body(tow=TOW, mode=4, error=0, ns=21, age_raw=150, lat=35.5, lon=139.25, h=60.0) -> bytes:
    b = bytearray(84)
    struct.pack_into("<IHBB", b, 0, tow, WN, mode, error)
    struct.pack_into("<ddd", b, 8, math.radians(lat), math.radians(lon), h)
    b[66] = ns
    struct.pack_into("<H", b, 70, age_raw)
    return bytes(b)


def meas_type1(svid, sig, cn0, n2=0, ant=0, info=0) -> bytes:
    b = bytearray(20)
    b[1] = (ant << 5) | sig
    b[2] = svid
    b[15] = cn0
    b[18] = info
    b[19] = n2
    return bytes(b)


def meas_type2(sig, cn0, ant=0, info=0) -> bytes:
    b = bytearray(12)
    b[0] = (ant << 5) | sig
    b[2] = cn0
    b[5] = info
    return bytes(b)


def measepoch(subblocks: list[bytes], n1: int, tow=TOW, flags=0) -> bytes:
    return sbf(4027, sbf_tow(tow, WN) + bytes((n1, 20, 12, flags, 0, 0)) + b"".join(subblocks))


def chan_sat(svid, az, el, pvt_status, svid_full=0) -> bytes:
    sat = struct.pack("<BBHHHbBBB", svid, 0, svid_full, az, 0, el, 1, 0, 0)
    state = struct.pack("<BBHHH", 0, 0, 0xFFFF, pvt_status, 0)
    return sat + state


def channel_status(sats: list[bytes], tow=TOW) -> bytes:
    return sbf(4013, sbf_tow(tow, WN) + bytes((len(sats), 12, 8, 0, 0, 0)) + b"".join(sats))


def sat_visibility(entries, tow=TOW) -> bytes:
    body = b"".join(struct.pack("<BBHhBBH", svid, 0, az, el, 1, 2, 0) for svid, az, el in entries)
    return sbf(4012, sbf_tow(tow, WN) + bytes((len(entries), 10)) + body)


def _run(data: bytes):
    dec = StreamDecoder()
    events = dec.feed(data) + dec.flush()
    return [e for e in events if isinstance(e, Epoch)], [e for e in events if isinstance(e, Satellites)]


def test_pvt_geodetic_epoch():
    (e,), _ = _run(sbf(4007, pvt_body()))
    j = e.to_json()
    assert j["time_sys"] == "GPST" and j["Q"] == 1 and j["ns"] == 21 and j["age"] == 1.5
    assert j["lat"] == pytest.approx(35.5) and j["lon"] == pytest.approx(139.25) and j["height"] == 60.0
    assert j["sdn"] is None  # HAccuracy is 2DRMS, not a per-axis sigma


@pytest.mark.parametrize("kw", [{"mode": 0}, {"error": 1}, {"tow": 0xFFFFFFFF}])
def test_pvt_without_a_position_is_dropped(kw):
    epochs, _ = _run(sbf(4007, pvt_body(**kw)))
    assert epochs == []


def test_pvt_age_not_available_is_none():
    (e,), _ = _run(sbf(4007, pvt_body(age_raw=0xFFFF)))
    assert e.age is None


def test_measepoch_cn0_per_band():
    g05 = meas_type1(5, 0, 140, n2=3) + meas_type2(3, 120) + meas_type2(2, 168) + meas_type2(4, 255)
    # J02 (SBF 182): L1C/A + extended signal 33 (L1S) via sig 31 + ObsInfo.
    j02 = meas_type1(182, 6, 120, n2=2) + meas_type2(31, 140, info=(1 << 3)) + meas_type2(7, 150, ant=1)
    _, (snap,) = _run(measepoch([g05, j02], n1=2))
    sats = {s["prn"]: s for s in snap.to_json()["satellites"]}
    # L1C/A 140*0.25+10; L2C 120*0.25+10 = 40; L2P 168*0.25 (no +10) = 42; L5 DNU.
    assert sats["G05"]["snr_by_band"] == {"L1": 45.0, "L2": 42.0}
    assert sats["J02"]["snr_by_band"] == {"L1": 45.0}  # L1S stronger; aux-antenna L2 ignored
    assert sats["G05"]["used"] is None and sats["G05"]["azimuth"] is None  # no ChannelStatus


def test_scrambled_measepoch_is_skipped():
    _, snaps = _run(measepoch([meas_type1(5, 0, 140)], n1=1, flags=0x80))
    assert snaps == []


def test_channel_status_and_sat_visibility_merge_into_the_snapshot():
    data = (
        measepoch([meas_type1(5, 0, 140), meas_type1(81, 17, 150)], n1=2)
        + channel_status([chan_sat(5, 120, 45, 0b10), chan_sat(0, 511, -128, 0b01, svid_full=81)])
        + sat_visibility([(5, 12034, 4512)])
    )
    _, (snap,) = _run(data)
    sats = {s["prn"]: s for s in snap.to_json()["satellites"]}
    assert sats["G05"]["used"] is True
    assert (sats["G05"]["azimuth"], sats["G05"]["elevation"]) == (120.34, 45.12)  # SatVisibility wins
    assert sats["E11"]["used"] is False  # waiting for ephemeris ≠ used
    assert sats["E11"]["azimuth"] is None and sats["E11"]["elevation"] is None  # DNU
    assert sats["E11"]["snr"] == 47.5


def test_snapshot_per_epoch_and_stale_channel_status_reuse():
    data = (
        channel_status([chan_sat(5, 120, 45, 0b10)], tow=TOW)
        + measepoch([meas_type1(5, 0, 140)], n1=1, tow=TOW)
        + measepoch([meas_type1(5, 0, 144)], n1=1, tow=TOW + 1000)  # no ChannelStatus
        + measepoch([meas_type1(5, 0, 148)], n1=1, tow=TOW + 11000)  # > STALE_S later
    )
    _, snaps = _run(data)
    g05 = [{s["prn"]: s for s in sn.to_json()["satellites"]}["G05"] for sn in snaps]
    assert [s["snr"] for s in g05] == [45.0, 46.0, 47.0]
    assert [s["used"] for s in g05] == [True, True, None]
    assert g05[1]["azimuth"] == 120.0 and g05[2]["azimuth"] is None


@pytest.mark.parametrize(
    "svid, prn",
    [(1, "G01"), (37, "G37"), (38, "R01"), (62, None), (63, "R25"), (71, "E01"),
     (110, None), (120, "S20"), (141, "C01"), (181, "J01"), (190, "J10"),
     (191, "I01"), (198, "S41"), (216, "I08"), (223, "C41"), (250, "G38"), (0, None)],
)
def test_svid_numbering(svid, prn):
    assert svid_to_prn(svid) == prn


def test_cn0_rule():
    assert cn0_dbhz(100, 0) == 35.0 and cn0_dbhz(100, 1) == 25.0 and cn0_dbhz(255, 0) is None


def test_pvt_with_nan_coordinates_is_dropped_and_the_stream_continues():
    epochs, _ = _run(sbf(4007, pvt_body(lat=float("nan"))) + sbf(4007, pvt_body(tow=TOW + 1000)))
    assert len(epochs) == 1 and epochs[0].lat == pytest.approx(35.5)


def test_decode_errors_are_contained_per_frame(monkeypatch):
    dec = StreamDecoder()

    def boom(frame):
        raise struct.error("bad layout")

    monkeypatch.setattr(dec.sbf, "decode", boom)
    events = dec.feed(sbf(4007, pvt_body()) + nmea_gga())
    assert [type(e) for e in events + dec.flush()] == [Epoch]  # the NMEA epoch survives
    assert dec.stats()["decode_errors"] == 1


def nmea_gga():
    from stream_builders import nmea

    return nmea("GPGGA,000001.00,3500.0,N,13900.0,E,1,08,1.0,10.0,M,30.0,M,,")
