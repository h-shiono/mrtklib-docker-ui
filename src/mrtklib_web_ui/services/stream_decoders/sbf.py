"""Septentrio SBF decoder: PVTGeodetic → epochs; MeasEpoch / ChannelStatus /
SatVisibility → satellites.

Layouts from the mosaic SBF Reference Guide (§4.1.9 satellite numbering,
§4.1.10 signal types); the signal table and the C/N0 rule match MRTKLIB
src/data/rcv/mrtk_rcv_septentrio.c (sig_tbl, decode_measepoch).

Satellite snapshots are per receiver epoch (WNc + TOW): the blocks of one
epoch are merged and emitted when a block of a later epoch arrives (or on
`flush()`). MeasEpoch gives C/N0 per band, ChannelStatus az/el (1°) and PVT
usage, SatVisibility az/el (0.01°, preferred). Mosaic receivers often do not
output SatVisibility, and ChannelStatus may come less often than MeasEpoch,
so az/el / usage from a block up to `STALE_S` older are reused.

Times are GPST (TOW / WNc, as received).
"""

from __future__ import annotations

import math
import struct
from datetime import datetime, timedelta, timezone

from mrtklib_web_ui.services.stream_decoders.events import (
    Epoch,
    Event,
    Satellites,
    SatState,
    prn_id,
)

SBF_PVTGEODETIC = 4007
SBF_SATVISIBILITY = 4012
SBF_CHANNELSTATUS = 4013
SBF_MEASEPOCH = 4027

GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)
STALE_S = 10.0

# PVTGeodetic Mode (low 4 bits) → UI Q (Fix=1, Float=2, SBAS=3, DGPS=4,
# Single=5, PPP=6). See QUALITY_COLOR in CLAUDE.md.
SBF_MODE = {
    1: 5,   # Stand-alone     → Single
    2: 4,   # Differential    → DGPS
    3: 5,   # Fixed location  → Single
    4: 1,   # RTK fixed       → Fix
    5: 2,   # RTK float       → Float
    6: 3,   # SBAS-aided      → SBAS
    7: 1,   # Moving-base fix → Fix
    8: 2,   # Moving-base flt → Float
    10: 6,  # PPP             → PPP
}

# Signal number → (system, band). MRTKLIB sig_tbl; None = reserved / L-band.
SBF_SIGNALS: dict[int, tuple[str, str]] = {
    0: ("G", "L1"), 1: ("G", "L1"), 2: ("G", "L2"), 3: ("G", "L2"), 4: ("G", "L5"),
    5: ("G", "L1"), 6: ("J", "L1"), 7: ("J", "L2"), 8: ("R", "G1"), 9: ("R", "G1"),
    10: ("R", "G2"), 11: ("R", "G2"), 12: ("R", "G3"), 13: ("C", "B1C"),
    14: ("C", "B2a"), 15: ("I", "L5"), 17: ("E", "E1"), 19: ("E", "E6"),
    20: ("E", "E5a"), 21: ("E", "E5b"), 22: ("E", "E5"), 24: ("S", "L1"),
    25: ("S", "L5"), 26: ("J", "L5"), 27: ("J", "L6"), 28: ("C", "B1I"),
    29: ("C", "B2I"), 30: ("C", "B3"), 32: ("J", "L1"), 33: ("J", "L1"),
    34: ("C", "B2b"), 36: ("I", "S"), 38: ("J", "L1"), 39: ("J", "L5"),
}


def svid_to_prn(svid: int) -> str | None:
    """SBF satellite number (§4.1.9) → RINEX id."""
    ranges = (
        (1, 37, "G", 0), (38, 61, "R", 37), (63, 68, "R", 38), (71, 106, "E", 70),
        (120, 140, "S", 100), (141, 180, "C", 140), (181, 190, "J", 180),
        (191, 197, "I", 190), (198, 215, "S", 157), (216, 222, "I", 208),
        (223, 245, "C", 182), (250, 251, "G", 212),
    )
    for lo, hi, sys, off in ranges:
        if lo <= svid <= hi:
            return prn_id(sys, svid - off)
    return None  # 62 (GLONASS slot unknown), L-band, undefined


def cn0_dbhz(raw: int, sig: int) -> float | None:
    """MeasEpoch CN0 field → dB-Hz (GPS L1P / L2P carry no +10 offset)."""
    if raw == 255:
        return None
    return raw * 0.25 + (0.0 if sig in (1, 2) else 10.0)


def gpst(wn: int, tow_ms: int) -> datetime:
    return GPS_EPOCH + timedelta(weeks=wn, milliseconds=tow_ms)


