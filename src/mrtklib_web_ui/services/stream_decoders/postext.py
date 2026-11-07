"""RTKLIB / MRTKLIB solution text (`mrtk run` llh / xyz output) → epochs.

Same rules as `frontend/.../viewer/posParser.ts`:
  TIME  c0 c1 c2  Q ns  sd0 sd1 sd2 sd01 sd12 sd20  age ratio
with TIME "YYYY/MM/DD HH:MM:SS.sss" or "WEEK TOW", (c0, c1, c2) lat/lon/height
(llh, degrees) or x/y/z (ECEF). The "%" header names the time system
(GPST / UTC / JST) and the layout; without a header, coordinates beyond
lat/lon bounds are read as ECEF. Q is already MRTKLIB's solution quality,
which the UI uses as is. ENU (baseline) and d°m's" rows are not decoded.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone

from mrtklib_web_ui.services.stream_decoders.events import Epoch, Event

_GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)
_TIME_SYS = re.compile(r"^%\s*(GPST|UTC|JST)\b")

# WGS84
_A = 6378137.0
_F = 1.0 / 298.257223563
_E2 = _F * (2.0 - _F)


def ecef_to_llh(x: float, y: float, z: float) -> tuple[float, float, float]:
    """ECEF (m) → (lat deg, lon deg, ellipsoidal height m); RTKLIB ecef2pos."""
    r2 = x * x + y * y
    zk, v = 0.0, _A
    zz = z
    while abs(zz - zk) >= 1e-4:
        zk = zz
        sinp = zz / math.sqrt(r2 + zz * zz)
        v = _A / math.sqrt(1.0 - _E2 * sinp * sinp)
        zz = z + v * _E2 * sinp
    if r2 > 1e-12:
        lat = math.atan(zz / math.sqrt(r2))
        lon = math.atan2(y, x)
    else:
        lat = math.pi / 2.0 if z > 0.0 else -math.pi / 2.0
        lon = 0.0
    h = math.sqrt(r2 + zz * zz) - v
    return math.degrees(lat), math.degrees(lon), h


class PosTextDecoder:
    def __init__(self) -> None:
        self.time_sys = "GPST"
        self.layout: str | None = None  # "llh" | "xyz" | "skip"; None = sniff rows

    def decode(self, line: bytes) -> list[Event]:
        text = line.decode("ascii", "replace").strip()
        if not text:
            return []
        if text.startswith("%"):
            self._header(text)
            return []
        if self.layout == "skip":
            return []
        parts = text.split()
        if len(parts) < 7:
            return []
        t = self._time(parts)
        if t is None:
            return []
        c0, c1, c2 = _num(parts, 2), _num(parts, 3), _num(parts, 4)
        try:
            q, ns = int(parts[5]), int(parts[6])
        except ValueError:
            return []
        if c0 is None or c1 is None or c2 is None:
            return []
        layout = self.layout or ("xyz" if abs(c0) > 90 or abs(c1) > 180 else "llh")
        if layout == "xyz":
            lat, lon, height = ecef_to_llh(c0, c1, c2)
        else:
            lat, lon, height = c0, c1, c2
        if not (-90 <= lat <= 90 and -180 <= lon <= 360):
            return []
        sd = [None, None, None]
        if layout == "llh":  # xyz rows carry ECEF sigmas
            sd = [_num(parts, 7), _num(parts, 8), _num(parts, 9)]
        return [Epoch(t, self.time_sys, lat, lon, height, q, ns, f"pos:{layout}",
                      sdn=sd[0], sde=sd[1], sdu=sd[2],
                      age=_num(parts, 13), ratio=_num(parts, 14))]

    def _header(self, text: str) -> None:
        m = _TIME_SYS.match(text)
        if m:
            self.time_sys = m.group(1)
        low = text.lower()
        if "x-ecef" in low:
            self.layout = "xyz"
        elif "latitude(d'\")" in low or "e-baseline" in low:
            self.layout = "skip"
        elif "latitude" in low:
            self.layout = "llh"

    @staticmethod
    def _time(parts: list[str]) -> datetime | None:
        try:
            if "/" in parts[0]:
                d = datetime.strptime(parts[0], "%Y/%m/%d").replace(tzinfo=timezone.utc)
                h, m, s = parts[1].split(":")
                hh, mm, ss = int(h), int(m), float(s)
                if not (0 <= hh <= 23 and 0 <= mm <= 59 and 0 <= ss < 61):  # rejects nan
                    return None
                return d + timedelta(hours=hh, minutes=mm, seconds=ss)
            week, tow = int(parts[0]), float(parts[1])
        except ValueError:
            return None
        if not 0 <= tow < 604800 or not 0 <= week <= 9999:  # rejects nan / overflow
            return None
        return _GPS_EPOCH + timedelta(weeks=week, seconds=tow)


def _num(parts: list[str], i: int) -> float | None:
    if i >= len(parts):
        return None
    try:
        v = float(parts[i])
    except ValueError:
        return None
    return v if math.isfinite(v) else None
