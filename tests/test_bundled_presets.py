"""Read-only presets shipped in the image (docker/bundled-presets/<mode>/*.toml,
served from /opt/mrtklib/presets by api/presets.py)."""

import tomllib
from pathlib import Path

import pytest

from mrtklib_web_ui.services.conf2toml import MAPPING

BUNDLED = Path(__file__).resolve().parent.parent / "docker" / "bundled-presets"
PRESETS = sorted(BUNDLED.rglob("*.toml"))
KNOWN_KEYS = {(section, key) for _, section, key, _ in MAPPING}


def _flat_keys(d, prefix=""):
    for k, v in d.items():
        if isinstance(v, dict):
            yield from _flat_keys(v, f"{prefix}.{k}" if prefix else k)
        else:
            yield (prefix, k)


def test_presets_found():
    assert PRESETS, f"no presets under {BUNDLED}"


@pytest.mark.parametrize("path", PRESETS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_first_line_names_the_preset(path):
    # _preset_name() reads only the first line; without it the list shows
    # the file stem ("Gal Has").
    first = path.read_text().split("\n", 1)[0]
    assert first.startswith("# Preset: ") and first[len("# Preset: "):].strip()


@pytest.mark.parametrize("path", PRESETS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_keys_are_in_the_mrtklib_schema(path):
    parsed = tomllib.loads(path.read_text())
    # [streams.*] is not in the conf2toml MAPPING (streams are mapped
    # separately) and is ignored when a preset is loaded.
    keys = {(s, k) for s, k in _flat_keys(parsed) if not s.startswith("streams.")}
    unknown = keys - KNOWN_KEYS
    assert not unknown, f"keys not in the MRTKLIB schema: {sorted(unknown)}"
