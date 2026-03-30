"""
mrtk_run service for real-time GNSS processing.

Manages the lifecycle of `mrtk run -s` (rtkrcv) processes,
polls status via telnet console, and streams updates via callbacks.
"""

import asyncio
import logging
import re
import tempfile
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

from mrtklib_web_ui.services.mask_credentials import mask_log_line

logger = logging.getLogger(__name__)

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
        self._status_callback: Optional[callable] = None
        self._log_callback: Optional[callable] = None

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
        _stream_section("streams.log.stream1", streams.log_stream1)
        lines.append("")
        _stream_section("streams.log.stream2", streams.log_stream2)
        lines.append("")
        _stream_section("streams.log.stream3", streams.log_stream3)
        lines.append("")

        return "\n".join(lines)

    async def start(
        self,
        request: MrtkRunStartRequest,
        status_callback: Optional[callable] = None,
        log_callback: Optional[callable] = None,
    ) -> None:
        """Start mrtk run -s process."""
        if self.is_running:
            raise RuntimeError("mrtk run is already running")

        self._status_callback = status_callback
        # Wrap log callback to mask credentials before broadcasting
        if log_callback:
            _raw_cb = log_callback
            async def _masked_cb(line: str) -> None:
                await _raw_cb(mask_log_line(line))
            self._log_callback = _masked_cb
            log_callback = self._log_callback
        else:
            self._log_callback = None

        # Generate config
        toml_content = self.generate_run_toml(request.config, request.streams)

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

        if log_callback:
            await log_callback(f"[CMD] {' '.join(cmd)}")
            await log_callback(f"[INFO] Console port: {self._console_port}")

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
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
                        await self._status_callback({"server_state": "stop"})
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

    async def _read_stdout(self) -> None:
        """Read stdout from the process and forward to log callback."""
        proc = self._process
        if not proc or not proc.stdout:
            return
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
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
            while True:
                line = await proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if text and self._log_callback:
                    await self._log_callback(f"[STDERR] {text}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"stderr read error: {e}")
