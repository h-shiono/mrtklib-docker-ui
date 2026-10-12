"""TOML generation for mrtk post / run (services/mrtk_post_service.py).

The vendored conf2toml MAPPING (MRTKLIB scripts/tools/conf2toml.py) is the
v0.7.6 schema; every key we emit must be in it, and every config field must
reach the TOML in at least one positioning mode.
"""

import tomllib
import typing

import pytest
from pydantic import BaseModel

from mrtklib_web_ui.services.conf2toml import MAPPING, convert_text
from mrtklib_web_ui.services.mrtk_post_service import MrtkPostConfig, MrtkPostService

MODES = [
    "single", "dgps", "kinematic", "static", "moving-base", "fixed",
    "ppp-kinematic", "ppp-static", "ppp-fixed", "ppp-rtk", "vrs-rtk",
]
KNOWN_KEYS = {(section, key) for _, section, key, _ in MAPPING}

# Fields intentionally not written to the TOML.
NOT_EMITTED = {
    # Legacy alias; v0.7.6 uses positioning.clas.resilience.l6_merge.
    "server.l6_margin",
}

svc = MrtkPostService()


def _perturb(model: BaseModel) -> BaseModel:
    """Every leaf set to a non-default value of its type."""
    upd = {}
    for name, field in type(model).model_fields.items():
        v = getattr(model, name)
        if isinstance(v, BaseModel):
            upd[name] = _perturb(v)
        elif typing.get_origin(field.annotation) is typing.Literal:
            others = [a for a in typing.get_args(field.annotation) if a != v]
            upd[name] = others[0] if others else v
        elif isinstance(v, bool):
            upd[name] = not v
        elif isinstance(v, int):
            upd[name] = v + 1
        elif isinstance(v, float):
            upd[name] = v + 1.5
        elif isinstance(v, str):
            upd[name] = v or "/workspace/x.dat"
    return model.model_copy(update=upd)


def _leaves(model: BaseModel, path=()):
    for name in type(model).model_fields:
        v = getattr(model, name)
        if isinstance(v, BaseModel):
            yield from _leaves(v, path + (name,))
        else:
            yield path + (name,)


def _get(model, path):
    for p in path:
        model = getattr(model, p)
    return model


def _set(model, path, value):
    head = path[0]
    new = value if len(path) == 1 else _set(getattr(model, head), path[1:], value)
    return model.model_copy(update={head: new})


def _flat_keys(d, prefix=""):
    for k, v in d.items():
        if isinstance(v, dict):
            yield from _flat_keys(v, f"{prefix}.{k}" if prefix else k)
        else:
            yield (prefix, k)


def _max_config(mode: str) -> MrtkPostConfig:
    cfg = _perturb(MrtkPostConfig())
    cfg = _set(cfg, ("positioning", "positioning_mode"), mode)
    # String enums are not perturbed; turn on the options that gate keys.
    cfg = _set(cfg, ("positioning", "robust"), "on")
    return _set(cfg, ("positioning", "tdcp"), "on")


@pytest.mark.parametrize("mode", MODES)
def test_generated_toml_parses_and_uses_known_keys(mode):
    for cfg in (_set(MrtkPostConfig(), ("positioning", "positioning_mode"), mode), _max_config(mode)):
        parsed = tomllib.loads(svc.generate_conf_file(cfg))
        unknown = set(_flat_keys(parsed)) - KNOWN_KEYS
        assert not unknown, f"keys not in the MRTKLIB schema: {sorted(unknown)}"


def test_every_config_field_reaches_the_toml():
    """Changing any field must change the output in at least one mode."""
    base = MrtkPostConfig()
    fields = [p for p in _leaves(base) if _get(_max_config("kinematic"), p) != _get(base, p)]
    unreached = {".".join(p) for p in fields}
    for mode in MODES:
        cfg = _max_config(mode)
        full = svc.generate_conf_file(cfg)
        for p in fields:
            name = ".".join(p)
            if name in unreached and svc.generate_conf_file(_set(cfg, p, _get(base, p))) != full:
                unreached.discard(name)
    assert unreached == NOT_EMITTED, (
        f"fields never written to the TOML: {sorted(unreached - NOT_EMITTED)}"
    )


def test_non_default_values_round_trip():
    cfg = MrtkPostConfig()
    cfg = _set(cfg, ("positioning", "positioning_mode"), "ppp-kinematic")
    cfg = _set(cfg, ("ambiguity_resolution", "systems"), 0x01 | 0x08)
    cfg = _set(cfg, ("output", "max_solution_std"), 1.5)
    cfg = _set(cfg, ("kalman_filter", "measurement_error", "ura_ratio"), 0.3)
    cfg = _set(cfg, ("slip_detection", "doppler"), 2.5)
    cfg = _set(cfg, ("positioning", "elevation_mask"), 12.5)
    t = tomllib.loads(svc.generate_conf_file(cfg))
    assert t["ambiguity_resolution"]["systems"] == 9
    assert t["output"]["max_solution_std"] == 1.5
    assert t["kalman_filter"]["measurement_error"]["ura_ratio"] == 0.3
    assert t["slip_detection"]["doppler"] == 2.5
    assert t["positioning"]["elevation_mask"] == 12.5


def test_legacy_conf_converts_to_schema_keys():
    out = convert_text("pos1-posmode = kinematic\npos2-arsys = 9\nout-maxsolstd = 1.5\n")
    parsed = tomllib.loads(out)
    assert parsed["positioning"]["mode"] == "kinematic"
    assert parsed["ambiguity_resolution"]["systems"] == 9
    assert parsed["output"]["max_solution_std"] == 1.5
