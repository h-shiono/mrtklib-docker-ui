"""Hatanaka compression (rnx2crx / crx2rnx) for the Conversion tab (#81).

The tools run as filters (no file name argument: stdin -> stdout):

- they would otherwise write next to the input, and inputs often live on
  the read-only /data mount;
- they check the input name (.??o / .rnx, .??d / .crx) only for a named
  file, so .obs and other names work as filters.

gzip is handled here, so a .gz input is fed decompressed and the output can
be written gzipped, without a shell pipeline.
"""

import asyncio
import gzip
import shutil
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Literal

Direction = Literal["compress", "decompress"]

TOOLS: dict[str, str] = {"compress": "rnx2crx", "decompress": "crx2rnx"}

# RNXCMP exit codes: 0 success, 1 error, 2 warning (finished, e.g. strange
# epochs skipped with -s).
EXIT_WARNING = 2

_CHUNK = 1 << 20


def build_args(direction: Direction, skip_strange: bool, reset_epochs: int | None) -> list[str]:
    """Command line for the filter (no file arguments)."""
    tool = TOOLS[direction]
    args = [shutil.which(tool) or tool]
    if skip_strange:
        args.append("-s")
    if direction == "compress" and reset_epochs:
        args += ["-e", str(reset_epochs)]
    return args


def is_gzip_name(path: Path) -> bool:
    return path.suffix.lower() == ".gz"


async def pump(
    proc: asyncio.subprocess.Process,
    src: Path,
    dst: Path,
    *,
    gzip_in: bool,
    gzip_out: bool,
    read_stderr: Callable[[asyncio.StreamReader], Awaitable[None]],
) -> BaseException | None:
    """Feed `src` to the tool's stdin and write its stdout to `dst`.

    Runs until the tool closes its pipes. Returns the first exception from
    the input / output side (e.g. a corrupt .gz), or None.
    """
    assert proc.stdin and proc.stdout and proc.stderr
    stdin, stdout = proc.stdin, proc.stdout

    async def feed() -> None:
        f = None
        try:
            f = await asyncio.to_thread(gzip.open if gzip_in else open, src, "rb")
            while chunk := await asyncio.to_thread(f.read, _CHUNK):
                stdin.write(chunk)
                await stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the tool exited early; its exit code says why
        finally:
            # Always close stdin, also when the input cannot be opened or
            # read, or the tool waits for more input forever.
            if not stdin.is_closing():
                stdin.close()
            if f is not None:
                await asyncio.to_thread(f.close)

    async def drain() -> None:
        f = None
        try:
            f = await asyncio.to_thread(gzip.open if gzip_out else open, dst, "wb")
            while chunk := await stdout.read(_CHUNK):
                await asyncio.to_thread(f.write, chunk)
        except BaseException:
            # The output cannot be opened or written (e.g. disk full): stop
            # the tool, or it blocks on a full stdout pipe and feed() blocks
            # on its stdin.
            if proc.returncode is None:
                proc.kill()
            raise
        finally:
            if f is not None:
                await asyncio.to_thread(f.close)

    results = await asyncio.gather(feed(), drain(), read_stderr(proc.stderr), return_exceptions=True)
    return next((r for r in results if isinstance(r, BaseException)), None)
