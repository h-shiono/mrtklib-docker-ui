"""Streaming SBF parser — extracts PVTGeodetic from a TCP byte stream.

Vendored from MRTKLIB scripts/plotting/parse_pvt.py (parse_sbf), adapted
for incremental input. Replace with a direct import once an upstream
streaming entry point is available.
"""

from __future__ import annotations

import asyncio
import struct
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

# The PVTGeodetic decode lives with the Stream Monitor decoders (#96) so both
# share one implementation; SBF_MODE is re-exported for existing imports.
from mrtklib_web_ui.services.stream_decoders.sbf import (  # noqa: F401
    SBF_MODE as _SBF_MODE,
    parse_pvt_geodetic,
)

SBF_SYNC = b"\x24\x40"
SBF_PVTGEODETIC = 4007

# Cap the rolling buffer so a malformed stream cannot grow it without bound.
_MAX_BUFFER = 1 << 20  # 1 MiB


@dataclass
class PvtFix:
    """Single PVTGeodetic decode result, scaled to the units the UI consumes."""

    time_gpst: datetime
    lat_deg: float
    lon_deg: float
    hgt_m: float
    quality: int  # 1=Fix, 2=Float, 4=DGPS, 5=Single, 6=PPP (matches QUALITY_COLOR)
    ns: int
    age_s: float

    def to_json(self) -> dict:
        return {
            "time_gpst": self.time_gpst.isoformat(),
            "lat": self.lat_deg,
            "lon": self.lon_deg,
            "hgt": self.hgt_m,
            "quality": self.quality,
            "ns": self.ns,
            "age": self.age_s,
        }


@dataclass
class FlowStats:
    """Rolling byte / message rate over a sliding window."""

    bytes_total: int = 0
    blocks_total: int = 0
    last_block_at: datetime | None = None
    last_pvt_at: datetime | None = None
    _byte_window: deque[tuple[datetime, int]] = field(default_factory=deque)
    _msg_window: deque[datetime] = field(default_factory=deque)
    window_seconds: float = 5.0

    def record_bytes(self, n: int) -> None:
        now = datetime.now(timezone.utc)
        self.bytes_total += n
        self._byte_window.append((now, n))
        self._trim(now)

    def record_block(self) -> None:
        now = datetime.now(timezone.utc)
        self.blocks_total += 1
        self.last_block_at = now
        self._msg_window.append(now)
        self._trim(now)

    def record_pvt(self) -> None:
        self.last_pvt_at = datetime.now(timezone.utc)

    def _trim(self, now: datetime) -> None:
        cutoff = now - timedelta(seconds=self.window_seconds)
        while self._byte_window and self._byte_window[0][0] < cutoff:
            self._byte_window.popleft()
        while self._msg_window and self._msg_window[0] < cutoff:
            self._msg_window.popleft()

    def to_json(self) -> dict:
        return {
            "bytes_total": self.bytes_total,
            "blocks_total": self.blocks_total,
            "bytes_per_sec": sum(n for _, n in self._byte_window) / self.window_seconds,
            "msg_per_sec": len(self._msg_window) / self.window_seconds,
            "last_block_at": self.last_block_at.isoformat() if self.last_block_at else None,
            "last_pvt_at": self.last_pvt_at.isoformat() if self.last_pvt_at else None,
        }


class SbfStreamParser:
    """Incremental SBF block walker.

    Feed bytes via `feed(chunk)`; yields complete blocks. PVTGeodetic blocks
    are decoded into PvtFix; other blocks are reported as raw stats only.
    """

    def __init__(self) -> None:
        self._buf = bytearray()
        self.stats = FlowStats()

    def feed(self, chunk: bytes) -> list[PvtFix]:
        if not chunk:
            return []
        self.stats.record_bytes(len(chunk))
        self._buf.extend(chunk)
        if len(self._buf) > _MAX_BUFFER:
            # Drop the oldest half; we never look back across resyncs anyway.
            del self._buf[: len(self._buf) // 2]
        return list(self._drain())

    def _drain(self):
        buf = self._buf
        pos = 0
        while True:
            idx = buf.find(SBF_SYNC, pos)
            if idx < 0:
                pos = max(0, len(buf) - 1)  # keep last byte (possible split sync)
                break
            if idx + 8 > len(buf):
                pos = idx
                break
            blk_len = struct.unpack_from("<H", buf, idx + 6)[0]
            if blk_len < 8 or blk_len > 65535:
                # Bogus length → resync at next byte after the false sync.
                pos = idx + 2
                continue
            if idx + blk_len > len(buf):
                pos = idx
                break
            blk_id = struct.unpack_from("<H", buf, idx + 4)[0] & 0x1FFF
            self.stats.record_block()

            if blk_id == SBF_PVTGEODETIC and blk_len >= 80:
                fix = self._decode_pvt(bytes(buf[idx + 8 : idx + blk_len]))
                if fix is not None:
                    self.stats.record_pvt()
                    yield fix

            pos = idx + blk_len

        if pos > 0:
            del buf[:pos]

    @staticmethod
    def _decode_pvt(p: bytes) -> PvtFix | None:
        r = parse_pvt_geodetic(p)
        if r is None:
            return None
        time_gpst, lat, lon, hgt, quality, ns, age = r
        return PvtFix(
            time_gpst=time_gpst,
            lat_deg=lat,
            lon_deg=lon,
            hgt_m=hgt,
            quality=quality,
            ns=ns,
            age_s=age,
        )


class SbfTcpSniffer:
    """Async TCP client that runs an SBF parser and dispatches events."""

    def __init__(
        self,
        host: str,
        port: int,
        on_pvt: Callable[[PvtFix], Awaitable[None]],
        on_flow: Callable[[FlowStats], Awaitable[None]],
        flow_interval_s: float = 1.0,
        reconnect_delay_s: float = 2.0,
    ) -> None:
        self.host = host
        self.port = port
        self._on_pvt = on_pvt
        self._on_flow = on_flow
        self._flow_interval_s = flow_interval_s
        self._reconnect_delay_s = reconnect_delay_s
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.parser = SbfStreamParser()

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop.clear()
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def _run(self) -> None:
        flow_task = asyncio.create_task(self._flow_loop())
        try:
            while not self._stop.is_set():
                try:
                    reader, writer = await asyncio.open_connection(self.host, self.port)
                except OSError:
                    await asyncio.sleep(self._reconnect_delay_s)
                    continue
                try:
                    while not self._stop.is_set():
                        chunk = await reader.read(4096)
                        if not chunk:
                            break
                        for fix in self.parser.feed(chunk):
                            await self._on_pvt(fix)
                finally:
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except Exception:
                        pass
                if not self._stop.is_set():
                    await asyncio.sleep(self._reconnect_delay_s)
        finally:
            flow_task.cancel()
            try:
                await flow_task
            except asyncio.CancelledError:
                pass

    async def _flow_loop(self) -> None:
        while not self._stop.is_set():
            await asyncio.sleep(self._flow_interval_s)
            await self._on_flow(self.parser.stats)
