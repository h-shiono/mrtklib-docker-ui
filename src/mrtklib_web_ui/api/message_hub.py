"""WebSocket clients of a page that shows decoded streams (#136): the Stream
Monitor's and the Streams'.

Follows the mrtk run pattern (lessons L17): a client keeps one WebSocket open
for the page's lifetime and gets a replay first. Broadcasts never wait on a
socket: each client has a bounded queue, and one that stops reading is
dropped (and closed, so the page reconnects for a fresh replay).

A client may select one message type of one stream for its Message tab:
`{"type": "select_message", "stream": ..., "label": str | null}`. It then
gets that type's rows (`message_rows`), the changed ones each tick, with
`reset` after a new selection or a new session.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable

from fastapi import WebSocket, WebSocketDisconnect

from mrtklib_web_ui.services.stream_decoders.messages import MessageLog

logger = logging.getLogger(__name__)

CLIENT_QUEUE_MAX = 256
MAX_SELECT_LABEL = 64
MAX_STREAM_ID = 100  # as long as a relay process ID may be (api/mrtk_relay.py)

# A stream's message log and whether its session runs; None if unknown.
Resolve = Callable[[str], "tuple[MessageLog, bool] | None"]


class _Client:
    def __init__(self, ws: WebSocket, stream: str | None, extra: int = 0) -> None:
        self.ws = ws
        # Room for the live messages, plus the replay queued before them.
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=CLIENT_QUEUE_MAX + extra)
        self.task: asyncio.Task | None = None
        # The message type this page shows, and how far it has been sent.
        # `log` tells when a new session began.
        self.selected_stream = stream
        self.selected: str | None = None
        self.sent_seq = 0
        self.log: MessageLog | None = None

    async def run(self) -> None:
        while True:
            await self.ws.send_text(await self.queue.get())


class MessageHub:
    def __init__(
        self,
        name: str,
        resolve: Resolve,
        valid_stream: Callable[[str], bool],
        default_stream: str | None = None,
    ) -> None:
        self._name = name
        self._resolve = resolve
        self._valid = valid_stream
        self._default = default_stream
        self._clients: set[_Client] = set()

    async def broadcast(self, msg: dict[str, Any]) -> None:
        """Queue a message for every client; never waits on a socket."""
        text = json.dumps(msg)
        for client in list(self._clients):
            self._put(client, text)

    def send_all_rows(self) -> None:
        for client in list(self._clients):
            self._send_rows(client)

    async def serve(self, websocket: WebSocket, replay: Callable[[], list[dict[str, Any]]]) -> None:
        """Run one client: the replay first (the same queue keeps it ahead of
        live messages), then live messages until it disconnects.

        `replay` is taken after the socket is accepted, and the client joins
        the broadcasts with no await in between: a session that ends while
        accepting must not reach this page as still running."""
        await websocket.accept()
        messages = replay()
        client = _Client(websocket, self._default, extra=len(messages))
        for msg in messages:
            client.queue.put_nowait(json.dumps(msg))
        self._clients.add(client)
        client.task = asyncio.create_task(client.run())
        try:
            while True:
                try:
                    text = await websocket.receive_text()
                except (WebSocketDisconnect, RuntimeError):  # RuntimeError: closed by _drop
                    break
                self._handle(client, text)
        finally:
            self._drop(client)

    # ── internals ───────────────────────────────────────────────────────────

    def _put(self, client: _Client, text: str) -> None:
        try:
            client.queue.put_nowait(text)
        except asyncio.QueueFull:
            logger.warning("%s: dropping a WebSocket client that stopped reading", self._name)
            self._drop(client, close=True)

    def _drop(self, client: _Client, close: bool = False) -> None:
        self._clients.discard(client)
        if client.task is not None:
            client.task.cancel()
        if close:
            asyncio.create_task(_close_quietly(client.ws))

    def _send_rows(self, client: _Client) -> None:
        """Queue the new rows of the client's selected message type."""
        if client.selected is None or client.selected_stream is None:
            return
        found = self._resolve(client.selected_stream)
        log, running = found if found is not None else (None, False)
        reset = client.log is not log
        if reset:  # just selected, or a new session
            client.log = log
            client.sent_seq = 0
        rows: list[dict[str, Any]] = []
        if log is not None and running:  # like `history`: pages clear a finished session
            rows, client.sent_seq = log.rows(client.selected, client.sent_seq)
        if not rows and not (reset and log is not None):
            return
        self._put(client, json.dumps({
            "type": "message_rows",
            "stream": client.selected_stream,
            "label": client.selected,
            "reset": reset,
            "rows": rows,
        }))

    def _handle(self, client: _Client, text: str) -> None:
        try:
            msg = json.loads(text)
        except ValueError:
            return
        if not isinstance(msg, dict) or msg.get("type") != "select_message":
            return
        label = msg.get("label")
        if label is not None and (not isinstance(label, str) or len(label) > MAX_SELECT_LABEL):
            return
        stream = msg.get("stream", self._default)
        if not isinstance(stream, str) or len(stream) > MAX_STREAM_ID or not self._valid(stream):
            return
        client.selected_stream = stream
        client.selected = label
        client.log = None  # the next rows are a full replay
        self._send_rows(client)


async def _close_quietly(ws: WebSocket) -> None:
    try:
        await asyncio.wait_for(ws.close(code=1013), timeout=5.0)  # 1013: try again later
    except Exception:
        pass
