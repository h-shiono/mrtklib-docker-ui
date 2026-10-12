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
    # Passed on the command line (mrtk post -x / mrtk run -t), not in TOML.
    "output.debug_trace",
    # UI state that always mirrors whether `signals` is set (the form sets
    # both together); the generator decides from `signals` itself.
    "positioning.signal_mode",
}

# A valid non-default value for every string field with a non-empty
# default (option lists from frontend/src/types/mrtkPostConfig.ts and the
# form). Empty-default strings get a path; numbers and lists are shifted.
ALT_VALUES = {
    "positioning.positioning_mode": "static",
    "positioning.correction": "igs",
    "positioning.frequency": "l1+l2+l5",
    "positioning.signal_mode": "signals",
    "positioning.filter_type": "combined",
    "positioning.receiver_dynamics": "on",
    "positioning.ephemeris_option": "precise",
    "positioning.robust": "on",
    "positioning.tdcp": "on",
    "positioning.corrections.phase_windup": "on",
    "positioning.corrections.iono_compensation": "ssr",
    "positioning.corrections.gps_frequency": "l1+l5",
    "positioning.corrections.qzs_frequency": "l1+l5",
    "positioning.corrections.tidal_correction": "on",
    "positioning.atmosphere.ionosphere": "dual-freq",
    "positioning.atmosphere.troposphere": "est-ztd",
    "positioning.clas.enhanced_spp_seed": "cn0+tdcp+robust",
    "ambiguity_resolution.mode": "fix-and-hold",
    "ambiguity_resolution.glonass_ar": "autocal",
    "ambiguity_resolution.bds_ar": "off",
    "ambiguity_resolution.qzs_ar": "off",
    "ambiguity_resolution.thresholds.alpha": "1%",
    "ambiguity_resolution.thresholds.reference_dop": "sd",
    "signal_selection.gps": "L1/L5",
    "signal_selection.qzs": "L1/L2",
    "signal_selection.galileo": "E1/E5b",
    "signal_selection.bds2": "B1I/B2I",
    "signal_selection.bds3": "B1I/B2I",
    "receiver.phase_shift": "table",
    "antenna.rover.mode": "xyz",
    "antenna.base.mode": "xyz",
    "output.solution_format": "xyz",
    "output.time_format": "utc",
    "output.lat_lon_format": "ddd-mm-ss.sss",
    "output.height": "geodetic",
    "output.geoid_model": "egm96",
    "output.static_solution_mode": "single",
    "output.output_solution_status": "state",
    "output.debug_trace": "level2",
    "server.nav_msg_select": "rover",
    "server.sbas_satellite": "129",
}

svc = MrtkPostService()


def _shift(v):
    """Numbers (also inside nested lists) moved off their default."""
    if isinstance(v, list):
        return [_shift(x) for x in v]
    if isinstance(v, bool):
        return not v
    if isinstance(v, int):
        return v + 1
    if isinstance(v, float):
        return v + 1.5
    return v


def _perturb(model: BaseModel, path=()) -> BaseModel:
    """Every leaf set to a non-default value of its type."""
    upd = {}
    for name, field in type(model).model_fields.items():
        v = getattr(model, name)
        dotted = ".".join(path + (name,))
        if isinstance(v, BaseModel):
            upd[name] = _perturb(v, path + (name,))
        elif dotted in ALT_VALUES:
            upd[name] = ALT_VALUES[dotted]
        elif typing.get_origin(field.annotation) is typing.Literal:
            others = [a for a in typing.get_args(field.annotation) if a != v]
            upd[name] = others[0] if others else v
        elif isinstance(v, str):
            upd[name] = v or "/workspace/x.dat"
        else:
            upd[name] = _shift(v)
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
    return _set(cfg, ("positioning", "positioning_mode"), mode)


@pytest.mark.parametrize("mode", MODES)
def test_generated_toml_parses_and_uses_known_keys(mode):
    for cfg in (_set(MrtkPostConfig(), ("positioning", "positioning_mode"), mode), _max_config(mode)):
        parsed = tomllib.loads(svc.generate_conf_file(cfg))
        unknown = set(_flat_keys(parsed)) - KNOWN_KEYS
        assert not unknown, f"keys not in the MRTKLIB schema: {sorted(unknown)}"


def test_every_config_field_is_perturbed():
    """The coverage test below is only as good as this: every leaf must get a
    non-default value (add new string fields to ALT_VALUES)."""
    base, pert = MrtkPostConfig(), _perturb(MrtkPostConfig())
    unchanged = [".".join(p) for p in _leaves(base) if _get(pert, p) == _get(base, p)]
    assert not unchanged, f"add a non-default value to ALT_VALUES for: {unchanged}"


def test_every_config_field_reaches_the_toml():
    """Changing any field must change the output in at least one mode."""
    base = MrtkPostConfig()
    fields = list(_leaves(base))
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
