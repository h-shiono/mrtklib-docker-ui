"""Split one receiver byte stream into NMEA / UBX / SBF / RTCM3 / reply / text frames.

Receivers commonly mix protocols on one port (u-blox: UBX + NMEA, Septentrio:
SBF + NMEA), and relay outputs may carry RTCM3 too. Binary frames are only
accepted after their checksum verifies (SBF CRC-16, UBX Fletcher, RTCM3
CRC-24Q, NMEA XOR), so a sync pattern inside another frame's payload or in
noise does not yield a frame. Accepted frames are consumed whole, so their
payload is never scanned for syncs.

A candidate whose declared length exceeds `MAX_FRAME` is treated as a false
sync, so it cannot stall the parser waiting for bytes that never come.

Septentrio ASCII output (command replies `$R:` / `$R;` / `$R?`, transmissions
`$TD` / `$TE`, formatted blocks `$--`) is a `reply` frame: it runs up to the
prompt that ends it (`USB1>`, `COM1>`, `IP10>`, `STOP>`, or the pseudo-prompt
`---->`), and must stay printable. Replies are atomic on the receiver side, so
binary data cannot interleave inside one.
"""

from __future__ import annotations

import re
import struct
from dataclasses import dataclass

from mrtklib_web_ui.services.stream_decoders.names import SBF_NAMES, UBX_NAMES

MAX_FRAME = 16384
MAX_LINE = 512  # NMEA allows 82; proprietary sentences and .pos lines are longer
_MAX_BUFFER = 1 << 20
MAX_REPLY = 65536  # a long lst reply (configuration file) still fits
_MAX_NMEA_LABEL = 16  # a checksummed line without a comma must not become a huge label

# Bytes that can start a frame: UBX µ, RTCM3 0xD3, '$' (NMEA / SBF '$@'),
# '%' (RTKLIB solution header) and digits (RTKLIB solution rows).
_CANDIDATE = re.compile(rb"[\xb5\xd3$%0-9]")
_PRINTABLE = frozenset(range(0x20, 0x7F)) | {0x09}
_REPLY_BYTES = bytes(sorted(_PRINTABLE | {0x0A, 0x0D}))
# Two characters after '$' that start Septentrio ASCII output, and its label.
SEPTENTRIO_REPLY_LABELS = {
    b"R:": "Septentrio reply",
    b"R;": "Septentrio reply",
    b"R?": "Septentrio error",
    b"TD": "Septentrio $TD",
    b"TE": "Septentrio $TE",
    b"--": "Septentrio block",
}
# A line break, then the prompt of a connection (COM1, USB1, IP10, IPS1, NTR1,
# BT10, ...), STOP after a reset command, or the pseudo-prompt between blocks.
_PROMPT = re.compile(rb"\r?\n(?P<prompt>[A-Z]{2,4}[0-9]{1,2}|STOP|----)>")
# Binary, or a line starting with '$' (the next sentence: replies never have
# one; lst blocks are frames of their own). Either way this is not a reply,
# and a false "$R:" in an NMEA stream cannot hold the stream for 64 KiB.
_NOT_REPLY = re.compile(rb"[^" + re.escape(_REPLY_BYTES) + rb"]|\n\$")


@dataclass
class Frame:
    kind: str  # "nmea" | "ubx" | "sbf" | "rtcm3" | "text"
    data: bytes  # the whole frame (NMEA / text: the line without CR/LF)
    label: str  # for message counters, e.g. "GNGGA", "UBX NAV-PVT", "SBF 4007"


# ── checksums ───────────────────────────────────────────────────────────────


def _crc16_table() -> list[int]:
    table = []
    for i in range(256):
        crc = i << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
        table.append(crc & 0xFFFF)
    return table


def _crc24q_table() -> list[int]:
    table = []
    for i in range(256):
        crc = i << 16
        for _ in range(8):
            crc <<= 1
            if crc & 0x1000000:
                crc ^= 0x1864CFB
        table.append(crc & 0xFFFFFF)
    return table


_CRC16 = _crc16_table()
_CRC24Q = _crc24q_table()


def crc16_ccitt(data: bytes) -> int:
    """SBF block CRC (CCITT, polynomial 0x1021, initial value 0)."""
    crc = 0
    for b in data:
        crc = ((crc << 8) & 0xFFFF) ^ _CRC16[((crc >> 8) ^ b) & 0xFF]
    return crc


