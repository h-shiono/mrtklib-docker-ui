"""CLAS pipeline orchestrator — wires `mrtk relay` and `mrtk cssr2rtcm3`.

Topology (single bidirectional serial port):

    receiver Serial (SBF + L6 out / RTCM3 in) ◄──► mrtk relay ◄──► tcpsvr://localhost:PORT
                                                                        │  ▲
                                                                RTCM3   │  │  SBF
                                                                        ▼  │
                                                                   mrtk cssr2rtcm3
                                                                   (in + out on tcpcli)

The relay runs with `-b 1` (relay-back): bytes it receives on the TCP
server — the RTCM3 that cssr2rtcm3 writes back to the same port — are fed
back into the serial input, so a single serial port carries both the SBF
uplink and the RTCM3 downlink. This replaces the older two-port topology
(one serial port for SBF in, a second for RTCM3 out).

The service starts the two processes in order, waiting briefly for the relay
to bind its TCP server. If either process exits, the other is stopped to
avoid a half-running pipeline. Positions are watched in the Stream Monitor,
which reads the bridge (or another TCP server output) like any relay (#197).
"""

from __future__ import annotations

import asyncio
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path

from mrtklib_web_ui.services.process_manager import process_manager
from mrtklib_web_ui.services.receiver_presets import get_preset

# Process IDs used in the global ProcessManager — fixed strings so the UI
# can subscribe by name instead of tracking dynamic UUIDs.
RELAY_PID = "clas-relay"
CSSR_PID = "clas-cssr2rtcm3"

# Local TCP loopback port for the SBF stream between relay and cssr2rtcm3.
DEFAULT_BRIDGE_PORT = 9870

# Wait this long after starting relay before connecting cssr2rtcm3 / sniffer.
_BIND_GRACE_S = 1.5


class PipelineState(str, Enum):
    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass
class PipelineConfig:
    """User-facing config — what the Wizard form posts."""

    receiver_id: str
    input_device: str       # e.g. /dev/serial/by-id/usb-Septentrio_...
    input_baud: int
    bridge_port: int = DEFAULT_BRIDGE_PORT
    # Further relay outputs after the bridge, as mrtk relay stream arguments
    # (e.g. a file to record the raw SBF, a TCP server for other apps). The
    # API validates and numbers them (`api.mrtk_relay`); they carry no
    # relay-back, which only reads the first output.
    outputs: list[str] = field(default_factory=list)



@dataclass
class PipelineStatus:
    state: PipelineState = PipelineState.IDLE
    relay_state: str = "idle"
    cssr_state: str = "idle"
    started_at: datetime | None = None
    error_message: str | None = None
    bridge_port: int | None = None
    outputs: list[str] = field(default_factory=list)


@dataclass
class SerialPort:
    path: str
    label: str  # human-readable; for /dev/serial/by-id/* this is the link basename


def list_serial_ports() -> list[SerialPort]:
    """Enumerate serial devices visible inside the container.

    Prefers /dev/serial/by-id/* entries because their names persist across
    reboots and surface the device descriptor (e.g. "usb-Septentrio_..."),
    which makes the receiver picker self-explanatory. Falls back to raw
    /dev/ttyUSB* and /dev/ttyACM* nodes when by-id is empty.
    """
    by_id = Path("/dev/serial/by-id")
    out: list[SerialPort] = []
    if by_id.is_dir():
        for entry in sorted(by_id.iterdir()):
            out.append(SerialPort(path=str(entry), label=entry.name))
        if out:
            return out

    for pattern in ("ttyUSB*", "ttyACM*"):
        for entry in sorted(Path("/dev").glob(pattern)):
            out.append(SerialPort(path=str(entry), label=entry.name))
    return out


_STREAM_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+]*://", re.IGNORECASE)


