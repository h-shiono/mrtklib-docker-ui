"""
mrtk_run service for real-time GNSS processing.

Manages the lifecycle of `mrtk run -s` (rtkrcv) processes,
polls status via telnet console, and streams updates via callbacks.
"""

import asyncio
import logging
import re
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

from mrtklib_web_ui.paths import WORKSPACE_ROOT
from mrtklib_web_ui.services.mask_credentials import mask_log_line
from mrtklib_web_ui.services.stream_lines import iter_lines
from mrtklib_web_ui.services.trace_tail import TraceTailer

logger = logging.getLogger(__name__)

# Working directory of `mrtk run`. rtkrcv writes its debug trace
# (rtkrcv_<time>.trace), solution status file and navigation cache
# (rtkrcv.nav, reused on the next start) relative to it, so keep it
# in /workspace where the user can reach them.
RUN_WORKDIR = WORKSPACE_ROOT / "rtlog" / "rtkrcv"
TRACE_POLL_INTERVAL = 0.5

# ── Status parsing ───────────────────────────────────────────────────────────

_POS_LLH_PATTERN = re.compile(
    r"pos llh.*rover\s*:\s*([-\d.]+),([-\d.]+),([-\d.]+)"
)
_SOL_STATUS_PATTERN = re.compile(
    r"solution status\s*:\s*(\S+)"
)
_NSAT_PATTERN = re.compile(
    r"# of valid satellites\s*:\s*(\d+)"
)
_RATIO_PATTERN = re.compile(
    r"ratio for ar validation\s*:\s*([\d.]+)"
)
_AGE_PATTERN = re.compile(
    r"age of differential.*:\s*([\d.]+)"
)
_TIME_PATTERN = re.compile(
    r"time of receiver clock rover\s*:\s*(.+)"
)
_STATE_PATTERN = re.compile(
    r"rtk server state\s*:\s*(\S+)"
)

SOL_QUALITY_MAP = {
    "-": 0, "fix": 1, "float": 2, "SBAS": 3,
    "DGPS": 4, "single": 5, "PPP": 6,
}

# Satellite system map from ID prefix
_SAT_SYSTEM_MAP = {
    "G": "GPS", "R": "GLONASS", "E": "Galileo",
    "J": "QZSS", "C": "BeiDou", "S": "SBAS", "I": "NavIC",
}


def parse_satellite_output(text: str) -> list[dict[str, Any]]:
    """Parse mrtk run `satellite` command output into per-satellite data."""
    text = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
    text = re.sub(r'[\xff\xfb\xfc\xfd\xfe][\x00-\xff]', '', text)
    satellites: list[dict[str, Any]] = []

    for line in text.split('\n'):
        line = line.strip()
        if not line or line.startswith('SAT') or line.startswith('password'):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        prn = parts[0]
        # Validate: first char should be satellite system letter
        if not prn or prn[0] not in _SAT_SYSTEM_MAP:
            continue
        try:
            valid = parts[1] == "OK"
            az = float(parts[2])
            el = float(parts[3])
        except (ValueError, IndexError):
            continue

        # Extract fix status from the Fix columns (after L1/L2 OK/- columns)
        # Format: PRN VS Az El [L1 L2 ...] [Fix1 Fix2 ...] [residuals...]
        fix = "NONE"
        for p in parts[4:]:
            if p in ("FIX", "FLOAT", "HOLD"):
                fix = p
                break

        system = _SAT_SYSTEM_MAP.get(prn[0], "Unknown")
        satellites.append({
            "prn": prn,
            "system": system,
            "azimuth": az,
            "elevation": el,
            "valid": valid,
            "fix": fix,
            "snr": 0.0,  # Will be filled from observ command
        })

    return satellites


