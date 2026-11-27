"""mrtk -ts / -te / -tr get the date and the time as two arguments (#224)."""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mrtklib_web_ui import paths
from mrtklib_web_ui.api import mrtk_post
from mrtklib_web_ui.api.convert import ConvertRequest, build_convert_cmd
from mrtklib_web_ui.services import mrtk_post_service
from mrtklib_web_ui.services.mrtk_args import epoch_args
from mrtklib_web_ui.services.mrtk_post_service import (
    MrtkPostConfig,
    MrtkPostInputFiles,
    MrtkPostJob,
    MrtkPostService,
    MrtkPostTimeRange,
)


@pytest.mark.parametrize("value, expected", [
    ("2026/01/21 00:00:00", ["2026/01/21", "00:00:00"]),
    (" 2026/1/2 3:04:05 ", ["2026/01/02", "03:04:05"]),
    ("2026-01-21T12:30:15.5", ["2026/01/21", "12:30:15.5"]),
])
def test_epoch_args_splits_date_and_time(value, expected):
    assert epoch_args("-ts", value) == ["-ts", *expected]


@pytest.mark.parametrize("value", [
    "2026/01/21", "00:00:00", "2026/13/01 00:00:00", "2026/02/30 00:00:00",
    "2026/01/21 24:00:00", "2026/01/21 00:00:60", "2026/01/21 00:00:00 x", "",
])
def test_epoch_args_rejects_bad_values(value):
    with pytest.raises(ValueError, match="-te"):
        epoch_args("-te", value)


def _after(cmd, flag):
    i = cmd.index(flag)
    return cmd[i + 1:i + 3]


def test_convert_passes_each_time_as_two_arguments():
    req = ConvertRequest(
        input_file="/data/rover.ubx",
        time_start="2026/01/21 00:00:00",
        time_end="2026/01/21 01:00:00",
        time_ref="2026/01/20 23:59:00",
        interval=30,
    )
    cmd = build_convert_cmd(req)
    assert _after(cmd, "-ts") == ["2026/01/21", "00:00:00"]
    assert _after(cmd, "-te") == ["2026/01/21", "01:00:00"]
    assert _after(cmd, "-tr") == ["2026/01/20", "23:59:00"]
    assert _after(cmd, "-ti") == ["30.0", "-f"]


def test_convert_rejects_a_malformed_time():
    with pytest.raises(ValueError):
        build_convert_cmd(ConvertRequest(input_file="/data/rover.ubx", time_start="21/01/2026"))


@pytest.mark.parametrize("time_range", [
    {"start_time": "2026/01/21 00:00:00"},  # used to swallow the rover file
    {"end_time": "2026/01/21 01:00:00"},
    {"start_time": "2026/01/21 00:00:00", "end_time": "2026/01/21 01:00:00", "interval": 30},
])
def test_post_keeps_every_argument(tmp_path, monkeypatch, time_range):
    rover, nav = tmp_path / "rover.26o", tmp_path / "nav.26n"
    rover.write_text("")
    nav.write_text("")
    captured = []

    class Stop(Exception):
        pass

    async def fake_exec(*cmd, **kw):
        captured.extend(cmd)
        raise Stop

    monkeypatch.setattr(mrtk_post_service.asyncio, "create_subprocess_exec", fake_exec)
    job = MrtkPostJob(
        input_files=MrtkPostInputFiles(
            rover_obs_file=str(rover), nav_file=str(nav), output_file=str(tmp_path / "out.pos"),
        ),
        config=MrtkPostConfig(),
        time_range=MrtkPostTimeRange(**time_range),
    )
    with pytest.raises(Stop):
        asyncio.run(MrtkPostService().run_mrtk_post(job))

    if "start_time" in time_range:
        assert _after(captured, "-ts") == ["2026/01/21", "00:00:00"]
    if "end_time" in time_range:
        assert _after(captured, "-te") == ["2026/01/21", "01:00:00"]
    if "interval" in time_range:
        assert _after(captured, "-ti")[0] == "30.0"
    assert captured[-2:] == [str(rover), str(nav)]


def test_post_execute_rejects_a_malformed_time(post_app):
    r, started = post_app({"start_time": "2026/01/21"})
    assert r.status_code == 400
    assert r.json()["detail"].startswith("Time Start: -ts")
    assert started == []


def test_post_blank_time_means_not_set(post_app, tmp_path, monkeypatch):
    # The UI sends " " when the box is ticked but the picker was cleared
    r, started = post_app({"start_time": " ", "end_time": " "})
    assert r.status_code == 200, r.text
    captured = []

    class Stop(Exception):
        pass

    async def fake_exec(*cmd, **kw):
        captured.extend(cmd)
        raise Stop

    monkeypatch.setattr(mrtk_post_service.asyncio, "create_subprocess_exec", fake_exec)
    with pytest.raises(Stop):
        asyncio.run(MrtkPostService().run_mrtk_post(started[0]))
    assert "-ts" not in captured and "-te" not in captured


@pytest.fixture
def post_app(tmp_path, monkeypatch):
    ws = tmp_path.resolve()
    (ws / "rover.26o").write_text("")
    (ws / "nav.26n").write_text("")
    monkeypatch.setattr(paths, "ALLOWED_ROOTS", [ws])
    monkeypatch.setattr(paths, "WORKSPACE_ROOT", ws)
    monkeypatch.setattr(mrtk_post, "WORKSPACE_ROOT", ws)
    started = []

    async def fake_run(job_id, job):
        started.append(job)

    monkeypatch.setattr(mrtk_post, "_run_mrtk_post_job", fake_run)
    app = FastAPI()
    app.include_router(mrtk_post.router, prefix="/api/mrtk-post")
    client = TestClient(app)

    def post(time_range):
        body = {
            "input_files": {
                "rover_obs_file": str(ws / "rover.26o"),
                "nav_file": str(ws / "nav.26n"),
                "output_file": str(ws / "out.pos"),
            },
            "config": {},
            "time_range": time_range,
        }
        return client.post("/api/mrtk-post/execute", json=body), started

    return post
