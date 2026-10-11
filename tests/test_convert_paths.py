"""mrtk convert only reads allowed inputs and writes into /workspace (#38 item 4)."""

import pytest
from pydantic import ValidationError

from mrtklib_web_ui.api.convert import ConvertRequest, _validate_convert_paths


def _req(**kw):
    return ConvertRequest(input_file=kw.pop("input_file", "/data/rover.ubx"), **kw)


def test_valid_request_is_resolved():
    req = _req(input_file="logs/rover.ubx", output_obs="/workspace/out/r.obs", output_dir="/workspace")
    assert _validate_convert_paths(req) is None
    assert req.input_file == "/workspace/logs/rover.ubx"
    assert req.output_obs == "/workspace/out/r.obs"
    assert req.output_dir == "/workspace"


@pytest.mark.parametrize("kw", [
    {"input_file": "/workspace/../etc/passwd"},
    {"input_file": "/opt/mrtklib/corrections/clas/isb.tbl"},
    {"input_file": "/workspace/.credentials.toml"},
    {"output_obs": "/workspace/../root/x.obs"},
    {"output_obs": "/workspace"},
    {"output_nav": "/data/x.nav"},
    {"output_nav": "/workspace/.ai_settings.toml"},
    {"output_dir": "/opt/mrtklib/corrections"},
])
def test_rejected(kw):
    assert _validate_convert_paths(_req(**kw)) is not None


def test_foreign_absolute_paths_land_in_workspace():
    # resolve_path treats paths outside every root as /workspace-relative
    req = _req(input_file="/etc/shadow", output_obs="/etc/cron.d/x", output_dir="/tmp")
    assert _validate_convert_paths(req) is None
    assert req.input_file == "/workspace/etc/shadow"
    assert req.output_obs == "/workspace/etc/cron.d/x"
    assert req.output_dir == "/workspace/tmp"


@pytest.mark.parametrize("station_id", ["../../etc/cron.d/evil", "a/b", "x y"])
def test_station_id_cannot_carry_a_path(station_id):
    with pytest.raises(ValidationError):
        _req(station_id=station_id)
