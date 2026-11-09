"""What the Stream Monitor's Message tab shows (#136).

`MessageLog` keeps, for each message type (`Frame.label`), the counters and
the most recent frames. Navigation data has one row per satellite and signal,
updated in place; every other type keeps its latest frames. All of it is
bounded, because the stream is untrusted input.

Only a key is worked out per frame. The summary line and the hex text are
built when a row is sent, and only the selected type is sent.

Fields read here are header-level. Layouts: mosaic SBF Reference Guides
(§4 raw navigation blocks) and u-blox Interface Descriptions (UBX-RXM-*).
"""

from __future__ import annotations

import struct
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from typing import Any, Callable

from mrtklib_web_ui.services.stream_decoders.framer import Frame
from mrtklib_web_ui.services.stream_decoders.sbf import svid_to_prn
from mrtklib_web_ui.services.stream_decoders.ubx import ubx_sat

MAX_LABELS = 256  # message types tracked; later ones are counted under OTHER
OTHER = "other"
MAX_ROWS_LATEST = 64  # frames kept for a type without a per-satellite key
MAX_ROWS_KEYED = 128  # satellites / signals kept for a type with one
MAX_TYPE_BYTES = 256 * 1024  # frame bytes kept per type
RATE_WINDOW_S = 10.0
PREVIEW_BYTES = 32

_RAW_NAV_DATA = 20  # NAVBits offset, after the SBF header and the fixed fields
_SBF_TOW_DNU = 0xFFFFFFFF
_SBF_WNC_DNU = 0xFFFF
_SBF_L6 = frozenset({4270, 4271})  # Parity / RSCnt instead of CRCPassed
_SBF_RAW_CRC = frozenset({
    4017, 4018, 4019, 4020, 4021, 4022, 4023, 4024, 4026, 4047, 4066, 4067, 4068,
    4093, 4219, 4228, 4242, 4246,
})
# Same SVID field, but CRC fields that differ per block.
_SBF_RAW_OTHER = frozenset({4218, 4221, 4227})
_SBF_RAW = _SBF_RAW_CRC | _SBF_L6 | _SBF_RAW_OTHER

# (gnssId, sigId) → signal, from "Signal identifiers" in the interface documents.
_UBX_SIGNALS = {
    (0, 0): "L1CA", (0, 3): "L2CL", (0, 4): "L2CM", (0, 6): "L5I", (0, 7): "L5Q",
    (1, 0): "L1CA",
    (2, 0): "E1C", (2, 1): "E1B", (2, 3): "E5aI", (2, 4): "E5aQ", (2, 5): "E5bI",
    (2, 6): "E5bQ", (2, 8): "E6B", (2, 9): "E6C", (2, 10): "E6A",
    (3, 0): "B1ID1", (3, 1): "B1ID2", (3, 2): "B2ID1", (3, 3): "B2ID2", (3, 4): "B3ID1",
    (3, 5): "B1Cp", (3, 6): "B1Cd", (3, 7): "B2ap", (3, 8): "B2ad", (3, 10): "B3ID2",
    (5, 0): "L1CA", (5, 1): "L1S", (5, 4): "L2CM", (5, 5): "L2CL", (5, 8): "L5I",
    (5, 9): "L5Q", (5, 12): "L1CB",
    (6, 0): "L1OF", (6, 2): "L2OF",
}
_UBX_L6_STATUS = {0: "status unknown", 1: "error-free", 2: "erroneous"}

# RTCM3 types whose station id (DF003) directly follows the message number.
_RTCM_STATION = frozenset({1005, 1006, 1007, 1008, 1033, 1230}) | frozenset(range(1001, 1005)) \
    | frozenset(range(1009, 1013)) | frozenset(range(1071, 1138))


def _sbf_id(data: bytes) -> int:
    return struct.unpack_from("<H", data, 4)[0] & 0x1FFF


def _ubx_id(data: bytes) -> tuple[int, int]:
    return data[2], data[3]


def _ubx_sfrbx_key(p: bytes) -> str:
    gnss, sv, sig, freq = struct.unpack_from("<BBBB", p, 0)
    prn = ubx_sat(gnss, sv)
    if prn is None:  # GLONASS before its slot is known (svId 255)
        prn = f"R?? k{freq - 7:+d}" if gnss == 6 else f"gnss{gnss} sv{sv}"
    return f"{prn} {_UBX_SIGNALS.get((gnss, sig), f'sig{sig}')}"