def _is_stream_url(s: str) -> bool:
    """True for `tcpcli://...`, `ntripcli://...`, `file://...`, etc.

    Used to let power users feed an existing TCP/NTRIP SBF stream into the
    pipeline for bench-testing the cssr2rtcm3 stage without needing an
    L6-capable receiver wired to the SBC.
    """
    return bool(_STREAM_SCHEME_RE.match(s))


def _device_accessible(path: str, allow_url: bool = False) -> tuple[bool, str | None]:
    """Return (ok, error_message). Distinguishes 'missing' from 'no permission'.

    Stream URLs (tcpcli://, ntripcli://, ...) are accepted only when
    `allow_url=True` — used for the input side, where mrtk relay can dial
    a remote SBF source for bench testing. The output side wraps the
    value as `serial://<basename>:<baud>`, so a URL there silently
    produces a malformed URI; reject it up front with a clear error.
    """
    if _is_stream_url(path):
        if allow_url:
            return True, None
        return False, (
            f"Output must be a serial device path, not a stream URL ({path}). "
            "Stream URLs are accepted only as input for bench testing."
        )
    p = Path(path)
    if not p.exists():
        return False, (
            f"Device not found: {path}. "
            "Pass it through to the container with `--device={path}` "
            "(or `devices:` in docker-compose.yml)."
        )
    if not os.access(path, os.R_OK | os.W_OK):
        return False, (
            f"Device {path} is not readable/writable inside the container. "
            "Run the container with sufficient privileges or add the user "
            "to the dialout group on the host."
        )
    return True, None