def parse_pvt_geodetic(p: bytes) -> tuple[datetime, float, float, float, int, int, float] | None:
    """PVTGeodetic body (after the 8-byte header) →
    (time_gpst, lat_deg, lon_deg, height_m, Q, ns, age_s); age_s = -1 if
    not available. None when there is no valid position.

    Shared with `sbf_pvt_sniffer` (CLAS pipeline); keep its behaviour.
    """
    tow_ms = struct.unpack_from("<I", p, 0)[0]
    wn = struct.unpack_from("<H", p, 4)[0]
    mode_raw = p[6] & 0x0F
    error = p[7]
    if mode_raw == 0 or error != 0 or tow_ms == 0xFFFFFFFF or wn == 0xFFFF:
        return None
    lat_rad, lon_rad, hgt = struct.unpack_from("<ddd", p, 8)
    # SBF marks "do-not-use" with -2e10
    if lat_rad <= -2.0e10 or lon_rad <= -2.0e10 or hgt <= -2.0e10:
        return None
    ns = p[66] if len(p) > 66 else 0
    # `unpack_from('<H', p, 70)` reads bytes 70..72, so we need len(p) >= 72.
    age_raw = struct.unpack_from("<H", p, 70)[0] if len(p) >= 72 else 0xFFFF
    age = age_raw * 0.01 if age_raw != 0xFFFF else -1.0
    return (
        gpst(wn, tow_ms),
        math.degrees(lat_rad),
        math.degrees(lon_rad),
        hgt,
        SBF_MODE.get(mode_raw, 5),
        ns,
        age,
    )


class _Snapshot:
    def __init__(self, key: tuple[int, int]) -> None:
        self.key = key
        self.snr: dict[str, dict[str, float]] = {}
        self.chan: dict[str, tuple[float | None, float | None, bool]] | None = None
        self.vis: dict[str, tuple[float | None, float | None]] | None = None


class SbfDecoder:
    def __init__(self) -> None:
        self._snap: _Snapshot | None = None
        # Latest ChannelStatus / SatVisibility, reused by later epochs.
        self._last_chan: tuple[float, dict] | None = None
        self._last_vis: tuple[float, dict] | None = None

    def decode(self, frame: bytes) -> list[Event]:
        """One CRC-checked SBF block, header included."""
        bid = struct.unpack_from("<H", frame, 4)[0] & 0x1FFF
        body = frame[8:]
        if bid == SBF_PVTGEODETIC:
            return self._pvt(body)
        if bid not in (SBF_MEASEPOCH, SBF_CHANNELSTATUS, SBF_SATVISIBILITY) or len(body) < 8:
            return []
        tow, wn = struct.unpack_from("<IH", body, 0)
        if tow == 0xFFFFFFFF or wn == 0xFFFF:
            return []
        events: list[Event] = []
        key = (wn, tow)
        if self._snap is not None and self._snap.key != key:
            events += self.flush()
        if self._snap is None:
            self._snap = _Snapshot(key)
        t = _seconds(key)
        if bid == SBF_MEASEPOCH:
            self._measepoch(body, self._snap)
        elif bid == SBF_CHANNELSTATUS:
            self._snap.chan = _channel_status(body)
            self._last_chan = (t, self._snap.chan)
        else:
            self._snap.vis = _sat_visibility(body)
            self._last_vis = (t, self._snap.vis)
        return events

    def flush(self) -> list[Event]:
        snap, self._snap = self._snap, None
        if snap is None:
            return []
        t = _seconds(snap.key)
        chan = snap.chan if snap.chan is not None else _fresh(self._last_chan, t)
        vis = snap.vis if snap.vis is not None else _fresh(self._last_vis, t)
        # Satellites of this epoch; stale az/el / usage only enrich them.
        prns = set(snap.snr)
        prns |= set(snap.chan or ()) | set(snap.vis or ())
        if not prns:
            return []
        sats = []
        for prn in prns:
            s = SatState(prn)
            for band, v in snap.snr.get(prn, {}).items():
                s.set_snr(band, v)
            if chan is not None:
                az, el, used = chan.get(prn, (None, None, False))
                s.azimuth, s.elevation, s.used = az, el, used
            if vis is not None and prn in vis:
                vaz, vel = vis[prn]
                s.azimuth = vaz if vaz is not None else s.azimuth
                s.elevation = vel if vel is not None else s.elevation
            sats.append(s)
        return [Satellites(gpst(*snap.key), "GPST", "sbf", sats)]

    @staticmethod
    def _pvt(body: bytes) -> list[Event]:
        if len(body) < 72:
            return []
        r = parse_pvt_geodetic(body)
        if r is None:
            return []
        t, lat, lon, hgt, q, ns, age = r
        if not (abs(lat) <= 90 and abs(lon) <= 180 and math.isfinite(hgt)):
            return []  # NaN / inf doubles; CLAS sniffer keeps its own behaviour
        return [Epoch(t, "GPST", lat, lon, hgt, q, ns, "sbf:pvtgeodetic",
                      age=age if age >= 0 else None)]

    @staticmethod
    def _measepoch(body: bytes, snap: _Snapshot) -> None:
        if len(body) < 12:
            return
        n1, sb1, sb2, flags = body[6], body[7], body[8], body[9]
        if flags & 0x80 or sb1 < 20 or sb2 < 12:
            return  # scrambled, or sub-blocks shorter than the spec allows
        p, end = 12, len(body)
        for _ in range(n1):
            if p + sb1 > end:
                return
            sig = body[p + 1] & 0x1F
            ant = body[p + 1] >> 5
            prn = svid_to_prn(body[p + 2])
            info, n2 = body[p + 18], body[p + 19]
            if sig == 31:
                sig = (info >> 3) + 32
            signals = [(sig, ant, body[p + 15])]
            p += sb1
            for _ in range(n2):
                if p + sb2 > end:
                    break
                sig2 = body[p] & 0x1F
                if sig2 == 31:
                    sig2 = (body[p + 5] >> 3) + 32
                signals.append((sig2, body[p] >> 5, body[p + 2]))
                p += sb2
            if prn is None:
                continue
            for s, a, raw in signals:
                band = SBF_SIGNALS.get(s)
                if a != 0 or band is None or band[0] != prn[0]:
                    continue  # aux antenna, or signal of another system
                v = cn0_dbhz(raw, s)
                if v is not None:
                    bands = snap.snr.setdefault(prn, {})
                    if v > bands.get(band[1], -1.0):
                        bands[band[1]] = v


