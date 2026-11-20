"""What the backend keeps of one receiver byte stream (#136).

`FrameLog` decodes the stream (`StreamDecoder`), keeps the Message tab's
per-type log (`MessageLog`), and the receiver console: the commands sent and
the receiver's answers (Septentrio ASCII output; UBX ACK / NAK, CFG-VALGET,
MON-VER, MON-COMMS). The Stream Monitor and the Streams sessions both use it.

`encode_command` turns what a page asks to send into bytes. Passwords in
Septentrio commands (and in the receiver's echo of them) are masked in what
is kept and shown (`mask_receiver_text`); the receiver gets them unchanged.
"""

from __future__ import annotations

import re
import time
from collections import deque
from typing import Any

from mrtklib_web_ui.services.mask_credentials import mask_log_line
from mrtklib_web_ui.services.stream_decoders import Frame, StreamDecoder
from mrtklib_web_ui.services.stream_decoders.messages import MessageLog, is_reply, summary

CONSOLE_MAX = 300  # console entries kept per session (sent + replies)
MAX_COMMAND_LINE = 2000  # Septentrio's limit for one ASCII command
MAX_COMMAND_BYTES = 4096


# Septentrio commands with password arguments (Reference Guides, mosaic-X5
# 4.16.0 / CLAS 4.15.1 / G5 1.1.0): command or reply name, short name → the
# argument positions (the name is 0). Replies name the setting without "set".
_SECRET_ARGS: dict[str, tuple[int, ...]] = {}
for _names, _args in (
    (("setNtripSettings", "snts", "NtripSettings"), (6,)),
    (("setNtripCasterUsers", "sncu", "NtripCasterUsers"), (3,)),
    (("setNtripCasterMountPoints", "snmp", "NtripCasterMountPoints"), (6,)),
    (("setUserAccessLevel", "sual", "UserAccessLevel"), (3,)),
    (("setDynamicDNS", "sdds", "DynamicDNS"), (3,)),
    (("setCommandName", "scn", "CommandName"), (5,)),
    (("setFTPPushSBF", "sfps", "FTPPushSBF"), (4,)),
    (("setFTPPushRINEX", "sfpr", "FTPPushRINEX"), (4,)),
    (("exeFTPUpgrade", "efup", "FTPUpgrade"), (4,)),
    (("exeFTPPushTest", "efpt", "FTPPushTest"), (4,)),
    (("login", "LogIn"), (2, 4)),
):
    for _name in _names:
        _SECRET_ARGS[_name.lower()] = _args

# An optional reply prefix ("$R: ", "$R; "), then the command and its arguments.
_COMMAND_LINE = re.compile(r"^(\s*(?:\$R[:;?]\s*)?)([A-Za-z]+)(\s*,.*)$")


def _mask_line(line: str) -> str:
    m = _COMMAND_LINE.match(line)
    args = _SECRET_ARGS.get(m.group(2).lower()) if m else None
    if m and args:
        fields = m.group(3).split(",")  # fields[0] is the space before the first comma
        for i in args:
            if i < len(fields) and fields[i].strip():
                lead = fields[i][: len(fields[i]) - len(fields[i].lstrip())]
                fields[i] = f"{lead}***"
        line = m.group(1) + m.group(2) + ",".join(fields)
    return mask_log_line(line)


def mask_receiver_text(text: str) -> str:
    """`text` with passwords masked: Septentrio password arguments (in a
    command or the receiver's echo of it) and anything `mask_log_line` masks."""
    return "".join(_mask_line(part) if part.strip() else part for part in re.split(r"(\r?\n)", text))


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
        if frame.kind == "reply":
            # The echo of a command may carry its password.
            text = frame.data.decode("ascii", "replace")
            masked = mask_receiver_text(text)
            if masked != text:
                frame = Frame(frame.kind, masked.encode("ascii", "replace"), frame.label)
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
        return self.add({"dir": "tx", "label": "sent", "text": mask_receiver_text(shown)})


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
