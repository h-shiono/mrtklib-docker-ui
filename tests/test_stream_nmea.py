"""NMEA decoder: epochs, satellites, dates (#96). Coordinates are made up."""

from datetime import datetime, timezone

import pytest

from mrtklib_web_ui.services.stream_decoders import Epoch, Satellites, StreamDecoder
from mrtklib_web_ui.services.stream_decoders.nmea import nmea_sat
from stream_builders import nmea


def _run(*sentences: str, clock=None):
    dec = StreamDecoder(clock=clock)
    events = dec.feed(b"".join(nmea(s) for s in sentences)) + dec.flush()
    return [e for e in events if isinstance(e, Epoch)], [e for e in events if isinstance(e, Satellites)]


# One u-blox style epoch (NMEA 4.11): RMC VTG GGA GSA GSV GLL.
UBLOX_EPOCH = [
    "GNRMC,121911.00,A,3530.00000,N,13915.00000,E,0.009,,071126,,,D,V",
    "GNVTG,,T,,M,0.009,N,0.017,K,D",
    "GNGGA,121911.00,3530.00000,N,13915.00000,E,2,12,0.50,20.9,M,39.4,M,1.0,0137",
    "GNGSA,A,3,02,03,,,,,,,,,,,0.92,0.50,0.77,1",
    "GNGSA,A,3,10,,,,,,,,,,,,0.92,0.50,0.77,3",
    "GPGSV,2,1,05,02,54,037,47,03,38,161,44,07,16,221,,41,40,150,39,1",
    "GPGSV,2,2,05,05,,,30,1",
    "GPGSV,1,1,02,02,54,037,45,03,38,161,41,6",
    "GAGSV,1,1,02,10,26,228,45,12,51,231,48,7",
    "GAGSV,1,1,01,10,26,228,50,2",
    "GNGLL,3530.00000,N,13915.00000,E,121911.00,A,D",
]


def test_ublox_epoch_gives_one_epoch_and_one_snapshot():
    epochs, snaps = _run(*UBLOX_EPOCH)
    assert len(epochs) == 1 and len(snaps) == 1  # GLL (same time) is no boundary
    e = epochs[0].to_json()
    assert e["time"] == "2026-11-07T12:19:11.000Z" and e["time_sys"] == "UTC"
    assert e["lat"] == pytest.approx(35.5) and e["lon"] == pytest.approx(139.25)
    assert e["height"] == pytest.approx(20.9 + 39.4)  # MSL + geoid separation
    assert e["Q"] == 4 and e["ns"] == 12 and e["age"] == 1.0  # GGA 2 = DGPS
    assert e["sdn"] is None and e["ratio"] is None
    assert e["refid"] == 137  # GGA station id, as sent


def test_gsv_signals_accumulate_per_band_and_gsa_sets_used():
    _, (snap,) = _run(*UBLOX_EPOCH)
    sats = {s["prn"]: s for s in snap.to_json()["satellites"]}
    assert sats["G02"]["snr_by_band"] == {"L1": 47.0, "L2": 45.0}  # signal 1 + 6
    assert sats["G02"]["snr"] == 47.0 and sats["G02"]["used"] is True
    assert sats["G07"]["used"] is False and sats["G07"]["snr"] is None  # in view, no SNR
    assert sats["G05"]["azimuth"] is None and sats["G05"]["snr"] == 30.0
    assert sats["E10"]["snr_by_band"] == {"E1": 45.0, "E5b": 50.0}
    assert sats["E10"]["snr"] == 45.0 and sats["E10"]["used"] is True
    assert sats["E12"]["used"] is False
    # GP talker 41 = SBAS PRN 128 → S28; SBAS shares the GPS GSA.
    assert sats["S28"]["system"] == "SBAS" and sats["S28"]["used"] is False


def test_epoch_closes_on_next_time_and_flush():
    second = [s.replace("121911.00", "121912.00") for s in UBLOX_EPOCH]
    dec = StreamDecoder()
    first = dec.feed(b"".join(nmea(s) for s in UBLOX_EPOCH))
    assert first == []  # still collecting
    events = dec.feed(nmea(second[0]))
    assert [type(e) for e in events] == [Epoch, Satellites]
    assert len(dec.feed(b"".join(nmea(s) for s in second[1:])) + dec.flush()) == 2


def test_gga_without_fix_gives_no_epoch():
    epochs, _ = _run("GNGGA,121911.00,,,,,0,00,99.99,,,,,,", "GNGGA,121912.00,,,,,0,00,99.99,,,,,,")
    assert epochs == []


@pytest.mark.parametrize("gga_q, q", [(1, 5), (2, 4), (4, 1), (5, 2), (6, 7)])
def test_gga_quality_mapping(gga_q, q):
    epochs, _ = _run(f"GPGGA,000001.00,3500.0,N,13900.0,E,{gga_q},08,1.0,10.0,M,30.0,M,,")
    assert epochs[0].q == q


def test_mrtklib_output_signal_id_0_and_zero_snr():
    epochs, (snap,) = _run(
        "GNRMC,160002.00,A,3600.0000000,N,14000.0000000,E,0.07,0.00,270819,0.0,E,A,V",
        "GNGGA,160002.00,3600.0000000,N,14000.0000000,E,1,12,1.0,32.245,M,38.037,M,0.0,0000",
        "GNGSA,A,3,14,25,,,,,,,,,,,2.7,1.1,2.4,1",
        "GPGSV,1,1,02,14,76,276,00,25,45,042,00,0",
        "GQGSV,1,1,01,02,82,345,41,0",
    )
    assert epochs[0].to_json()["time"] == "2019-08-27T16:00:02.000Z"
    sats = {s["prn"]: s for s in snap.to_json()["satellites"]}
    assert sats["G14"]["snr"] is None and sats["G14"]["used"] is True
    assert sats["J02"]["snr_by_band"] == {"L1": 41.0}  # signal 0 → primary band
    assert sats["J02"]["used"] is None  # no QZSS GSA → unknown, not "unused"


