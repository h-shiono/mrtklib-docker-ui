"""Browser serial as a Streams input (#136).

    receiver ◄──► Web Serial (page) ◄──► ingest WebSocket ◄──► BrowserBridge
                                                                 ▲ 127.0.0.1:PORT
                                          mrtk relay -in tcpcli ─┘

A page opens a serial port with Web Serial and sends its bytes over the
ingest WebSocket; the bridge serves them on a TCP port bound to 127.0.0.1,
which the relay reads as a TCP client. What the relay writes back to its
input (receiver commands, through the message tap's -b) goes to the page,
which writes it to the port. The bridge never opens anything outside this
machine.

The page owns the port: when its socket closes (tab closed or reloaded,
port unplugged), or it never connects, the relay is stopped too, so no
relay is left reading nothing.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from collections import deque
from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)

ATTACH_TIMEOUT_S = 15.0  # the page connects its socket within this, or the relay stops
MAX_PENDING = 1 << 20  # bytes from the page kept while the relay is not connected


class BrowserBridge:
    """One page's serial port, served to one relay."""

    def __init__(self, label: str) -> None:
        self.label = label
        self.token = secrets.token_urlsafe(16)  # only the page that started it may send
        self.port: int | None = None
        self.attached = False
        self.ended = asyncio.Event()
        self._server: asyncio.base_events.Server | None = None
        self._relay: asyncio.StreamWriter | None = None
        self._pending: deque[bytes] = deque()
        self._pending_bytes = 0
        self._to_page: Callable[[bytes], Awaitable[None]] | None = None

    async def open(self) -> int:
        self._server = await asyncio.start_server(self._serve_relay, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]
        return self.port

    async def _serve_relay(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """The relay's connection (it reconnects if it drops)."""
        if self._relay is not None:  # one relay per bridge
            writer.close()
            return
        self._relay = writer
        try:
            while self._pending:
                writer.write(self._pending.popleft())
            self._pending_bytes = 0
            await writer.drain()
            while chunk := await reader.read(65536):
                # Bytes the relay passes back to its input: commands.
                if self._to_page is not None:
                    await self._to_page(chunk)
        except (OSError, asyncio.CancelledError):
            pass
        finally:
            if self._relay is writer:
                self._relay = None
            writer.close()

    def attach(self, token: str, to_page: Callable[[bytes], Awaitable[None]]) -> None:
        if self.ended.is_set():
            raise ValueError("This stream has ended")
        if not secrets.compare_digest(token, self.token):
            raise ValueError("Not the page that started this stream")
        if self.attached:
            raise ValueError("Another page is already sending this stream")
        self.attached = True
        self._to_page = to_page

    async def from_page(self, data: bytes) -> None:
        writer = self._relay
        if writer is None:
            # The relay is still connecting: keep the start of the stream.
            self._pending.append(data)
            self._pending_bytes += len(data)
            while self._pending_bytes > MAX_PENDING and self._pending:
                self._pending_bytes -= len(self._pending.popleft())
            return
        writer.write(data)
        await writer.drain()

    async def close(self) -> None:
        self.ended.set()
        self._to_page = None
        if self._relay is not None:
            self._relay.close()
            self._relay = None
        if self._server is not None:
            self._server.close()
            self._server = None


class BrowserBridges:
    """The bridges of the running Browser serial streams, by relay process ID."""

    def __init__(self) -> None:
        self.bridges: dict[str, BrowserBridge] = {}
        self._stop_relay: Callable[[str], Awaitable[None]] | None = None

    def set_stop_relay(self, cb: Callable[[str], Awaitable[None]]) -> None:
        """How to stop a relay whose page went away (the API's stop)."""
        self._stop_relay = cb

    def add(self, process_id: str, bridge: BrowserBridge) -> None:
        self.bridges[process_id] = bridge
        asyncio.create_task(self._expect_page(process_id, bridge))

    def get(self, process_id: str) -> BrowserBridge | None:
        return self.bridges.get(process_id)

    async def _expect_page(self, process_id: str, bridge: BrowserBridge) -> None:
        try:
            await asyncio.wait_for(bridge.ended.wait(), ATTACH_TIMEOUT_S)
        except asyncio.TimeoutError:
            if not bridge.attached:
                logger.info("Browser serial stream %s: the page never connected", process_id)
                await self.page_left(process_id)

    async def page_left(self, process_id: str) -> None:
        """The page's socket closed (or never opened): stop the stream."""
        bridge = self.bridges.pop(process_id, None)
        if bridge is None:
            return
        await bridge.close()
        if self._stop_relay is not None:
            try:
                await self._stop_relay(process_id)
            except Exception:
                logger.exception("Failed to stop the relay of browser stream %s", process_id)

    async def relay_stopped(self, process_id: str) -> None:
        """The relay stopped (Stop on any page): close the page's socket."""
        bridge = self.bridges.pop(process_id, None)
        if bridge is not None:
            await bridge.close()


browser_bridges = BrowserBridges()
