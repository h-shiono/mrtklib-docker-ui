"""Process manager for RTKLIB command execution with real-time log streaming."""

import asyncio
import signal
import uuid
from asyncio.subprocess import Process
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Callable, Awaitable


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
    """Manages RTKLIB subprocess execution with async log streaming.

    Handles starting, stopping, and monitoring of RTKLIB processes.
    Broadcasts stderr output to connected WebSocket clients.
    """

    # Allowed commands (security whitelist)
    ALLOWED_COMMANDS: set[str] = field(
        default_factory=lambda: {"str2str", "convbin", "rnx2rtkp", "rtkrcv"}
    )

    # Active processes
    _processes: dict[str, Process] = field(default_factory=dict)
    _process_info: dict[str, ProcessInfo] = field(default_factory=dict)

    # Log broadcast callback
    _log_callback: Callable[[str, str], Awaitable[None]] | None = None

    # Background tasks for log reading
    _log_tasks: dict[str, asyncio.Task] = field(default_factory=dict)

    def set_log_callback(
        self, callback: Callable[[str, str], Awaitable[None]]
    ) -> None:
        """Set callback for log broadcasting.

        Args:
            callback: Async function that receives (process_id, log_line)
        """
        self._log_callback = callback

    async def start(
        self,
        command: str,
        args: list[str] | None = None,
        process_id: str | None = None,
    ) -> ProcessInfo:
        """Start an RTKLIB process.

        Args:
            command: RTKLIB command name (e.g., 'str2str')
            args: Command arguments
            process_id: Optional custom process ID

        Returns:
            ProcessInfo with process details

        Raises:
            ValueError: If command is not allowed or process already running
        """
        if command not in self.ALLOWED_COMMANDS:
            raise ValueError(f"Command not allowed: {command}")

        # Generate process ID if not provided
        proc_id = process_id or str(uuid.uuid4())[:8]

        # Check if process with same ID is already running
        if proc_id in self._processes:
            existing = self._process_info.get(proc_id)
            if existing and existing.state == ProcessState.RUNNING:
                raise ValueError(f"Process {proc_id} is already running")

        # Create process info
        info = ProcessInfo(
            id=proc_id,
            command=command,
            args=args or [],
            state=ProcessState.STARTING,
            started_at=datetime.now(),
        )
        self._process_info[proc_id] = info

        try:
            # Build full command path
            cmd_path = f"/usr/local/bin/{command}"

            # Log the command being executed
            cmd_str = f"{cmd_path} {' '.join(args or [])}"
            await self._broadcast_log(proc_id, f"[SYSTEM] Starting: {cmd_str}")

            # Create subprocess
            process = await asyncio.create_subprocess_exec(
                cmd_path,
                *(args or []),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
            )

            self._processes[proc_id] = process
            info.pid = process.pid
            info.state = ProcessState.RUNNING

            await self._broadcast_log(proc_id, f"[SYSTEM] Process started (PID: {process.pid})")

            # Start background task to read stderr
            self._log_tasks[proc_id] = asyncio.create_task(
                self._read_stderr(proc_id, process)
            )

            # Also read stdout in background
            asyncio.create_task(self._read_stdout(proc_id, process))

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
            if process_id in self._log_tasks:
                self._log_tasks[process_id].cancel()
                try:
                    await self._log_tasks[process_id]
                except asyncio.CancelledError:
                    pass
                del self._log_tasks[process_id]

            # Clean up process reference
            del self._processes[process_id]

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

    async def _read_stderr(self, process_id: str, process: Process) -> None:
        """Read stderr stream and broadcast lines.

        str2str writes its logs to stderr.
        """
        if process.stderr is None:
            return

        try:
            while True:
                line = await process.stderr.readline()
                if not line:
                    break

                decoded = line.decode("utf-8", errors="replace").rstrip()
                if decoded:
                    await self._broadcast_log(process_id, decoded)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            await self._broadcast_log(process_id, f"[ERROR] Log read error: {e}")

    async def _read_stdout(self, process_id: str, process: Process) -> None:
        """Read stdout stream and broadcast lines."""
        if process.stdout is None:
            return

        try:
            while True:
                line = await process.stdout.readline()
                if not line:
                    break

                decoded = line.decode("utf-8", errors="replace").rstrip()
                if decoded:
                    await self._broadcast_log(process_id, f"[OUT] {decoded}")

        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def _broadcast_log(self, process_id: str, message: str) -> None:
        """Broadcast a log message."""
        if self._log_callback:
            try:
                await self._log_callback(process_id, message)
            except Exception:
                pass  # Don't let broadcast errors affect process


# Global process manager instance
process_manager = ProcessManager()
