"""Stream Server relays survive a page reload / reconnect (#52)."""

import asyncio
import importlib
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mrtklib_web_ui.api import mrtk_relay
from mrtklib_web_ui.services.process_manager import ProcessManager, ProcessState

pm_mod = importlib.import_module("mrtklib_web_ui.services.process_manager")

# Logs one line, then runs until stopped
_LONG_RUNNING = (
    "import sys, time; sys.stderr.write('stream: 0 B\\n'); sys.stderr.flush(); time.sleep(60)"
)


@pytest.fixture
def pm(monkeypatch):
    pm = ProcessManager()
    monkeypatch.setattr(pm, "SUBCOMMAND_MAP", {"str2str": "relay"})
    real_exec = asyncio.create_subprocess_exec

    async def fake_exec(_mrtk, _sub, *args, **kw):
        return await real_exec(sys.executable, "-c", _LONG_RUNNING, **kw)

    monkeypatch.setattr(pm_mod.asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(mrtk_relay, "process_manager", pm)
    monkeypatch.setattr(mrtk_relay, "_stream_names", {})
    return pm


async def _wait_for_log(pm, pid, text):
    for _ in range(200):
        if any(text in line for line in pm.get_log(pid)):
            return
        await asyncio.sleep(0.05)
    raise AssertionError(f"{text!r} not in log: {pm.get_log(pid)}")


def test_log_history_and_exit_status_are_kept(pm):
    states = []

    async def on_status(pid, state):
        states.append((pid, state))

    pm.set_status_callback(on_status)

    async def run():
        await pm.start("str2str", ["-in", "ntrip://u:secret@h:2101/M"], process_id="r1")
        await _wait_for_log(pm, "r1", "stream: 0 B")
        return await pm.stop("r1", timeout=2)

    info = asyncio.run(run())
    assert info.state == ProcessState.STOPPED
    log = pm.get_log("r1")
    assert log[0].startswith("[SYSTEM] Starting:")
    assert "secret" not in "\n".join(log)  # masked before it is kept
    assert log[-1].startswith("[SYSTEM] Process stopped")
    assert states == [("r1", "stopped")]


def test_natural_exit_broadcasts_status(monkeypatch):
    pm = ProcessManager()
    monkeypatch.setattr(pm, "SUBCOMMAND_MAP", {"str2str": "relay"})
    real_exec = asyncio.create_subprocess_exec

    async def fake_exec(_mrtk, _sub, *args, **kw):
        return await real_exec(sys.executable, "-c", "import sys; sys.exit(2)", **kw)

    monkeypatch.setattr(pm_mod.asyncio, "create_subprocess_exec", fake_exec)
    states = []

    async def on_status(pid, state):
        states.append((pid, state))

    pm.set_status_callback(on_status)

    async def run():
        await pm.start("str2str", [], process_id="r2")
        await asyncio.wait_for(pm._log_tasks["r2"], timeout=10)

    asyncio.run(run())
    assert states == [("r2", "stopped")]
    assert pm.get_log("r2")[-1] == "[SYSTEM] Process exited (exit code: 2)"


def test_prune_drops_log_history():
    from datetime import datetime

    from mrtklib_web_ui.services.process_manager import ProcessInfo

    pm = ProcessManager()
    pm._MAX_FINISHED = 0
    pm._process_info["old"] = ProcessInfo(
        id="old", command="str2str", args=[], state=ProcessState.STOPPED,
        stopped_at=datetime(2026, 1, 1),
    )
    pm._log_history["old"] = pm_mod.deque(["x"])
    pm._prune_finished()
    assert pm.get_log("old") == []


def test_streams_endpoint_lists_ui_relays_with_log(pm):
    app = FastAPI()
    app.include_router(mrtk_relay.router, prefix="/api/mrtk-relay")
    args = ["-in", "ntrip://u:secret@h:2101/M", "-out", "tcpsvr://:2102"]

    with TestClient(app) as c:
        r = c.post("/api/mrtk-relay/start", json={"args": args, "name": "Base NTRIP"})
        assert r.status_code == 200
        pid = r.json()["id"]
        # a relay the CLAS pipeline runs is not a Stream Server stream
        c.portal.call(pm.start, "str2str", [], "clas-relay")
        c.portal.call(_wait_for_log, pm, pid, "stream: 0 B")

        streams = c.get("/api/mrtk-relay/streams").json()
        assert [s["id"] for s in streams] == [pid]
        s = streams[0]
        assert s["name"] == "Base NTRIP" and s["state"] == "running"
        assert s["args"] == ["-in", "ntrip://u:***@h:2101/M", "-out", "tcpsvr://:2102"]
        assert "stream: 0 B" in s["log"]

        assert c.post("/api/mrtk-relay/stop", json={"process_id": pid, "timeout": 2}).status_code == 200
        c.portal.call(pm.stop, "clas-relay", 2)
        s = c.get("/api/mrtk-relay/streams").json()[0]
        assert s["state"] == "stopped"
        assert s["log"][-1].startswith("[SYSTEM] Process stopped")

        # once the process manager forgets it, so does the stream list
        pm._MAX_FINISHED = 0
        pm._prune_finished()
        assert c.get("/api/mrtk-relay/streams").json() == []
        assert mrtk_relay._stream_names == {}
