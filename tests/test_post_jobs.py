"""mrtk post runner and job bookkeeping."""

import asyncio
import stat
from pathlib import Path

from mrtklib_web_ui.api import mrtk_post
from mrtklib_web_ui.services.mrtk_post_service import (
    MrtkPostConfig,
    MrtkPostInputFiles,
    MrtkPostJob,
    MrtkPostService,
)


def test_run_without_callbacks_drains_pipes(tmp_path):
    # A fake mrtk that writes far more than a pipe buffer to both streams.
    fake = tmp_path / "mrtk"
    fake.write_text(
        "#!/bin/sh\n"
        "head -c 1048576 /dev/zero | tr '\\\\0' 'o'\n"
        "head -c 1048576 /dev/zero | tr '\\\\0' 'e' 1>&2\n"
    )
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    for name in ("rover.obs", "nav.nav"):
        (tmp_path / name).write_text("")
    job = MrtkPostJob(
        input_files=MrtkPostInputFiles(
            rover_obs_file=str(tmp_path / "rover.obs"),
            nav_file=str(tmp_path / "nav.nav"),
            output_file=str(tmp_path / "out.pos"),
        ),
        config=MrtkPostConfig(),
    )
    svc = MrtkPostService(mrtk_bin_path=str(fake))
    result = asyncio.run(asyncio.wait_for(svc.run_mrtk_post(job), timeout=20))
    assert result.returncode == 0


def test_finished_jobs_pruned_by_finish_order(monkeypatch):
    async def scenario():
        jobs: dict[str, asyncio.Task] = {}
        monkeypatch.setattr(mrtk_post, "_active_jobs", jobs)
        monkeypatch.setattr(mrtk_post, "_finished_seq", {})
        monkeypatch.setattr(mrtk_post, "MAX_FINISHED_JOBS", 2)

        gates = {name: asyncio.Event() for name in ("long", "a", "b", "c", "run")}
        for name, gate in gates.items():  # started in this order
            mrtk_post._start_job(name, gate.wait())

        # Finish out of start order: a, b, c, then the long-running job.
        for name in ("a", "b", "c", "long"):
            gates[name].set()
            await asyncio.sleep(0)
            await asyncio.sleep(0)

        mrtk_post._prune_finished_jobs()
        keys = set(jobs)
        gates["run"].set()
        await asyncio.sleep(0)
        return keys

    # Keeps the 2 most recently *finished* (c, long) and the running job;
    # "long" started first but finished last, so it must survive.
    assert asyncio.run(scenario()) == {"c", "long", "run"}


def test_finish_order_recorded_before_task_is_done(monkeypatch):
    async def scenario():
        monkeypatch.setattr(mrtk_post, "_active_jobs", {})
        monkeypatch.setattr(mrtk_post, "_finished_seq", {})
        task = mrtk_post._start_job("j", asyncio.sleep(0))
        await task
        # Numbered as soon as the task is done: no callback window.
        return "j" in mrtk_post._finished_seq

    assert asyncio.run(scenario())


def test_job_cancelled_before_running_is_pruned_safely(monkeypatch):
    async def scenario():
        jobs: dict[str, asyncio.Task] = {}
        monkeypatch.setattr(mrtk_post, "_active_jobs", jobs)
        monkeypatch.setattr(mrtk_post, "_finished_seq", {})
        monkeypatch.setattr(mrtk_post, "MAX_FINISHED_JOBS", 1)
        coro = asyncio.sleep(10)
        t = mrtk_post._start_job("cancelled", coro)
        t.cancel()  # before it ever runs: its `finally` never executes
        try:
            await t
        except asyncio.CancelledError:
            pass
        coro.close()  # never started; avoid a "never awaited" warning
        done = mrtk_post._start_job("done", asyncio.sleep(0))
        await done
        mrtk_post._prune_finished_jobs()
        return set(jobs)

    # Both finished; the unnumbered one is numbered at prune time as most
    # recent, and pruning does not fail on a missing key.
    assert len(asyncio.run(scenario())) == 1


def test_limit_holds_after_the_last_job_of_a_batch(monkeypatch):
    async def scenario():
        jobs: dict[str, asyncio.Task] = {}
        monkeypatch.setattr(mrtk_post, "_active_jobs", jobs)
        monkeypatch.setattr(mrtk_post, "_finished_seq", {})
        monkeypatch.setattr(mrtk_post, "MAX_FINISHED_JOBS", 3)
        gate = asyncio.Event()
        tasks = [mrtk_post._start_job(f"j{i}", gate.wait()) for i in range(10)]
        gate.set()  # all finish; no further job is started
        await asyncio.gather(*tasks)
        return len(jobs)

    assert asyncio.run(scenario()) == 3


