"""u-blox UBX decoder: NAV-PVT → epochs, NAV-SAT → satellites.

Layouts from the u-blox F9 interface description. Many setups stream only
RXM-RAWX / RXM-SFRBX + NMEA (positions then come from NMEA); NAV-PVT and
NAV-SAT are decoded when enabled.

NAV-PVT times are its UTC date/time fields (as received). NAV-SAT has only
the GPS time of week (iTOW), so its snapshot takes the time of the NAV-PVT
with the same iTOW, else none.
"""

from __future__ import annotations

import struct
from datetime import datetime, timedelta, timezone

from mrtklib_web_ui.services.stream_decoders.events import (
    PRIMARY_BANDS,
    Epoch,
    Event,
    Satellites,
    SatState,
    prn_id,
)

# NAV-SAT gnssId → RINEX system letter
_GNSS = {0: "G", 1: "S", 2: "E", 3: "C", 5: "J", 6: "R", 7: "I"}


def ubx_sat(gnss_id: int, sv_id: int) -> str | None:
    sys = _GNSS.get(gnss_id)
    if sys is None:
        return None
    if sys == "S":
        return prn_id("S", sv_id - 100) if 120 <= sv_id <= 158 else None
    limit = {"G": 32, "E": 36, "C": 63, "J": 10, "R": 32, "I": 14}[sys]
    return prn_id(sys, sv_id) if 1 <= sv_id <= limit else None


class UbxDecoder:
    def __init__(self) -> None:
        self._pvt_time: tuple[int, datetime] | None = None  # iTOW, UTC time

    def decode(self, frame: bytes) -> list[Event]:
        """One checksum-verified UBX frame, header included."""
        cls, mid = frame[2], frame[3]
        payload = frame[6:-2]
        if (cls, mid) == (0x01, 0x07):
            return self._nav_pvt(payload)
        if (cls, mid) == (0x01, 0x35):
            return self._nav_sat(payload)
        return []

    def flush(self) -> list[Event]:
        return []

    def _nav_pvt(self, p: bytes) -> list[Event]:
        if len(p) < 84:
            return []
        itow, year, month, day, hour, minute, sec, valid = struct.unpack_from("<IHBBBBBB", p, 0)
        nano = struct.unpack_from("<i", p, 16)[0]
        fix_type, flags, _, num_sv = struct.unpack_from("<BBBB", p, 20)
        lon, lat, height = struct.unpack_from("<iii", p, 24)
        if (valid & 0x03) != 0x03:  # needs validDate and validTime
            return []
        try:
            t = datetime(year, month, day, hour, minute, sec, tzinfo=timezone.utc)
        except ValueError:
            return []
        t += timedelta(microseconds=nano / 1000.0)
        self._pvt_time = (itow, t)

        if len(p) >= 92 and p[78] & 0x01:  # flags3.invalidLlh
            return []
        if abs(lat) > 900000000 or abs(lon) > 1800000000:
            return []
        gnss_fix_ok = flags & 0x01
        carr = (flags >> 6) & 0x03
        if fix_type == 1:
            q = 7  # dead reckoning only
        elif fix_type in (2, 3, 4) and gnss_fix_ok:
            q = 1 if carr == 2 else 2 if carr == 1 else 4 if flags & 0x02 else 5
        else:
            return []
        return [Epoch(t, "UTC", lat * 1e-7, lon * 1e-7, height * 1e-3, q, num_sv,
                      "ubx:nav-pvt")]

    def _nav_sat(self, p: bytes) -> list[Event]:
        if len(p) < 8:
            return []
        itow, _, num = struct.unpack_from("<IBB", p, 0)
        sats = []
        for k in range(num):
            o = 8 + 12 * k
            if o + 12 > len(p):
                break
            gnss_id, sv_id, cno, elev, azim, _, flags = struct.unpack_from("<BBBbhhI", p, o)
            prn = ubx_sat(gnss_id, sv_id)
            if prn is None:
                continue
            s = SatState(prn, used=bool(flags & 0x08))
            if -90 <= elev <= 90:  # out of range = unknown (az too)
                s.elevation = float(elev)
                if 0 <= azim <= 360:
                    s.azimuth = float(azim)
            if cno:
                s.set_snr(PRIMARY_BANDS[prn[0]][0], float(cno))
            sats.append(s)
        if self._pvt_time is not None and self._pvt_time[0] == itow:
            return [Satellites(self._pvt_time[1], "UTC", "ubx:nav-sat", sats)]
        return [Satellites(None, "GPST", "ubx:nav-sat", sats)]
