"""Stream Monitor (#96): show what a receiver or solution stream carries.

    input (serial / tcpcli / tcpsvr / ntrip)
        └──► mrtk relay ──► tcpsvr://:PORT ──► StreamDecoder (this process)
    input (file) ──► StreamDecoder, read here (all at once or paced, #161)
    input (browser) ──► Web Serial in the page ──► ingest WebSocket ──► StreamDecoder

A browser session (#136) reads a serial port the page opened with Web Serial,
so a receiver on the user's machine needs no Docker USB access (usbipd,
macOS). The page sends the bytes; the session ends when that socket closes.

Raw streams are saved in Stream Relay, which the Monitor can read through a
relay output `tcpsvr://:PORT` (#191).

`mrtk relay` opens the input with MRTKLIB's own stream code (serial, NTRIP,
...) and copies the bytes unchanged; the backend reads them back from the
relay's local TCP server.
A file is read here instead: the relay would read it in a moment and its
tcpsvr would drop it before the reader connects (#161). The session stays
open at the end of the file, so the data stays on the page until Stop.
Like the CLAS bridge, `tcpsvr://:PORT` binds all interfaces (mrtk relay has
no bind-address option); docker-compose publishes only 8080, not this port.

Decoded epochs are thinned to one per `EPOCH_INTERVAL_S` of data time and
sent once per `TICK_S` with the latest satellite snapshot and the stream
statistics. When one stream carries several position sources (UBX NAV-PVT and
NMEA GGA, SBF PVTGeodetic and NMEA), the receiver's native one is shown.

Up to two streams run at once (#171), each its own session with its own
relay; messages to the page carry the stream id.
"""

from __future__ import annotations

import asyncio
import logging
import re
import socket
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable, Collection, Literal

from mrtklib_web_ui.services.mask_credentials import mask_log_line
from mrtklib_web_ui.services.process_manager import process_manager
from mrtklib_web_ui.services.stream_decoders import Epoch, Event, Frame, Satellites, StreamDecoder
from mrtklib_web_ui.services.stream_decoders.messages import MessageLog, is_reply, summary

logger = logging.getLogger(__name__)

StreamId = Literal["a", "b"]
SessionKind = Literal["relay", "file", "browser"]
STREAM_IDS: tuple[StreamId, ...] = ("a", "b")

# UI stream type → mrtk relay scheme (same names as frontend streamArgs.ts).
INPUT_SCHEMES = {
    "serial": "serial",
    "tcpcli": "tcpcli",
    "tcpsvr": "tcpsvr",
    "ntripcli": "ntrip",
    "file": "file",
}

TICK_S = 1.0
EPOCH_INTERVAL_S = 1.0
HISTORY_EPOCHS = 3600
SOURCE_HOLD_S = 5.0
_CONNECT_RETRY_S = 0.5
_DRAIN_S = 1.0  # on stop, wait this long for the reader to reach EOF
_FILE_CHUNK_FAST = 1 << 16  # bytes per read when reading a file at once
_FILE_CHUNK_PACED = 512  # small, so pacing by epoch time stays smooth
_FILE_MAX_WAIT_S = 2.0  # a gap in the data is skipped after this long
INGEST_TIMEOUT_S = 10.0  # a browser session whose page never sends ends
CONSOLE_MAX = 300  # receiver console entries kept per session (sent + replies)

# Lower = preferred. A source is shown unless a preferred one was seen
# within SOURCE_HOLD_S.
EPOCH_SOURCE_RANK = {
    "sbf:pvtgeodetic": 0, "ubx:nav-pvt": 0, "nmea:gga": 1, "pos:llh": 2, "pos:xyz": 2,
}
SAT_SOURCE_RANK = {"sbf": 0, "ubx:nav-sat": 0, "nmea:gsv": 1}