# --- Stop (#234) -----------------------------------------------------------

import os  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from mrtklib_web_ui.api.mrtk_post import MrtkPostExecuteRequest  # noqa: E402
from mrtklib_web_ui.services import mrtk_post_service  # noqa: E402

# Runs until signalled; `exec` so SIGTERM reaches the sleeping process itself.
LONG_RUN = "#!/bin/sh\necho started\nexec sleep 60\n"
# Ignores SIGTERM, so only the kill after the timeout ends it.
IGNORES_TERM = "#!/bin/sh\ntrap '' TERM\necho started\nwhile :; do sleep 0.1; done\n"


@pytest.fixture
def jobs(monkeypatch):
    """Fresh job tables and a recorder in place of the WebSocket broadcasts."""
    monkeypatch.setattr(mrtk_post, "_active_jobs", {})
    monkeypatch.setattr(mrtk_post, "_finished_seq", {})
    monkeypatch.setattr(mrtk_post, "_stop_requested", set())
    monkeypatch.setattr(mrtk_post, "_job_outputs", {})
    sent: list[tuple] = []

    async def log(job_id, line):
        sent.append(("log", job_id, line))

    async def status(job_id, value, details=None):
        sent.append(("status", job_id, value, details))

    async def progress(job_id, value):
        pass

    monkeypatch.setattr(mrtk_post.ws_manager, "broadcast_log", log)
    monkeypatch.setattr(mrtk_post.ws_manager, "broadcast_status", status)
    monkeypatch.setattr(mrtk_post.ws_manager, "broadcast_progress", progress)
    return sent


def _job_with_fake(tmp_path, monkeypatch, script: str, rover: str = "rover.obs") -> MrtkPostJob:
    fake = tmp_path / "mrtk"
    fake.write_text(script)
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    for name in (rover, "nav.nav"):
        (tmp_path / name).write_bytes(b"x")
    monkeypatch.setattr(mrtk_post, "MrtkPostService", lambda: MrtkPostService(mrtk_bin_path=str(fake)))
    return MrtkPostJob(
        input_files=MrtkPostInputFiles(
            rover_obs_file=str(tmp_path / rover),
            nav_file=str(tmp_path / "nav.nav"),
            output_file=str(tmp_path / "out.pos"),
        ),
        config=MrtkPostConfig(),
    )


async def _until_logged(sent, text: str, timeout: float = 5.0) -> None:
    end = time.monotonic() + timeout
    while not any(m[0] == "log" and text in m[2] for m in sent):
        assert time.monotonic() < end, f"never logged: {text}"
        await asyncio.sleep(0.05)


def _statuses(sent) -> list[str]:
    return [m[2] for m in sent if m[0] == "status"]


def test_stop_ends_mrtk_and_reports_stopped(tmp_path, monkeypatch, jobs):
    job = _job_with_fake(tmp_path, monkeypatch, LONG_RUN)

    async def scenario():
        mrtk_post._start_job("j", mrtk_post._run_mrtk_post_job("j", job))
        await _until_logged(jobs, "started")
        t0 = time.monotonic()
        stopped = await mrtk_post.stop_job("j")
        took = time.monotonic() - t0
        status = await mrtk_post.get_job_status("j")
        return stopped, status, took

    stopped, status, took = asyncio.run(scenario())
    assert stopped.status == "stopped"
    assert status.status == "stopped"  # not a 500 from a cancelled task
    assert took < 3  # SIGTERM, not the kill timeout
    assert _statuses(jobs) == ["running", "stopped"]
    assert mrtk_post._running_job_id() is None


def test_stop_kills_mrtk_that_ignores_sigterm(tmp_path, monkeypatch, jobs):
    monkeypatch.setattr(mrtk_post_service, "STOP_TIMEOUT", 0.5)
    job = _job_with_fake(tmp_path, monkeypatch, IGNORES_TERM)

    async def scenario():
        mrtk_post._start_job("j", mrtk_post._run_mrtk_post_job("j", job))
        await _until_logged(jobs, "started")
        return await asyncio.wait_for(mrtk_post.stop_job("j"), timeout=5)

    assert asyncio.run(scenario()).status == "stopped"


