"""Follow the debug trace file rtkrcv writes while `mrtk run -t N` is running.

rtkrcv opens a single trace file per run (``rtkrcv_%Y%m%d%h%M.trace``,
relative to its working directory, time keywords expanded in GPST at open
time) and never rotates it. The name is not predicted here: files present
before launch are recorded, and the first one created or rewritten after
that is picked up instead.

At level 3+ the file can grow by megabytes per minute, so each read is
capped; anything beyond the cap is skipped and reported with a marker line.
"""

from pathlib import Path
from typing import Optional

TRACE_GLOB = "rtkrcv_*.trace"
MAX_READ_BYTES = 32 * 1024
MAX_LINE_BYTES = 4096


class TraceTailer:
    """Incrementally read complete lines from the run's trace file."""

    def __init__(
        self,
        directory: Path,
        pattern: str = TRACE_GLOB,
        max_read: int = MAX_READ_BYTES,
    ) -> None:
        """Create before launching the process: snapshots existing traces."""
        self.directory = directory
        self.pattern = pattern
        self.max_read = max_read
        self.path: Optional[Path] = None
        self._offset = 0
        self._partial = bytearray()
        self._before = self._scan()

    def _scan(self) -> dict[Path, int]:
        out: dict[Path, int] = {}
        try:
            candidates = list(self.directory.glob(self.pattern))
        except OSError:
            return out
        for p in candidates:
            try:
                out[p] = p.stat().st_mtime_ns
            except OSError:
                continue
        return out

    def find(self) -> Optional[Path]:
        """Locate the trace file of this run (None until rtkrcv creates it)."""
        if self.path is None:
            # Earlier runs' files only qualify once rewritten: a restart in
            # the same GPST minute reopens the same name with "w".
            fresh = [
                (mtime, p) for p, mtime in self._scan().items()
                if self._before.get(p) != mtime
            ]
            if fresh:
                self.path = max(fresh)[1]
        return self.path

    def read(self, final: bool = False) -> list[str]:
        """Return the lines appended since the last call.

        A trailing line without a newline is held back until it completes,
        or returned as is when ``final`` (the process has exited).
        """
        if self.find() is None:
            return []
        out: list[str] = []
        try:
            with open(self.path, "rb") as f:
                size = f.seek(0, 2)
                if size < self._offset:  # truncated / recreated
                    self._offset = 0
                    self._partial.clear()
                pending = size - self._offset
                if pending > self.max_read:
                    skipped = pending - self.max_read
                    self._partial.clear()
                    out.append(f"[... {skipped} bytes of trace skipped ...]")
                    f.seek(size - self.max_read)
                    chunk = f.read(self.max_read)
                    # Resumed mid-line: drop the fragment up to the next newline.
                    nl = chunk.find(b"\n")
                    chunk = chunk[nl + 1:] if nl >= 0 else b""
                else:
                    f.seek(self._offset)
                    chunk = f.read(pending)
                self._offset = size
        except OSError:
            return out
        buf = self._partial
        buf.extend(chunk)
        while (nl := buf.find(b"\n")) >= 0:
            out.append(buf[:nl].decode("utf-8", errors="replace").rstrip("\r"))
            del buf[: nl + 1]
        if len(buf) > MAX_LINE_BYTES or (final and buf):
            out.append(buf.decode("utf-8", errors="replace").rstrip("\r"))
            buf.clear()
        return out
