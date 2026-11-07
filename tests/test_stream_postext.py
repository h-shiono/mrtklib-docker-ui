"""MRTKLIB solution text (mrtk run llh / xyz output) decoder (#96)."""

import math

import pytest

from mrtklib_web_ui.services.stream_decoders import Epoch, StreamDecoder
from mrtklib_web_ui.services.stream_decoders.postext import ecef_to_llh

LLH_HEADER = (
    "%  GPST                  latitude(deg) longitude(deg)  height(m)   Q  ns   sdn(m)   sde(m)"
    "   sdu(m)  sdne(m)  sdeu(m)  sdun(m) age(s)  ratio\n"
)
LLH_ROW = (
    "2026/11/07 12:19:11.000   35.500000000  139.250000000    60.3000   1  21   0.0050   0.0040"
    "   0.0120   0.0010  -0.0020   0.0030   1.00    9.9\n"
)


def _epochs(text: str):
    dec = StreamDecoder()
    return [e for e in dec.feed(text.encode()) + dec.flush() if isinstance(e, Epoch)]


def _pos2ecef(lat, lon, h):
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    la, lo = math.radians(lat), math.radians(lon)
    v = a / math.sqrt(1 - e2 * math.sin(la) ** 2)
    return ((v + h) * math.cos(la) * math.cos(lo), (v + h) * math.cos(la) * math.sin(lo),
            (v * (1 - e2) + h) * math.sin(la))


def test_llh_row_with_header():
    (e,) = _epochs(LLH_HEADER + LLH_ROW)
    j = e.to_json()
    assert j["time"] == "2026-11-07T12:19:11.000Z" and j["time_sys"] == "GPST"
    assert (j["lat"], j["lon"], j["height"], j["Q"], j["ns"]) == (35.5, 139.25, 60.3, 1, 21)
    assert (j["sdn"], j["sde"], j["sdu"], j["age"], j["ratio"]) == (0.005, 0.004, 0.012, 1.0, 9.9)
    assert e.source == "pos:llh"


def test_utc_header_and_week_tow_time():
    (e,) = _epochs(LLH_HEADER.replace("GPST", "UTC ") + "2380 389951.000 35.5 139.25 60.3 2 10\n")
    assert e.time_sys == "UTC" and e.to_json()["time"] == "2025-08-21T12:19:11.000Z"


def test_xyz_rows_without_header_are_sniffed():
    x, y, z = _pos2ecef(35.5, 139.25, 60.3)
    (e,) = _epochs(f"2026/11/07 12:19:11.000 {x:.4f} {y:.4f} {z:.4f} 5 8 1.0 1.0 1.0\n")
    assert e.lat == pytest.approx(35.5, abs=1e-8) and e.lon == pytest.approx(139.25, abs=1e-8)
    assert e.height == pytest.approx(60.3, abs=1e-3)
    assert e.sdn is None  # ECEF sigmas are not N/E/U


def test_ecef_to_llh_edge_cases():
    assert ecef_to_llh(6378137.0, 0.0, 0.0) == pytest.approx((0.0, 0.0, 0.0), abs=1e-6)
    lat, _, h = ecef_to_llh(0.0, 0.0, 6356752.314245)
    assert lat == 90.0 and h == pytest.approx(0.0, abs=1e-3)


def test_enu_and_dms_layouts_are_skipped():
    enu = "%  GPST                  e-baseline(m) n-baseline(m) u-baseline(m)   Q  ns\n"
    assert _epochs(enu + "2026/11/07 12:19:11.000 1.0 2.0 3.0 1 10\n") == []
    dms = "%  GPST                  latitude(d'\") longitude(d'\")  height(m)   Q  ns\n"
    assert _epochs(dms + "2026/11/07 12:19:11.000 35 30 0.0 139 15 0.0 60.3 1 10\n") == []


def test_other_text_lines_are_ignored():
    assert _epochs("12 monkeys\n2026/13/45 99:99:99 1 2 3 4 5\n") == []


@pytest.mark.parametrize(
    "bad",
    [
        "1000000000 389951.000 35.5 139.25 60.3 1 10",  # week overflows datetime
        "2380 nan 35.5 139.25 60.3 1 10",
        "2026/11/07 12:19:nan 35.5 139.25 60.3 1 10",
        "2026/11/07 12:19:11.000 nan 139.25 60.3 1 10",
        "2026/11/07 12:19:11.000 inf inf inf 1 10",
    ],
)
def test_malformed_rows_do_not_stop_the_stream(bad):
    (e,) = _epochs(bad + "\n" + LLH_ROW)
    assert e.lat == 35.5


def test_last_row_without_newline_is_decoded_on_flush():
    (e,) = _epochs(LLH_HEADER + LLH_ROW.rstrip("\n"))
    assert e.ns == 21
