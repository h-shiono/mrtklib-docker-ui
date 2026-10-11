"""Process manager for MRTKLIB command execution with real-time log streaming."""

import asyncio
import uuid
from asyncio.subprocess import Process
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from time import monotonic
from typing import Callable, Awaitable

from mrtklib_web_ui.services.mask_credentials import mask_log_line


class ProcessState(str, Enum):
    """Process execution state."""

    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass
class ProcessInfo:
    """Information about a managed process."""

    id: str
    command: str
    args: list[str]
    state: ProcessState = ProcessState.IDLE
    pid: int | None = None
    return_code: int | None = None
    started_at: datetime | None = None
    stopped_at: datetime | None = None
    error_message: str | None = None


@dataclass
class ProcessManager:
    """Manages MRTKLIB subprocess execution with async log streaming.

    Handles starting, stopping, and monitoring of MRTKLIB processes.
    Maps legacy command names to mrtk subcommands.
    Broadcasts stderr output to connected WebSocket clients.
    """

    # Map legacy command names → mrtk subcommands
    SUBCOMMAND_MAP: dict[str, str] = field(
        default_factory=lambda: {
            "str2str": "relay",
            "convbin": "convert",
            "rnx2rtkp": "post",
            "rtkrcv": "run",
            "cssr2rtcm3": "cssr2rtcm3",
        }
    )

    # Active processes
    _processes: dict[str, Process] = field(default_factory=dict)
    _process_info: dict[str, ProcessInfo] = field(default_factory=dict)

    # Log broadcast callback
    _log_callback: Callable[[str, str], Awaitable[None]] | None = None

    # State broadcast callback, called with (process_id, state) once a
    # process has ended, so clients learn about natural exits too
    _status_callback: Callable[[str, str], Awaitable[None]] | None = None

    # Recent (credential-masked) log lines per process, replayed to clients
    # that reconnect mid-run, e.g. after a page reload (#52)
    _log_history: dict[str, deque[str]] = field(default_factory=dict)
    _MAX_LOG_HISTORY = 500

    # One supervisor task per process: reads stderr+stdout, then records the
    # exit. Holding the reference also keeps the readers from being GC'd.
    _log_tasks: dict[str, asyncio.Task] = field(default_factory=dict)

    # Finished ProcessInfo entries kept for status polling; older are pruned
    _MAX_FINISHED = 50

    # How long start() waits for a previous run under the same ID to finish
    # draining its pipes before cutting it off
    _DRAIN_TIMEOUT = 2.0

    def set_log_callback(
        self, callback: Callable[[str, str], Awaitable[None]]
    ) -> None:
        """Set callback for log broadcasting.

        Args:
            callback: Async function that receives (process_id, log_line)
        """
        self._log_callback = callback

    def set_status_callback(
        self, callback: Callable[[str, str], Awaitable[None]]
    ) -> None:
        """Set callback for state broadcasting.

        Args:
            callback: Async function that receives (process_id, state)
        """
        self._status_callback = callback

    def get_log(self, process_id: str) -> list[str]:
        """Return the recent log lines of a process (oldest first)."""
        return list(self._log_history.get(process_id, ()))

    async def start(
        self,
        command: str,
        args: list[str] | None = None,
        process_id: str | None = None,
    ) -> ProcessInfo:
        """Start an MRTKLIB process.

        Args:
            command: Legacy command name (e.g., 'str2str') mapped to mrtk subcommand
            args: Command arguments
            process_id: Optional custom process ID

        Returns:
            ProcessInfo with process details

        Raises:
            ValueError: If command is not allowed or process already running
        """
        if command not in self.SUBCOMMAND_MAP:
            raise ValueError(f"Command not allowed: {command}")

        # Generate process ID if not provided
        proc_id = process_id or str(uuid.uuid4())[:8]

        # Check if process with same ID is already running
        if proc_id in self._processes:
            existing = self._process_info.get(proc_id)
            if existing and existing.state == ProcessState.RUNNING:
                raise ValueError(f"Process {proc_id} is already running")

        # A previous run under this ID (fixed IDs: CLAS pipeline, relay test)
        # may have exited -- get_status() marks it STOPPED -- while its
        # supervisor still drains the pipes. Let it finish first, so its
        # tail output and exit status go out before this run starts instead
        # of landing in this run's log and marking it stopped.
        prev_task = self._log_tasks.get(proc_id)
        if prev_task is not None and not prev_task.done():
            done, _ = await asyncio.wait({prev_task}, timeout=self._DRAIN_TIMEOUT)
            if not done:
                prev_task.cancel()
                try:
                    await prev_task
                except asyncio.CancelledError:
                    pass

        # Create process info
        info = ProcessInfo(
            id=proc_id,
            command=command,
            args=args or [],
            state=ProcessState.STARTING,
            started_at=datetime.now(),
        )
        self._process_info[proc_id] = info
        self._log_history[proc_id] = deque(maxlen=self._MAX_LOG_HISTORY)

        try:
            # Map to mrtk subcommand
            subcommand = self.SUBCOMMAND_MAP[command]
            mrtk_path = "/usr/local/bin/mrtk"

            # Log the command being executed
            cmd_str = f"mrtk {subcommand} {' '.join(args or [])}"
            await self._broadcast_log(proc_id, f"[SYSTEM] Starting: {cmd_str}")

            # Create subprocess
            process = await asyncio.create_subprocess_exec(
                mrtk_path,
                subcommand,
                *(args or []),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
            )

            self._processes[proc_id] = process
            info.pid = process.pid
            info.state = ProcessState.RUNNING

            await self._broadcast_log(proc_id, f"[SYSTEM] Process started (PID: {process.pid})")

            self._log_tasks[proc_id] = asyncio.create_task(
                self._supervise(proc_id, process, info)
            )

            return info

        except FileNotFoundError:
            info.state = ProcessState.ERROR
            info.error_message = f"Command not found: {command}"
            await self._broadcast_log(proc_id, f"[ERROR] {info.error_message}")
            raise ValueError(info.error_message)

        except Exception as e:
            info.state = ProcessState.ERROR
            info.error_message = str(e)
            await self._broadcast_log(proc_id, f"[ERROR] Failed to start: {e}")
            raise

    async def stop(self, process_id: str, timeout: float = 5.0) -> ProcessInfo:
        """Stop a running process.

        Args:
            process_id: ID of process to stop
            timeout: Seconds to wait for graceful termination

        Returns:
            Updated ProcessInfo
        """
        if process_id not in self._processes:
            # Already exited on its own (the supervisor dropped the handle)
            if process_id in self._process_info:
                return self._process_info[process_id]
            raise ValueError(f"Process not found: {process_id}")

        process = self._processes[process_id]
        info = self._process_info[process_id]

        if process.returncode is not None:
            # Process already terminated
            info.state = ProcessState.STOPPED
            return info

        info.state = ProcessState.STOPPING
        await self._broadcast_log(process_id, "[SYSTEM] Stopping process...")

        try:
            # Send SIGTERM for graceful shutdown
            process.terminate()

            try:
                await asyncio.wait_for(process.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                # Force kill if not terminated
                await self._broadcast_log(
                    process_id, "[SYSTEM] Process did not terminate, killing..."
                )
                process.kill()
                await process.wait()

            info.return_code = process.returncode
            info.state = ProcessState.STOPPED
            info.stopped_at = datetime.now()

            await self._broadcast_log(
                process_id,
                f"[SYSTEM] Process stopped (exit code: {info.return_code})",
            )

        except ProcessLookupError:
            # Process already gone
            info.state = ProcessState.STOPPED

        finally:
            # Cancel log reading task
            task = self._log_tasks.pop(process_id, None)
            if task is not None:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

            # Clean up process reference
            self._processes.pop(process_id, None)
            self._prune_finished()

        await self._broadcast_status(process_id, info.state)
        return info

    async def get_status(self, process_id: str) -> ProcessInfo | None:
        """Get process status.

        Args:
            process_id: ID of process to check

        Returns:
            ProcessInfo or None if not found
        """
        info = self._process_info.get(process_id)
        if not info:
            return None

        # Update state if process has terminated
        if process_id in self._processes:
            process = self._processes[process_id]
            if process.returncode is not None:
                info.state = ProcessState.STOPPED
                info.return_code = process.returncode
                info.stopped_at = datetime.now()

        return info

    def get_all_processes(self) -> list[ProcessInfo]:
        """Get all process infos."""
        return list(self._process_info.values())

    def peek_state(self, process_id: str) -> ProcessState:
        """Synchronous, lock-free read of a process's last-known state.

        Returns ProcessState.IDLE for unknown IDs. Use get_status() when
        you want the live subprocess return-code refresh; this helper is
        for callers that just need the cached state in a sync context.
        """
        info = self._process_info.get(process_id)
        return info.state if info else ProcessState.IDLE

    async def _supervise(self, process_id: str, process: Process, info: ProcessInfo) -> None:
        """Pump both pipes until EOF, then record a natural exit.

        Without this a process that exited on its own stayed RUNNING in the
        cached state (peek_state) and its handle and task were never freed.
        stop() cancels this task and does its own bookkeeping.
        """
        await asyncio.gather(
            self._read_stderr(process_id, process),
            self._read_stdout(process_id, process),
        )
        rc = await process.wait()
        # Not STOPPING: stop() announces that itself. A STOPPED state may
        # already have been set by get_status() before the pipes drained,
        # and must not swallow the exit announcement.
        if info.state != ProcessState.STOPPING:
            info.state = ProcessState.STOPPED
            info.return_code = rc
            info.stopped_at = info.stopped_at or datetime.now()
            # Announce only while this run still owns the ID: a newer run
            # under the same ID must not be reported as stopped
            if self._process_info.get(process_id) is info:
                await self._broadcast_log(process_id, f"[SYSTEM] Process exited (exit code: {rc})")
                await self._broadcast_status(process_id, info.state)
        if self._processes.get(process_id) is process:
            del self._processes[process_id]
        if self._log_tasks.get(process_id) is asyncio.current_task():
            del self._log_tasks[process_id]
        self._prune_finished()

    def _prune_finished(self) -> None:
        """Forget the earliest-finished processes beyond _MAX_FINISHED."""
        finished = sorted(
            (
                pid for pid, i in self._process_info.items()
                if pid not in self._processes and i.state != ProcessState.RUNNING
            ),
            key=lambda pid: self._process_info[pid].stopped_at or datetime.min,
        )
        for pid in finished[: max(0, len(finished) - self._MAX_FINISHED)]:
            del self._process_info[pid]
            self._log_history.pop(pid, None)

    # Cap a single broadcast line at 8 KiB so a runaway upstream (e.g. a
    # cssr2rtcm3 dump or accidentally-printed binary buffer) cannot blow
    # up the WebSocket payload or the browser console. Beyond this we
    # truncate with a marker; the read loop itself keeps going.
    _MAX_BROADCAST_LINE = 8 * 1024
    # Hard cap on the partial-line buffer. If the upstream produces no
    # newline at all for this many bytes, we flush what we have as one
    # truncated line and reset, instead of growing without bound.
    _MAX_LINE_BUFFER = 1 * 1024 * 1024

    async def _read_stderr(self, process_id: str, process: Process) -> None:
        """Stream stderr to broadcast_log, line by line.

        Reads in chunks instead of asyncio.StreamReader.readline() so we
        do not crash with `Separator is not found, and chunk exceed the
        limit` when a single log line is longer than the default 64 KiB
        buffer (e.g. cssr2rtcm3's `=== End Dump ===` block can push past
        that). str2str / mrtk relay write their logs to stderr.
        """
        if process.stderr is None:
            return
        await self._pump_stream(process_id, process.stderr, prefix="")

    async def _read_stdout(self, process_id: str, process: Process) -> None:
        """Stream stdout to broadcast_log with an [OUT] prefix."""
        if process.stdout is None:
            return
        await self._pump_stream(process_id, process.stdout, prefix="[OUT] ")

    # A progress line ended by a bare \r (e.g. cssr2rtcm3's "\rEpoch N: ...")
    # is broadcast at most this often; lines ended by \n always are.
    _CR_LINE_INTERVAL = 1.0

    async def _pump_stream(
        self,
        process_id: str,
        stream: asyncio.StreamReader,
        prefix: str,
    ) -> None:
        """Chunk-based line splitter on \n, \r\n or \r — survives lines of any length.

        Splitting on \n only let \r-terminated progress lines pile up in the
        buffer until the 1 MiB cap, stalling the console for hours (#32).
        """
        buf = bytearray()
        last_cr_emit = 0.0
        skip_lf = False  # a read ended in \r: drop the \n if the next one starts with it
        try:
            while True:
                chunk = await stream.read(8192)
                if not chunk:
                    if buf:
                        await self._emit_line(process_id, bytes(buf), prefix)
                        buf.clear()
                    return
                buf.extend(chunk)
                if skip_lf and buf[:1] == b"\n":
                    del buf[:1]
                skip_lf = False
                while True:
                    cr, nl = buf.find(b"\r"), buf.find(b"\n")
                    if cr < 0 and nl < 0:
                        if len(buf) > self._MAX_LINE_BUFFER:
                            await self._emit_line(
                                process_id, bytes(buf), prefix, truncated=True
                            )
                            buf.clear()
                        break
                    end = nl if cr < 0 or 0 <= nl < cr else cr
                    line = bytes(buf[:end])
                    # A \r ending this read may be half of a \r\n: emit the
                    # line now (unthrottled, it may be a real line) and drop
                    # a \n that starts the next read.
                    if end == cr and end == len(buf) - 1:
                        skip_lf = True
                        buf.clear()
                        await self._emit_line(process_id, line, prefix)
                        break
                    bare_cr = buf[end:end + 1] == b"\r" and buf[end + 1:end + 2] != b"\n"
                    del buf[: end + (2 if buf[end:end + 2] == b"\r\n" else 1)]
                    if bare_cr and line.strip():
                        now = monotonic()
                        if now - last_cr_emit < self._CR_LINE_INTERVAL:
                            continue
                        last_cr_emit = now
                    await self._emit_line(process_id, line, prefix)
        except asyncio.CancelledError:
            return
        except Exception as e:
            # Unexpected I/O failure — surface once, then stop reading
            # this stream rather than spamming the same error.
            await self._broadcast_log(
                process_id, f"[ERROR] Log read error: {e}"
            )

    async def _emit_line(
        self,
        process_id: str,
        raw: bytes,
        prefix: str,
        truncated: bool = False,
    ) -> None:
        decoded = raw.decode("utf-8", errors="replace").rstrip("\r")
        if not decoded and not truncated:
            return
        if len(decoded) > self._MAX_BROADCAST_LINE:
            decoded = decoded[: self._MAX_BROADCAST_LINE] + " …[truncated]"
        elif truncated:
            decoded = decoded + " …[no newline within 1 MiB; flushed]"
        await self._broadcast_log(process_id, f"{prefix}{decoded}")

    async def _broadcast_log(self, process_id: str, message: str) -> None:
        """Broadcast a log message (with credentials masked)."""
        message = mask_log_line(message)
        history = self._log_history.get(process_id)
        if history is not None:
            history.append(message)
        if self._log_callback:
            try:
                await self._log_callback(process_id, message)
            except Exception:
                pass  # Don't let broadcast errors affect process

    async def _broadcast_status(self, process_id: str, state: ProcessState) -> None:
        if self._status_callback:
            try:
                await self._status_callback(process_id, state.value)
            except Exception:
                pass


# Global process manager instance
process_manager = ProcessManager()
