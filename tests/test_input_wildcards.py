"""PP input wildcards behave like MRTKLIB expath() (#39 item 1)."""

from pathlib import Path

import pytest

from mrtklib_web_ui.services import input_staging


@pytest.fixture
def data_root(tmp_path, monkeypatch):
    data = tmp_path.resolve() / "data"
    ws = tmp_path.resolve() / "workspace"
    data.mkdir()
    ws.mkdir()
    for name in ("rover1.24d", "ROVER2.24D", "rover3.24o", ".hidden.24d"):
        (data / name).write_text(name)
    monkeypatch.setattr(input_staging, "_READONLY_ROOTS", (data,))
    monkeypatch.setattr(input_staging, "WORKSPACE_ROOT", ws)
    return data


def test_staging_a_compressed_wildcard(data_root):
    pattern = str(data_root / "rover*.24d")
    mapping, tmpdir = input_staging.stage_paths([pattern])
    try:
        staged = Path(mapping[pattern])
        assert staged.name == "rover*.24d"
        assert [p.name for p in input_staging.expand_wildcard(str(staged))] == ["ROVER2.24D", "rover1.24d"]
    finally:
        input_staging.remove_stage_dir(tmpdir)


def test_matching_folders_are_ignored(data_root):
    (data_root / "rover_archive.24d").mkdir()  # a folder that matches the pattern
    pattern = str(data_root / "rover*.24d")
    assert [p.name for p in input_staging.expand_wildcard(pattern)] == ["ROVER2.24D", "rover1.24d"]
    mapping, tmpdir = input_staging.stage_paths([pattern])
    try:
        assert [p.name for p in input_staging.expand_wildcard(mapping[pattern])] == ["ROVER2.24D", "rover1.24d"]
    finally:
        input_staging.remove_stage_dir(tmpdir)


def test_failed_staging_removes_its_dir(data_root, monkeypatch):
    def boom(*a, **kw):
        raise OSError("disk full")

    monkeypatch.setattr(input_staging.shutil, "copy2", boom)
    with pytest.raises(OSError):
        input_staging.stage_paths([str(data_root / "rover*.24d")])
    assert list(input_staging.WORKSPACE_ROOT.iterdir()) == []


def test_same_names_from_two_dirs_do_not_collide(data_root):
    other = data_root / "base"
    other.mkdir()
    (other / "rover1.24d").write_text("base")
    rover, base = str(data_root / "rover1.24d"), str(other / "rover1.24d")
    mapping, tmpdir = input_staging.stage_paths([rover, base])
    try:
        assert Path(mapping[rover]).read_text() == "rover1.24d"
        assert Path(mapping[base]).read_text() == "base"
    finally:
        input_staging.remove_stage_dir(tmpdir)


def test_expand_wildcard_mirrors_expath(data_root):
    def names(pat):
        return [p.name for p in input_staging.expand_wildcard(str(data_root / pat))]

    assert names("*.24D") == ["ROVER2.24D", "rover1.24d"]  # case-insensitive, no dotfiles
    assert names("rover*") == ["ROVER2.24D", "rover1.24d", "rover3.24o"]
    assert names("rover?.24d") == []  # ? is literal to mrtk
    assert names("nomatch*") == []


# ── /api/mrtk-post/execute input validation ──────────────────────────────────

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mrtklib_web_ui import paths  # noqa: E402
from mrtklib_web_ui.api import mrtk_post  # noqa: E402


@pytest.fixture
def post_client(data_root, monkeypatch):
    ws = data_root.parent / "workspace"
    (data_root / "nav.24n").write_text("nav")
    monkeypatch.setattr(paths, "ALLOWED_ROOTS", [ws, data_root])
    monkeypatch.setattr(paths, "WORKSPACE_ROOT", ws)
    monkeypatch.setattr(mrtk_post, "WORKSPACE_ROOT", ws)
    started = []

    async def fake_run(job_id, job):
        started.append(job)

    monkeypatch.setattr(mrtk_post, "_run_mrtk_post_job", fake_run)
    app = FastAPI()
    app.include_router(mrtk_post.router, prefix="/api/mrtk-post")
    return TestClient(app), data_root, ws, started


def _execute(c, rover, nav, ws):
    body = {"input_files": {"rover_obs_file": rover, "nav_file": nav, "output_file": str(ws / "out.pos")}, "config": {}}
    return c.post("/api/mrtk-post/execute", json=body)


def test_execute_keeps_wildcard_as_one_argument(post_client):
    c, data, ws, started = post_client
    r = _execute(c, str(data / "*.24D"), str(data / "nav.24n"), ws)
    assert r.status_code == 200, r.text
    assert started[0].input_files.rover_obs_file == str(data / "*.24D")


@pytest.mark.parametrize("rover, needle", [
    ("nomatch*.obs", "no files match"),
    ("*/rover1.24d", "only supported in the file name"),
    ("rover?.24d", "'*' is the only wildcard"),
])
def test_execute_rejects_bad_inputs(post_client, rover, needle):
    c, data, ws, _ = post_client
    r = _execute(c, str(data / rover), str(data / "nav.24n"), ws)
    assert r.status_code == 400 and needle in r.json()["detail"]


def test_execute_reports_remapped_path(post_client):
    c, data, ws, _ = post_client
    r = _execute(c, "/home/me/rover.obs", str(data / "nav.24n"), ws)
    assert r.status_code == 400
    assert f"resolved to {ws}/home/me/rover.obs" in r.json()["detail"]
