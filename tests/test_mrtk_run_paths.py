"""Tests for mrtk run file-stream path numbering and write-path validation."""

from datetime import datetime, timezone

import pytest

from mrtklib_web_ui.api import mrtk_run
from mrtklib_web_ui.api.mrtk_run import _validate_write_streams
from mrtklib_web_ui.services import mrtk_run_service as svc
from mrtklib_web_ui.services.mrtk_run_service import (
    StreamsConfigModel,
    _with_suffix_number,
    expand_path_keywords,
    number_file_stream_path,
)

# 2026-10-11 (Sun) 21:05:07 GPST -> DOY 284, hour code 'v'
T = datetime(2026, 10, 11, 21, 5, 7, tzinfo=timezone.utc)


# ── keyword expansion ────────────────────────────────────────────────────────

def test_expand_path_keywords():
    assert expand_path_keywords("%Y/%n/rovr_%n%H.ubx", T) == "2026/284/rovr_284v.ubx"
    assert expand_path_keywords("%y%m%d %h:%M:%S", T) == "261011 21:05:07"
    assert expand_path_keywords("%W %D", T) == "2440 0"
    # %ha/%hb/%hc are replaced before %h
    assert expand_path_keywords("%ha %hb %hc %t", T) == "21 18 12 00"


def test_with_suffix_number():
    assert _with_suffix_number("/a/b/rovr_%n%H.ubx", 2) == "/a/b/rovr_%n%H_2.ubx"
    assert _with_suffix_number("/a/b/noext", 3) == "/a/b/noext_3"
    assert _with_suffix_number("/a/.hidden", 2) == "/a/.hidden_2"
    assert _with_suffix_number("/a.b/c", 2) == "/a.b/c_2"


# ── numbering ────────────────────────────────────────────────────────────────

def test_free_path_unchanged_and_reserved(tmp_path):
    tmpl = f"{tmp_path}/%n/rovr_%n%H.ubx"
    reserved: set[str] = set()
    assert number_file_stream_path(f"{tmpl}::S=1::T", T, reserved) == f"{tmpl}::S=1::T"
    target = f"{tmp_path.resolve()}/284/rovr_284v.ubx"
    assert reserved == {target, f"{target}.tag"}


def test_existing_file_gets_suffix(tmp_path):
    (tmp_path / "out.pos").write_text("x")
    assert number_file_stream_path(f"{tmp_path}/out.pos", T, set()) == f"{tmp_path}/out_2.pos"


def test_tag_only_collision_gets_suffix(tmp_path):
    (tmp_path / "rovr.ubx.tag").write_text("x")
    assert number_file_stream_path(f"{tmp_path}/rovr.ubx::T", T, set()) == f"{tmp_path}/rovr_2.ubx::T"


def test_skips_occupied_suffixes(tmp_path):
    for name in ("out.pos", "out_2.pos", "out_3.pos"):
        (tmp_path / name).write_text("x")
    assert number_file_stream_path(f"{tmp_path}/out.pos", T, set()) == f"{tmp_path}/out_4.pos"


def test_streams_in_one_run_never_share_a_file(tmp_path):
    # out.pos exists; another stream targets the free out_2.pos
    (tmp_path / "out.pos").write_text("x")
    reserved: set[str] = set()
    a = number_file_stream_path(f"{tmp_path}/out.pos", T, reserved)
    b = number_file_stream_path(f"{tmp_path}/out_2.pos", T, reserved)
    assert a == f"{tmp_path}/out_2.pos"
    assert b != a


def test_identical_templates_are_separated(tmp_path):
    reserved: set[str] = set()
    a = number_file_stream_path(f"{tmp_path}/x.ubx", T, reserved)
    b = number_file_stream_path(f"{tmp_path}/x.ubx", T, reserved)
    assert (a, b) == (f"{tmp_path}/x.ubx", f"{tmp_path}/x_2.ubx")


def test_aliased_paths_are_one_target(tmp_path):
    (tmp_path / "logs").mkdir()
    reserved: set[str] = set()
    a = number_file_stream_path(f"{tmp_path}/out.pos", T, reserved)
    b = number_file_stream_path(f"{tmp_path}/logs/../out.pos", T, reserved)
    assert a == f"{tmp_path}/out.pos"
    assert b == f"{tmp_path}/logs/../out_2.pos"


def test_tag_file_of_another_stream_is_reserved(tmp_path):
    reserved: set[str] = set()
    number_file_stream_path(f"{tmp_path}/raw.ubx::T", T, reserved)
    # A stream literally targeting raw.ubx.tag must not reuse it
    assert number_file_stream_path(f"{tmp_path}/raw.ubx.tag", T, reserved) == f"{tmp_path}/raw.ubx_2.tag"
    # ...and a stream whose own .tag would be another stream's file is moved too
    reserved = set()
    number_file_stream_path(f"{tmp_path}/x.ubx.tag", T, reserved)
    assert number_file_stream_path(f"{tmp_path}/x.ubx::T", T, reserved) == f"{tmp_path}/x_2.ubx::T"


def test_exhaustion_refuses_instead_of_overwriting(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_MAX_SUFFIX_NUMBER", 3)
    for name in ("out.pos", "out_2.pos", "out_3.pos"):
        (tmp_path / name).write_text("x")
    with pytest.raises(RuntimeError, match="No free file name"):
        number_file_stream_path(f"{tmp_path}/out.pos", T, set())


def test_empty_path_is_stdout_and_untouched():
    reserved: set[str] = set()
    assert number_file_stream_path("", T, reserved) == ""
    assert reserved == set()


# ── write-path validation ────────────────────────────────────────────────────

def _validate(**paths: str) -> str | None:
    return _validate_write_streams(
        StreamsConfigModel(**{k: {"type": "file", "path": v} for k, v in paths.items()})
    )


@pytest.mark.parametrize("field,path", [
    ("log_stream1", "/workspace/rtlog/%Y/%n/rovr_%n%H.ubx::S=1::T"),
    ("output_stream1", "/workspace/out.pos"),
    ("output_stream1", ""),  # stdout
])
def test_accepted_write_paths(field, path):
    assert _validate(**{field: path}) is None


@pytest.mark.parametrize("field,path,msg", [
    ("log_stream1", "/workspace/../etc/x.ubx::S=1", "within /workspace"),
    ("log_stream2", "rel/x.ubx", "within /workspace"),
    ("log_stream3", "::S=1", "file path is required"),
    ("output_stream1", "/tmp/out.pos", "within /workspace"),
])
def test_rejected_write_paths(field, path, msg):
    assert msg in (_validate(**{field: path}) or "")


def test_keyword_dir_symlinked_out_of_workspace_is_rejected(tmp_path, monkeypatch):
    ws = tmp_path.resolve() / "ws"
    outside = tmp_path.resolve() / "outside"
    ws.mkdir()
    outside.mkdir()
    year = mrtk_run.gpst_now().year
    (ws / str(year)).symlink_to(outside)
    monkeypatch.setattr(mrtk_run, "WORKSPACE_ROOT", ws)
    assert _validate(output_stream1=f"{ws}/%Y/new.pos") is not None
    assert _validate(output_stream1=f"{ws}/new_%Y.pos") is None


def test_non_file_streams_are_not_checked():
    s = StreamsConfigModel(output_stream1={"type": "tcpsvr", "path": ":2101"})
    assert _validate_write_streams(s) is None