def parse_observ_snr(text: str) -> dict[str, float]:
    """Parse mrtk run `observ` command output to extract SNR per satellite.
    Returns dict mapping PRN -> max SNR (dB-Hz) across frequencies.
    Only parses rover observations (rcv=1).
    """
    text = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
    text = re.sub(r'[\xff\xfb\xfc\xfd\xfe][\x00-\xff]', '', text)
    snr_map: dict[str, float] = {}

    for line in text.split('\n'):
        line = line.strip()
        if not line or line.startswith('TIME') or line.startswith('password'):
            continue
        parts = line.split()
        if len(parts) < 6:
            continue
        # Format: YYYY/MM/DD HH:MM:SS.ss PRN RCV C1 C2 S1 S2 ...
        prn = parts[2]
        if not prn or prn[0] not in _SAT_SYSTEM_MAP:
            continue
        try:
            rcv = int(parts[3])
        except ValueError:
            continue
        if rcv != 1:  # rover only
            continue
        # Find SNR values (S1, S2, ... columns follow code columns)
        # Codes are 2-char, SNR are numeric
        snr_vals: list[float] = []
        for p in parts[4:]:
            try:
                v = float(p)
                # SNR values are typically 0-60, pseudoranges are large
                if 0 < v <= 60:
                    snr_vals.append(v)
                elif v > 1000:
                    break  # hit pseudorange columns
            except ValueError:
                continue
        if snr_vals:
            snr_map[prn] = max(snr_vals)

    return snr_map


def parse_status_output(text: str) -> dict[str, Any]:
    """Parse mrtk run `status` command output into structured data."""
    # Strip ANSI escape codes and telnet negotiation bytes
    text = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
    text = re.sub(r'[\xff\xfb\xfc\xfd\xfe][\x00-\xff]', '', text)
    result: dict[str, Any] = {}

    m = _STATE_PATTERN.search(text)
    if m:
        result["server_state"] = m.group(1)

    m = _SOL_STATUS_PATTERN.search(text)
    if m:
        sol_str = m.group(1)
        result["solution_status"] = sol_str
        result["quality"] = SOL_QUALITY_MAP.get(sol_str, 0)

    m = _POS_LLH_PATTERN.search(text)
    if m:
        result["lat"] = float(m.group(1))
        result["lon"] = float(m.group(2))
        result["height"] = float(m.group(3))

    m = _NSAT_PATTERN.search(text)
    if m:
        result["ns"] = int(m.group(1))

    m = _RATIO_PATTERN.search(text)
    if m:
        result["ratio"] = float(m.group(1))

    m = _AGE_PATTERN.search(text)
    if m:
        result["age"] = float(m.group(1))

    m = _TIME_PATTERN.search(text)
    if m:
        ts = m.group(1).strip()
        if ts != "-":
            result["timestamp"] = ts

    return result


# ── Input stream status ──────────────────────────────────────────────────────
#
# rtkrcv's `stream` command prints one row per stream:
#   input1  ntripcli rtcm3 C   2202  3196  0  0 <path:24 chars> <message>
# The S column is NOT live (stream_t.state is set once at open), so the state
# is derived from the byte counter and the message, which strread() keeps
# current. An NTRIP client with a bad mountpoint keeps reconnecting forever and
# only says so in the message, which is overwritten by "connecting..." on each
# retry — hence the tracker latches the last error.

INPUT_NAMES = ("rover", "base", "correction")

# Fmt may print empty (rtkrcv has no label for rinex/nmea)
_STREAM_ROW_PATTERN = re.compile(
    r"^input([123])\s+(\S+)\s+(\S*)\s+[-CE]\s+(-?\d+)\s+(-?\d+)\s+-?\d+\s+-?\d+\s(.{24})\s?(.*)$"
)
_INPUT_DATA_PATTERN = re.compile(r"# of input([123]) data\s*:\s*(.*)")
_INPUT_COUNT_PATTERN = re.compile(r"(\w+)\((\d+)\)")

_STREAM_ERROR_PATTERN = re.compile(
    r"error|timeout|disconnect|no mountp|sourcetable|unauthori|forbidden|not found|HTTP/\d",
    re.IGNORECASE,
)
# A connected stream reports just its address: "host" (tcp) or
# "host/mountpoint" (ntrip). Words in those names are not errors.
_STREAM_ADDRESS_PATTERN = re.compile(r"^(?!HTTP/)[^\s]*[.:/][^\s]*$", re.IGNORECASE)


def is_stream_error(message: str) -> bool:
    """Whether a stream message reports an error (not a connection name)."""
    message = message.strip()
    if _STREAM_ADDRESS_PATTERN.match(message):
        return False
    return bool(_STREAM_ERROR_PATTERN.search(message))


