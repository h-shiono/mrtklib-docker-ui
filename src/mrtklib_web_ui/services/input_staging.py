"""Stage compressed inputs so mrtk never decompresses beside the source.

MRTKLIB's ``rtk_uncompress()`` decompresses a compressed input file
(``.gz``/``.Z``/``.zip``/``.tar``/Hatanaka ``.??d``/``.crx``) by writing the
decompressed output *next to the source file* — it does not honour the
``[files] temp_dir`` option (that option is registered but unused in v0.7.6).
``readrnxfile()`` then deletes that output once it has read it.

That breaks in two ways:

- under a read-only mount (``/data`` or the bundled corrections root) the
  shell redirect fails with ``cannot create <path>: Read-only file system``;
- under ``/workspace`` it overwrites and then deletes any file that already
  has the decompressed name: running ``X.26o.gz`` removes the user's own
  ``X.26o`` (``X.26d`` → ``X.26o``, ``X.crx`` → ``X.rnx`` alike), and the
  next run on ``X.26o`` fails with "Rover observation file not found" (#223).

So every compressed input is copied into a fresh temp directory under
``/workspace`` and mrtk gets the copied path, so it decompresses beside the
copy. The temp directory is removed when the job finishes. The copies are
plain copies, not hard links: a wildcard also stages its uncompressed
matches, and mrtk's ``gzip -c > X`` would write through a link to ``X``.
"""

import re
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from mrtklib_web_ui.paths import WORKSPACE_ROOT

# gzip/compress/zip extensions handled by rtk_uncompress (case-insensitive).
_GZIP_EXTS = {".z", ".gz", ".zip"}


def is_compressed(name: str) -> bool:
    """Return True if ``name`` is a file mrtk would try to decompress.

    Mirrors the extension checks in MRTKLIB ``rtk_uncompress()`` so we stage
    exactly the files that trigger a write next to the source.
    """
    ext = Path(name).suffix  # includes the leading dot, e.g. ".gz"
    low = ext.lower()
    if low in _GZIP_EXTS or low in (".tar", ".crx"):
        return True
    # Hatanaka-compressed RINEX: ".YYd"/".YYD" (rtk_uncompress: len>3 && p[3] in dD).
    if len(ext) > 3 and ext[3] in ("d", "D"):
        return True
    return False


def expand_wildcard(path: str) -> list[Path]:
    """Expand a ``*`` file-name pattern the way MRTKLIB ``expath()`` does.

    mrtk expands input wildcards itself, so this mirrors it rather than
    using ``glob``: only ``*`` is special (``?`` and ``[`` are literal), it
    applies to the file name only, matching is case-insensitive and
    dotfiles are skipped. Only regular files are returned (expath also
    lists directories, but mrtk cannot read them as input), sorted by name.
    """
    p = Path(path)
    regex = re.compile(".*".join(re.escape(t) for t in p.name.split("*")), re.IGNORECASE)
    try:
        entries = list(p.parent.iterdir())
    except OSError:
        return []
    return sorted(
        (e for e in entries if not e.name.startswith(".") and regex.fullmatch(e.name) and e.is_file()),
        key=lambda e: e.name,
    )


def _needs_staging(path: str) -> bool:
    # Wherever the input lives: on a read-only root decompressing fails, and
    # on /workspace it would clobber and delete a same-named sibling (#223).
    if "*" in path:
        return any(is_compressed(m.name) for m in expand_wildcard(path))
    return is_compressed(Path(path).name)


def stage_paths(paths: Iterator[str]) -> tuple[dict[str, str], "Path | None"]:
    """Copy compressed inputs to a fresh writable temp dir.

    Returns ``(mapping, tmpdir)`` where ``mapping`` is ``{original: staged}``
    for only the files that needed staging (callers substitute via
    ``mapping.get(p, p)``) and ``tmpdir`` is the created temp directory (or
    ``None`` if nothing was staged). The caller must pass ``tmpdir`` to
    :func:`remove_stage_dir` when the job finishes.
    """
    mapping: dict[str, str] = {}
    tmpdir: Path | None = None
    to_stage = [p for p in paths if p and p.strip() and _needs_staging(p.strip())]
    if to_stage:
        WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
        tmpdir = Path(tempfile.mkdtemp(prefix=".mrtk_stage_", dir=str(WORKSPACE_ROOT)))
        try:
            _copy_inputs(to_stage, tmpdir, mapping)
        except BaseException:
            remove_stage_dir(tmpdir)  # the caller never gets tmpdir to clean up
            raise
    return mapping, tmpdir


def _copy_inputs(to_stage: list[str], tmpdir: Path, mapping: dict[str, str]) -> None:
    """Copy each input (every match of a wildcard) into its own subdir."""
    for i, p in enumerate(to_stage):
        src = Path(p.strip())
        # One subdir per input so same-named files never collide. A
        # wildcard stages every match; the subdir holds only those
        # copies, so the same pattern still selects exactly them.
        dst_dir = tmpdir / str(i)
        dst_dir.mkdir()
        for f in expand_wildcard(str(src)) if "*" in src.name else [src]:
            shutil.copy2(f, dst_dir / f.name)
        mapping[p] = str(dst_dir / src.name)


def remove_stage_dir(tmpdir: "Path | None") -> None:
    """Remove a staging temp directory created by :func:`stage_paths`."""
    if tmpdir is not None:
        shutil.rmtree(tmpdir, ignore_errors=True)


@contextmanager
def staged_inputs(paths: Iterator[str]) -> Iterator[dict[str, str]]:
    """Context-manager form of :func:`stage_paths` that auto-cleans up.

    Yields the ``{original: staged}`` mapping; the temp directory is removed
    on exit.
    """
    mapping, tmpdir = stage_paths(paths)
    try:
        yield mapping
    finally:
        remove_stage_dir(tmpdir)
