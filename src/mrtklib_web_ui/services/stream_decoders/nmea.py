"""NMEA-0183 decoder: GGA / RMC / ZDA / GST / GSA / GSV → epochs + satellites.

Sentences of one epoch are collected and emitted together when the next
epoch starts, i.e. when a time-bearing sentence (GGA / RMC / GLL / ZDA / GST)
carries a different time of day. GSA / GSV carry no time. A u-blox epoch is
RMC VTG GGA GSA… GSV… GLL; MRTKLIB writes RMC GGA GSA… GSV…. `flush()` emits
the last epoch when the stream stops.

Times are UTC (as received; no leap seconds). The date comes from RMC / ZDA;
without either it comes from the current UTC day, as for a live stream.

Quality: GGA fix quality → UI Q via `NMEA_GGA_TO_Q` (same table as
`frontend/.../viewer/posParser.ts`, i.e. MRTKLIB nmea_solq[]). GGA quality 0
(no fix) yields no epoch.

Satellite numbers follow NMEA 4.11 (GSA system ID field, GSV signal ID),
with the older ranges accepted too (GP 33-64 SBAS, 65-96 GLONASS, QZSS
193-202).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Callable

from mrtklib_web_ui.services.stream_decoders.events import (
    PRIMARY_BANDS,
    Epoch,
    Event,
    Satellites,
    SatState,
    prn_id,
)

# GGA 1=Single 2=DGPS 3=PPP 4=Fix 5=Float 6=DR → Q (posParser NMEA_GGA_TO_Q).
NMEA_GGA_TO_Q = [0, 5, 4, 6, 1, 2, 7, 0, 0]

_TALKER_SYS = {"GP": "G", "GL": "R", "GA": "E", "GB": "C", "BD": "C",
               "GQ": "J", "QZ": "J", "GI": "I", "IR": "I"}
_SYSTEM_ID = {"1": "G", "2": "R", "3": "E", "4": "C", "5": "J", "6": "I"}

# NMEA 4.11 signal ID → band, per system (u-blox F9 and MRTKLIB use these).
_GPS_BANDS = {"1": "L1", "2": "L1", "3": "L1", "4": "L2", "5": "L2", "6": "L2",
              "7": "L5", "8": "L5"}
_SIGNAL_BANDS = {
    "G": _GPS_BANDS,
    "S": _GPS_BANDS,
    "R": {"1": "G1", "2": "G1", "3": "G2", "4": "G2"},
    "E": {"1": "E5a", "2": "E5b", "3": "E5", "4": "E6", "5": "E6", "6": "E1", "7": "E1"},
    "C": {"1": "B1I", "2": "B1I", "3": "B1C", "4": "B1C", "5": "B2a", "6": "B2b",
          "7": "B2", "8": "B3", "9": "B3", "A": "B3", "B": "B2I", "C": "B2I"},
    "J": {"1": "L1", "2": "L1", "3": "L1", "4": "L1", "5": "L2", "6": "L2",
          "7": "L5", "8": "L5", "9": "L6", "A": "L6"},
    "I": {"1": "L5", "2": "S", "3": "L5", "4": "S", "5": "L1"},
}

_TIME_SENTENCES = {"GGA": 1, "RMC": 1, "GLL": 5, "ZDA": 1, "GST": 1}


def nmea_sat(system: str | None, n: int) -> str | None:
    """RINEX id for an NMEA satellite number under a system (None = GN talker)."""
    if system in (None, "G"):
        if 1 <= n <= 32:
            return prn_id("G", n)
        if 33 <= n <= 64:
            return prn_id("S", n + 87 - 100)  # NMEA SBAS = PRN - 87
        if 65 <= n <= 96:
            return prn_id("R", n - 64)
        if 193 <= n <= 202:
            return prn_id("J", n - 192)
        return None
    if system == "R":
        if 65 <= n <= 96:
            return prn_id("R", n - 64)
        return prn_id("R", n) if 1 <= n <= 32 else None
    if system == "E":
        if 301 <= n <= 336:
            n -= 300
        return prn_id("E", n) if 1 <= n <= 36 else None
    if system == "C":
        if 401 <= n <= 463:
            n -= 400
        return prn_id("C", n) if 1 <= n <= 63 else None
    if system == "J":
        if 193 <= n <= 202:
            n -= 192
        return prn_id("J", n) if 1 <= n <= 10 else None
    if system == "I":
        return prn_id("I", n) if 1 <= n <= 14 else None
    return None


def _deg(value: str, hemi: str, limit: float) -> float | None:
    """ddmm.mmmm / dddmm.mmmm → signed degrees; None if not a valid angle."""
    v = _float(value)
    if v is None or not 0 <= v <= limit * 100:
        return None
    d = int(v // 100)
    deg = d + (v - d * 100) / 60.0
    return -deg if hemi in ("S", "W") else deg


def _tod(value: str) -> float | None:
    """hhmmss[.ss] → seconds of day."""
    if len(value) < 6:
        return None
    try:
        h, m, s = int(value[0:2]), int(value[2:4]), float(value[4:])
    except ValueError:
        return None
    if h > 23 or m > 59 or not 0 <= s < 61:  # also rejects nan
        return None
    return h * 3600 + m * 60 + s


def _float(value: str) -> float | None:
    """Field → float; None when empty, malformed or not finite ('nan', 'inf')."""
    try:
        v = float(value)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


@dataclass
class _Pending:
    tod: float
    date: date | None = None
    position: tuple[float, float, float | None, int, int | None, float | None] | None = None
    sd: tuple[float | None, float | None, float | None] | None = None
    sats: dict[str, SatState] = field(default_factory=dict)
    used: set[str] = field(default_factory=set)
    used_systems: set[str] = field(default_factory=set)


class NmeaDecoder:
    def __init__(self, clock: Callable[[], datetime] | None = None) -> None:
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._cur: _Pending | None = None
        self._last: tuple[date, float] | None = None  # date + tod of the last epoch

    def decode(self, line: bytes) -> list[Event]:
        """One checksum-verified sentence (the framer's line, '$' … '*hh')."""
        text = line[1 : line.rfind(b"*")].decode("ascii", "replace")
        f = text.split(",")
        head = f[0]
        if len(head) != 5 or head.startswith("P"):
            return []  # proprietary
        talker, kind = head[:2], head[2:]
        events: list[Event] = []

        ti = _TIME_SENTENCES.get(kind)
        if ti is not None and len(f) > ti:
            tod = _tod(f[ti])
            if tod is not None:
                if self._cur is not None and abs(tod - self._cur.tod) > 1e-3:
                    events += self.flush()
                if self._cur is None:
                    self._cur = _Pending(tod)
        cur = self._cur
        if cur is None:
            return events  # GSA / GSV before the first timed sentence

        if kind == "GGA":
            self._gga(cur, f)
        elif kind == "RMC" and len(f) > 9 and len(f[9]) == 6:
            try:
                cur.date = date(2000 + int(f[9][4:6]), int(f[9][2:4]), int(f[9][0:2]))
            except ValueError:
                pass
        elif kind == "ZDA" and len(f) > 4:
            try:
                cur.date = date(int(f[4]), int(f[3]), int(f[2]))
            except ValueError:
                pass
        elif kind == "GST" and len(f) > 8:
            cur.sd = (_float(f[6]), _float(f[7]), _float(f[8]))
        elif kind == "GSA":
            self._gsa(cur, talker, f)
        elif kind == "GSV":
            self._gsv(cur, talker, f)
        return events

    def flush(self) -> list[Event]:
        """Emit the epoch collected so far."""
        cur, self._cur = self._cur, None
        if cur is None:
            return []
        day = self._date_for(cur)
        self._last = (day, cur.tod)
        t = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(seconds=cur.tod)
        events: list[Event] = []
        if cur.position is not None:
            lat, lon, height, q, ns, age = cur.position
            sdn, sde, sdu = cur.sd or (None, None, None)
            events.append(Epoch(t, "UTC", lat, lon, height, q, ns, "nmea:gga",
                                sdn=sdn, sde=sde, sdu=sdu, age=age))
        if cur.sats:
            for prn, s in cur.sats.items():
                if prn[:1] in cur.used_systems:
                    s.used = prn in cur.used
            events.append(Satellites(t, "UTC", "nmea:gsv", list(cur.sats.values())))
        return events

    # ── sentences ───────────────────────────────────────────────────────────

    @staticmethod
    def _gga(cur: _Pending, f: list[str]) -> None:
        if len(f) < 12:
            return
        try:
            q = NMEA_GGA_TO_Q[int(f[6])]
        except (ValueError, IndexError):
            return
        lat, lon = _deg(f[2], f[3], 90), _deg(f[4], f[5], 180)
        if not q or lat is None or lon is None:
            return
        # Ellipsoidal = MSL altitude + geoid separation. Either one missing
        # leaves the height unknown rather than off by the geoid (tens of m).
        alt, sep = _float(f[9]), _float(f[11])
        height = alt + sep if alt is not None and sep is not None else None
        try:
            ns: int | None = int(f[7])
        except ValueError:
            ns = None
        age = _float(f[13]) if len(f) > 13 else None
        cur.position = (lat, lon, height, q, ns, age)

    @staticmethod
    def _gsa(cur: _Pending, talker: str, f: list[str]) -> None:
        if len(f) < 15:
            return
        system = _SYSTEM_ID.get(f[18]) if len(f) > 18 else None
        system = system or _TALKER_SYS.get(talker)
        for v in f[3:15]:
            try:
                n = int(v)
            except ValueError:
                continue
            if system is None:
                # Bare GNGSA (NMEA 4.0): GPS, Galileo and BeiDou numbers
                # overlap, only GLONASS 65-96 is unambiguous.
                if not 65 <= n <= 96:
                    continue
                prn = nmea_sat("R", n)
            else:
                prn = nmea_sat(system, n)
            if prn:
                cur.used.add(prn)
                cur.used_systems.add(prn[:1])
        if system is not None:
            cur.used_systems.add(system)
            if system == "G":
                cur.used_systems.add("S")  # SBAS shares the GPS GSA

    @staticmethod
    def _gsv(cur: _Pending, talker: str, f: list[str]) -> None:
        system = _TALKER_SYS.get(talker)
        rest = f[4:]
        signal = None
        if len(rest) % 4 == 1:  # NMEA 4.10+: trailing signal ID
            signal = rest[-1].upper()
            rest = rest[:-1]
        for k in range(0, len(rest) - 3, 4):
            try:
                n = int(rest[k])
            except ValueError:
                continue
            prn = nmea_sat(system, n)
            if prn is None:
                continue
            sat = cur.sats.get(prn)
            if sat is None:
                sat = cur.sats[prn] = SatState(prn)
            el, az, snr = _float(rest[k + 1]), _float(rest[k + 2]), _float(rest[k + 3])
            if el is not None and -90 <= el <= 90:
                sat.elevation = el
            if az is not None and 0 <= az <= 360:
                sat.azimuth = az
            if snr:  # empty = not tracked; MRTKLIB writes 00 when it has none
                bands = _SIGNAL_BANDS.get(prn[:1], {})
                band = bands.get(signal) if signal and signal != "0" else None
                band = band or PRIMARY_BANDS.get(prn[:1], ("L1",))[0]
                sat.set_snr(band, snr)

    # ── dates ───────────────────────────────────────────────────────────────

    def _date_for(self, cur: _Pending) -> date:
        if cur.date is not None:
            return cur.date
        if self._last is not None:
            day, tod = self._last
            return day + timedelta(days=1) if cur.tod < tod - 43200 else day
        # Live stream with no RMC / ZDA: today's UTC date, allowing for the
        # stream and the clock being either side of midnight.
        now = self._clock()
        now_tod = now.hour * 3600 + now.minute * 60 + now.second
        day = now.date()
        if cur.tod - now_tod > 43200:
            day -= timedelta(days=1)
        elif now_tod - cur.tod > 43200:
            day += timedelta(days=1)
        return day