def _ubx_l6_key(p: bytes) -> str:
    sv = p[1]
    info = struct.unpack_from("<H", p, 10)[0]
    return f"{ubx_sat(5, sv) or f'sv{sv}'} {'L6E' if info >> 10 & 1 else 'L6D'}"


def frame_key(frame: Frame) -> str | None:
    """Per-satellite row key, or None for a type listed frame by frame."""
    data = frame.data
    try:
        if frame.kind == "sbf" and _sbf_id(data) in _SBF_RAW:
            svid = data[14]
            return svid_to_prn(svid) or f"SV{svid}"
        if frame.kind == "ubx":
            if _ubx_id(data) == (0x02, 0x13):
                return _ubx_sfrbx_key(data[6:-2])
            if _ubx_id(data) == (0x02, 0x73):
                return _ubx_l6_key(data[6:-2])
    except (IndexError, struct.error):
        pass
    return None


def _sbf_summary(data: bytes) -> str:
    tow, wnc = struct.unpack_from("<IH", data, 8)
    parts = [
        "TOW —" if tow == _SBF_TOW_DNU else f"TOW {tow / 1000:.3f}",
        "WNc —" if wnc == _SBF_WNC_DNU else f"WNc {wnc}",
    ]
    bid = _sbf_id(data)
    if bid in _SBF_RAW_CRC:
        parts.append("CRC ok" if data[15] else "CRC failed")
    elif bid in _SBF_L6:
        parts.append(f"RS ok, {data[16]} corrected" if data[15] else "RS failed")
    return "  ".join(parts)


def _ubx_summary(data: bytes) -> str | None:
    msg = _ubx_id(data)
    p = data[6:-2]
    if msg == (0x02, 0x13):  # RXM-SFRBX
        freq, words, chn = p[3], p[4], p[5]
        slot = f"  k{freq - 7:+d}" if p[0] == 6 else ""
        return f"words {words}  ch {chn}{slot}"
    if msg == (0x02, 0x73):  # RXM-QZSSL6
        cno, _, _, corrected, info = struct.unpack_from("<HIBBH", p, 2)
        status = _UBX_L6_STATUS.get(info >> 12 & 3, "status unknown")
        return f"C/N0 {cno / 256:.1f}  RS corrected {corrected}  {status}  ch {'AB'[info >> 14 & 1]}"
    if msg == (0x02, 0x15):  # RXM-RAWX
        tow, week, _, num = struct.unpack_from("<dHbB", p, 0)
        return f"TOW {tow:.3f}  week {week}  numMeas {num}"
    if msg == (0x01, 0x07):  # NAV-PVT
        itow = struct.unpack_from("<I", p, 0)[0]
        return f"iTOW {itow / 1000:.3f}  fixType {p[20]}  numSV {p[23]}"
    if msg == (0x01, 0x35):  # NAV-SAT
        return f"iTOW {struct.unpack_from('<I', p, 0)[0] / 1000:.3f}  numSvs {p[5]}"
    if msg == (0x01, 0x43):  # NAV-SIG
        return f"iTOW {struct.unpack_from('<I', p, 0)[0] / 1000:.3f}  numSigs {p[5]}"
    return None


def _rtcm_summary(data: bytes) -> str | None:
    number = (data[3] << 4) | (data[4] >> 4)
    if number not in _RTCM_STATION:
        return None
    return f"Station {((data[4] & 0x0F) << 8) | data[5]}"


def summary(frame: Frame) -> str | None:
    """A short description from the frame's fixed fields; None if it has none."""
    try:
        if frame.kind == "sbf":
            return _sbf_summary(frame.data)
        if frame.kind == "ubx":
            return _ubx_summary(frame.data)
        if frame.kind == "rtcm3":
            return _rtcm_summary(frame.data)
    except (IndexError, struct.error):
        pass  # shorter than its layout (input is untrusted)
    return None


def _words(data: bytes) -> str:
    """Little-endian 32-bit words, as the navigation data is packed."""
    n = len(data) // 4
    return " ".join(f"{w:08X}" for w in struct.unpack_from(f"<{n}I", data, 0))


def _hex_groups(data: bytes) -> str:
    return " ".join(data[i : i + 4].hex().upper() for i in range(0, len(data), 4))


