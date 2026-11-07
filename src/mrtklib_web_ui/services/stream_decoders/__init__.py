"""Stream Monitor decoders (#96): receiver / solution byte stream → events.

`StreamDecoder.feed(chunk)` frames a mixed NMEA / UBX / SBF / RTCM3 / text
stream (see `framer`) and decodes positions and satellite snapshots:

- NMEA GGA / RMC / ZDA / GST / GSA / GSV        (`nmea`)
- SBF PVTGeodetic, MeasEpoch, ChannelStatus, SatVisibility (`sbf`)
- UBX NAV-PVT, NAV-SAT                          (`ubx`)
- MRTKLIB solution text, llh / xyz              (`postext`)

Pure bytes in → events out (no I/O, no asyncio); the Stream Monitor
service decides which source to show and how often.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Callable

from mrtklib_web_ui.services.stream_decoders.events import (
    Epoch,
    Event,
    Satellites,
    SatState,
)
from mrtklib_web_ui.services.stream_decoders.framer import Frame, Framer
from mrtklib_web_ui.services.stream_decoders.nmea import NmeaDecoder
from mrtklib_web_ui.services.stream_decoders.postext import PosTextDecoder
from mrtklib_web_ui.services.stream_decoders.sbf import SbfDecoder
from mrtklib_web_ui.services.stream_decoders.ubx import UbxDecoder

__all__ = ["Epoch", "Event", "Frame", "Satellites", "SatState", "StreamDecoder"]


class StreamDecoder:
    def __init__(self, clock: Callable[[], datetime] | None = None) -> None:
        self.framer = Framer()
        self.nmea = NmeaDecoder(clock)
        self.sbf = SbfDecoder()
        self.ubx = UbxDecoder()
        self.pos = PosTextDecoder()
        self.bytes_total = 0
        self.msg_counts: Counter[str] = Counter()

    def feed(self, chunk: bytes) -> list[Event]:
        self.bytes_total += len(chunk)
        events: list[Event] = []
        for frame in self.framer.feed(chunk):
            self.msg_counts[frame.label] += 1
            events += self.decode_frame(frame)
        return events

    def decode_frame(self, frame: Frame) -> list[Event]:
        if frame.kind == "nmea":
            return self.nmea.decode(frame.data)
        if frame.kind == "sbf":
            return self.sbf.decode(frame.data)
        if frame.kind == "ubx":
            return self.ubx.decode(frame.data)
        if frame.kind == "text":
            return self.pos.decode(frame.data)
        return []  # RTCM3: counted only

    def flush(self) -> list[Event]:
        """Emit the epochs still being collected (call when the stream stops)."""
        return self.nmea.flush() + self.sbf.flush() + self.ubx.flush()

    def stats(self) -> dict:
        return {
            "bytes_total": self.bytes_total,
            "unknown_bytes": self.framer.unknown_bytes,
            "bad_frames": self.framer.bad_frames,
            "msg_counts": dict(self.msg_counts),
        }
