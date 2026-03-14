"""MRTKLIB process manager service."""

import asyncio
import uuid
from typing import Any


class MRTKProcessManager:
    """Manages MRTKLIB subprocess execution."""

    # Map legacy command names → mrtk subcommands
    SUBCOMMAND_MAP = {
        "mrtk_post": "post",
        "str2str": "relay",
        "convbin": "convert",
    }

    def __init__(self) -> None:
        self._processes: dict[str, asyncio.subprocess.Process] = {}

    async def start(self, command: str, args: list[str]) -> str:
        """Start an MRTKLIB process.

        Args:
            command: Legacy command name (e.g., 'mrtk_post') mapped to mrtk subcommand
            args: Command arguments

        Returns:
            Process ID string

        Raises:
            ValueError: If command is not allowed
        """
        subcommand = self.SUBCOMMAND_MAP.get(command)
        if subcommand is None:
            raise ValueError(f"Command not allowed: {command}")

        process_id = str(uuid.uuid4())

        process = await asyncio.create_subprocess_exec(
            "/usr/local/bin/mrtk",
            subcommand,
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
