"""Regenerate docs/reference/config-coverage.md: which config fields the form exposes.

    uv run python scripts/gen_config_coverage.py [--mrtklib ../MRTKLIB]

Needs frontend/node_modules (esbuild) and an MRTKLIB git checkout that has
the tag in .mrtklib-version. The chain is traced, not read by hand:

1. frontend field -> backend field: change each leaf of the default config
   and diff configToBackend()'s output (scripts/config_coverage_fe.ts);
2. backend field -> TOML key: change each leaf of MrtkPostConfig and diff
   the TOML that generate_conf_file() writes;
3. TOML key -> mrtk option: MRTKLIB's toml_mapping (src/core/mrtk_toml.c).

Which mrtk app reads an option is not derived. Options registered only in
rtkrcv.c are run-only, and APP_ONLY lists the ones checked by reading the
MRTKLIB source (#90). Everything else is marked as read by both.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import sys
import tarfile
import tempfile
import tomllib
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from mrtklib_web_ui.services import mrtk_post_service as svc_mod  # noqa: E402
from mrtklib_web_ui.services.mrtk_post_service import MrtkPostConfig, MrtkPostService  # noqa: E402

OUT = ROOT / "docs/reference/config-coverage.md"
FORM = ROOT / "frontend/src/components/ProcessingConfigTabs.tsx"

# Options that only one of mrtk post / mrtk run reads, checked in the
# MRTKLIB source. The form disables them in the other mode.
APP_ONLY = {
    "positioning.solution_type": ("post", "postpos.c:1815; rtksvr.c never reads it"),
    "files.eop": ("post", "postpos.c:1724"),
    "files.station_pos": ("post", "postpos.c:1785"),
    "files.trace": ("post", "postpos.c:1710; rtkrcv.c:2181 opens rtkrcv_*.trace instead"),
    "output.options": ("post", "postpos.c:225"),
    "output.static_solution": ("post", "postpos.c:823"),
    "input.rinex.option_1": ("post", "postpos.c:1367"),
    "input.rinex.option_2": ("post", "postpos.c:1367"),
    "files.temp_dir": ("run", "rtkrcv.c:622"),
    "antenna.base.max_average_epochs": ("run", "rtksvr.c:921"),
    "antenna.base.init_reset": ("run", "rtksvr.c:1249"),
}

# MRTKLIB keys the UI writes some other way.
WRITTEN_ELSEWHERE = {
    "streams.": "mrtk run, from the I/O Streams panel (mrtk_run_service.generate_run_toml)",
    "positioning.constellations": "replaced by positioning.systems, which mrtk reads first",
}

# UI fields that do not go to the TOML on purpose.
NOT_TOML = {
    "time.": "mrtk post -ts / -te / -ti",
    "output.debugTrace": "mrtk post -x / mrtk run -t",
    "positioning.signalMode": "derived from positioning.signals",
    "server.l6Margin": "legacy [server] l6_margin; the form uses positioning.clas.l6Merge",
}

BACKEND_BASES = [
    {"positioning": {"positioning_mode": "kinematic"}},
    {"positioning": {"positioning_mode": "kinematic", "robust": "on", "tdcp": "on"}},
    {"positioning": {"positioning_mode": "ppp-kinematic", "correction": "igs"}},
    {"positioning": {"positioning_mode": "ppp-rtk", "correction": "qzs-clas"}},
    {"positioning": {"positioning_mode": "single"}},
    {"positioning": {"positioning_mode": "kinematic", "signals": "G1C,G2W"}},
]


def flat(t: dict, p: str = "") -> dict:
    out = {}
    for k, v in t.items():
        if isinstance(v, dict):
            out.update(flat(v, f"{p}{k}."))
        else:
            out[p + k] = v
    return out


def frontend_map() -> dict[str, list[str]]:
    esbuild = ROOT / "frontend/node_modules/.bin/esbuild"
    with tempfile.TemporaryDirectory() as tmp:
        bundle = Path(tmp) / "fe.cjs"
        subprocess.run(
            [str(esbuild), str(ROOT / "scripts/config_coverage_fe.ts"), "--bundle", "--platform=node",
             "--format=cjs", f"--outfile={bundle}", "--log-level=warning"],
            check=True,
        )
        return json.loads(subprocess.run(["node", str(bundle)], check=True, capture_output=True, text=True).stdout)


def backend_map() -> dict[str, set[str]]:
    service = MrtkPostService()
    enums = sorted(set(re.findall(r'"([A-Za-z0-9_.%+\-]+)"\s*:', Path(svc_mod.__file__).read_text())))

    def toml(d: dict) -> dict:
        return flat(tomllib.loads(service.generate_conf_file(MrtkPostConfig.model_validate(d))))

    def alternatives(v):
        if isinstance(v, bool):
            return [not v]
        if isinstance(v, int):
            return [v + 3, 1 if v == 0 else 0]
        if isinstance(v, float):
            return [v * 2 + 0.37, 0.0 if v else 1.0]
        if isinstance(v, str):
            return [v + "_x", "on", "off", "/workspace/x.dat", "1", "0", *enums]
        if isinstance(v, list):
            if v and all(isinstance(x, (int, float)) for x in v):
                return [[x + 1.5 for x in v]]
            return [[*v, "X"], []]
        return []

    result: dict[str, set[str]] = {}
    for override in BACKEND_BASES:
        base = MrtkPostConfig.model_validate(override).model_dump()
        t0 = toml(base)
        for path, value in flat(base).items():
            keys = path.split(".")
            changed = result.setdefault(path, set())
            for alt in alternatives(value):
                d = copy.deepcopy(base)
                cur = d
                for k in keys[:-1]:
                    cur = cur[k]
                cur[keys[-1]] = alt
                try:
                    t1 = toml(d)
                except Exception:
                    continue
                changed |= {k for k in t0.keys() | t1.keys() if t0.get(k) != t1.get(k)}
    # The antenna type is written only when its switch and its name are both set
    for side in ("rover", "base"):
        result[f"antenna.{side}.antenna_type"].add(f"antenna.{side}.type")
        result[f"antenna.{side}.antenna_type_enabled"].add(f"antenna.{side}.type")
    return result


def mrtklib_sources(repo: Path, tag: str) -> dict[str, str]:
    data = subprocess.run(["git", "-C", str(repo), "archive", tag, "src/core/mrtk_toml.c", "apps/rtkrcv/rtkrcv.c"],
                          check=True, capture_output=True).stdout
    with tarfile.open(fileobj=BytesIO(data)) as tar:
        return {m.name: tar.extractfile(m).read().decode(errors="ignore") for m in tar.getmembers() if m.isfile()}


def form_paths() -> set[str]:
    """Frontend fields the form reads (``config.a.b``, not ``...config.a.b`` spreads)."""
    text = FORM.read_text()
    text = text[: text.index("export function TomlDrawer")]
    return set(re.findall(r"(?<!\.\.\.)\bconfig\.([a-zA-Z]+(?:\.[a-zA-Z0-9]+)+)", text))


def on_form(path: str, paths: set[str]) -> bool:
    parts = path.split(".")
    return any(".".join(parts[:i]) in paths for i in range(2, len(parts) + 1))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mrtklib", type=Path, default=ROOT.parent / "MRTKLIB")
    args = ap.parse_args()
    tag = (ROOT / ".mrtklib-version").read_text().strip()

    src = mrtklib_sources(args.mrtklib, tag)
    toml_c, rtkrcv_c = src["src/core/mrtk_toml.c"], src["apps/rtkrcv/rtkrcv.c"]
    mapping_block = toml_c[toml_c.index("toml_mapping[]"): toml_c.index("toml_alias[]")]
    mapping = {f"{s}.{k}": legacy for s, k, legacy in re.findall(r'\{"([^"]+)", *"([^"]+)", *"([^"]+)"\}', mapping_block)}
    mapping["positioning.systems"] = "(navsys list)"
    run_registered = set(re.findall(r'\{"([a-z0-9_-]+)", *-?\d+, *\(void\s*\*\)', rtkrcv_c))

    fe = frontend_map()
    be = backend_map()
    paths = form_paths()

    rows = []  # (toml key, frontend fields, on form, read by)
    toml_to_fe: dict[str, set[str]] = {}
    unmapped_fe = []
    for f, backend_fields in sorted(fe.items()):
        keys = {k for b in backend_fields for k in be.get(b, ())}
        if not keys:
            unmapped_fe.append(f)
        for k in keys:
            toml_to_fe.setdefault(k, set()).add(f)

    def read_by(key: str) -> str:
        if key in APP_ONLY:
            return f"{APP_ONLY[key][0]} only ({APP_ONLY[key][1]})"
        if mapping.get(key) in run_registered:
            return "run only (rtkrcv.c option)"
        return "both"

    for key in sorted(toml_to_fe):
        fields = sorted(toml_to_fe[key])
        exposed = any(on_form(f, paths) for f in fields)
        rows.append((key, fields, exposed, read_by(key)))

    written = set(toml_to_fe)

    def elsewhere(key: str) -> str | None:
        return next((v for p, v in WRITTEN_ELSEWHERE.items() if key == p or (p.endswith(".") and key.startswith(p))), None)

    roundtrip = sorted(k for k in mapping if k not in written and not elsewhere(k))
    other = sorted(k for k in mapping if k not in written and elsewhere(k))
    unknown = sorted(k for k in written if k not in mapping)

    L = [
        "# Config coverage",
        "",
        f"Generated by `scripts/gen_config_coverage.py` for MRTKLIB {tag}. Do not edit by hand.",
        "",
        "Each TOML key the UI writes, the frontend fields it comes from, whether the",
        "Real-time / Post-processing form has a control for it, and which `mrtk` app",
        "reads it. Keys with no control are written with the imported value or the",
        "default.",
        "",
        "- **Control**: the form reads the field (`config.a.b` in",
        "  `ProcessingConfigTabs.tsx`, found by a text search).",
        "- **Read by**: `post only` / `run only` were checked in the MRTKLIB source (file",
        "  and line given), or the option is registered in `rtkrcv.c` only. The form",
        "  disables those controls in the other mode, and hides the Server section in",
        "  Post-processing. `both` means not checked one by one: the option is in the",
        "  shared option table.",
        "",
        f"- Keys the UI writes: {len(rows)}, with a control: {sum(r[2] for r in rows)}",
        f"- MRTKLIB keys the UI never writes: {len(roundtrip)} (kept from an imported TOML on export)",
        "",
        "## Keys the UI writes",
        "",
        "| TOML key | Frontend field | Control | Read by |",
        "|---|---|---|---|",
    ]
    for key, fields, exposed, by in rows:
        L.append(f"| `{key}` | {'<br>'.join(f'`{f}`' for f in fields)} | {'yes' if exposed else '—'} | {by} |")
    L += ["", "## Frontend fields that are not TOML keys", "",
          "| Frontend field | Where it goes |", "|---|---|"]
    for f in unmapped_fe:
        where = next((v for p, v in NOT_TOML.items() if f == p or (p.endswith(".") and f.startswith(p))), "**not written**")
        L.append(f"| `{f}` | {where} |")
    L += ["", "## MRTKLIB keys the UI never writes", "",
          "No control and no field. A key from an imported TOML survives export through",
          "`extraToml` (#230); otherwise `mrtk` uses its default. `mrtk run`"
          " started from the UI drops `console.passwd`: the UI logs in to the"
          " console without one.", ""]
    L += [f"- `{k}` ({mapping[k]})" for k in roundtrip]
    L += ["", "## MRTKLIB keys written outside the config form", ""]
    groups: dict[str, list[str]] = {}
    for k in other:
        groups.setdefault(elsewhere(k), []).append(k)
    for where, keys in groups.items():
        shown = f"`{keys[0]}`" if len(keys) == 1 else f"`{keys[0].split('.')[0]}.*` ({len(keys)} keys)"
        L.append(f"- {shown}: {where}")
    if unknown:
        L += ["", "## Keys the UI writes that MRTKLIB does not know", ""] + [f"- `{k}`" for k in unknown]
    OUT.write_text("\n".join(L) + "\n")
    missing = [f for f in unmapped_fe if not any(f == p or (p.endswith(".") and f.startswith(p)) for p in NOT_TOML)]
    print(f"wrote {OUT.relative_to(ROOT)}: {len(rows)} keys, {len(roundtrip)} round-trip only")
    if missing or unknown:
        print("needs a look:", missing, unknown)
        sys.exit(1)


if __name__ == "__main__":
    main()