def test_gst_fills_standard_deviations():
    epochs, _ = _run(
        "GPGGA,000001.00,3500.0,N,13900.0,E,4,08,1.0,10.0,M,30.0,M,,",
        "GPGST,000001.00,0.5,0.1,0.1,0.0,0.012,0.010,0.025",
    )
    e = epochs[0]
    assert (e.sdn, e.sde, e.sdu) == (0.012, 0.010, 0.025)


def test_no_rmc_dates_from_the_clock_across_midnight():
    # Stream at 23:59:59 UTC, clock already at 00:00:02 the next day.
    clock = lambda: datetime(2026, 11, 8, 0, 0, 2, tzinfo=timezone.utc)  # noqa: E731
    epochs, _ = _run(
        "GPGGA,235959.00,3500.0,N,13900.0,E,1,08,1.0,10.0,M,30.0,M,,",
        "GPGGA,000000.00,3500.0,N,13900.0,E,1,08,1.0,10.0,M,30.0,M,,",
        clock=clock,
    )
    assert [e.to_json()["time"] for e in epochs] == [
        "2026-11-07T23:59:59.000Z",
        "2026-11-08T00:00:00.000Z",
    ]


def test_bare_gngsa_only_resolves_glonass():
    _, (snap,) = _run(
        "GNGGA,000001.00,3500.0,N,13900.0,E,1,08,1.0,10.0,M,30.0,M,,",
        "GNGSA,A,3,05,66,,,,,,,,,,,1.0,1.0,1.0",
        "GPGSV,1,1,01,05,40,100,40",
        "GLGSV,1,1,01,66,40,100,40",
    )
    sats = {s["prn"]: s for s in snap.to_json()["satellites"]}
    assert sats["R02"]["used"] is True
    assert sats["G05"]["used"] is None  # 05 could be GPS, Galileo or BeiDou


@pytest.mark.parametrize(
    "system, n, prn",
    [
        ("G", 5, "G05"), ("G", 33, "S20"), ("G", 65, "R01"), ("G", 193, "J01"),
        ("R", 65, "R01"), ("E", 36, "E36"), ("C", 63, "C63"), ("J", 7, "J07"),
        ("J", 199, "J07"), ("I", 14, "I14"), (None, 70, "R06"), ("E", 37, None),
    ],
)
def test_nmea_satellite_numbers(system, n, prn):
    assert nmea_sat(system, n) == prn


@pytest.mark.parametrize(
    "alt, sep",
    [("", "39.4"), ("20.9", ""), ("", "")],
)
def test_missing_altitude_or_geoid_separation_leaves_height_unknown(alt, sep):
    epochs, _ = _run(f"GPGGA,000001.00,3500.0,N,13900.0,E,1,08,1.0,{alt},M,{sep},M,,")
    assert epochs[0].height is None and epochs[0].lat == pytest.approx(35.0)


@pytest.mark.parametrize(
    "bad",
    [
        "GPGGA,000001.00,nan,N,13900.0,E,1,08,1.0,10.0,M,30.0,M,,",
        "GPGGA,000001.00,3500.0,N,inf,E,1,08,1.0,10.0,M,30.0,M,,",
        "GPGGA,0000nan,3500.0,N,13900.0,E,1,08,1.0,10.0,M,30.0,M,,",
        "GPGGA,000001.00,9500.0,N,13900.0,E,1,08,1.0,10.0,M,30.0,M,,",
        "GPGST,000001.00,0.5,0.1,0.1,0.0,nan,inf,0.025",
    ],
)
def test_malformed_numbers_do_not_stop_the_stream(bad):
    good = "GPGGA,000002.00,3500.0,N,13900.0,E,1,08,1.0,10.0,M,30.0,M,,"
    dec = StreamDecoder()
    events = dec.feed(nmea(bad) + nmea(good)) + dec.flush()
    epochs = [e for e in events if isinstance(e, Epoch)]
    assert epochs[-1].to_json()["time"].endswith("00:00:02.000Z")
    for e in epochs:  # no NaN / inf reaches the JSON
        assert all(v is None or abs(v) < 1e9 for v in (e.lat, e.lon, e.height, e.sdn, e.sde))


@pytest.mark.parametrize(
    "field, refid",
    [("0243", 243), ("0101", 101), ("0000", 0), ("0137", 137), ("", None), ("12a", None), ("2000", None)],
)
def test_gga_station_id_is_kept(field, refid):
    """GGA field 14; MRTKLIB CLAS output names the L6 source there (#144)."""
    gga = f"GNGGA,121911.00,3530.0,N,13915.0,E,4,12,0.5,20.0,M,40.0,M,4.0,{field}"
    (e,), _ = _run(gga)
    assert e.to_json()["refid"] == refid


def test_gga_without_station_id_field():
    (e,), _ = _run("GNGGA,121911.00,3530.0,N,13915.0,E,1,08,0.9,20.0,M,40.0,M")
    assert e.refid is None
