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


def test_crlf_split_across_reads_is_one_line(monkeypatch):
    # if the \r were taken as a bare CR, the throttle would drop "second"
    lines = _pump([b"first\r", b"\nsecond\r", b"\n"], monkeypatch, clock=[10.0])
    assert lines == ["first", "second"]


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
