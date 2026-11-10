"""What the backend keeps of one receiver byte stream (#136).

`FrameLog` decodes the stream (`StreamDecoder`), keeps the Message tab's
per-type log (`MessageLog`), and the receiver console: the commands sent and
the receiver's answers (Septentrio ASCII output; UBX ACK / NAK, CFG-VALGET,
MON-VER). The Stream Monitor and the Streams sessions both use it.

`encode_command` turns what a page asks to send into bytes.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any

from mrtklib_web_ui.services.stream_decoders import Frame, StreamDecoder
from mrtklib_web_ui.services.stream_decoders.messages import MessageLog, is_reply, summary

CONSOLE_MAX = 300  # console entries kept per session (sent + replies)
MAX_COMMAND_LINE = 2000  # Septentrio's limit for one ASCII command
MAX_COMMAND_BYTES = 4096


class FrameLog:
    """Decoder, message log and console of one stream session."""

    def __init__(self, replies: bool = True) -> None:
        # `replies`: put the receiver's answers in the console (not for a file).
        self.replies = replies
        self.messages = MessageLog()
        self.decoder = StreamDecoder(on_frame=self._on_frame)
        self.console: deque[dict] = deque(maxlen=CONSOLE_MAX)
        self._new: list[dict] = []

    def _on_frame(self, frame: Frame) -> None:
        self.messages.add(frame)
        if self.replies and is_reply(frame):
            entry: dict[str, Any] = {"dir": "rx", "label": frame.label}
            if frame.kind == "reply":
                entry["text"] = frame.data.decode("ascii", "replace")
            else:
                entry["summary"] = summary(frame)
                entry["data"] = frame.data.hex()
            self._new.append(entry)

    def take_replies(self) -> list[dict]:
        """Replies decoded since the last call, added to the console."""
        new, self._new = self._new, []
        return [self.add(e) for e in new]

    def add(self, entry: dict[str, Any]) -> dict[str, Any]:
        """Stamp a console entry and keep it; returns it for broadcasting."""
        entry = {"t": round(time.time(), 3), **entry}
        self.console.append(entry)
        return entry

    def sent(self, shown: str) -> dict[str, Any]:
        return self.add({"dir": "tx", "label": "sent", "text": shown})


def encode_command(line: str | None, hex_data: str | None) -> tuple[bytes, str]:
    """A page's command as bytes for the receiver, and the console line.

    `line`: one printable ASCII command, CR LF added. `hex_data`: a binary
    frame (e.g. UBX). Raises ValueError with a message for the page.
    """
    if (line is None) == (hex_data is None):
        raise ValueError("Give either line or hex")
    if line is not None:
        text = line.strip()
        if not text or any(not (0x20 <= ord(c) < 0x7F) for c in text):
            raise ValueError("A command line must be printable ASCII")
        if len(text) > MAX_COMMAND_LINE:
            raise ValueError(f"A command line is at most {MAX_COMMAND_LINE} characters")
        return (text + "\r\n").encode("ascii"), text
    try:
        data = bytes.fromhex(hex_data or "")
    except ValueError:
        raise ValueError("hex is not valid hexadecimal") from None
    if not data:
        raise ValueError("hex is empty")
    if len(data) > MAX_COMMAND_BYTES:
        raise ValueError(f"A binary command is at most {MAX_COMMAND_BYTES} bytes")
    return data, data.hex(" ").upper()
