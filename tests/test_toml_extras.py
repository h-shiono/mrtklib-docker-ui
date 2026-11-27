"""Unknown imported keys written back on export (#230)."""

import tomllib

import pytest
from fastapi.testclient import TestClient

from mrtklib_web_ui.api import presets
from mrtklib_web_ui.main import app
from mrtklib_web_ui.services import toml_extras
from mrtklib_web_ui.services.mrtk_post_service import MrtkPostConfig, MrtkPostService
from mrtklib_web_ui.services.mrtk_run_service import MrtkRunService, StreamsConfigModel

svc = MrtkPostService()


def _gen(extra: dict) -> str:
    return svc.generate_conf_file(MrtkPostConfig(extra_toml=extra))


def test_no_extras_leaves_the_output_unchanged():
    assert _gen({}) == svc.generate_conf_file(MrtkPostConfig())
    # Only empty tables: nothing to add either.
    assert _gen({"positioning": {}, "future": {"sub": {}}}) == _gen({})


def test_unknown_keys_are_added():
    t = tomllib.loads(_gen({
        "positioning": {"future_key": 3, "future": {"name": "x"}},
        "future_table": {"ratio": 1.5, "on": False, "list": [1, 2], "sats": ["G01", "E11"]},
    }))
    assert t["positioning"]["future_key"] == 3
    assert t["positioning"]["future"] == {"name": "x"}
    assert t["future_table"] == {"ratio": 1.5, "on": False, "list": [1, 2], "sats": ["G01", "E11"]}
    # The rest of the generated TOML is still there.
    assert t == toml_extras.merge(tomllib.loads(_gen({})), t)


def test_generated_values_win():
    base = tomllib.loads(_gen({}))
    t = tomllib.loads(_gen({
        "positioning": {"elevation_mask": 99, "mode": "single"},
        "output": "not a table",
        "files": {"satellite_atx": {"not": "a value"}},
    }))
    assert t == base


def test_strings_and_keys_are_escaped():
    odd = 'C:\\dir\\"quoted"\n\ttab \u00e9 del\x7f \x01'
    t = tomllib.loads(_gen({"future": {"path": odd, "key with space": 1, "a.b": 2, "del\x7fkey": 3}}))
    assert t["future"] == {"path": odd, "key with space": 1, "a.b": 2, "del\x7fkey": 3}


def test_inline_tables_in_arrays():
    t = tomllib.loads(_gen({"future": {"items": [{"a": 1, "b": "x"}, {"a": 2}]}}))
    assert t["future"]["items"] == [{"a": 1, "b": "x"}, {"a": 2}]


def test_streams_are_never_taken_from_extras():
    """RT writes [streams.*] itself; a second copy would be invalid TOML."""
    extra = {"streams": {"input": {"rover": {"type": "ntripcli", "path": "u:p@host/MNT"}}}}
    assert _gen(extra) == _gen({})
    run = MrtkRunService().generate_run_toml(
        MrtkPostConfig(extra_toml={**extra, "future": {"k": 1}}).model_dump(),
        StreamsConfigModel(),
    )
    t = tomllib.loads(run)
    assert t["future"] == {"k": 1}
    assert "u:p@host" not in run


def test_rt_toml_keeps_extras():
    cfg = MrtkPostConfig(extra_toml={"positioning": {"future_key": "on"}, "console": {"timetype": "utc"}})
    t = tomllib.loads(MrtkRunService().generate_run_toml(cfg.model_dump(), StreamsConfigModel()))
    assert t["positioning"]["future_key"] == "on"
    assert t["console"] == {"timetype": "utc"}
    assert "rover" in t["streams"]["input"]


# ── Presets ──────────────────────────────────────────────────────────────


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(presets, "PRESETS_DIR", tmp_path / "presets")
    monkeypatch.setattr(presets, "BUNDLED_PRESETS_DIR", tmp_path / "bundled")
    return TestClient(app)


def test_preset_saved_as_toml_loads_as_toml(client, tmp_path):
    text = _gen({"future": {"k": 1}})
    r = client.post("/api/presets/post", json={"name": "Mine", "toml": text})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    saved = (tmp_path / "presets" / "post" / f"{pid}.toml").read_text()
    assert saved == "# Preset: Mine\n" + text
    got = client.get(f"/api/presets/post/{pid}").json()
    assert got["name"] == "Mine"
    assert got["config"] == tomllib.loads(text)


def test_preset_rejects_invalid_toml(client, tmp_path):
    r = client.post("/api/presets/post", json={"name": "Bad", "toml": "[positioning\n"})
    assert r.status_code == 400
    assert not list((tmp_path / "presets" / "post").glob("*.toml"))


def test_preset_duplicate_still_takes_a_dict(client):
    """Duplicate re-posts the parsed TOML it read; it must come back equal."""
    cfg = tomllib.loads(_gen({
        "future": {"path": 'C:\\x\\"q"', "tiny": 1.25e-7, "items": [{"a": 1}], "odd key": True},
    }))
    r = client.post("/api/presets/realtime", json={"name": "Copy", "config": cfg})
    assert r.status_code == 200
    got = client.get(f"/api/presets/realtime/{r.json()['id']}").json()
    assert got["config"] == cfg


def test_preset_needs_toml_or_config(client):
    assert client.post("/api/presets/post", json={"name": "Empty"}).status_code == 400



def test_rt_drops_the_console_password():
    """The server logs in with -w ""; rtkrcv reads passwd from the TOML after
    the arguments, so a kept passwd would lock it out of the console."""
    cfg = MrtkPostConfig(extra_toml={"console": {"passwd": "admin", "timetype": "utc"}})
    t = tomllib.loads(MrtkRunService().generate_run_toml(cfg.model_dump(), StreamsConfigModel()))
    assert t["console"] == {"timetype": "utc"}
    cfg = MrtkPostConfig(extra_toml={"console": {"passwd": "admin"}})
    assert "console" not in tomllib.loads(
        MrtkRunService().generate_run_toml(cfg.model_dump(), StreamsConfigModel())
    )
    # PP export keeps it: it is the user's file.
    assert tomllib.loads(svc.generate_conf_file(cfg))["console"] == {"passwd": "admin"}


def test_unparseable_generator_output_is_left_alone():
    """The generator does not escape strings; extras must not turn that
    into a server error (mrtk reports the bad TOML, as before)."""
    cfg = MrtkPostConfig(extra_toml={"future": {"k": 1}})
    cfg.files.trace = 'bad"quote'
    text = svc.generate_conf_file(cfg)
    cfg.extra_toml = {}
    assert text == svc.generate_conf_file(cfg)
