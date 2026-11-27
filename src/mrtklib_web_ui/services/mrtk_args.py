"""Command-line arguments shared by the mrtk subcommands we spawn."""

import re
from datetime import datetime

# "YYYY/MM/DD HH:MM:SS" as the UI sends it; "-" for "/" and "T" for the
# space are accepted too, and the seconds may have a fraction.
_EPOCH_RE = re.compile(
    r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)"
)


def epoch_args(flag: str, value: str) -> list[str]:
    """Return ``[flag, "Y/M/D", "h:m:s"]`` for an mrtk time option.

    mrtk reads ``-ts`` / ``-te`` / ``-tr`` as *two* arguments, date then
    time (``sscanf(argv[++i], "%lf/%lf/%lf")`` and then ``"%lf:%lf:%lf"`` in
    rnx2rtkp.c / convbin.c). Passed as one argument, ``"Y/M/D h:m:s"``, the
    flag swallows the argument after it as its time of day, so the next
    option (or the rover file) is lost (#224).

    Raises ``ValueError`` when ``value`` is not a valid date and time.
    """
    m = _EPOCH_RE.fullmatch(value.strip())
    if not m:
        raise ValueError(f"{flag}: expected YYYY/MM/DD HH:MM:SS, got {value!r}")
    y, mo, d, h, mi = (int(g) for g in m.groups()[:5])
    sec = m.group(6)
    try:
        datetime(y, mo, d, h, mi, int(float(sec)))
    except ValueError:
        raise ValueError(f"{flag}: not a valid date and time: {value!r}") from None
    return [flag, f"{y:04d}/{mo:02d}/{d:02d}", f"{h:02d}:{mi:02d}:{sec}"]
