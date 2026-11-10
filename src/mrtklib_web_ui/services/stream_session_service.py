"""Stream sessions (#136): what the Streams page shows of a running relay.

    receiver ◄──► mrtk relay ──► user outputs (file, tcpsvr, NTRIP server)
                      └──► tap: tcpsvr://:PORT (-b) ◄──► StreamSession (this process)

The server adds one output to each relay started from the Stream Relay view,
the tap, and reads it back: the decoded messages (Message view), and the
receiver's answers to commands (Console). With `-b` on the tap, what the
session writes to it reaches the relay's input, so commands go to the
receiver through the relay that owns its port.

`mrtk relay` relays back from a single output index (`-b N` = the Nth
output; checked with the binary: `-out file -out tcpsvr -b 2` passes what a
tcpsvr client writes to the input, from every client) and takes one input
plus four outputs (MAXSTR 5). The tap rules are in `plan_tap`.

A session attaches to a port and watches its process through
process_manager; it does not own the relay. The tap's TCP server binds all
interfaces (mrtk relay has no bind option); docker-compose publishes only
8080, but with `-b` the port is a write path to the receiver.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from mrtklib_web_ui.services.process_manager import process_manager
from mrtklib_web_ui.services.receiver_console import FrameLog

logger = logging.getLogger(__name__)

MAX_OUTPUTS = 4  # mrtk relay: MAXSTR 5 = one input + four outputs
TICK_S = 1.0
_CONNECT_RETRY_S = 0.5

# Input schemes whose stream takes bytes back to the receiver.
_COMMAND_INPUTS = ("serial", "tcpcli", "tcpsvr")
_ALIASES = {"--input": "-in", "--output": "-out"}


@dataclass(frozen=True)
class TapInfo:
    """Where a session reads (and writes) a relay's data."""

    port: int
    # The tap is an output the server added (hidden from the page), not one
    # of the user's.
    owned: bool
    # The server added `-b` for it (hidden from the page too).
    added_b: bool


def _scheme(stream: str) -> str:
    return stream.split("://", 1)[0].lower() if "://" in stream else ""


def _tcpsvr_port(stream: str) -> int | None:
    m = re.fullmatch(r"tcpsvr://[^:/]*:(\d+)", stream.split("#", 1)[0])
    return int(m.group(1)) if m else None


def plan_tap(args: list[str], port: int) -> tuple[list[str], TapInfo | None, str | None]:
    """The relay arguments to run, the tap, and why commands cannot be sent
    (None when they can).

    - An input that takes commands (serial, TCP) gets the tap with `-b`;
      NTRIP and file inputs get it read-only.
    - The user's own `-b N` is kept: if output N is a TCP server, it is the
      tap (shared, like the CLAS bridge); otherwise the server adds a
      read-only tap.
    - With four outputs already, a user TCP server output becomes the tap
      (with `-b` if commands can go back); without one there is no tap.
    - No input (the help screen): no tap.
    """
    flags = [_ALIASES.get(a, a) for a in args]
    if "-in" not in flags or flags.index("-in") + 1 >= len(args):
        return args, None, "No input"
    scheme = _scheme(args[flags.index("-in") + 1])
    outputs = [args[i + 1] for i, f in enumerate(flags[:-1]) if f == "-out"]
    user_b: int | None = None
    if "-b" in flags and flags.index("-b") + 1 < len(args):
        try:
            user_b = int(args[flags.index("-b") + 1])
        except ValueError:
            user_b = None
    takes_commands = scheme in _COMMAND_INPUTS
    no_commands = None if takes_commands else (
        "An NTRIP input cannot take receiver commands" if scheme == "ntrip"
        else "A file input cannot take commands" if scheme == "file"
        else f"A {scheme or 'this'} input cannot take receiver commands"
    )

    if user_b is not None:
        target = outputs[user_b - 1] if 1 <= user_b <= len(outputs) else None
        shared = _tcpsvr_port(target) if target else None
        if shared is not None:
            return args, TapInfo(shared, owned=False, added_b=False), no_commands
        blocked = f"The relay already passes output {user_b} back to its input (-b {user_b})"
        if len(outputs) >= MAX_OUTPUTS:
            return args, None, blocked
        run = [*args, "-out", f"tcpsvr://:{port}"]
        return run, TapInfo(port, owned=True, added_b=False), blocked

    if len(outputs) < MAX_OUTPUTS:
        run = [*args, "-out", f"tcpsvr://:{port}"]
        if takes_commands:
            run += ["-b", str(len(outputs) + 1)]
        return run, TapInfo(port, owned=True, added_b=takes_commands), no_commands

    for index, out in enumerate(outputs, start=1):
        shared = _tcpsvr_port(out)
        if shared is not None:
            run = [*args, "-b", str(index)] if takes_commands else args
            return run, TapInfo(shared, owned=False, added_b=takes_commands), no_commands
    return args, None, "All four outputs are in use: no room for the message tap"


def strip_tap(args: list[str], tap: TapInfo | None) -> list[str]:
    """The arguments as the user gave them: without the tap the server added,
    and without the `-b` it added."""
    if tap is None or not (tap.owned or tap.added_b):
        return args
    out: list[str] = []
    i = 0
    tap_out = f"tcpsvr://:{tap.port}"
    while i < len(args):
        if tap.owned and args[i] == "-out" and i + 1 < len(args) and args[i + 1] == tap_out:
            i += 2
            continue
        if tap.added_b and args[i] == "-b":
            i += 2
            continue
        out.append(args[i])
        i += 1
    return out


