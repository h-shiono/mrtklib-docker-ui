"""Build valid NMEA / SBF / UBX / RTCM3 frames for the stream decoder tests.

Checksums and CRCs are computed, since the framer rejects frames whose
checksum fails. Coordinates used with these are made up.
"""

from __future__ import annotations

import struct

from mrtklib_web_ui.services.stream_decoders.framer import (
    crc16_ccitt,
    crc24q,
    nmea_checksum,
    ubx_checksum,
)


def nmea(body: str, eol: bytes = b"\r\n") -> bytes:
    """'GNGGA,…' → b'$GNGGA,…*hh\\r\\n'."""
    b = body.encode("ascii")
    return b"$" + b + b"*" + f"{nmea_checksum(b):02X}".encode() + eol


def sbf(block_id: int, body: bytes, revision: int = 0) -> bytes:
    """SBF block with header, padding to a multiple of 4 and a valid CRC.

    `body` starts with TOW (the field after the 8-byte header).
    """
    body = body + b"\x00" * (-(len(body) + 8) % 4)
    length = 8 + len(body)
    idrev = (block_id & 0x1FFF) | (revision << 13)
    tail = struct.pack("<HH", idrev, length) + body
    return b"$@" + struct.pack("<H", crc16_ccitt(tail)) + tail


def ubx(cls: int, mid: int, payload: bytes) -> bytes:
    head = struct.pack("<BBH", cls, mid, len(payload))
    return b"\xb5\x62" + head + payload + ubx_checksum(head + payload)


def rtcm3(msg_type: int, extra: bytes = b"\x00" * 4) -> bytes:
    payload = bytes((msg_type >> 4, (msg_type & 0x0F) << 4)) + extra
    frame = bytes((0xD3, (len(payload) >> 8) & 0x03, len(payload) & 0xFF)) + payload
    return frame + crc24q(frame).to_bytes(3, "big")


def sbf_tow(tow_ms: int, wn: int) -> bytes:
    return struct.pack("<IH", tow_ms, wn)