# (pattern, hint) — first match wins
_STREAM_ERROR_HINTS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"no mountp|sourcetable|bad mountpoint|\b404\b|not found", re.I),
     "Mountpoint not found on caster"),
    (re.compile(r"\b401\b|unauthori|bad password", re.I),
     "Authentication failed (check user/password)"),
    (re.compile(r"\b403\b|forbidden", re.I), "Access denied by caster"),
    (re.compile(r"connect error|recv error|send error|socket error|address error", re.I),
     "Cannot connect to host"),
    (re.compile(r"timeout", re.I), "No response from host (timeout)"),
    (re.compile(r"disconnect", re.I), "Disconnected by remote host"),
    (re.compile(r"open error", re.I), "Cannot open device/file"),
]

# Seconds without new bytes before a stream that had data counts as stalled
STREAM_STALL_S = 5.0
# Bytes received with nothing decoded before a rover/base is flagged
STREAM_NODECODE_BYTES = 8192


def _strip_console(text: str) -> str:
    text = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
    return re.sub(r'[\xff\xfb\xfc\xfd\xfe][\x00-\xff]', '', text)


def parse_stream_output(text: str) -> dict[str, dict[str, Any]]:
    """Parse the input1..3 rows of the mrtk run `stream` command."""
    result: dict[str, dict[str, Any]] = {}
    for line in _strip_console(text).split("\n"):
        # A multi-line message (raw HTTP response) continues on the next
        # lines; only its first line is kept.
        m = _STREAM_ROW_PATTERN.match(line.rstrip("\r"))
        if not m:
            continue
        result[INPUT_NAMES[int(m.group(1)) - 1]] = {
            "type": m.group(2),
            "format": m.group(3),
            "in_bytes": int(m.group(4)),
            "in_bps": int(m.group(5)),
            "message": m.group(7).strip("\r ").strip(),
        }
    return result


def parse_input_counts(text: str) -> dict[str, dict[str, int]]:
    """Parse `# of inputN data` lines of the `status` command.

    Returns {name: {"decoded": <obs+nav+...+ssr>, "errors": <err>}}.
    """
    result: dict[str, dict[str, int]] = {}
    for m in _INPUT_DATA_PATTERN.finditer(_strip_console(text)):
        counts = {k: int(v) for k, v in _INPUT_COUNT_PATTERN.findall(m.group(2))}
        errors = counts.pop("err", 0)
        result[INPUT_NAMES[int(m.group(1)) - 1]] = {
            "decoded": sum(counts.values()),
            "errors": errors,
        }
    return result


def stream_error_hint(message: str) -> str:
    for pattern, hint in _STREAM_ERROR_HINTS:
        if pattern.search(message):
            return hint
    return "Stream error"


class InputStreamTracker:
    """Derives a live per-input state from successive `stream` polls.

    States: off | connecting | receiving | stalled | nodecode | error
    """

    def __init__(self) -> None:
        self._prev_bytes: dict[str, int] = {}
        self._last_rx: dict[str, float] = {}
        self._last_error: dict[str, str] = {}
        self._prev_state: dict[str, str] = {}
        self._prev_hint: dict[str, Optional[str]] = {}

    def update(
        self,
        streams: dict[str, dict[str, Any]],
        counts: dict[str, dict[str, int]],
        now: float,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """Return (per-input status list, log lines for state changes)."""
        out: list[dict[str, Any]] = []
        events: list[str] = []
        for name in INPUT_NAMES:
            s = streams.get(name)
            if s is None:
                continue
            c = counts.get(name, {})
            message = mask_log_line(s["message"])
            in_bytes = s["in_bytes"]
            entry: dict[str, Any] = {
                "name": name,
                "type": s["type"],
                "format": s["format"],
                "in_bytes": in_bytes,
                "in_bps": s["in_bps"],
                "message": message,
                "decoded": c.get("decoded"),
                "errors": c.get("errors"),
                "last_error": None,
                "hint": None,
            }

            if s["type"] == "-":
                entry["state"] = "off"
                out.append(entry)
                continue

            # Bytes counter is a uint32 printed as %d: any change is new data
            fresh = in_bytes != self._prev_bytes.get(name, 0)
            if fresh:
                self._last_rx[name] = now
            self._prev_bytes[name] = in_bytes

            # Latch an error until fresh data arrives under a non-error message
            if is_stream_error(message):
                self._last_error[name] = message
            elif fresh:
                self._last_error.pop(name, None)

            last_rx = self._last_rx.get(name)
            if name in self._last_error:
                state = "error"
                entry["last_error"] = self._last_error[name]
                entry["hint"] = stream_error_hint(self._last_error[name])
            elif last_rx is not None and now - last_rx < STREAM_STALL_S:
                if (
                    name != "correction"  # CLAS L6 SSR is not counted
                    and in_bytes >= STREAM_NODECODE_BYTES
                    and c.get("decoded") == 0
                ):
                    state = "nodecode"
                    entry["hint"] = (
                        f"Data received but nothing decoded (check format '{s['format']}'"
                        " and that the receiver outputs raw observations)"
                    )
                else:
                    state = "receiving"
            elif last_rx is not None:
                state = "stalled"
                entry["hint"] = f"No data for {now - last_rx:.0f} s"
            else:
                state = "connecting"
            entry["state"] = state

            # Log transitions (and a changed error kind) to the console
            prev = self._prev_state.get(name)
            prev_hint = self._prev_hint.get(name)
            label = name.capitalize()
            if state in ("error", "nodecode"):
                if state != prev or entry["hint"] != prev_hint:
                    detail = f" ({entry['last_error']})" if entry["last_error"] else ""
                    events.append(f"[WARN] {label} stream: {entry['hint']}{detail}")
            elif state != prev:
                if state == "stalled":
                    events.append(f"[WARN] {label} stream: no data received")
                elif state == "receiving" and prev is not None:
                    events.append(f"[INFO] {label} stream: receiving data")
            self._prev_state[name] = state
            self._prev_hint[name] = entry["hint"]
            out.append(entry)
        return out, events


# ── File stream path numbering ───────────────────────────────────────────────

# GPST - UTC (s); mrtk expands file path keywords in GPST.
_GPS_LEAP_SECONDS = 18
_GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)