def preview(frame: Frame) -> str | None:
    """The start of the content, past the headers; None for a text frame."""
    data = frame.data
    if frame.kind == "sbf":
        if _sbf_id(data) in _SBF_RAW:
            return _words(data[_RAW_NAV_DATA : _RAW_NAV_DATA + PREVIEW_BYTES])
        return _hex_groups(data[14 : 14 + PREVIEW_BYTES])
    if frame.kind == "ubx":
        body = data[6:-2]
        if _ubx_id(data) == (0x02, 0x13):
            return _words(body[8 : 8 + PREVIEW_BYTES])
        if _ubx_id(data) == (0x02, 0x73):
            return _hex_groups(body[14 : 14 + PREVIEW_BYTES])
        return _hex_groups(body[:PREVIEW_BYTES])
    if frame.kind == "rtcm3":
        return _hex_groups(data[3:-3][:PREVIEW_BYTES])
    return None


@dataclass(slots=True)
class _Row:
    seq: int
    t: float
    key: str | None
    frame: Frame


@dataclass(slots=True)
class _Type:
    kind: str
    count: int = 0
    bytes: int = 0
    length: int = 0
    last: float = 0.0
    stored: int = 0  # bytes held in `rows`
    # Oldest first. Key: the satellite, or the seq of a frame without one.
    rows: OrderedDict[str | int, _Row] = field(default_factory=OrderedDict)


class MessageLog:
    """Counters and recent frames per message type (no I/O, testable)."""

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._types: dict[str, _Type] = {}
        self._seq = 0
        # Counts at each tick, for the rates. Starts at zero: the first rates
        # are over the time since the session began.
        self._snapshots: deque[tuple[float, dict[str, int]]] = deque([(clock(), {})])

    def add(self, frame: Frame) -> None:
        self._seq += 1
        now = self._clock()
        label = frame.label if frame.label in self._types or len(self._types) < MAX_LABELS else OTHER
        t = self._types.get(label)
        if t is None:
            t = self._types[label] = _Type(frame.kind)
        n = len(frame.data)
        t.count += 1
        t.bytes += n
        t.length = n
        t.last = now

        key = frame_key(frame)
        slot: str | int = self._seq if key is None else key
        old = t.rows.pop(slot, None)
        if old is not None:
            t.stored -= len(old.frame.data)
        t.rows[slot] = _Row(self._seq, now, key, frame)
        t.stored += n
        limit = MAX_ROWS_LATEST if key is None else MAX_ROWS_KEYED
        while len(t.rows) > limit or (t.stored > MAX_TYPE_BYTES and len(t.rows) > 1):
            _, evicted = t.rows.popitem(last=False)
            t.stored -= len(evicted.frame.data)

    def tick(self) -> None:
        """Record the counts; call once per status tick."""
        now = self._clock()
        self._snapshots.append((now, {k: t.count for k, t in self._types.items()}))
        while len(self._snapshots) > 2 and now - self._snapshots[1][0] >= RATE_WINDOW_S:
            self._snapshots.popleft()

    def summary(self, rate_divisor: float | None = 1.0) -> list[dict[str, Any]]:
        """One entry per type. `rate_divisor` undoes a file's replay speed;
        None (a file read at once) means there is no meaningful rate."""
        then, counts = self._snapshots[0]
        span = self._clock() - then
        out = []
        for label, t in self._types.items():
            rate = None
            if rate_divisor is not None and span > 0:
                rate = round((t.count - counts.get(label, 0)) / span / rate_divisor, 2)
            out.append({
                "label": label, "kind": t.kind, "count": t.count, "bytes": t.bytes,
                "length": t.length, "rate": rate, "last": round(t.last, 3),
            })
        return out

    def rows(self, label: str, since: int = 0) -> tuple[list[dict[str, Any]], int]:
        """Rows of `label` that changed after seq `since`, oldest first, and
        the seq to pass next time."""
        t = self._types.get(label)
        if t is None:
            return [], since
        fresh: list[_Row] = []
        for row in reversed(t.rows.values()):  # seq rises through the dict
            if row.seq <= since:
                break
            fresh.append(row)
        fresh.reverse()
        return [self._row_json(r) for r in fresh], fresh[-1].seq if fresh else since

    def now(self) -> float:
        return round(self._clock(), 3)

    @staticmethod
    def _row_json(row: _Row) -> dict[str, Any]:
        f = row.frame
        return {
            "seq": row.seq,
            "key": row.key,
            "t": round(row.t, 3),
            "length": len(f.data),
            "summary": summary(f),
            "preview": preview(f),
            "data": f.data.decode("ascii", "replace") if f.kind in ("nmea", "text") else f.data.hex(),
        }