def crc24q(data: bytes) -> int:
    """RTCM3 frame CRC."""
    crc = 0
    for b in data:
        crc = ((crc << 8) & 0xFFFFFF) ^ _CRC24Q[((crc >> 16) ^ b) & 0xFF]
    return crc


def ubx_checksum(data: bytes) -> bytes:
    """UBX 8-bit Fletcher checksum over class, id, length and payload."""
    a = b = 0
    for x in data:
        a = (a + x) & 0xFF
        b = (b + a) & 0xFF
    return bytes((a, b))


def nmea_checksum(body: bytes) -> int:
    """XOR of the characters between '$' and '*'."""
    c = 0
    for x in body:
        c ^= x
    return c


# ── labels ──────────────────────────────────────────────────────────────────

def _ubx_label(cls: int, mid: int) -> str:
    return "UBX " + UBX_NAMES.get((cls, mid), f"{cls:02X}-{mid:02X}")


def _sbf_label(bid: int) -> str:
    name = SBF_NAMES.get(bid)
    return f"SBF {bid} {name}" if name else f"SBF {bid}"


# ── framer ──────────────────────────────────────────────────────────────────

# Result of trying one frame kind at a position.
_NEED_MORE = object()  # might be a frame, buffer ends before it can tell
_NO = None  # not this kind of frame here