def gpst_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=_GPS_LEAP_SECONDS)


def expand_path_keywords(path: str, t: datetime) -> str:
    """Python port of MRTKLIB reppath() time keywords (same replacement order)."""
    week, sow = divmod((t - _GPS_EPOCH).total_seconds(), 604800)
    reps = [
        ("%ha", f"{t.hour // 3 * 3:02d}"),
        ("%hb", f"{t.hour // 6 * 6:02d}"),
        ("%hc", f"{t.hour // 12 * 12:02d}"),
        ("%Y", f"{t.year:04d}"),
        ("%y", f"{t.year % 100:02d}"),
        ("%m", f"{t.month:02d}"),
        ("%d", f"{t.day:02d}"),
        ("%h", f"{t.hour:02d}"),
        ("%M", f"{t.minute:02d}"),
        ("%S", f"{t.second:02d}"),
        ("%n", f"{t.timetuple().tm_yday:03d}"),
        ("%W", f"{int(week):04d}"),
        ("%D", f"{int(sow // 86400)}"),
        ("%H", chr(ord("a") + t.hour)),
        ("%t", f"{t.minute // 15 * 15:02d}"),
    ]
    for key, val in reps:
        path = path.replace(key, val)
    return path


def _with_suffix_number(base: str, n: int) -> str:
    """Insert _n before the file extension: dir/name.ext -> dir/name_n.ext."""
    head, sep, name = base.rpartition("/")
    stem, dot, ext = name.rpartition(".")
    name = f"{stem}_{n}.{ext}" if dot and stem else f"{name}_{n}"
    return f"{head}{sep}{name}"


_MAX_SUFFIX_NUMBER = 999


def number_file_stream_path(path: str, t: datetime, reserved: set[str]) -> str:
    """Avoid overwriting an existing file on (re)start.

    mrtk opens write file streams with "wb", so restarting within the same
    keyword period (e.g. the same %H hour) truncates the earlier file. If the
    file the stream would open now (or its .tag) exists, or another stream of
    this run already claimed it (``reserved``), insert _2, _3, ... into the
    template so this run writes alongside it. The suffix stays for the whole
    run, including later ::S swaps. The chosen path and its .tag are added to
    ``reserved`` as resolved paths, so aliases (``a/../x``, symlinks) and tag
    files of other streams are caught too.

    Raises RuntimeError when no free name is left, rather than overwriting.
    """
    base, sep, opts = path.partition("::")
    # Empty path = stdout; nothing on disk to protect
    if not base.strip():
        return path

    def target(b: str) -> str:
        return str(Path(expand_path_keywords(b, t)).resolve())

    def taken(b: str) -> bool:
        p = target(b)
        tag = f"{p}.tag"
        return p in reserved or tag in reserved or Path(p).exists() or Path(tag).exists()

    candidate = base
    n = 1
    while taken(candidate):
        n += 1
        if n > _MAX_SUFFIX_NUMBER:
            raise RuntimeError(
                f"No free file name for {target(base)} (_2.._{_MAX_SUFFIX_NUMBER} all exist)"
            )
        candidate = _with_suffix_number(base, n)
    chosen = target(candidate)
    reserved.update((chosen, f"{chosen}.tag"))
    return f"{candidate}{sep}{opts}"