class StreamSession:
    """The tap of one running relay: read, decode, and write commands."""

    def __init__(self, process_id: str, tap: TapInfo, blocked: str | None) -> None:
        self.process_id = process_id
        self.tap = tap
        self.blocked = blocked
        self.frames = FrameLog()
        self.connected = False
        self.ended = False
        self.started_at = time.time()
        self.bytes_per_sec = 0.0
        self._bytes_at_tick = 0
        self._writer: asyncio.StreamWriter | None = None
        self._send_lock = asyncio.Lock()  # two pages' commands must not interleave
        self._reader: asyncio.Task | None = None
        self._broadcast: Callable[[dict], Awaitable[None]] | None = None

    def start(self, broadcast: Callable[[dict], Awaitable[None]]) -> None:
        self._broadcast = broadcast
        self._reader = asyncio.create_task(self._read())

    async def stop(self) -> None:
        self.ended = True
        if self._reader is not None:
            self._reader.cancel()
            try:
                await self._reader
            except (asyncio.CancelledError, Exception):
                pass
        self.connected = False

    async def _read(self) -> None:
        """Read the tap; reconnect while the relay runs (it may still be
        binding, or have dropped a slow reader)."""
        while not self.ended:
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", self.tap.port)
            except OSError:
                await asyncio.sleep(_CONNECT_RETRY_S)
                continue
            self.connected = True
            self._writer = writer
            try:
                while chunk := await reader.read(65536):
                    self.frames.decoder.feed(chunk)
                    for entry in self.frames.take_replies():
                        await self._send({"type": "console", "entry": entry})
            except OSError:
                pass
            finally:
                self._writer = None
                self.connected = False
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
            await asyncio.sleep(_CONNECT_RETRY_S)

    async def send(self, data: bytes, shown: str) -> None:
        """Write a command to the receiver; RuntimeError if it cannot go."""
        if self.blocked:
            raise RuntimeError(self.blocked)
        async with self._send_lock:
            writer = self._writer
            if writer is None:
                raise RuntimeError("The relay is not connected yet")
            writer.write(data)
            await writer.drain()
            await self._send({"type": "console", "entry": self.frames.sent(shown)})

    def tick(self) -> None:
        total = self.frames.decoder.bytes_total
        self.bytes_per_sec = (total - self._bytes_at_tick) / TICK_S
        self._bytes_at_tick = total
        self.frames.messages.tick()

    def status_message(self, exited: bool = False) -> dict[str, Any]:
        msg = {
            "type": "status",
            "stream": self.process_id,
            "running": not self.ended,
            "connected": self.connected,
            "bytes_per_sec": self.bytes_per_sec,
            "commands": self.blocked is None,
            "blocked": self.blocked,
            **self.frames.decoder.stats(),
        }
        if exited:
            msg["exited"] = True
        return msg

    def messages_message(self) -> dict[str, Any]:
        return {
            "type": "messages",
            "stream": self.process_id,
            "now": self.frames.messages.now(),
            "types": self.frames.messages.summary(),
        }

    def history_message(self) -> dict[str, Any]:
        return {
            "type": "history",
            "stream": self.process_id,
            "messages": self.messages_message(),
            "console": list(self.frames.console),
        }

    async def _send(self, msg: dict) -> None:
        if self._broadcast is not None:
            try:
                await self._broadcast({**msg, "stream": self.process_id})
            except Exception:
                logger.exception("Stream session broadcast failed")


class StreamSessions:
    """The sessions of the running relays, by process id."""

    def __init__(self) -> None:
        self.sessions: dict[str, StreamSession] = {}
        self._broadcast: Callable[[dict], Awaitable[None]] | None = None
        self._on_tick: Callable[[], None] | None = None
        self._ticker: asyncio.Task | None = None

    def set_broadcast(self, cb: Callable[[dict], Awaitable[None]]) -> None:
        self._broadcast = cb

    def set_on_tick(self, cb: Callable[[], None]) -> None:
        self._on_tick = cb

    async def attach(self, process_id: str, tap: TapInfo, blocked: str | None) -> StreamSession:
        old = self.sessions.pop(process_id, None)
        if old is not None:
            await old.stop()
        session = StreamSession(process_id, tap, blocked)
        self.sessions[process_id] = session
        session.start(self._send)
        await self._send(session.history_message())
        await self._send(session.status_message())
        ticker = self._ticker
        # A ticker left on another event loop (a restarted app, tests) is dead.
        if ticker is None or ticker.done() or ticker.get_loop() is not asyncio.get_running_loop():
            self._ticker = asyncio.create_task(self._tick())
        return session

    async def end(self, process_id: str) -> None:
        session = self.sessions.pop(process_id, None)
        if session is None:
            return
        await session.stop()
        await self._send(session.status_message(exited=True))

    def get(self, process_id: str) -> StreamSession | None:
        return self.sessions.get(process_id)

    async def _tick(self) -> None:
        while self.sessions:
            await asyncio.sleep(TICK_S)
            for pid, session in list(self.sessions.items()):
                info = await process_manager.get_status(pid)
                if info is None or info.state.value not in ("starting", "running"):
                    await self.end(pid)
                    continue
                session.tick()
                await self._send(session.status_message())
                await self._send(session.messages_message())
            if self._on_tick is not None:
                self._on_tick()

    async def _send(self, msg: dict) -> None:
        if self._broadcast is not None:
            try:
                await self._broadcast(msg)
            except Exception:
                logger.exception("Stream sessions broadcast failed")


stream_sessions = StreamSessions()