def _channel_status(body: bytes) -> dict[str, tuple[float | None, float | None, bool]]:
    out: dict[str, tuple[float | None, float | None, bool]] = {}
    if len(body) < 12:
        return out
    n, sb1, sb2 = body[6], body[7], body[8]
    if sb1 < 12 or sb2 < 8:
        return out
    p, end = 12, len(body)
    for _ in range(n):
        if p + sb1 > end:
            break
        svid = body[p] or struct.unpack_from("<H", body, p + 2)[0]
        az_raw = struct.unpack_from("<H", body, p + 4)[0] & 0x1FF
        el_raw = struct.unpack_from("<b", body, p + 8)[0]
        n2 = body[p + 9]
        p += sb1
        used = False
        for _ in range(n2):
            if p + sb2 > end:
                break
            pvt_status = struct.unpack_from("<H", body, p + 4)[0]
            if any((pvt_status >> k) & 3 == 2 for k in range(0, 16, 2)):
                used = True
            p += sb2
        prn = svid_to_prn(svid)
        if prn is None:
            continue
        az = None if az_raw == 511 else float(az_raw)
        el = None if el_raw == -128 else float(el_raw)
        if prn in out:  # one satellite on several channels
            oaz, oel, oused = out[prn]
            out[prn] = (oaz if oaz is not None else az, oel if oel is not None else el,
                        oused or used)
        else:
            out[prn] = (az, el, used)
    return out


def _sat_visibility(body: bytes) -> dict[str, tuple[float | None, float | None]]:
    out: dict[str, tuple[float | None, float | None]] = {}
    if len(body) < 8:
        return out
    n, sbl = body[6], body[7]
    if sbl < 8:
        return out
    p, end = 8, len(body)
    for _ in range(n):
        if p + sbl > end:
            break
        svid = body[p]
        if svid == 0 and sbl >= 10:
            svid = struct.unpack_from("<H", body, p + 8)[0]
        az_raw, el_raw = struct.unpack_from("<Hh", body, p + 2)
        p += sbl
        prn = svid_to_prn(svid)
        if prn is None:
            continue
        out[prn] = (None if az_raw == 65535 else az_raw * 0.01,
                    None if el_raw == -32768 else el_raw * 0.01)
    return out


def _seconds(key: tuple[int, int]) -> float:
    wn, tow_ms = key
    return wn * 604800.0 + tow_ms / 1000.0


def _fresh(last: tuple[float, dict] | None, t: float) -> dict | None:
    if last is None:
        return None
    lt, data = last
    return data if 0 <= t - lt <= STALE_S else None