# ── Pydantic models ──────────────────────────────────────────────────────────

class StreamConfigModel(BaseModel):
    type: str = "off"
    path: str = ""
    format: str = ""


class BaseStreamConfigModel(StreamConfigModel):
    nmeareq: bool = False
    nmealat: float = 0.0
    nmealon: float = 0.0


class StreamsConfigModel(BaseModel):
    input_rover: StreamConfigModel = Field(default_factory=StreamConfigModel)
    input_base: BaseStreamConfigModel = Field(default_factory=BaseStreamConfigModel)
    input_correction: StreamConfigModel = Field(default_factory=StreamConfigModel)
    output_stream1: StreamConfigModel = Field(default_factory=StreamConfigModel)
    output_stream2: StreamConfigModel = Field(default_factory=StreamConfigModel)
    log_stream1: StreamConfigModel = Field(default_factory=StreamConfigModel)
    log_stream2: StreamConfigModel = Field(default_factory=StreamConfigModel)
    log_stream3: StreamConfigModel = Field(default_factory=StreamConfigModel)


class MrtkRunStartRequest(BaseModel):
    config: dict = Field(default_factory=dict)
    streams: StreamsConfigModel = Field(default_factory=StreamsConfigModel)


# ── Service ──────────────────────────────────────────────────────────────────

