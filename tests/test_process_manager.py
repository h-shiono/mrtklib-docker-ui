"""process_manager log pumping and process lifecycle (#39 item 4, #32)."""

import asyncio
import importlib
import sys

from mrtklib_web_ui.services.process_manager import ProcessManager, ProcessState

# services/__init__ re-exports the process_manager instance under the module's name
pm_mod = importlib.import_module("mrtklib_web_ui.services.process_manager")


def _pump(chunks, monkeypatch, clock=None):
    pm = ProcessManager()
    lines = []

    async def cb(pid, line):
        lines.append(line)

    pm.set_log_callback(cb)
    if clock is not None:
        monkeypatch.setattr(pm_mod, "monotonic", lambda: clock.pop(0))

    async def run():
        reader = asyncio.StreamReader()
        for c in chunks:
            reader.feed_data(c)
        reader.feed_eof()
        await pm._pump_stream("p", reader, prefix="")

    asyncio.run(run())
    return lines


def test_cr_progress_lines_are_emitted(monkeypatch):
    lines = _pump([b"\rEpoch 1: ok\rEpoch 2: ok\rEpoch 3: ok"], monkeypatch, clock=[10.0, 11.5])
    assert lines == ["Epoch 1: ok", "Epoch 2: ok", "Epoch 3: ok"]


def test_cr_lines_are_throttled(monkeypatch):
    lines = _pump([b"a\rb\rc\rdone\n"], monkeypatch, clock=[10.0, 10.2, 10.4])
    assert lines == ["a", "done"]


def _pump_live(monkeypatch, steps):
    """Run the pump while feeding data step by step; return lines seen after each step.

    Each step is fed only after the pump has consumed the previous one, so
    every step is its own read() — the read-boundary cases really happen.
    """
    pm = ProcessManager()
    lines = []

    async def cb(pid, line):
        lines.append(line)

    pm.set_log_callback(cb)
    monkeypatch.setattr(pm_mod, "monotonic", lambda: 100.0)

    async def run():
        reader = asyncio.StreamReader()
        task = asyncio.create_task(pm._pump_stream("p", reader, prefix=""))
        seen = []
        for data in steps:
            reader.feed_data(data)
            for _ in range(5):
                await asyncio.sleep(0)
            seen.append(list(lines))
        reader.feed_eof()
        await task
        return seen, lines

    return asyncio.run(run())


def test_cr_line_is_emitted_before_more_output(monkeypatch):
    seen, lines = _pump_live(monkeypatch, [b"progress 1\r"])
    assert seen == [["progress 1"]]  # not held back waiting for a possible \n


def test_crlf_split_across_reads_is_one_line(monkeypatch):
    seen, lines = _pump_live(monkeypatch, [b"first\r", b"\nsecond\r", b"\n"])
    assert seen[0] == ["first"]
    assert lines == ["first", "second"]  # the split \r\n yields no extra line


def test_natural_exit_is_recorded(monkeypatch):
    pm = ProcessManager()
    monkeypatch.setattr(pm, "SUBCOMMAND_MAP", {"str2str": "relay"})
    real_exec = asyncio.create_subprocess_exec

    async def fake_exec(_mrtk, _sub, *args, **kw):
        return await real_exec(sys.executable, "-c", "import sys; sys.stderr.write('\\rEpoch 1'); sys.exit(3)", **kw)

    monkeypatch.setattr(pm_mod.asyncio, "create_subprocess_exec", fake_exec)

    async def run():
        await pm.start("str2str", [], process_id="r1")
        await asyncio.wait_for(pm._log_tasks["r1"], timeout=10)
        return await pm.stop("r1")

    info = asyncio.run(run())
    assert info.state == ProcessState.STOPPED and info.return_code == 3
    assert pm.peek_state("r1") == ProcessState.STOPPED
    assert "r1" not in pm._processes and "r1" not in pm._log_tasks


def test_restart_under_same_id_waits_for_previous_drain(monkeypatch):
    """The old run's tail output and exit go out before the new run starts."""
    pm = ProcessManager()
    monkeypatch.setattr(pm, "SUBCOMMAND_MAP", {"str2str": "relay"})
    events = []

    async def on_log(pid, line):
        events.append(("log", line))

    async def on_status(pid, state):
        events.append(("status", state))

    pm.set_log_callback(on_log)
    pm.set_status_callback(on_status)
    real_exec = asyncio.create_subprocess_exec
    # First run: exits at once, but a child keeps stderr open for a while,
    # so the supervisor is still draining when the run is restarted
    child = "import sys, time; time.sleep(0.5); print('tail', file=sys.stderr)"
    first = f"import subprocess, sys; subprocess.Popen([sys.executable, '-c', {child!r}]); sys.exit(0)"
    scripts = [first, "import sys; print('second', file=sys.stderr)"]

    async def fake_exec(_mrtk, _sub, *args, **kw):
        return await real_exec(sys.executable, "-c", scripts.pop(0), **kw)

    monkeypatch.setattr(pm_mod.asyncio, "create_subprocess_exec", fake_exec)

    async def run():
        await pm.start("str2str", [], process_id="clas")
        await pm._processes["clas"].wait()
        assert (await pm.get_status("clas")).state == ProcessState.STOPPED
        await pm.start("str2str", [], process_id="clas")
        await asyncio.wait_for(pm._log_tasks["clas"], timeout=10)

    asyncio.run(run())
    second_start = [i for i, e in enumerate(events) if e[0] == "log" and "Starting" in e[1]][1]
    before, after = events[:second_start], events[second_start:]
    assert ("log", "tail") in before
    assert ("status", "stopped") in before
    # The new run's only stop is its own, after its own output
    assert [e for e in after if e[0] == "status"] == [("status", "stopped")]
    assert after.index(("log", "second")) < after.index(("status", "stopped"))


def test_prune_drops_earliest_finished_not_earliest_started():
    from datetime import datetime, timedelta

    from mrtklib_web_ui.services.process_manager import ProcessInfo

    pm = ProcessManager()
    pm._MAX_FINISHED = 2
    t0 = datetime(2026, 1, 1)
    # "long" started first but finished last
    for pid, finished in (("long", 10), ("a", 1), ("b", 2), ("c", 3)):
        pm._process_info[pid] = ProcessInfo(
            id=pid, command="str2str", args=[], state=ProcessState.STOPPED,
            stopped_at=t0 + timedelta(seconds=finished),
        )
    pm._prune_finished()
    assert set(pm._process_info) == {"c", "long"}
