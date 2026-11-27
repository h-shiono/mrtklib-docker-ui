"""Fixtures for the TOML round trip checked by the frontend.

A PP / RT config goes out through the backend (configToBackend → JSON →
`generate_conf_file`) and comes back through the backend (`/api/config/import`
returns `tomllib.loads`) into `tomlToConfig`. The browser never parses TOML,
so each case stores both ends of the backend half:

- ``config``: the backend config (``MrtkPostConfig.model_dump()``);
- ``toml``: what `/api/config/import` returns for the TOML generated from it;
- ``not_written``: fields whose value does not reach that TOML (other
  positioning modes, NOT_EMITTED), so the frontend cannot get them back.

This test fails when the stored fixtures no longer match the generator.
``frontend/src/utils/tomlRoundTrip.test.ts`` then checks that
``configToBackend(tomlToConfig(toml))`` gives ``config`` back.

Regenerate after a generator change with
``UPDATE_FIXTURES=1 uv run pytest tests/test_config_roundtrip_fixtures.py``.
"""

import json
import os
import tomllib
from pathlib import Path

import pytest
from test_toml_generation import _get, _leaves, _max_config, _set

from mrtklib_web_ui.services.mrtk_post_service import MrtkPostConfig, MrtkPostService

FIXTURES = Path(__file__).parent / "fixtures" / "config_roundtrip"

svc = MrtkPostService()


# name -> config. "ui-*": what the frontend's configToBackend() sends for
# the UI configs in tomlRoundTrip.test.ts (it writes ui-*.input.json);
# "all-*": every field moved off its backend default
# (test_toml_generation._perturb), so a field the import does not read shows
# up as a difference.
UI_INPUTS = sorted(FIXTURES.glob("ui-*.input.json"))
CASES = {
    **{
        p.name.removesuffix(".input.json"): MrtkPostConfig.model_validate_json(p.read_text())
        for p in UI_INPUTS
    },
    "all-kinematic": _max_config("kinematic"),
    "all-ppp-kinematic": _max_config("ppp-kinematic"),
    "all-ppp-rtk": _max_config("ppp-rtk"),
    # Keys no form field reads, kept through import → export (#230).
    "extra-keys": MrtkPostConfig(
        extra_toml={
            "positioning": {"future_key": 3, "future": {"name": "x"}},
            "files": {"future_file": "/workspace/a b/\"q\"\\x.dat"},
            "future_table": {"on": True, "ratio": 1.5, "list": [1, 2], "sats": ["G01"]},
        }
    ),
}


def _not_written(cfg: MrtkPostConfig) -> list[str]:
    """Fields that do not change the generated TOML when moved off their
    current value (to the default, or for a default config to the perturbed
    value)."""
    full = svc.generate_conf_file(cfg)
    other = _max_config(cfg.positioning.positioning_mode)
    base = MrtkPostConfig()
    out = []
    for p in _leaves(cfg):
        alt = _get(base, p) if _get(cfg, p) != _get(base, p) else _get(other, p)
        if svc.generate_conf_file(_set(cfg, p, alt)) == full:
            out.append(".".join(p))
    return out


def _case(cfg: MrtkPostConfig) -> dict:
    return {
        "config": cfg.model_dump(mode="json"),
        "toml": tomllib.loads(svc.generate_conf_file(cfg)),
        "not_written": _not_written(cfg),
    }


def test_ui_inputs_exist():
    assert UI_INPUTS, "no ui-*.input.json; run UPDATE_FIXTURES=1 npm test in frontend/"


def _extra_keys(sent, model, prefix=""):
    for k, v in sent.items():
        name = f"{prefix}.{k}" if prefix else k
        if k not in model:
            yield name
        elif isinstance(v, dict):
            yield from _extra_keys(v, model[k], name)


@pytest.mark.parametrize("path", UI_INPUTS, ids=lambda p: p.name)
def test_ui_input_fields_are_known_to_the_backend(path):
    """A field configToBackend sends that MrtkPostConfig lacks is dropped
    without an error, so it would never reach the TOML."""
    sent = json.loads(path.read_text())
    model = MrtkPostConfig.model_validate(sent).model_dump(mode="json")
    assert list(_extra_keys(sent, model)) == []


@pytest.mark.parametrize("name", CASES)
def test_round_trip_fixture_is_current(name):
    path = FIXTURES / f"{name}.json"
    want = _case(CASES[name])
    if os.environ.get("UPDATE_FIXTURES"):
        path.write_text(json.dumps(want, indent=2, ensure_ascii=False) + "\n")
    assert path.exists(), f"{path} missing; run with UPDATE_FIXTURES=1"
    assert json.loads(path.read_text()) == want, (
        f"{path.name} is stale; run UPDATE_FIXTURES=1 uv run pytest {Path(__file__).name}"
    )
