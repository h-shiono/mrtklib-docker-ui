"""Read subprocess output line by line without StreamReader.readline() limits.

readline() raises once a line exceeds the reader's 64 KiB limit, and a
reader that stops leaves the pipe undrained until the child blocks on
write. This splits on newlines in chunks and flushes over-long lines.
"""

import asyncio
from typing import AsyncIterator

MAX_LINE_BYTES = 1024 * 1024


async def iter_lines(stream: asyncio.StreamReader, max_line: int = MAX_LINE_BYTES) -> AsyncIterator[str]:
    """Yield decoded lines (without the line ending) until EOF."""
    buf = bytearray()
    while True:
        chunk = await stream.read(8192)
        if not chunk:
            if buf:
                yield buf.decode("utf-8", errors="replace").rstrip("\r")
            return
        buf.extend(chunk)
        while (nl := buf.find(b"\n")) >= 0:
            yield buf[:nl].decode("utf-8", errors="replace").rstrip("\r")
            del buf[: nl + 1]
        if len(buf) > max_line:
            yield buf.decode("utf-8", errors="replace")
            buf.clear()
