"""rtkrcv `satellite` parsing: `used` matches the solution's ns (#120)."""

from mrtklib_web_ui.services.mrtk_run_service import parse_satellite_output

HEADER = "\x1b[1mSAT C1    Az   El L1 L2  Fix1  Fix2  P1Res  P2Res   L1Res   L2Res  Sl1  Sl2  Lock1  Lock2 Rj1 Rj2\x1b[0m"


def _row(prn, c1, l1, l2, fix1="-", fix2="-"):
    return f"{prn} {c1}  123.4 45.6 {l1} {l2} {fix1:>5} {fix2:>5}  0.000  0.000  0.0000  0.0000    0    0     10     10   0   0"


def test_used_follows_l1_while_the_filter_runs():
    # 4 SPP-valid satellites, 2 of them valid on L1 in the RTK filter
    text = "\n".join([
        HEADER,
        _row("G01", "OK", "OK", "OK", "FIX", "FIX"),
        _row("G02", "OK", "OK", "-", "FLOAT"),
        _row("E11", "OK", "-", "-"),
        _row("R05", "OK", "-", "-"),
        _row("J02", "-", "-", "-"),
    ])
    sats = {s["prn"]: s for s in parse_satellite_output(text)}
    assert [p for p, s in sats.items() if s["valid"]] == ["G01", "G02", "E11", "R05"]
    assert [p for p, s in sats.items() if s["used"]] == ["G01", "G02"]
    assert sats["G01"]["fix"] == "FIX"
    assert sats["G02"]["fix"] == "FLOAT"
    assert sats["E11"]["fix"] == "NONE"


def test_single_mode_falls_back_to_spp_valid():
    # No L column is OK (single mode, or the filter fell back to SPP)
    text = "\n".join([HEADER, _row("G01", "OK", "-", "-"), _row("G02", "-", "-", "-")])
    sats = {s["prn"]: s for s in parse_satellite_output(text)}
    assert sats["G01"]["used"] is True
    assert sats["G02"]["used"] is False


def test_three_frequency_columns():
    header = "SAT C1    Az   El L1 L2 L5  Fix1  Fix2  Fix5  P1Res"
    rows = [
        "C20 OK  200.0 30.0 - OK OK     -   FIX     -  0.000",
        "C21 OK  210.0 40.0 OK OK OK FLOAT     -     -  0.000",
    ]
    c20, c21 = parse_satellite_output("\n".join([header, *rows]))
    assert c20["used"] is False  # valid on L2 / L5 only: not in the L1 count
    assert c20["valid"] is True
    assert c20["fix"] == "FIX"
    assert c21["used"] is True
    assert c21["fix"] == "FLOAT"