def test_stop_removes_temp_conf_and_stage_dir(tmp_path, monkeypatch, jobs):
    from mrtklib_web_ui.services import input_staging

    monkeypatch.setattr(input_staging, "WORKSPACE_ROOT", tmp_path / "ws")
    job = _job_with_fake(tmp_path, monkeypatch, LONG_RUN, rover="rover.obs.gz")

    async def scenario():
        mrtk_post._start_job("j", mrtk_post._run_mrtk_post_job("j", job))
        await _until_logged(jobs, "started")
        await mrtk_post.stop_job("j")

    asyncio.run(scenario())
    logs = [m[2] for m in jobs if m[0] == "log"]
    conf = next(re.search(r"Configuration file: (\S+)", line).group(1) for line in logs if "Configuration file:" in line)
    cmd = next(line for line in logs if line.startswith("[CMD]"))
    staged = Path(cmd.split()[-2])  # rover, then nav
    stage_dir = staged.parent.parent  # <stage dir>/<n>/<name>
    assert staged.name == "rover.obs.gz" and stage_dir.parent == tmp_path / "ws"
    assert not Path(conf).exists()
    assert not stage_dir.exists()


def test_stop_twice_and_stop_after_finish(tmp_path, monkeypatch, jobs):
    job = _job_with_fake(tmp_path, monkeypatch, LONG_RUN)

    async def scenario():
        mrtk_post._start_job("j", mrtk_post._run_mrtk_post_job("j", job))
        await _until_logged(jobs, "started")
        first, second = await asyncio.gather(mrtk_post.stop_job("j"), mrtk_post.stop_job("j"))
        third = await mrtk_post.stop_job("j")
        return first, second, third

    results = asyncio.run(scenario())
    assert [r.status for r in results] == ["stopped"] * 3
    assert _statuses(jobs).count("stopped") == 1


def test_stop_after_completion_keeps_the_result(tmp_path, monkeypatch, jobs):
    job = _job_with_fake(tmp_path, monkeypatch, "#!/bin/sh\nexit 0\n")

    async def scenario():
        task = mrtk_post._start_job("j", mrtk_post._run_mrtk_post_job("j", job))
        await task
        return await mrtk_post.stop_job("j")

    assert asyncio.run(scenario()).status == "completed"
    assert "stopped" not in _statuses(jobs)


def test_stop_before_mrtk_starts(tmp_path, monkeypatch, jobs):
    job = _job_with_fake(tmp_path, monkeypatch, LONG_RUN)
    (tmp_path / "out.pos").write_text("from an earlier run")
    old = time.time() - 3600
    os.utime(tmp_path / "out.pos", (old, old))

    async def scenario():
        mrtk_post._start_job("j", mrtk_post._run_mrtk_post_job("j", job))
        await asyncio.sleep(0)  # inside the start-up delay, before any spawn
        return await mrtk_post.stop_job("j")

    result = asyncio.run(scenario())
    assert result.status == "stopped"
    assert result.output_file is None  # the old file is not this job's output
    assert not any(m[0] == "log" and m[2].startswith("[CMD]") for m in jobs)


def test_stop_unknown_job_is_404(jobs):
    with pytest.raises(HTTPException) as e:
        asyncio.run(mrtk_post.stop_job("nope"))
    assert e.value.status_code == 404


def test_execute_refused_while_a_job_runs(jobs):
    async def scenario():
        gate = asyncio.Event()
        mrtk_post._start_job("running", gate.wait())
        mrtk_post._job_outputs["running"] = "/workspace/a.pos"
        active = await mrtk_post.active_job()
        request = MrtkPostExecuteRequest.model_validate({
            "input_files": {"rover_obs_file": "/workspace/r.obs", "nav_file": "/workspace/n.nav",
                            "output_file": "/workspace/out.pos"},
            "config": {},
        })
        try:
            await mrtk_post.execute_mrtk_post(request)
        except HTTPException as e:
            code = e.status_code
        else:
            code = None
        gate.set()
        await asyncio.sleep(0)
        return active, code, await mrtk_post.active_job()

    active, code, after = asyncio.run(scenario())
    assert code == 409
    assert active.job_id == "running" and active.output_file == "/workspace/a.pos"
    assert after is None


def test_stop_after_mrtk_exited_reports_completed(tmp_path, monkeypatch, jobs):
    job = _job_with_fake(tmp_path, monkeypatch, "#!/bin/sh\nexit 0\n")
    gate = asyncio.Event()
    real_status = mrtk_post.ws_manager.broadcast_status

    async def held_status(job_id, value, details=None):
        first = value == "completed" and "completed" not in _statuses(jobs)
        await real_status(job_id, value, details)
        if first:
            await gate.wait()  # the stop lands during the final broadcast

    monkeypatch.setattr(mrtk_post.ws_manager, "broadcast_status", held_status)

    async def scenario():
        mrtk_post._start_job("j", mrtk_post._run_mrtk_post_job("j", job))
        while "completed" not in _statuses(jobs):
            await asyncio.sleep(0.02)
        return await mrtk_post.stop_job("j")

    assert asyncio.run(scenario()).status == "completed"
    assert "stopped" not in _statuses(jobs)
