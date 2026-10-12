"""mrtk post runner and job bookkeeping."""

import asyncio
import stat

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


def test_finished_jobs_are_pruned_but_running_kept(monkeypatch):
    async def scenario():
        jobs: dict[str, asyncio.Task] = {}
        monkeypatch.setattr(mrtk_post, "_active_jobs", jobs)
        monkeypatch.setattr(mrtk_post, "MAX_FINISHED_JOBS", 2)
        never = asyncio.Event()
        running = asyncio.create_task(never.wait())
        jobs["run"] = running
        for i in range(5):
            t = asyncio.create_task(asyncio.sleep(0))
            await t
            jobs[f"done{i}"] = t
        mrtk_post._prune_finished_jobs()
        keys = list(jobs)
        running.cancel()
        return keys

    assert asyncio.run(scenario()) == ["run", "done3", "done4"]