@dataclass
class ClasPipelineService:
    """Single-instance orchestrator. The UI manages one CLAS pipeline at a time."""

    _config: PipelineConfig | None = None
    _status: PipelineStatus = field(default_factory=PipelineStatus)
    _watch_task: asyncio.Task | None = None

    @property
    def status(self) -> PipelineStatus:
        # Refresh sub-process states from the global ProcessManager.
        relay = self._status_for(RELAY_PID)
        cssr = self._status_for(CSSR_PID)
        self._status.relay_state = relay
        self._status.cssr_state = cssr
        if self._status.state == PipelineState.RUNNING and (
            relay in ("stopped", "error") or cssr in ("stopped", "error")
        ):
            # One side died — reflect that immediately even before _watch_task
            # has a chance to tear the other side down.
            self._status.state = PipelineState.ERROR
        return self._status

    @staticmethod
    def _status_for(pid: str) -> str:
        return process_manager.peek_state(pid).value

    async def start(self, config: PipelineConfig) -> PipelineStatus:
        if self._status.state in (PipelineState.STARTING, PipelineState.RUNNING):
            raise RuntimeError("CLAS to RTCM3 is already running")

        preset = get_preset(config.receiver_id)
        if preset is None:
            raise ValueError(f"Unknown receiver preset: {config.receiver_id}")

        ok, err = _device_accessible(config.input_device, allow_url=True)
        if not ok:
            self._status = PipelineStatus(
                state=PipelineState.ERROR, error_message=err
            )
            return self._status

        self._config = config
        self._status = PipelineStatus(
            state=PipelineState.STARTING,
            started_at=datetime.now(),
            bridge_port=config.bridge_port,
            outputs=list(config.outputs),
        )

        if _is_stream_url(config.input_device):
            # Pass URL straight through. Append the format tag if the user
            # didn't supply one — `mrtk relay` needs it to know what's coming.
            relay_in = (
                config.input_device
                if "#" in config.input_device
                else f"{config.input_device}#{preset.relay_input_format}"
            )
        else:
            relay_in = (
                f"serial://{_dev_basename(config.input_device)}:"
                f"{config.input_baud}#{preset.relay_input_format}"
            )
        relay_out_tcp = f"tcpsvr://:{config.bridge_port}"
        # `-b 1` = relay-back from the first -out stream (the TCP server) to
        # the serial input. This is what carries cssr2rtcm3's RTCM3 back down
        # the single serial port to the receiver. The TCP server MUST stay the
        # first -out; the further outputs come after it.
        relay_args: list[str] = ["-in", relay_in, "-b", "1", "-out", relay_out_tcp]
        for out in config.outputs:
            relay_args += ["-out", out]

        try:
            await process_manager.start(
                command="str2str",
                args=relay_args,
                process_id=RELAY_PID,
            )
        except Exception as e:
            self._status.state = PipelineState.ERROR
            self._status.error_message = f"Failed to start relay: {e}"
            return self._status

        await asyncio.sleep(_BIND_GRACE_S)

        cssr_in = f"sbf://tcpcli://localhost:{config.bridge_port}"
        # Write RTCM3 back to the relay's TCP server. The relay's `-b 1`
        # relay-back then forwards it down the serial line to the receiver —
        # no second serial port needed.
        cssr_out = f"tcpcli://localhost:{config.bridge_port}"
        cssr_args: list[str] = []
        # Pass the per-receiver TOML config (signal_remap + CLAS grid/BLQ
        # paths). Without it the OSR generator can't bootstrap a grid
        # network and every epoch logs "Skipped: noosr=N".
        if Path(preset.cssr2rtcm3_config_path).is_file():
            cssr_args += ["-k", preset.cssr2rtcm3_config_path]
        cssr_args += ["-in", cssr_in, "-out", cssr_out]
        try:
            await process_manager.start(
                command="cssr2rtcm3",
                args=cssr_args,
                process_id=CSSR_PID,
            )
        except Exception as e:
            self._status.state = PipelineState.ERROR
            self._status.error_message = f"Failed to start cssr2rtcm3: {e}"
            await self._stop_process(RELAY_PID)
            return self._status

        self._status.state = PipelineState.RUNNING
        self._watch_task = asyncio.create_task(self._watch())
        return self._status

    async def stop(self) -> PipelineStatus:
        if self._status.state == PipelineState.IDLE:
            return self._status
        self._status.state = PipelineState.STOPPING

        if self._watch_task is not None:
            self._watch_task.cancel()
            try:
                await self._watch_task
            except asyncio.CancelledError:
                pass
            self._watch_task = None

        # cssr2rtcm3 first — it depends on the relay's TCP server, so we want
        # to give it a clean EOF rather than tearing the relay out from under it.
        await self._stop_process(CSSR_PID)
        await self._stop_process(RELAY_PID)

        self._status.state = PipelineState.STOPPED
        return self._status

    async def _watch(self) -> None:
        """If either process exits, tear the whole pipeline down."""
        try:
            while True:
                await asyncio.sleep(1.0)
                relay_alive = self._status_for(RELAY_PID) == "running"
                cssr_alive = self._status_for(CSSR_PID) == "running"
                if not (relay_alive and cssr_alive):
                    self._status.state = PipelineState.ERROR
                    self._status.error_message = (
                        "A pipeline process exited unexpectedly — "
                        "see relay/cssr2rtcm3 logs."
                    )
                    if relay_alive:
                        await self._stop_process(RELAY_PID)
                    if cssr_alive:
                        await self._stop_process(CSSR_PID)
                    return
        except asyncio.CancelledError:
            return

    @staticmethod
    async def _stop_process(pid: str) -> None:
        try:
            await process_manager.stop(pid, timeout=3.0)
        except ValueError:
            # Already stopped or never started — nothing to do.
            return
        except Exception:
            pass


def _dev_basename(path: str) -> str:
    """`mrtk relay`'s `serial://name:baud` resolves `name` against `/dev/`.

    Resolve symlinks first — `/dev/serial/by-id/usb-...` typically points at
    `/dev/ttyUSB0`. The bare name (`ttyUSB0`) is what the URI parser expects;
    a path with internal slashes confuses it.
    """
    p = Path(path)
    if p.is_symlink():
        try:
            p = p.resolve(strict=False)
        except OSError:
            pass
    name = p.name
    return name or path


# Global instance
clas_pipeline_service = ClasPipelineService()
