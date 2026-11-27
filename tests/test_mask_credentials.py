"""Credential masking for log lines.

The cases live in tests/fixtures/mask_cases.json, which the frontend's
mirror (frontend/src/utils/maskPath.test.ts, maskLogLine) runs as well, so
the two implementations cannot drift apart unnoticed.
"""

import json
from pathlib import Path

import pytest

from mrtklib_web_ui.services.mask_credentials import mask_log_line

CASES = json.loads((Path(__file__).parent / "fixtures" / "mask_cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["line"] for c in CASES])
def test_mask_log_line(case):
    assert mask_log_line(case["line"]) == case["expected"]
