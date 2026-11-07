"""Stream decoder over real captures (local-only, see tests/localdata_manifest.toml)."""

from collections import Counter

import pytest

from mrtklib_web_ui.services.stream_decoders import Epoch, Satellites, StreamDecoder

pytestmark = pytest.mark.localdata


def _decode(data: bytes, chunk: int = 4096):
    dec = StreamDecoder()
    events = []
    for i in range(0, len(data), chunk):
        events += dec.feed(data[i : i + chunk])
    events += dec.flush()
    return (dec, [e for e in events if isinstance(e, Epoch)],
            [e for e in events if isinstance(e, Satellites)])


def test_ublox_rawx_nmea_capture(localdata):
    dec, epochs, snaps = _decode(localdata("ublox_f9_rawx_nmea_60s.raw").read_bytes(), chunk=1000)
    stats = dec.stats()
    assert stats["unknown_bytes"] == 0 and stats["bad_frames"] == 0
    assert stats["msg_counts"] == {
        "UBX RXM-SFRBX": 1291, "UBX RXM-RAWX": 60, "GNRMC": 60, "GNVTG": 60, "GNGGA": 60,
        "GNGLL": 60, "GNGSA": 300, "GPGSV": 366, "GLGSV": 300, "GAGSV": 300, "GBGSV": 400,
        "GQGSV": 180,
    }
    assert len(epochs) == 60 and len(snaps) == 60
    assert all(e.time_sys == "UTC" and e.source == "nmea:gga" for e in epochs)
    assert [s.time for s in snaps] == [e.time for e in epochs]
    systems = Counter(s.system for s in snaps[0].sats)
    assert set(systems) == {"GPS", "GLONASS", "Galileo", "BeiDou", "QZSS", "SBAS"}


def test_mrtklib_nmea_output(localdata):
    dec, epochs, snaps = _decode(localdata("rtkrcv_clas_ref.nmea").read_bytes())
    assert dec.stats()["bad_frames"] == 0
    assert len(epochs) == 3599 and len(snaps) == 3599
    assert epochs[0].to_json()["time"] == "2019-08-27T16:00:02.000Z"


def test_mosaic_sbf_head(localdata):
    with open(localdata("G5P3073h.sbf"), "rb") as f:
        data = f.read(3_000_000)
    dec, epochs, snaps = _decode(data)
    stats = dec.stats()
    assert stats["unknown_bytes"] == 0 and stats["bad_frames"] == 0
    n_pvt = stats["msg_counts"]["SBF 4007 PVTGeodetic"]
    assert len(epochs) == n_pvt == 197
    assert len(snaps) == stats["msg_counts"]["SBF 4027 MeasEpoch"]
    # ChannelStatus PVT usage agrees with the PVT's own satellite count.
    by_time = {s.time: s for s in snaps}
    for e in epochs:
        assert sum(1 for s in by_time[e.time].sats if s.used) == e.ns