class MonitorState:
    """Source selection, thinning and history (no I/O, testable)."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self.history: deque[dict] = deque(maxlen=HISTORY_EPOCHS)
        self.satellites: dict | None = None
        self._pending: list[dict] = []
        self._sats_new = False
        self._seen: dict[str, float] = {}  # source → clock of the last event
        self.epoch_source: str | None = None
        self.satellite_source: str | None = None
        self._last_kept: datetime | None = None

    def add(self, events: list[Event]) -> None:
        for e in events:
            if isinstance(e, Epoch):
                self._epoch(e)
            elif isinstance(e, Satellites):
                self._sats(e)

    def take_updates(self) -> tuple[list[dict], dict | None]:
        """Epochs kept since the last call, and the satellites if they changed."""
        # A file read at once can decode far more than the history holds.
        epochs, self._pending = self._pending[-HISTORY_EPOCHS:], []
        sats = self.satellites if self._sats_new else None
        self._sats_new = False
        return epochs, sats

    def sources(self) -> list[str]:
        now = self._clock()
        return sorted(s for s, t in self._seen.items() if now - t <= SOURCE_HOLD_S)

    def _preferred(self, source: str, ranks: dict[str, int]) -> bool:
        now = self._clock()
        self._seen[source] = now
        rank = ranks.get(source, 9)
        return not any(
            ranks.get(s, 9) < rank and now - t <= SOURCE_HOLD_S
            for s, t in self._seen.items()
            if s != source
        )

    def _epoch(self, e: Epoch) -> None:
        if not self._preferred(e.source, EPOCH_SOURCE_RANK):
            return
        if e.source != self.epoch_source:
            self.epoch_source = e.source
            self._last_kept = None
        last = self._last_kept
        if last is not None:
            dt = (e.time - last).total_seconds()
            if 0 <= dt < EPOCH_INTERVAL_S - 1e-3:
                return  # thinned; a jump back (replayed file, restart) is kept
        self._last_kept = e.time
        j = e.to_json()
        self.history.append(j)
        self._pending.append(j)

    def _sats(self, s: Satellites) -> None:
        if not self._preferred(s.source, SAT_SOURCE_RANK):
            return
        self.satellite_source = s.source
        self.satellites = s.to_json()
        self._sats_new = True


def build_relay_args(input_type: str, path: str, port: int) -> list[str]:
    """mrtk relay arguments: the input, relayed to a local TCP server for the decoder.

    `-b 1` relays what the decoder's connection writes back to the input, so
    commands reach the receiver (#136). Raw streams are saved in Stream Relay,
    not here (#191). The caller still validates the file paths
    (`api.mrtk_relay._validate_relay_args`).
    """
    scheme = INPUT_SCHEMES.get(input_type)
    if scheme is None:
        raise ValueError(f"Unsupported input type: {input_type}")
    path = path.strip()
    if not path:
        raise ValueError("Input path is required")
    return ["-in", f"{scheme}://{path}", "-out", f"tcpsvr://:{port}", "-b", "1"]


_LOCAL_TCPCLI = re.compile(r"^tcpcli://(?:127\.0\.0\.1|localhost):(\d+)$")


def relay_back_owner(port: int, exclude: str) -> tuple[str, bool] | None:
    """The running relay (other than process `exclude`) whose output is
    `tcpsvr://:port`, and whether that output is its relay-back one (`-b N`):
    only then do bytes written to the port reach the relay's input.

    `mrtk relay` relays back from a single output index (mrtk_streamsvr.c), so
    a Stream Relay without `-b` drops what a client writes. None if no relay
    serves the port (an outside TCP server).
    """
    for info in process_manager.get_all_processes():
        if info.command != "str2str" or info.id == exclude:
            continue
        if info.state.value not in ("starting", "running"):
            continue
        args = info.args
        relay_back = None
        for i, a in enumerate(args[:-1]):
            if a == "-b":
                try:
                    relay_back = int(args[i + 1])
                except ValueError:
                    pass
        index = 0
        for i, a in enumerate(args[:-1]):
            if a != "-out":
                continue
            index += 1
            target = args[i + 1].split("#", 1)[0]
            if re.fullmatch(rf"tcpsvr://[^:/]*:{port}", target):
                return info.id, relay_back == index
    return None


def free_port(exclude: Collection[int] = ()) -> int:
    """A free TCP port, not one in `exclude` (ports already handed to a relay
    that may not have bound them yet)."""
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        if port not in exclude:
            return port


class StreamMonitorService:
    """The monitor session of one stream."""

    def __init__(self, stream_id: StreamId = "a") -> None:
        self.stream_id: StreamId = stream_id
        self.relay_pid = f"stream-monitor-relay-{stream_id}"
        self._broadcast: Callable[[dict], Awaitable[None]] | None = None
        self._on_tick: Callable[[], None] | None = None
        self._lock = asyncio.Lock()
        self._state = MonitorState()
        self.messages = MessageLog()  # the Message tab; replaced per session
        self._decoder = StreamDecoder(on_frame=self._on_frame)
        # Receiver console (#136): commands sent and the receiver's replies.
        self.console: deque[dict] = deque(maxlen=CONSOLE_MAX)
        self._console_new: list[dict] = []
        # Writes to the input: the relay connection, or the page's port.
        self._relay_writer: asyncio.StreamWriter | None = None
        self._ingest_write: Callable[[bytes], Awaitable[None]] | None = None
        self._reader: asyncio.Task | None = None
        self._ticker: asyncio.Task | None = None
        self._run = 0  # bumped per start; stale tasks / logs check it
        self.kind: SessionKind = "relay"
        self.state = "idle"  # idle | starting | running | stopped | error
        self.error_message: str | None = None
        self.started_at: datetime | None = None
        self.input_label = ""
        self.port: int | None = None
        self._bytes_at_tick = 0
        self.bytes_per_sec = 0.0
        self.connected = False
        # File input (#161): {"size", "read", "eof", "speed"}; None for a relay.
        self.file: dict[str, Any] | None = None
        # Log of a session without a relay (file, browser); a relay's is
        # kept by process_manager.
        self._session_log: list[str] = []
        # Browser input: the page that sends, and when it must have connected.
        self._ingest_run: int | None = None
        self._ingest_deadline = 0.0
        self._ended = asyncio.Event()

    def set_broadcast(self, cb: Callable[[dict], Awaitable[None]]) -> None:
        self._broadcast = cb

    def set_on_tick(self, cb: Callable[[], None]) -> None:
        """Called once per tick, after the broadcasts (per-client messages)."""
        self._on_tick = cb

    @property
    def is_running(self) -> bool:
        return self.state in ("starting", "running")

    # ── lifecycle ───────────────────────────────────────────────────────────

    def _begin(self, input_label: str, port: int | None, kind: SessionKind) -> None:
        """Reset for a new session (caller holds the lock)."""
        if self.is_running:
            raise RuntimeError(f"Stream {self.stream_id.upper()} is already running")
        self._run += 1
        self.kind = kind
        self._ended = asyncio.Event()
        self._ingest_run = None
        self._state = MonitorState()
        self.messages = MessageLog()
        self._decoder = StreamDecoder(on_frame=self._on_frame)
        self.console = deque(maxlen=CONSOLE_MAX)
        self._console_new = []
        self._relay_writer = None
        self._ingest_write = None
        self.state = "starting"
        self.error_message = None
        self.started_at = datetime.now()
        self.input_label = mask_log_line(input_label)
        self.port = port
        self._bytes_at_tick = 0
        self.bytes_per_sec = 0.0
        self.connected = False
        self.file = None
        self._session_log = []

    async def start(self, args: list[str], input_label: str, port: int) -> None:
        async with self._lock:
            self._begin(input_label, port, "relay")
            # Before the relay's first log line: a new `started_at` tells every
            # page that a new session begins (its console and data reset).
            await self._send(self.status_message())
            try:
                await process_manager.start(
                    command="str2str", args=args, process_id=self.relay_pid
                )
            except Exception as e:
                self.state = "error"
                self.error_message = f"Failed to start mrtk relay: {e}"
                await self._send({**self.status_message(), "exited": True})
                raise RuntimeError(self.error_message) from e
            self.state = "running"
            run = self._run
            self._reader = asyncio.create_task(self._read(run, port))
            self._ticker = asyncio.create_task(self._tick(run))
        await self._send(self.status_message())

    async def start_file(self, path: Path, speed: float | None) -> None:
        """Read a file into the decoder (#161): at once (`speed` None) or paced
        by the epoch times at `speed` × real time. The session stays open at
        the end of the file, until Stop."""
        async with self._lock:
            self._begin(f"file://{path}", None, "file")
            size = path.stat().st_size
            self.file = {"size": size, "read": 0, "eof": False, "speed": speed}
            await self._send(self.status_message())
            pace = "at once" if speed is None else f"at {speed:g}x real time"
            await self._log(f"[SYSTEM] Reading {path} ({size:,} bytes) {pace}")
            self.state = "running"
            run = self._run
            self._reader = asyncio.create_task(self._read_file(run, path, speed))
            self._ticker = asyncio.create_task(self._tick(run))
        await self._send(self.status_message())

    async def start_browser(self, input_label: str) -> None:
        """Wait for the page to send what it reads from its serial port."""
        async with self._lock:
            self._begin(input_label, None, "browser")
            await self._send(self.status_message())
            await self._log("[SYSTEM] Waiting for the browser to send the serial port data")
            self.state = "running"
            self._ingest_deadline = time.monotonic() + INGEST_TIMEOUT_S
            self._ticker = asyncio.create_task(self._tick(self._run))
        await self._send(self.status_message())

    def attach_ingest(
        self, started_at: str | None, write: Callable[[bytes], Awaitable[None]] | None = None
    ) -> int:
        """Register the page that sends a browser session's bytes, and how to
        hand it bytes for its port (`write`); returns its run token. Raises
        ValueError if this is not the session it started."""
        if self.kind != "browser" or not self.is_running:
            raise ValueError("No browser serial session is waiting")
        if started_at != (self.started_at.isoformat() if self.started_at else None):
            raise ValueError("This session has ended")
        if self._ingest_run is not None:
            raise ValueError("Another page is already sending this session")
        self._ingest_run = self._run
        self._ingest_write = write
        self.connected = True
        return self._run

    async def feed_ingest(self, run: int, data: bytes) -> None:
        if run == self._run and self.is_running:
            self._state.add(self._decoder.feed(data))
            await self._flush_console()

    # ── receiver commands (#136) ────────────────────────────────────────────

    async def send(self, data: bytes, shown: str) -> None:
        """Write `data` to the input (the receiver); `shown` is the console
        line. Raises RuntimeError when this session cannot take commands."""
        if not self.is_running:
            raise RuntimeError(f"Stream {self.stream_id.upper()} is not running")
        if self.kind == "file":
            raise RuntimeError("A file input cannot take commands")
        if self.input_label.startswith("ntrip://"):
            # -b 1 would send the command to the caster, not a receiver.
            raise RuntimeError("An NTRIP input cannot take receiver commands")
        local = _LOCAL_TCPCLI.match(self.input_label)
        if self.kind == "relay" and local:
            owner = relay_back_owner(int(local.group(1)), exclude=self.relay_pid)
            if owner is not None and not owner[1]:
                # The Monitor's -b 1 would write into that relay's TCP server,
                # which drops it: the receiver would never answer.
                raise RuntimeError(
                    f"This stream reads an output of the relay '{owner[0]}', which does not "
                    "pass commands back to the receiver. Send commands from a stream that "
                    "opens the receiver itself (Serial, TCP, Browser serial)."
                )
        if self.kind == "browser":
            if self._ingest_write is None:
                raise RuntimeError("The browser has not connected the serial port yet")
            await self._ingest_write(data)
        else:
            writer = self._relay_writer
            if writer is None:
                raise RuntimeError("The relay is not connected yet")
            writer.write(data)
            await writer.drain()
        await self._console_add({"dir": "tx", "label": "sent", "text": shown})

    def _on_frame(self, frame: Frame) -> None:
        self.messages.add(frame)
        if self.kind != "file" and is_reply(frame):
            entry: dict[str, Any] = {"dir": "rx", "label": frame.label}
            if frame.kind == "reply":
                entry["text"] = frame.data.decode("ascii", "replace")
            else:
                entry["summary"] = summary(frame)
                entry["data"] = frame.data.hex()
            self._console_new.append(entry)

    async def _flush_console(self) -> None:
        new, self._console_new = self._console_new, []
        for entry in new:
            await self._console_add(entry)

    async def _console_add(self, entry: dict[str, Any]) -> None:
        entry = {"t": round(time.time(), 3), **entry}
        self.console.append(entry)
        await self._send({"type": "console", "entry": entry})

    async def detach_ingest(self, run: int) -> None:
        """The page stopped sending (closed, unplugged): the session ends."""
        async with self._lock:
            if run != self._run or not self.is_running:
                return
            await self._log("[SYSTEM] The browser closed the serial port")
            await self._finish("stopped", None)

    async def wait_ended(self) -> None:
        """Return once the current session has ended."""
        await self._ended.wait()

    async def stop(self) -> None:
        async with self._lock:
            if not self.is_running:
                return
            await self._finish("stopped", None)

    async def _finish(self, state: str, error: str | None) -> None:
        """End the session: stop the relay, read what it sent, send the rest.

        The relay goes first: closing its TCP server lets the reader take the
        bytes still in flight up to EOF and flush the decoder (the last NMEA
        epoch is only complete then), instead of being cut off mid-stream.
        """
        self._run += 1  # the reader stops reconnecting, the ticker stops
        if self.kind == "relay":
            try:
                await process_manager.stop(self.relay_pid, timeout=3.0)
            except ValueError:
                pass  # already exited
            except Exception:
                logger.exception("Failed to stop the Stream Monitor relay")
        current = asyncio.current_task()
        reader, ticker = self._reader, self._ticker
        self._reader = self._ticker = None
        if reader is not None and not reader.done():
            await asyncio.wait({reader}, timeout=_DRAIN_S)
        for task in (reader, ticker):
            if task is not None and task is not current and not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        self._state.add(self._decoder.flush())
        self.state = state
        self.error_message = error
        self.connected = False
        self._ended.set()
        await self._send_updates()
        await self._send({**self.status_message(), "exited": True})

    # ── tasks ───────────────────────────────────────────────────────────────

    async def _read(self, run: int, port: int) -> None:
        """Read the relay's TCP server; reconnect while the session runs."""
        while run == self._run:
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
            except OSError:
                await asyncio.sleep(_CONNECT_RETRY_S)  # relay still binding
                continue
            self.connected = True
            self._relay_writer = writer
            try:
                # Read to EOF even when the session is ending: the relay is
                # stopped first, so what it sent last is still in the socket.
                while True:
                    chunk = await reader.read(65536)
                    if not chunk:
                        break
                    self._state.add(self._decoder.feed(chunk))
                    await self._flush_console()
            except OSError:
                pass
            finally:
                self._relay_writer = None
                # Connection over: complete the last epoch, and let the next
                # connection start with an empty framer.
                self._state.add(self._decoder.flush())
                self.connected = False
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
            await asyncio.sleep(_CONNECT_RETRY_S)

    async def _read_file(self, run: int, path: Path, speed: float | None) -> None:
        """Feed a file to the decoder; paced by the decoded epoch times."""
        loop = asyncio.get_running_loop()
        chunk = _FILE_CHUNK_FAST if speed is None else _FILE_CHUNK_PACED
        last_t: datetime | None = None  # data time of the last paced epoch
        due = loop.time()  # wall-clock time that epoch is due
        self.connected = True
        try:
            with path.open("rb") as f:
                while run == self._run:
                    data = f.read(chunk)
                    if not data:
                        break
                    events = self._decoder.feed(data)
                    self._state.add(events)
                    self.file["read"] += len(data)
                    if speed is None:
                        await asyncio.sleep(0)  # let the ticker and clients run
                        continue
                    times = [e.time for e in events if isinstance(e, Epoch)]
                    if not times:
                        # A stretch with no position (e.g. a measurement-only
                        # log) must still yield, or Stop and clients stall.
                        await asyncio.sleep(0)
                        continue
                    t = times[-1]
                    if last_t is not None:
                        dt = (t - last_t).total_seconds()
                        # Going back (a joined file) or a long gap: no wait.
                        due += min(max(dt, 0.0), _FILE_MAX_WAIT_S * speed) / speed
                    else:
                        due = loop.time()
                    last_t = t
                    wait = due - loop.time()
                    if wait > 0:
                        await asyncio.sleep(wait)
                    else:
                        await asyncio.sleep(0)
            if run == self._run:
                self._state.add(self._decoder.flush())
                self.file["eof"] = True
                await self._log(f"[SYSTEM] End of file: {self.file['read']:,} bytes read")
        except OSError as e:
            if run == self._run:
                self.file["eof"] = True
                await self._log(f"[SYSTEM] Read error: {e}")
        finally:
            self.connected = False

    async def _tick(self, run: int) -> None:
        while run == self._run:
            await asyncio.sleep(TICK_S)
            if run != self._run:
                return
            total = self._decoder.bytes_total
            self.bytes_per_sec = (total - self._bytes_at_tick) / TICK_S
            self._bytes_at_tick = total
            await self._send_updates()
            await self._send(self.status_message())
            self.messages.tick()
            await self._send(self.messages_message())
            if self._on_tick is not None:
                self._on_tick()
            if self.kind == "browser":
                if self._ingest_run is None and time.monotonic() > self._ingest_deadline:
                    async with self._lock:
                        if run == self._run:
                            await self._finish("error", "The browser did not send the serial port data")
                    return
                continue  # no relay; the page's socket ends the session
            if self.kind == "file":
                continue  # no relay; the session ends on Stop
            info = await process_manager.get_status(self.relay_pid)
            if info is None or info.state.value in ("stopped", "error"):
                rc = info.return_code if info else None
                async with self._lock:
                    if run == self._run:
                        await self._finish(
                            "error" if rc not in (0, None) else "stopped",
                            f"mrtk relay exited (code {rc})" if rc not in (0, None) else None,
                        )
                return

    # ── messages ────────────────────────────────────────────────────────────

    async def on_relay_log(self, line: str) -> None:
        """process_manager log line of the relay (already masked)."""
        if self.kind != "relay":
            return  # a relay left over from before does not belong here
        await self._send({"type": "log", "message": line})

    async def _log(self, line: str) -> None:
        """A log line of a session without a relay (file, browser)."""
        self._session_log.append(line)
        await self._send({"type": "log", "message": line})

    def status_message(self) -> dict[str, Any]:
        return {
            "type": "status",
            "stream": self.stream_id,
            "running": self.is_running,
            "state": self.state,
            "kind": self.kind,
            "error_message": self.error_message,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "input": self.input_label,
            "connected": self.connected,
            "bytes_per_sec": self.bytes_per_sec,
            "file": dict(self.file) if self.file is not None else None,
            "epoch_source": self._state.epoch_source,
            "satellite_source": self._state.satellite_source,
            "sources": self._state.sources(),
            **self._decoder.stats(),
        }

    def messages_message(self) -> dict[str, Any]:
        """Per-type counters for the Message tab."""
        divisor: float | None = 1.0
        if self.file is not None:
            divisor = self.file["speed"]  # None: read at once, no meaningful rate
        return {
            "type": "messages",
            "now": self.messages.now(),
            "types": self.messages.summary(divisor),
        }

    def history_message(self) -> dict[str, Any]:
        """Replay for a client that (re)connects; data only while running (L17)."""
        running = self.is_running
        return {
            "type": "history",
            "stream": self.stream_id,
            "epochs": list(self._state.history) if running else [],
            "satellites": self._state.satellites if running else None,
            "messages": self.messages_message() if running else None,
            "console": list(self.console) if running else [],
            "logs": list(self._session_log) if self.kind != "relay"
            else process_manager.get_log(self.relay_pid),
        }

    async def _send_updates(self) -> None:
        epochs, sats = self._state.take_updates()
        if epochs:
            await self._send({"type": "epochs", "epochs": epochs})
        if sats is not None:
            await self._send({"type": "satellites", **sats})

    async def _send(self, msg: dict) -> None:
        if self._broadcast is not None:
            try:
                await self._broadcast({**msg, "stream": self.stream_id})
            except Exception:
                logger.exception("Stream Monitor broadcast failed")


stream_monitor_services: dict[StreamId, StreamMonitorService] = {
    stream_id: StreamMonitorService(stream_id) for stream_id in STREAM_IDS
}


async def on_relay_log(process_id: str, line: str) -> None:
    """Route a process_manager log line to the stream whose relay wrote it."""
    for service in stream_monitor_services.values():
        if process_id == service.relay_pid:
            await service.on_relay_log(line)


async def stop_all_streams() -> None:
    """Stop every stream; one that fails to stop does not hold up the other."""
    results = await asyncio.gather(
        *(service.stop() for service in stream_monitor_services.values()),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, Exception):
            logger.error("Failed to stop a Stream Monitor stream: %s", result)