class Framer:
    """Incremental framer: `feed(chunk)` returns the frames completed so far."""

    def __init__(self) -> None:
        self._buf = bytearray()
        self.unknown_bytes = 0
        self.bad_frames = 0  # sync + plausible header, checksum failed

    def feed(self, chunk: bytes) -> list[Frame]:
        self._buf.extend(chunk)
        frames: list[Frame] = []
        pos = self._scan(frames)
        if pos:
            del self._buf[:pos]
        if len(self._buf) > _MAX_BUFFER:  # cannot happen with MAX_FRAME; guard anyway
            self.unknown_bytes += len(self._buf)
            self._buf.clear()
        return frames

    def flush(self) -> list[Frame]:
        """End of stream: the buffer end also ends a line (a last row without
        LF, or with a lone CR); incomplete binary frames are dropped."""
        frames: list[Frame] = []
        self._scan(frames, eof=True)
        self._buf.clear()
        return frames

    def _scan(self, frames: list[Frame], eof: bool = False) -> int:
        buf = self._buf
        n = len(buf)
        pos = 0
        while pos < n:
            m = _CANDIDATE.search(buf, pos)
            if m is None:
                self.unknown_bytes += n - pos
                return n
            if m.start() > pos:
                self.unknown_bytes += m.start() - pos
                pos = m.start()
            b0 = buf[pos]
            if b0 == 0xB5:
                res = self._try_ubx(pos)
            elif b0 == 0xD3:
                res = self._try_rtcm3(pos)
            elif b0 == 0x24 and pos + 1 < n and buf[pos + 1] == 0x40:
                res = self._try_sbf(pos)
            elif b0 == 0x24 and (pos + 2 >= n or bytes(buf[pos + 1 : pos + 3]) in SEPTENTRIO_REPLY_LABELS):
                res = self._try_reply(pos, eof)
            elif b0 == 0x24:
                res = self._try_line(pos, nmea=True, eof=eof)
            else:
                res = self._try_line(pos, nmea=False, eof=eof)
            if res is _NEED_MORE and not eof:
                return pos
            if res is _NEED_MORE:  # end of stream: it will never complete
                res = _NO
            if res is _NO:
                self.unknown_bytes += 1
                pos += 1
                continue
            frame, end = res
            if frame is not None:
                frames.append(frame)
            pos = end
        return pos

    def _try_ubx(self, pos: int):
        buf = self._buf
        if pos + 1 < len(buf) and buf[pos + 1] != 0x62:
            return _NO
        if pos + 6 > len(buf):
            return _NEED_MORE
        cls, mid, length = buf[pos + 2], buf[pos + 3], struct.unpack_from("<H", buf, pos + 4)[0]
        if length + 8 > MAX_FRAME:
            return _NO
        end = pos + 8 + length
        if end > len(buf):
            return _NEED_MORE
        if ubx_checksum(buf[pos + 2 : end - 2]) != buf[end - 2 : end]:
            self.bad_frames += 1
            return _NO
        return Frame("ubx", bytes(buf[pos:end]), _ubx_label(cls, mid)), end

    def _try_sbf(self, pos: int):
        buf = self._buf
        if pos + 8 > len(buf):
            return _NEED_MORE
        crc, bid, length = struct.unpack_from("<HHH", buf, pos + 2)
        if length < 8 or length % 4 or length > MAX_FRAME:
            return _NO
        end = pos + length
        if end > len(buf):
            return _NEED_MORE
        if crc16_ccitt(buf[pos + 4 : end]) != crc:
            self.bad_frames += 1
            return _NO
        return Frame("sbf", bytes(buf[pos:end]), _sbf_label(bid & 0x1FFF)), end

    def _try_reply(self, pos: int, eof: bool):
        """Septentrio ASCII output, up to and including its prompt."""
        buf = self._buf
        n = len(buf)
        if pos + 2 >= n:
            return _NO if eof else _NEED_MORE  # too short to tell yet
        head = bytes(buf[pos + 1 : pos + 3])
        if head not in SEPTENTRIO_REPLY_LABELS:
            return self._try_line(pos, nmea=True, eof=eof)
        limit = min(n, pos + MAX_REPLY)
        window = bytes(buf[pos:limit])
        end_m = _PROMPT.search(window)
        bad = _NOT_REPLY.search(window, 0, end_m.end() if end_m else len(window))
        if bad is not None:
            return _NO  # binary inside: not a reply (or one cut off)
        if end_m is None:
            if limit - pos >= MAX_REPLY or eof:
                return _NO
            return _NEED_MORE
        end = pos + end_m.end()
        return Frame("reply", bytes(buf[pos:end]), SEPTENTRIO_REPLY_LABELS[head]), end

    def _try_rtcm3(self, pos: int):
        buf = self._buf
        if pos + 3 > len(buf):
            return _NEED_MORE
        if buf[pos + 1] & 0xFC:  # 6 reserved bits must be zero
            return _NO
        length = ((buf[pos + 1] & 0x03) << 8) | buf[pos + 2]
        end = pos + 3 + length + 3
        if end > len(buf):
            return _NEED_MORE
        if crc24q(buf[pos : end - 3]) != int.from_bytes(buf[end - 3 : end], "big"):
            self.bad_frames += 1
            return _NO
        mtype = ((buf[pos + 3] << 4) | (buf[pos + 4] >> 4)) if length >= 2 else 0
        return Frame("rtcm3", bytes(buf[pos:end]), f"RTCM3 {mtype}"), end

    def _try_line(self, pos: int, nmea: bool, eof: bool = False):
        """A printable line ending in CR / LF. NMEA lines need a valid *hh.

        A '$' inside the line starts the next sentence (the stream lost a
        line end), so the line stops there.
        """
        buf = self._buf
        n = len(buf)
        limit = min(n, pos + MAX_LINE)
        i = pos + 1
        while i < limit:
            c = buf[i]
            if c == 0x0A or c == 0x0D or c == 0x24:
                break
            if c not in _PRINTABLE:
                return _NO
            i += 1
        else:
            if limit == n and n - pos < MAX_LINE:
                if not eof:
                    return _NEED_MORE
                c = None  # end of stream ends the line
            else:
                return _NO
        line = bytes(buf[pos:i])
        if c is None or c == 0x24:
            end = i
        else:
            end = i + 1
            if c == 0x0D and end == n and not eof:
                return _NEED_MORE  # the LF may come in the next chunk
            if c == 0x0D and end < n and buf[end] == 0x0A:
                end += 1
        if not nmea:
            return Frame("text", line, "text"), end
        star = line.rfind(b"*")
        want = -1
        if len(line) >= 7 and star > 0 and len(line) - star == 3:
            try:
                want = int(line[star + 1 :], 16)
            except ValueError:
                pass
        if want < 0 or nmea_checksum(line[1:star]) != want:
            # A whole printable line: consume it rather than rescan its
            # digits as solution rows.
            self.bad_frames += 1
            self.unknown_bytes += end - pos
            return None, end
        # "GNGGA" for standard sentences, "PUBX" / "PSSN" for proprietary ones.
        head = line[1:star].split(b",", 1)[0][:_MAX_NMEA_LABEL].decode("ascii", "replace")
        return Frame("nmea", line, head), end