class MrtkRunService:
    """Manages mrtk run (rtkrcv) process lifecycle."""

    def __init__(self, mrtk_bin_path: str = "/usr/local/bin/mrtk"):
        self.mrtk_bin_path = mrtk_bin_path
        self._process: Optional[asyncio.subprocess.Process] = None
        self._telnet_reader: Optional[asyncio.StreamReader] = None
        self._telnet_writer: Optional[asyncio.StreamWriter] = None
        self._console_port: int = 0
        self._config_path: Optional[str] = None
        self._poll_task: Optional[asyncio.Task] = None
        self._stdout_task: Optional[asyncio.Task] = None
        self._stderr_task: Optional[asyncio.Task] = None
        self._trace_task: Optional[asyncio.Task] = None
        self._status_callback: Optional[callable] = None
        self._log_callback: Optional[callable] = None
        self._stream_tracker = InputStreamTracker()

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    def generate_run_toml(self, config: dict, streams: StreamsConfigModel) -> str:
        """Generate TOML config for mrtk run, including [streams] section."""
        from mrtklib_web_ui.services.mrtk_post_service import MrtkPostService, MrtkPostConfig

        svc = MrtkPostService(self.mrtk_bin_path)
        post_config = MrtkPostConfig(**config)
        lines_str = svc.generate_conf_file(post_config)

        lines = [lines_str]

        def _s(v: str) -> str:
            return f'"{v}"'

        def _stream_section(section: str, s: StreamConfigModel):
            lines.append(f"[{section}]")
            lines.append(f"type   = {_s(s.type)}")
            lines.append(f"path   = {_s(s.path)}")
            lines.append(f"format = {_s(s.format)}")

        def _log_stream_section(section: str, s: StreamConfigModel):
            # mrtk log streams (logstrN) accept only type/path — no format key.
            lines.append(f"[{section}]")
            lines.append(f"type   = {_s(s.type)}")
            lines.append(f"path   = {_s(s.path)}")

        def _base_stream_section(section: str, s: BaseStreamConfigModel):
            _stream_section(section, s)
            lines.append(f"nmeareq = {'true' if s.nmeareq else 'false'}")
            lines.append(f"nmealat = {s.nmealat}")
            lines.append(f"nmealon = {s.nmealon}")

        lines.append("")
        _stream_section("streams.input.rover", streams.input_rover)
        lines.append("")
        _base_stream_section("streams.input.base", streams.input_base)
        lines.append("")
        _stream_section("streams.input.correction", streams.input_correction)
        lines.append("")
        _stream_section("streams.output.stream1", streams.output_stream1)
        lines.append("")
        _stream_section("streams.output.stream2", streams.output_stream2)
        lines.append("")
        _log_stream_section("streams.log.stream1", streams.log_stream1)
        lines.append("")
        _log_stream_section("streams.log.stream2", streams.log_stream2)
        lines.append("")
        _log_stream_section("streams.log.stream3", streams.log_stream3)
        lines.append("")

        return "\n".join(lines)

    async def start(
        self,
        request: MrtkRunStartRequest,
        status_callback: Optional[callable] = None,
        log_callback: Optional[callable] = None,
        trace_callback: Optional[callable] = None,
        trace_file_callback: Optional[callable] = None,
    ) -> None:
        """Start mrtk run -s process.

        With a debug trace level set, ``trace_file_callback(path)`` is called
        once the trace file appears and ``trace_callback(lines)`` with each
        batch of new (credential-masked) trace lines.
        """
        if self.is_running:
            raise RuntimeError("mrtk run is already running")

        self._status_callback = status_callback
        self._stream_tracker = InputStreamTracker()
        # Wrap log callback to mask credentials before broadcasting
        if log_callback:
            _raw_cb = log_callback
            async def _masked_cb(line: str) -> None:
                await _raw_cb(mask_log_line(line))
            self._log_callback = _masked_cb
            log_callback = self._log_callback
        else:
            self._log_callback = None

        # Number file outputs/logs that would overwrite an existing file
        streams = request.streams.model_copy(deep=True)
        now = gpst_now()
        reserved: set[str] = set()
        for name in ("output_stream1", "output_stream2", "log_stream1", "log_stream2", "log_stream3"):
            s: StreamConfigModel = getattr(streams, name)
            if s.type != "file":
                continue
            numbered = number_file_stream_path(s.path, now, reserved)
            if numbered != s.path:
                s.path = numbered
                if log_callback:
                    await log_callback(f"[INFO] {name}: target in use, writing to {numbered}")

        # Generate config
        toml_content = self.generate_run_toml(request.config, streams)

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".toml", delete=False, prefix="mrtkrun_"
        ) as f:
            f.write(toml_content)
            self._config_path = f.name

        # Log generated TOML for debugging
        if log_callback:
            await log_callback(f"[INFO] Config file: {self._config_path}")
            for line in toml_content.split("\n"):
                await log_callback(f"[CONF] {line}")

        # Find a free port for telnet console
        import socket
        with socket.socket() as s:
            s.bind(("", 0))
            self._console_port = s.getsockname()[1]

        # Resolve trace level from config
        trace_levels = {"level1": "1", "level2": "2", "level3": "3", "level4": "4", "level5": "5"}
        debug_trace = request.config.get("output", {}).get("debug_trace", "off")
        trace_arg = trace_levels.get(debug_trace)

        # Launch: mrtk run -s -o config.toml -p <port>
        cmd = [
            self.mrtk_bin_path, "run",
            "-s",
            "-o", self._config_path,
            "-p", str(self._console_port),
            "-w", "",  # no password for telnet console
        ]
        if trace_arg:
            cmd.extend(["-t", trace_arg])

        workdir: Optional[Path] = RUN_WORKDIR
        try:
            RUN_WORKDIR.mkdir(parents=True, exist_ok=True)
        except OSError as e:  # e.g. local dev without /workspace
            workdir = None
            if log_callback:
                await log_callback(f"[WARN] Cannot create {RUN_WORKDIR} ({e}); using {Path.cwd()}")

        if log_callback:
            await log_callback(f"[CMD] {' '.join(cmd)}")
            await log_callback(f"[INFO] Working directory: {workdir or Path.cwd()}")
            await log_callback(f"[INFO] Console port: {self._console_port}")

        # Snapshot existing traces before launch so an earlier run's file
        # is never mistaken for this run's.
        tailer = TraceTailer(workdir or Path.cwd()) if trace_arg else None
        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workdir,
        )

        if tailer:
            self._trace_task = asyncio.create_task(
                self._tail_trace(tailer, trace_callback, trace_file_callback)
            )

        # Start stdout/stderr readers
        self._stdout_task = asyncio.create_task(self._read_stdout())
        self._stderr_task = asyncio.create_task(self._read_stderr())

        # Wait for rtkrcv to start and stabilize before telnet connection
        await asyncio.sleep(5.0)

        # Check if process crashed immediately
        if not self._process or self._process.returncode is not None:
            code = self._process.returncode if self._process else "unknown"
            if log_callback:
                await log_callback(f"[ERROR] Process exited with code {code}")
            self._process = None
            raise RuntimeError(f"mrtk run exited with code {code}")

        # Connect telnet console
        retries = 3
        for attempt in range(retries):
            try:
                self._telnet_reader, self._telnet_writer = await asyncio.wait_for(
                    asyncio.open_connection("127.0.0.1", self._console_port),
                    timeout=3.0,
                )
                # Read welcome/password prompt, then authenticate
                try:
                    welcome = await asyncio.wait_for(
                        self._telnet_reader.read(4096), timeout=2.0
                    )
                    logger.info(f"Console welcome: {welcome[:200]!r}")

                    # Send password (rtkrcv default or empty)
                    if b"password" in welcome.lower():
                        self._telnet_writer.write(b"admin\r\n")
                        await self._telnet_writer.drain()
                        # Read response after password
                        auth_resp = await asyncio.wait_for(
                            self._telnet_reader.read(4096), timeout=2.0
                        )
                        logger.info(f"Console auth: {auth_resp[:200]!r}")

                    if log_callback:
                        await log_callback(f"[INFO] Console connected (port {self._console_port})")
                except asyncio.TimeoutError:
                    if log_callback:
                        await log_callback(f"[INFO] Console connected (port {self._console_port})")
                break
            except Exception as e:
                logger.warning(f"Console connect attempt {attempt+1}/{retries}: {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(1.0)
                else:
                    if log_callback:
                        await log_callback(f"[WARN] Console connection failed after {retries} attempts: {e}")

        # Start polling status
        self._poll_task = asyncio.create_task(self._poll_status())

    async def stop(self) -> None:
        """Stop the running mrtk run process."""
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
            self._poll_task = None

        # Send shutdown command via telnet
        if self._telnet_writer:
            try:
                self._telnet_writer.write(b"shutdown\r\n")
                await self._telnet_writer.drain()
                await asyncio.sleep(1.0)
            except Exception:
                pass
            try:
                self._telnet_writer.close()
                await self._telnet_writer.wait_closed()
            except Exception:
                pass
            self._telnet_writer = None
            self._telnet_reader = None

        # Wait or kill
        if self._process and self._process.returncode is None:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._process.kill()
                await self._process.wait()

        # The tailer drains the rest of the file on its own once the
        # process has exited; cancel only if that takes too long.
        if self._trace_task:
            try:
                await asyncio.wait_for(self._trace_task, timeout=TRACE_POLL_INTERVAL * 4)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            except Exception as e:
                logger.warning(f"trace tail error: {e}")
            self._trace_task = None

        for task_attr in ('_stdout_task', '_stderr_task'):
            task = getattr(self, task_attr)
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                setattr(self, task_attr, None)

        self._process = None

        if self._config_path:
            try:
                Path(self._config_path).unlink()
            except Exception:
                pass
            self._config_path = None

    async def _send_command(self, cmd: str, timeout: float = 3.0) -> str:
        """Send a command to the telnet console and return the response."""
        if not self._telnet_writer or not self._telnet_reader:
            return ""

        # Drain any pending data first
        try:
            while not self._telnet_reader.at_eof():
                pending = await asyncio.wait_for(
                    self._telnet_reader.read(8192), timeout=0.1
                )
                if not pending:
                    break
        except asyncio.TimeoutError:
            pass

        # Send command
        self._telnet_writer.write(f"{cmd}\r\n".encode())
        await self._telnet_writer.drain()

        # Read response until prompt
        output = b""
        try:
            deadline = asyncio.get_event_loop().time() + timeout
            while asyncio.get_event_loop().time() < deadline:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    break
                chunk = await asyncio.wait_for(
                    self._telnet_reader.read(8192),
                    timeout=min(remaining, 1.0),
                )
                if not chunk:
                    break
                output += chunk
                # rtkrcv prompt indicates end of response
                if b"rtkrcv>" in output or b"mrtk>" in output:
                    break
        except asyncio.TimeoutError:
            pass

        text = output.decode("utf-8", errors="replace")

        # Handle unexpected password prompt (re-authenticate)
        if "password" in text.lower() and "invalid" in text.lower():
            self._telnet_writer.write(b"admin\r\n")
            await self._telnet_writer.drain()
            try:
                await asyncio.wait_for(self._telnet_reader.read(4096), timeout=2.0)
            except asyncio.TimeoutError:
                pass
            return ""

        return text

    async def get_status(self) -> dict[str, Any]:
        """Query status from running process via telnet."""
        if not self._telnet_writer or not self._telnet_reader:
            return {"server_state": "disconnected"}

        try:
            text = await self._send_command("status")
            if not text.strip():
                if self._log_callback:
                    await self._log_callback("[DEBUG] status: empty response")
                return {"server_state": "no_response"}
            result = parse_status_output(text)
            if not result:
                if self._log_callback:
                    preview = text[:300].replace('\n', '\\n')
                    await self._log_callback(f"[DEBUG] status raw: {preview}")

            # Poll satellite data
            try:
                sat_text = await self._send_command("satellite")
                satellites = parse_satellite_output(sat_text)
                if satellites:
                    # Get SNR from observ command
                    try:
                        obs_text = await self._send_command("observ")
                        snr_map = parse_observ_snr(obs_text)
                        for sat in satellites:
                            if sat["prn"] in snr_map:
                                sat["snr"] = snr_map[sat["prn"]]
                    except Exception:
                        pass  # SNR is optional, satellite data still useful
                    result["satellites"] = satellites
            except Exception:
                pass  # Don't break status polling if satellite command fails

            # Poll input stream state (rover / base / correction)
            try:
                stream_text = await self._send_command("stream")
                streams = parse_stream_output(stream_text)
                if streams:
                    entries, events = self._stream_tracker.update(
                        streams, parse_input_counts(text), time.monotonic()
                    )
                    result["streams"] = entries
                    if self._log_callback:
                        for line in events:
                            await self._log_callback(line)
            except Exception:
                pass  # Don't break status polling if stream command fails

            return result

        except Exception as e:
            logger.warning(f"Status query failed: {e}")
            if self._log_callback:
                await self._log_callback(f"[WARN] Status query: {e}")
            return {"server_state": "error", "error": str(e)}

    async def _poll_status(self) -> None:
        """Background task to poll status periodically."""
        poll_count = 0
        while True:
            try:
                await asyncio.sleep(1.0)
                if not self.is_running:
                    exit_code = self._process.returncode if self._process else "unknown"
                    if self._log_callback:
                        await self._log_callback(f"[INFO] Process no longer running (exit code: {exit_code}), stopping poll")
                    if self._status_callback:
                        # `exited` marks a genuine process death so the client
                        # returns to idle. The per-poll rtkrcv `server_state` is
                        # deliberately NOT used for lifecycle (it is the RTK
                        # server thread state, not our process state).
                        await self._status_callback(
                            {"server_state": "stop", "running": False, "exited": True}
                        )
                    break
                status = await self.get_status()
                poll_count += 1
                if self._status_callback and status:
                    await self._status_callback(status)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Status poll error: {e}")
                if self._log_callback:
                    await self._log_callback(f"[WARN] Status poll: {e}")

    async def _tail_trace(
        self,
        tailer: TraceTailer,
        trace_callback: Optional[callable],
        trace_file_callback: Optional[callable],
    ) -> None:
        """Follow the trace file until the process exits, then drain it."""
        proc = self._process
        announced = False
        try:
            while True:
                exited = proc is None or proc.returncode is not None
                lines = tailer.read(final=exited)
                if tailer.path and not announced:
                    announced = True
                    if self._log_callback:
                        await self._log_callback(f"[INFO] Trace file: {tailer.path}")
                    if trace_file_callback:
                        await trace_file_callback(str(tailer.path))
                if lines and trace_callback:
                    await trace_callback([mask_log_line(line) for line in lines])
                if exited:
                    break
                await asyncio.sleep(TRACE_POLL_INTERVAL)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"trace tail error: {e}")

    async def _read_stdout(self) -> None:
        """Read stdout from the process and forward to log callback."""
        proc = self._process
        if not proc or not proc.stdout:
            return
        try:
            async for line in iter_lines(proc.stdout):
                text = line.strip()
                if text and self._log_callback:
                    await self._log_callback(f"[STDOUT] {text}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"stdout read error: {e}")

    async def _read_stderr(self) -> None:
        """Read stderr from the process and forward to log callback."""
        proc = self._process
        if not proc or not proc.stderr:
            return
        try:
            async for line in iter_lines(proc.stderr):
                text = line.strip()
                if text and self._log_callback:
                    await self._log_callback(f"[STDERR] {text}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"stderr read error: {e}")
