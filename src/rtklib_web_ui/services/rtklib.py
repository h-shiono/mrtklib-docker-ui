"""RTKLIB process manager service."""

import asyncio
import uuid
from typing import Any


class RTKProcessManager:
    """Manages RTKLIB subprocess execution."""

    # Allowed RTKLIB commands
    ALLOWED_COMMANDS = {"rnx2rtkp", "str2str", "convbin"}

    def __init__(self) -> None:
        self._processes: dict[str, asyncio.subprocess.Process] = {}

    async def start(self, command: str, args: list[str]) -> str:
        """Start an RTKLIB process.

        Args:
            command: RTKLIB command name (e.g., 'rnx2rtkp', 'str2str')
            args: Command arguments

        Returns:
            Process ID string

        Raises:
            ValueError: If command is not allowed
        """
        if command not in self.ALLOWED_COMMANDS:
            raise ValueError(f"Command not allowed: {command}")

        process_id = str(uuid.uuid4())

        # In production, spawn the actual RTKLIB binary
        # For now, this is a placeholder for the mock mode
        process = await asyncio.create_subprocess_exec(
            f"/usr/local/bin/{command}",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        self._processes[process_id] = process
        return process_id

    async def stop(self, process_id: str) -> int | None:
        """Stop a running process.

        Args:
            process_id: Process ID to stop

        Returns:
            Return code if process terminated, None otherwise
        """
        process = self._processes.get(process_id)
        if process is None:
            return None

        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()

        return process.returncode

    async def get_status(self, process_id: str) -> dict[str, Any]:
        """Get process status.

        Args:
            process_id: Process ID to check

        Returns:
            Status dictionary with 'running' and optionally 'return_code'
        """
        process = self._processes.get(process_id)
        if process is None:
            return {"running": False, "return_code": None}

        if process.returncode is not None:
            return {"running": False, "return_code": process.returncode}

        return {"running": True}
